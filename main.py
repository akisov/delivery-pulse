import os
import asyncio
import httpx
from datetime import date, datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import json

TRACKER_TOKEN = os.environ.get("TRACKER_TOKEN", "")
ORG_ID        = os.environ.get("ORG_ID", "7405124")
TURSO_URL     = os.environ.get("TURSO_URL", "").replace("libsql://", "https://")
TURSO_TOKEN   = os.environ.get("TURSO_TOKEN", "")
MISTRAL_API_KEY = os.environ.get("MISTRAL_TOKEN", "") or os.environ.get("MISTRAL_API_KEY", "")
MISTRAL_MODEL   = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
PRACTICE_URL    = "https://evawiki.int.vkusvill.ru/project/Document/DOC-037888#analiz-blokirovok"

# Кратко суть внутренней практики «Анализ (кластеризация) блокировок» — чтобы AI
# опирался на неё в рекомендациях.
PRACTICE_BRIEF = """Внутренняя практика VkusVill «Анализ блокировок» (кластеризация):
- Блокеры нельзя «снять и забыть»: без устранения корневой причины они возвращаются и удлиняют цикл поставки.
- Раз в месяц блокировки выгружают и смотрят на картину целиком; повторяющиеся причины — это маркеры, где сломан процесс.
- Блокеры делят на ВНУТРЕННИЕ (в зоне контроля команды — чинить в первую очередь) и ВНЕШНИЕ (извне — влиять через договорённости/эскалацию).
- Приоритет = ОБЩЕЕ ВРЕМЯ блокировки (а не то, что громче бесит/свежее/проще починить — это когнитивные ловушки). Особое внимание — блокерам в узком месте.
- Корневую причину ищут методом «5 почему».
- Решение оформляют как ЭКСПЕРИМЕНТ: «Мы полагаем, что [решение] приведёт к [эффект]»; заводят задачу в Яндекс Трекере и проверяют через месяц.
- Для частых ВНЕШНИХ ожиданий — договариваться об SLA с той командой, опираясь на цифры (медианное/общее время ожидания).
- Не чинить редкие, но дорогие в исправлении блокеры (невыгодно).
- Цель: снижение общего времени и количества блокировок, рост предсказуемости (тоньше хвост Lead time, P98/P50)."""

# Классификация причин: внутренняя (в зоне контроля команды) / внешняя (зависимость извне).
REASON_KIND = {
    "Блок другой нашей задачей":       "внутренняя",
    "Переключились на срочную задачу": "внутренняя",
    "Отпуск, больничный":              "внутренняя",
    "Причина не известна":             "внутренняя",  # = «Нет рук»
    "Не указана":                      "внутренняя",
    "Ждем тестовую среду":             "внешняя",
    "Ждем другую команду":             "внешняя",
    "Ждем партнера":                   "внешняя",
    "Ждем ответа заказчика":           "внешняя",
    "Ждем фун. архитекторов":          "внешняя",
    "Ждем тех. архитектров":           "внешняя",
    "Ждем тех. архитекторов":          "внешняя",
    "Внешний фактор":                  "внешняя",
    "Мораторий":                       "внешняя",
    "Ждем дату или событие":           "внешняя",
}

# Доменные особенности именно этих данных (важно, чтобы AI не делал ложных выводов).
DOMAIN_NOTES = """Важные особенности данных (учитывай ОБЯЗАТЕЛЬНО, иначе вывод будет неверным):
- Поле «Причина блокировки» заполняется ВСЕГДА. НЕ пиши, что причины не фиксируются / нет культуры ретроспектив.
- «Причина не известна» (и «Не указана») = «Нет рук» — нехватка свободных исполнителей/ресурсов. Это ВНУТРЕННЯЯ причина; советуй про загрузку и планирование команды.
- SLA есть на ВСЕХ этапах. НИКОГДА не пиши «нет SLA». Если время превышено — это НЕСОБЛЮДЕНИЕ SLA или ошибка планирования, а не его отсутствие.
- Если тебе дан «Характер главной причины» — используй именно его, не меняй внутреннюю на внешнюю и наоборот.
- ВНУТРЕННЯЯ причина = что-то не спланировано/не приоритизировано ВНУТРИ команды (последовательность задач, загрузка, переключения). Рекомендации — про внутренний процесс. НЕ упоминай внешние команды и не предлагай «договориться об SLA вовне».
- ВНЕШНЯЯ причина = зависимость от другой команды/партнёра/заказчика. Тут уместны эскалация, разбор несоблюдения SLA и пересмотр договорённостей (SLA уже есть)."""

QUEUES = ["POOLING", "DOSTAVKAPIKO", "UDOSTAVKA"]

# ── Turso HTTP client ─────────────────────────────────────────────────────────

async def turso_execute(statements: list[dict]) -> list:
    url = f"{TURSO_URL}/v2/pipeline"
    headers = {"Authorization": f"Bearer {TURSO_TOKEN}", "Content-Type": "application/json"}
    payload = {"requests": [{"type": "execute", "stmt": s} for s in statements] + [{"type": "close"}]}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
    results = []
    for item in data.get("results", []):
        if item.get("type") == "ok":
            results.append(item.get("response", {}).get("result", {}))
    return results

def stmt(sql: str, args: list = None) -> dict:
    s: dict = {"sql": sql}
    if args:
        s["args"] = [_val(a) for a in args]
    return s

def _val(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    return {"type": "text", "value": str(v)}

def rows_to_dicts(result: dict) -> list[dict]:
    cols = [c["name"] for c in result.get("cols", [])]
    return [dict(zip(cols, [cell.get("value") for cell in row])) for row in result.get("rows", [])]

# ── DB init ───────────────────────────────────────────────────────────────────

WORK_STATUSES = {
    "vRazrabotke":              "В разработке",
    "testing":                  "Тестирование",
    "analyticalstudy":          "Аналит. проработка",
    "pomesenieVProduktiv":      "Помещение в продуктив",
    "atthecustomersinspection": "На проверке у заказчика",
}

async def init_db():
    await turso_execute([
        stmt("""CREATE TABLE IF NOT EXISTS parent_tasks (
            key TEXT PRIMARY KEY,
            title TEXT,
            queue TEXT,
            created_at TEXT,
            issue_type TEXT,
            issue_type_display TEXT
        )"""),
        stmt("""CREATE TABLE IF NOT EXISTS blockings (
            key TEXT PRIMARY KEY,
            parent_key TEXT NOT NULL,
            title TEXT,
            queue TEXT,
            reason TEXT,
            start_date TEXT,
            end_date TEXT,
            status TEXT,
            created_at TEXT,
            updated_at TEXT
        )"""),
        stmt("CREATE INDEX IF NOT EXISTS idx_blockings_parent ON blockings(parent_key)"),
        stmt("CREATE INDEX IF NOT EXISTS idx_blockings_queue ON blockings(queue)"),
        stmt("""CREATE TABLE IF NOT EXISTS sync_log (
            queue TEXT PRIMARY KEY,
            last_synced TEXT
        )"""),
        stmt("""CREATE TABLE IF NOT EXISTS status_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT NOT NULL,
            status_key TEXT NOT NULL,
            status_display TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT
        )"""),
        stmt("CREATE INDEX IF NOT EXISTS idx_sh_key ON status_history(issue_key)"),
        stmt("""CREATE TABLE IF NOT EXISTS blocking_status (
            blocking_key TEXT PRIMARY KEY,
            parent_key TEXT NOT NULL,
            status_key TEXT,
            status_display TEXT
        )"""),
        stmt("""CREATE TABLE IF NOT EXISTS sle_overrides (
            task_key TEXT PRIMARY KEY,
            cluster TEXT,
            updated_at TEXT
        )"""),
        stmt("""CREATE TABLE IF NOT EXISTS sle_snapshot (
            which TEXT PRIMARY KEY,
            data TEXT,
            updated_at TEXT
        )"""),
    ])
    # Миграция: добавляем колонки если не существуют (игнорируем ошибку если уже есть)
    for col_sql in [
        "ALTER TABLE parent_tasks ADD COLUMN issue_type TEXT",
        "ALTER TABLE parent_tasks ADD COLUMN issue_type_display TEXT",
    ]:
        try:
            await turso_execute([stmt(col_sql)])
        except Exception:
            pass

# ── Tracker API ───────────────────────────────────────────────────────────────

_sem = asyncio.Semaphore(3)

def tracker_headers():
    return {
        "Authorization": f"OAuth {TRACKER_TOKEN}",
        "X-Org-ID": ORG_ID,
        "Content-Type": "application/json"
    }

async def tracker_request(client: httpx.AsyncClient, method: str, path: str, body: dict = None):
    url = f"https://api.tracker.yandex.net{path}"
    for attempt in range(6):
        async with _sem:
            try:
                if method == "GET":
                    r = await client.get(url, headers=tracker_headers())
                else:
                    r = await client.post(url, headers=tracker_headers(), json=body)
            except Exception:
                if attempt == 5:
                    raise
                await asyncio.sleep(2 ** attempt)
                continue
        if r.status_code == 429:
            wait = 5 * (2 ** attempt)
            print(f"  [429] rate limit, ждём {wait}s...")
            await asyncio.sleep(wait)
            continue
        if r.status_code >= 500:
            wait = 3 * (2 ** attempt)
            print(f"  [5xx] {r.status_code}, ждём {wait}s...")
            await asyncio.sleep(wait)
            continue
        r.raise_for_status()
        return r.json()
    raise Exception(f"Failed after retries: {url}")

async def fetch_issues_with_blockings(client, queue, page):
    """Ищем задачи у которых есть связи типа blokirovka через поиск по очереди."""
    data = await tracker_request(client, "POST",
        f"/v2/issues/_search?perPage=100&page={page}",
        {
            "filter": {"queue": queue},
            "expand": "links"
        })
    return data if isinstance(data, list) else []

async def fetch_issue_links(client, key):
    """Получаем все связи задачи."""
    try:
        data = await tracker_request(client, "GET", f"/v2/issues/{key}/links")
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"  [WARN] links {key}: {e}")
        return []

async def fetch_issue(client, key):
    """Получаем данные конкретной задачи (подзадачи-блокировки)."""
    try:
        data = await tracker_request(client, "GET", f"/v2/issues/{key}")
        return data if isinstance(data, dict) else None
    except Exception as e:
        print(f"  [WARN] issue {key}: {e}")
        return None

# ── Sync logic ────────────────────────────────────────────────────────────────

async def sync_queue(client, queue, send):
    await send({"type": "progress", "msg": f"{queue}: загружаем список задач…", "pct": 5})
    print(f"[{queue}] fetching all issues...")

    # Загружаем все задачи очереди
    issues = []
    page = 1
    while True:
        chunk = await fetch_issues_with_blockings(client, queue, page)
        issues.extend(chunk)
        await asyncio.sleep(0.5)
        if len(chunk) < 100:
            break
        page += 1

    print(f"[{queue}] total issues: {len(issues)}")
    await send({"type": "progress", "msg": f"{queue}: {len(issues)} задач, ищем блокировки…", "pct": 15})

    # Сохраняем родительские задачи
    parent_stmts = []
    for iss in issues:
        parent_stmts.append(stmt(
            "INSERT INTO parent_tasks(key,title,queue,created_at,issue_type,issue_type_display) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET title=excluded.title, issue_type=excluded.issue_type, issue_type_display=excluded.issue_type_display",
            [iss["key"], iss.get("summary","—"), queue, iss.get("createdAt",""),
             iss.get("type",{}).get("key",""), iss.get("type",{}).get("display","")]
        ))
    if parent_stmts:
        await turso_execute(parent_stmts)

    # Для каждой задачи ищем связи blokirovka
    BATCH = 5
    blocking_keys_found = 0
    for i in range(0, len(issues), BATCH):
        chunk = issues[i:i + BATCH]
        links_list = await asyncio.gather(
            *[fetch_issue_links(client, iss["key"]) for iss in chunk],
            return_exceptions=True
        )
        await asyncio.sleep(0.5)

        # Собираем ключи подзадач-блокировок
        blocking_pairs = []  # (parent_key, blocking_key)
        for iss, links in zip(chunk, links_list):
            if isinstance(links, Exception):
                continue
            for link in links:
                obj = link.get("object", {})
                obj_key = obj.get("key", "")
                obj_display = obj.get("display", "")
                if not obj_key:
                    continue
                # Маркер (БЛОК) в названии подзадачи — главный признак
                if "(БЛОК)" in obj_display.upper() or "БЛОК" in obj_display[:10].upper():
                    blocking_pairs.append((iss["key"], obj_key))

        # Загружаем данные каждой подзадачи-блокировки
        if blocking_pairs:
            BBLOCKING_BATCH = 3
            for j in range(0, len(blocking_pairs), BBLOCKING_BATCH):
                bchunk = blocking_pairs[j:j + BBLOCKING_BATCH]
                blocking_issues = await asyncio.gather(
                    *[fetch_issue(client, bkey) for _, bkey in bchunk],
                    return_exceptions=True
                )
                await asyncio.sleep(0.3)

                bstmts = []
                for (parent_key, bkey), biss in zip(bchunk, blocking_issues):
                    if isinstance(biss, Exception) or biss is None:
                        continue
                    # Проверяем что это действительно Блокировка
                    issue_type = biss.get("type", {})
                    if issue_type.get("key") != "blokirovka":
                        continue

                    reasons = biss.get("reasonForBlocking", [])
                    reason = reasons[0] if reasons else "Не указана"

                    status = biss.get("status", {}).get("key", "")
                    start_date = biss.get("start", "") or (biss.get("createdAt", "") or "")[:10]
                    end_date = biss.get("end", "") if status == "closed" else ""

                    bstmts.append(stmt(
                        "INSERT INTO blockings(key,parent_key,title,queue,reason,start_date,end_date,status,created_at,updated_at) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?) "
                        "ON CONFLICT(key) DO UPDATE SET "
                        "title=excluded.title, reason=excluded.reason, start_date=excluded.start_date, "
                        "end_date=excluded.end_date, status=excluded.status, updated_at=excluded.updated_at",
                        [bkey, parent_key, biss.get("summary", "—"), queue, reason,
                         start_date, end_date, status,
                         biss.get("createdAt", ""), biss.get("updatedAt", "")]
                    ))
                    blocking_keys_found += 1

                if bstmts:
                    await turso_execute(bstmts)

        done = i + len(chunk)
        pct = 15 + round(done / len(issues) * 75)
        await send({"type": "progress", "msg": f"{queue}: {done}/{len(issues)} задач, блокировок: {blocking_keys_found}", "pct": pct})

    await turso_execute([stmt(
        "INSERT INTO sync_log(queue,last_synced) VALUES(?,?) "
        "ON CONFLICT(queue) DO UPDATE SET last_synced=excluded.last_synced",
        [queue, (datetime.utcnow() + timedelta(hours=3)).strftime("%Y-%m-%d %H:%M")]
    )])
    print(f"[{queue}] done. Blockings found: {blocking_keys_found}")

# ── Query ─────────────────────────────────────────────────────────────────────

async def query_dashboard(queues: list[str], date_from: str = "", date_to: str = ""):
    today = date.today().isoformat()
    q_ph = ",".join("?" * len(queues))

    # Фильтр по дате начала блокировки
    date_filter = ""
    args = [*queues]
    if date_from:
        date_filter += " AND b.start_date >= ?"
        args.append(date_from)
    if date_to:
        date_filter += " AND b.start_date <= ?"
        args.append(date_to)

    results = await turso_execute([stmt(f"""
        SELECT
            b.key AS blocking_key,
            b.parent_key,
            b.title AS blocking_title,
            b.queue,
            b.reason,
            b.start_date,
            b.end_date,
            b.status,
            p.title AS parent_title
        FROM blockings b
        JOIN parent_tasks p ON p.key = b.parent_key
        WHERE b.queue IN ({q_ph}){date_filter}
        ORDER BY b.parent_key, b.start_date
    """, args)])

    rows = rows_to_dicts(results[0]) if results else []

    # Группируем блокировки по родительской задаче
    tasks_map: dict[str, dict] = {}
    for row in rows:
        parent_key = row["parent_key"]
        if parent_key not in tasks_map:
            tasks_map[parent_key] = {
                "key": parent_key,
                "title": row["parent_title"] or "—",
                "url": f"https://tracker.yandex.ru/{parent_key}",
                "queue": row["queue"],
                "blockings": [],
                "totalDays": 0,
            }

        start = row["start_date"] or ""
        end = row["end_date"] or ""
        status = row["status"] or ""

        # Считаем длительность
        days = 0
        if start:
            try:
                start_d = date.fromisoformat(start[:10])
                if status == "closed" and end:
                    end_d = date.fromisoformat(end[:10])
                else:
                    end_d = date.fromisoformat(today)
                days = max(0, (end_d - start_d).days + 1)
            except ValueError:
                days = 0

        blocking = {
            "key": row["blocking_key"],
            "title": row["blocking_title"] or "—",
            "reason": row["reason"] or "Не указана",
            "startDate": start[:10] if start else "",
            "endDate": end[:10] if end else "",
            "status": status,
            "days": days,
            "isActive": status != "closed",
        }
        if days > 0:
            tasks_map[parent_key]["blockings"].append(blocking)
            tasks_map[parent_key]["totalDays"] += days

    tasks = sorted(
        [t for t in tasks_map.values() if t["totalDays"] > 0],
        key=lambda t: t["totalDays"], reverse=True
    )

    queues_out = {q: {"tasks": []} for q in queues}
    for t in tasks:
        q = t["queue"]
        if q in queues_out:
            queues_out[q]["tasks"].append(t)

    # Считаем перцентили по всем задачам
    all_days = [t["totalDays"] for t in tasks if t["totalDays"] > 0]
    def _pct(vals, p):
        if not vals: return 0
        s = sorted(vals)
        return round(s[min(int(len(s) * p), len(s)-1)], 1)
    p85v = _pct(all_days, 0.85)

    # Помечаем outliers
    for t in tasks:
        t["isOutlier"] = t["totalDays"] >= p85v

    return {
        "tasks":  tasks,
        "queues": queues_out,
        "today":  today,
        "p70":    _pct(all_days, 0.70),
        "p85":    p85v,
        "p90":    _pct(all_days, 0.90),
    }

async def get_sync_info():
    results = await turso_execute([stmt("SELECT queue, last_synced FROM sync_log")])
    return {r["queue"]: r["last_synced"] for r in rows_to_dicts(results[0])} if results else {}

# ── Background sync job ───────────────────────────────────────────────────────

_sync_status: dict = {"running": False, "pct": 0, "msg": "", "error": ""}

async def run_sync_job(selected: list[str], full: bool):
    global _sync_status
    _sync_status = {"running": True, "pct": 2, "msg": "Подключаемся к Трекеру…", "error": ""}
    try:
        info = await get_sync_info()
        async with httpx.AsyncClient(timeout=60) as client:
            for qi, queue in enumerate(selected):
                # Дата с которой грузим: полный = 2 года, инкрементальный = с последнего синка
                if full or queue not in info or not info[queue]:
                    updated_from = (date.today() - timedelta(days=730)).isoformat()
                else:
                    # Конвертируем "2026-06-03 14:35" → "2026-06-03T14:35:00"
                    raw = info[queue]
                    updated_from = raw.replace(" ", "T") + ":00" if " " in raw else raw

                base_pct = qi * (90 // len(selected))

                async def send(m, _base=base_pct, _total=len(selected)):
                    if m.get("type") == "progress":
                        _sync_status["msg"] = m.get("msg", "")
                        _sync_status["pct"] = _base + (m.get("pct", 0) * (90 // _total) // 100)

                # Переопределяем updated_from в sync_queue через временную замену DATE_FROM
                await _sync_queue_from(client, queue, updated_from, send)

        _sync_status = {"running": False, "pct": 100, "msg": "Синк завершён", "error": ""}
    except Exception as e:
        _sync_status = {"running": False, "pct": 0, "msg": "", "error": str(e)}

async def _sync_queue_from(client, queue, updated_from, send):
    """Синк очереди начиная с updated_from."""
    await send({"type": "progress", "msg": f"{queue}: загружаем задачи с {updated_from}…", "pct": 5})

    issues, page = [], 1
    while True:
        data = await tracker_request(client, "POST",
            f"/v2/issues/_search?perPage=100&page={page}",
            {"filter": {"queue": queue,
                        "updatedAt": {"from": updated_from if "T" in updated_from else f"{updated_from}T00:00:00", "to": "2099-01-01T00:00:00"}}})
        chunk = data if isinstance(data, list) else []
        issues.extend(chunk)
        if len(chunk) < 100:
            break
        page += 1
        await asyncio.sleep(0.5)

    await send({"type": "progress", "msg": f"{queue}: {len(issues)} задач, ищем блокировки…", "pct": 15})

    # Сохраняем родительские задачи батчами
    for i in range(0, len(issues), 50):
        batch = issues[i:i+50]
        await turso_execute([
            stmt("INSERT INTO parent_tasks(key,title,queue,created_at,issue_type,issue_type_display) VALUES(?,?,?,?,?,?) "
                 "ON CONFLICT(key) DO UPDATE SET title=excluded.title, "
                 "issue_type=CASE WHEN excluded.issue_type != '' THEN excluded.issue_type ELSE parent_tasks.issue_type END, "
                 "issue_type_display=CASE WHEN excluded.issue_type_display != '' THEN excluded.issue_type_display ELSE parent_tasks.issue_type_display END",
                 [iss["key"], iss.get("summary","—"), queue, iss.get("createdAt",""),
                  iss.get("type",{}).get("key",""), iss.get("type",{}).get("display","")])
            for iss in batch
        ])

    BATCH = 5
    found = 0
    for i in range(0, len(issues), BATCH):
        chunk = issues[i:i+BATCH]
        links_list = await asyncio.gather(
            *[fetch_issue_links(client, iss["key"]) for iss in chunk],
            return_exceptions=True
        )
        await asyncio.sleep(0.5)

        blocking_pairs = []
        for iss, links in zip(chunk, links_list):
            if isinstance(links, Exception) or not isinstance(links, list):
                continue
            for link in links:
                obj = link.get("object", {})
                obj_key = obj.get("key", "")
                obj_display = obj.get("display", "")
                if obj_key and "(БЛОК)" in obj_display.upper():
                    blocking_pairs.append((iss["key"], obj_key))

        if blocking_pairs:
            BSIZE = 3
            for j in range(0, len(blocking_pairs), BSIZE):
                bchunk = blocking_pairs[j:j+BSIZE]
                bdata = await asyncio.gather(
                    *[fetch_issue(client, bkey) for _, bkey in bchunk],
                    return_exceptions=True
                )
                await asyncio.sleep(0.3)
                bstmts = []
                for (parent_key, bkey), biss in zip(bchunk, bdata):
                    if isinstance(biss, Exception) or not isinstance(biss, dict):
                        continue
                    if biss.get("type", {}).get("key") != "blokirovka":
                        continue
                    reasons = biss.get("reasonForBlocking", [])
                    reason = reasons[0] if reasons else "Не указана"
                    status = biss.get("status", {}).get("key", "")
                    start_date = biss.get("start", "") or (biss.get("createdAt","") or "")[:10]
                    end_date = biss.get("end","") if status == "closed" else ""
                    bstmts.append(stmt(
                        "INSERT INTO blockings(key,parent_key,title,queue,reason,start_date,end_date,status,created_at,updated_at) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?) "
                        "ON CONFLICT(key) DO UPDATE SET title=excluded.title, reason=excluded.reason, "
                        "start_date=excluded.start_date, end_date=excluded.end_date, "
                        "status=excluded.status, updated_at=excluded.updated_at",
                        [bkey, parent_key, biss.get("summary","—"), queue, reason,
                         start_date, end_date, status,
                         biss.get("createdAt",""), biss.get("updatedAt","")]
                    ))
                    found += 1
                if bstmts:
                    await turso_execute(bstmts)

        done = i + len(chunk)
        pct = 15 + round(done / max(len(issues), 1) * 75)
        await send({"type": "progress", "msg": f"{queue}: {done}/{len(issues)}, блокировок: {found}", "pct": pct})

    await turso_execute([stmt(
        "INSERT INTO sync_log(queue,last_synced) VALUES(?,?) "
        "ON CONFLICT(queue) DO UPDATE SET last_synced=excluded.last_synced",
        [queue, (datetime.utcnow() + timedelta(hours=3)).strftime("%Y-%m-%d %H:%M")]
    )])

# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/sync-info")
async def sync_info():
    info = await get_sync_info()
    return {**info, "__status__": _sync_status}

@app.post("/sync")
async def sync_start(full: bool = Query(False), queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA")):
    if _sync_status["running"]:
        return JSONResponse({"ok": False, "error": "Синк уже запущен"})
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    asyncio.create_task(run_sync_job(selected, full))
    return JSONResponse({"ok": True})

@app.get("/sync-status")
async def sync_status_endpoint():
    return JSONResponse(_sync_status)

_backfill_status: dict = {"running": False, "done": 0, "total": 0, "updated": 0, "error": "", "msg": ""}

async def run_backfill_job(selected: list[str]):
    """Догружает issue_type для задач без типа — строго по ключам из БД
    (три очереди, уже загруженный период). Тянет каждую задачу точечно
    через GET /v2/issues/{key}, без обхода всей очереди."""
    global _backfill_status
    try:
        q_ph = ",".join("?" * len(selected))
        res = await turso_execute([stmt(
            f"SELECT key FROM parent_tasks WHERE (issue_type IS NULL OR issue_type = '') "
            f"AND queue IN ({q_ph})", [*selected])])
        need = [r["key"] for r in rows_to_dicts(res[0])] if res else []
        _backfill_status = {"running": True, "done": 0, "total": len(need), "updated": 0, "error": "", "msg": "Догружаем типы…"}
        if not need:
            _backfill_status = {"running": False, "done": 0, "total": 0, "updated": 0, "error": "", "msg": "Типы уже заполнены"}
            return

        updated = 0
        BATCH = 10
        async with httpx.AsyncClient(timeout=60) as client:
            for i in range(0, len(need), BATCH):
                batch = need[i:i+BATCH]
                issues = await asyncio.gather(
                    *[fetch_issue(client, k) for k in batch], return_exceptions=True)
                upd = []
                for k, iss in zip(batch, issues):
                    if isinstance(iss, dict):
                        t = iss.get("type", {})
                        if t.get("key") or t.get("display"):
                            upd.append(stmt(
                                "UPDATE parent_tasks SET issue_type=?, issue_type_display=? WHERE key=?",
                                [t.get("key", ""), t.get("display", ""), k]))
                if upd:
                    await turso_execute(upd)
                    updated += len(upd)
                _backfill_status["done"] = min(i + BATCH, len(need))
                _backfill_status["updated"] = updated
                await asyncio.sleep(0.2)
        _backfill_status = {"running": False, "done": len(need), "total": len(need),
                            "updated": updated, "error": "", "msg": "Готово"}
    except Exception as e:
        _backfill_status = {**_backfill_status, "running": False, "error": str(e), "msg": "Ошибка"}

@app.post("/backfill-types")
async def backfill_types(queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA")):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    if _backfill_status.get("running"):
        return JSONResponse({"ok": False, "error": "Бэкфилл уже идёт", "status": _backfill_status})
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    asyncio.create_task(run_backfill_job(selected))
    return JSONResponse({"ok": True, "started": True})

@app.get("/backfill-status")
async def backfill_status_endpoint():
    return JSONResponse(_backfill_status)

@app.get("/status-analysis")
async def status_analysis(
    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA"),
    date_from: str = Query(""),
    date_to: str = Query(""),
):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    q_ph = ",".join("?" * len(selected))
    args: list = [*selected]

    date_filter = ""
    if date_from:
        date_filter += " AND b.start_date >= ?"
        args.append(date_from)
    if date_to:
        date_filter += " AND b.start_date <= ?"
        args.append(date_to)

    results = await turso_execute([stmt(f"""
        SELECT
            bs.status_key,
            bs.status_display,
            b.key AS blocking_key,
            b.parent_key,
            b.reason,
            b.start_date,
            b.end_date,
            b.status AS b_status,
            p.title AS parent_title,
            b.queue,
            CASE
                WHEN b.status = 'closed' AND b.start_date != '' AND b.end_date != ''
                    THEN CAST(julianday(b.end_date) - julianday(b.start_date) AS INTEGER) + 1
                WHEN b.status != 'closed' AND b.start_date != ''
                    THEN CAST(julianday(date('now')) - julianday(b.start_date) AS INTEGER) + 1
                ELSE 0
            END AS days_val
        FROM blockings b
        JOIN blocking_status bs ON bs.blocking_key = b.key
        JOIN parent_tasks p ON p.key = b.parent_key
        WHERE b.queue IN ({q_ph}){date_filter}
          AND bs.status_key IS NOT NULL
    """, args)])

    rows = rows_to_dicts(results[0]) if results else []

    def pct(values: list[int], p: float) -> float:
        if not values: return 0
        s = sorted(values)
        return round(s[min(int(len(s) * p), len(s)-1)], 1)

    def avg(values: list[int]) -> float:
        return round(sum(values) / len(values), 1) if values else 0

    def p85_threshold(values: list[int]) -> float:
        return pct(values, 0.85)

    by_status: dict[str, dict] = {}
    for row in rows:
        sk = row["status_key"]
        if sk not in WORK_STATUSES:
            continue
        try:
            days = int(float(row["days_val"] or 0))
        except (ValueError, TypeError):
            days = 0
        if days <= 0:
            continue
        if sk not in by_status:
            by_status[sk] = {"values": [], "tasks": []}
        by_status[sk]["values"].append(days)
        by_status[sk]["tasks"].append({
            "blockingKey": row["blocking_key"],
            "parentKey":   row["parent_key"],
            "parentTitle": row["parent_title"] or "—",
            "url":         f"https://tracker.yandex.ru/{row['parent_key']}",
            "queue":       row["queue"],
            "reason":      row["reason"] or "Не указана",
            "startDate":   (row["start_date"] or "")[:10],
            "endDate":     (row["end_date"] or "")[:10],
            "isActive":    row["b_status"] != "closed",
            "days":        days,
        })

    order = ["analyticalstudy", "vRazrabotke", "testing", "pomesenieVProduktiv", "atthecustomersinspection"]
    data_out = []
    for sk in order:
        d = by_status.get(sk, {"values": [], "tasks": []})
        vals = d["values"]
        tasks = sorted(d["tasks"], key=lambda t: t["days"], reverse=True)
        p85v = pct(vals, 0.85)
        data_out.append({
            "statusKey":     sk,
            "statusDisplay": WORK_STATUSES[sk],
            "count":         len(vals),
            "avg":           avg(vals),
            "p70":           pct(vals, 0.70),
            "p85":           p85v,
            "p90":           pct(vals, 0.90),
            "tasks":         [dict(t, isOutlier=t["days"] >= p85v) for t in tasks],
        })

    return JSONResponse({"statuses": data_out})

@app.get("/insights")
async def insights(
    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA"),
    date_from: str = Query(""),
    date_to: str = Query(""),
):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    q_ph = ",".join("?" * len(selected))
    args_base: list = [*selected]
    date_filter = ""
    if date_from:
        date_filter += " AND b.start_date >= ?"
        args_base.append(date_from)
    if date_to:
        date_filter += " AND b.start_date <= ?"
        args_base.append(date_to)

    days_expr = """CASE
        WHEN b.status='closed' AND b.start_date!='' AND b.end_date!=''
            THEN CAST(julianday(b.end_date)-julianday(b.start_date) AS INTEGER)+1
        WHEN b.status!='closed' AND b.start_date!=''
            THEN CAST(julianday(date('now'))-julianday(b.start_date) AS INTEGER)+1
        ELSE 0 END"""

    task_fields = f"""b.key as blocking_key, b.parent_key, b.reason,
            b.start_date, b.end_date, b.status as b_status,
            b.queue, p.title as parent_title,
            {days_expr} as days_val"""

    results = await turso_execute([
        # 1. Этапы — кол-во
        stmt(f"""SELECT bs.status_key, bs.status_display, COUNT(*) as cnt
            FROM blockings b JOIN blocking_status bs ON bs.blocking_key=b.key
            WHERE b.queue IN ({q_ph}){date_filter} AND bs.status_key IS NOT NULL
              AND bs.status_key IN ('vRazrabotke','testing','analyticalstudy','pomesenieVProduktiv','atthecustomersinspection')
            GROUP BY bs.status_key, bs.status_display ORDER BY cnt DESC""", args_base),
        # 2. Причины — кол-во
        stmt(f"""SELECT b.reason, COUNT(*) as cnt
            FROM blockings b WHERE b.queue IN ({q_ph}){date_filter} AND b.reason IS NOT NULL
            GROUP BY b.reason ORDER BY cnt DESC LIMIT 15""", args_base),
        # 3. Причины — среднее время
        stmt(f"""SELECT b.reason, AVG({days_expr}) as avg_days, COUNT(*) as cnt
            FROM blockings b WHERE b.queue IN ({q_ph}){date_filter}
              AND b.reason IS NOT NULL AND {days_expr} > 0
            GROUP BY b.reason ORDER BY avg_days DESC LIMIT 15""", args_base),
        # 4. Типы задач
        stmt(f"""SELECT p.issue_type_display, p.issue_type, COUNT(DISTINCT b.parent_key) as cnt
            FROM blockings b JOIN parent_tasks p ON p.key=b.parent_key
            WHERE b.queue IN ({q_ph}){date_filter}
              AND p.issue_type IS NOT NULL AND p.issue_type != ''
            GROUP BY p.issue_type, p.issue_type_display ORDER BY cnt DESC""", args_base),
        # 5. Задачи по этапам
        stmt(f"""SELECT bs.status_key, {task_fields}
            FROM blockings b
            JOIN blocking_status bs ON bs.blocking_key=b.key
            JOIN parent_tasks p ON p.key=b.parent_key
            WHERE b.queue IN ({q_ph}){date_filter} AND bs.status_key IS NOT NULL
              AND bs.status_key IN ('vRazrabotke','testing','analyticalstudy','pomesenieVProduktiv','atthecustomersinspection')
              AND {days_expr} > 0""", args_base),
        # 6. Задачи по причинам (count)
        stmt(f"""SELECT b.reason, {task_fields}
            FROM blockings b JOIN parent_tasks p ON p.key=b.parent_key
            WHERE b.queue IN ({q_ph}){date_filter} AND b.reason IS NOT NULL
              AND {days_expr} > 0""", args_base),
        # 7. Задачи по типу задачи
        stmt(f"""SELECT p.issue_type_display, p.issue_type, {task_fields}
            FROM blockings b JOIN parent_tasks p ON p.key=b.parent_key
            WHERE b.queue IN ({q_ph}){date_filter}
              AND p.issue_type IS NOT NULL AND p.issue_type != ''
              AND {days_expr} > 0""", args_base),
    ])

    stage_order = ["analyticalstudy","vRazrabotke","testing","pomesenieVProduktiv","atthecustomersinspection"]

    def to_rows(idx):
        return rows_to_dicts(results[idx]) if results and len(results) > idx else []

    def make_task(r):
        try: d = int(float(r.get("days_val") or 0))
        except: d = 0
        return {
            "blockingKey": r.get("blocking_key",""),
            "parentKey":   r.get("parent_key",""),
            "parentTitle": r.get("parent_title") or "—",
            "url":         f"https://tracker.yandex.ru/{r.get('parent_key','')}",
            "queue":       r.get("queue",""),
            "reason":      r.get("reason") or "Не указана",
            "startDate":   (r.get("start_date") or "")[:10],
            "endDate":     (r.get("end_date") or "")[:10],
            "isActive":    r.get("b_status") != "closed",
            "days":        d,
        }

    # Группируем задачи по ключу
    def ipct(values: list[int], p: float) -> float:
        if not values: return 0
        s = sorted(values)
        return round(s[min(int(len(s) * p), len(s)-1)], 1)

    def iavg(values: list[int]) -> float:
        return round(sum(values) / len(values), 1) if values else 0

    def group_tasks(rows, key_field):
        groups: dict[str, list] = {}
        for r in rows:
            k = r.get(key_field) or ""
            groups.setdefault(k, []).append(make_task(r))
        for k in groups:
            groups[k] = sorted(groups[k], key=lambda t: t["days"], reverse=True)
        return groups

    def with_outliers(tasks: list, p85v: float) -> list:
        return [dict(t, isOutlier=t["days"] >= p85v) for t in tasks]

    stage_tasks    = group_tasks(to_rows(4), "status_key")
    reason_tasks   = group_tasks(to_rows(5), "reason")
    type_tasks_raw = group_tasks(to_rows(6), "issue_type_display")

    # Этапы в порядке воронки
    stages_raw = {r["status_key"]: r for r in to_rows(0)}
    stages = []
    for sk in stage_order:
        if sk not in stages_raw: continue
        tasks = stage_tasks.get(sk, [])
        vals = [t["days"] for t in tasks]
        p85v = ipct(vals, 0.85)
        stages.append({"key": sk, "label": WORK_STATUSES[sk],
                        "count": int(stages_raw[sk]["cnt"] or 0),
                        "avg": iavg(vals), "p70": ipct(vals,0.70), "p85": p85v, "p90": ipct(vals,0.90),
                        "tasks": with_outliers(tasks, p85v)})

    reasons_count = []
    for r in to_rows(1):
        tasks = reason_tasks.get(r["reason"], [])
        vals = [t["days"] for t in tasks]
        p85v = ipct(vals, 0.85)
        reasons_count.append({"reason": r["reason"], "count": int(r["cnt"] or 0),
                               "p70": ipct(vals,0.70), "p85": p85v,
                               "tasks": with_outliers(tasks, p85v)})

    reasons_avg = []
    for r in to_rows(2):
        try: avg_d = round(float(r["avg_days"] or 0), 1)
        except: avg_d = 0
        if avg_d <= 0: continue
        tasks = reason_tasks.get(r["reason"], [])
        vals = [t["days"] for t in tasks]
        p85v = ipct(vals, 0.85)
        reasons_avg.append({"reason": r["reason"], "avg": avg_d,
                             "p70": ipct(vals,0.70), "p85": p85v, "p90": ipct(vals,0.90),
                             "count": int(r["cnt"] or 0),
                             "tasks": with_outliers(tasks, p85v)})

    issue_types = []
    for r in to_rows(3):
        label = r["issue_type_display"] or r["issue_type"] or "Не указан"
        tasks = type_tasks_raw.get(label, [])
        vals = [t["days"] for t in tasks]
        p85v = ipct(vals, 0.85)
        issue_types.append({"type": label, "count": int(r["cnt"] or 0),
                             "p70": ipct(vals,0.70), "p85": p85v,
                             "tasks": with_outliers(tasks, p85v)})

    return JSONResponse({
        "stages":       stages,
        "reasonsCount": reasons_count,
        "reasonsAvg":   reasons_avg,
        "issueTypes":   issue_types,
    })

# ── AI-сводка ───────────────────────────────────────────────────────────────────

_insight_cache: dict = {}

def _pctl(vals: list[int], p: float) -> float:
    if not vals: return 0
    s = sorted(vals)
    return round(s[min(int(len(s) * p), len(s) - 1)], 1)

def _ddmm(iso: str) -> str:
    try:
        d = date.fromisoformat(iso[:10]); return f"{d.day:02d}.{d.month:02d}.{d.year}"
    except Exception:
        return iso

async def compute_facts(selected: list[str], date_from: str, date_to: str) -> dict:
    q_ph = ",".join("?" * len(selected))
    days_expr = """CASE
        WHEN b.status='closed' AND b.start_date!='' AND b.end_date!=''
            THEN CAST(julianday(b.end_date)-julianday(b.start_date) AS INTEGER)+1
        WHEN b.status!='closed' AND b.start_date!=''
            THEN CAST(julianday(date('now'))-julianday(b.start_date) AS INTEGER)+1
        ELSE 0 END"""
    rng = ""; rargs: list = [*selected]
    if date_from: rng += " AND b.start_date >= ?"; rargs.append(date_from)
    if date_to:   rng += " AND b.start_date <= ?"; rargs.append(date_to)

    # Предыдущий период такой же длины — для тренда
    prev = None
    try:
        if date_from and date_to:
            d0 = date.fromisoformat(date_from); d1 = date.fromisoformat(date_to)
            length = (d1 - d0).days
            pe = d0 - timedelta(days=1); ps = pe - timedelta(days=length)
            prev = (ps.isoformat(), pe.isoformat())
    except Exception:
        prev = None

    stmts = [
        stmt(f"SELECT {days_expr} as d, b.parent_key as pk FROM blockings b "
             f"WHERE b.queue IN ({q_ph}){rng}", rargs),
        # топ-этап по СУММАРНОМУ времени простоя (приоритет по практике — время, не количество)
        stmt(f"""SELECT bs.status_key as sk, COUNT(*) as cnt, SUM({days_expr}) as total FROM blockings b
                 JOIN blocking_status bs ON bs.blocking_key=b.key
                 WHERE b.queue IN ({q_ph}){rng} AND bs.status_key IN
                 ('vRazrabotke','testing','analyticalstudy','pomesenieVProduktiv','atthecustomersinspection')
                 GROUP BY bs.status_key ORDER BY total DESC LIMIT 1""", rargs),
        # топ-причина по СУММАРНОМУ времени простоя
        stmt(f"""SELECT b.reason as reason, COUNT(*) as cnt, SUM({days_expr}) as total FROM blockings b
                 WHERE b.queue IN ({q_ph}){rng} AND b.reason IS NOT NULL AND b.reason!=''
                 GROUP BY b.reason ORDER BY total DESC LIMIT 1""", rargs),
        # самая ранняя дата блокировки — граница реальных данных
        stmt(f"SELECT MIN(b.start_date) as mn FROM blockings b "
             f"WHERE b.queue IN ({q_ph}) AND b.start_date != ''", [*selected]),
    ]
    prev_idx = None
    if prev:
        prev_idx = len(stmts)
        stmts.append(stmt(
            f"SELECT COUNT(*) as cnt FROM blockings b WHERE b.queue IN ({q_ph}) "
            f"AND b.start_date >= ? AND b.start_date <= ?", [*selected, prev[0], prev[1]]))

    results = await turso_execute(stmts)
    rows0 = rows_to_dicts(results[0]) if results else []
    days, parents = [], set()
    for r in rows0:
        try: d = int(float(r["d"] or 0))
        except: d = 0
        if d > 0: days.append(d)
        if r["pk"]: parents.add(r["pk"])

    stage_rows  = rows_to_dicts(results[1]) if len(results) > 1 else []
    reason_rows = rows_to_dicts(results[2]) if len(results) > 2 else []
    min_rows    = rows_to_dicts(results[3]) if len(results) > 3 else []
    data_start  = (min_rows[0]["mn"] or "")[:10] if min_rows and min_rows[0].get("mn") else None

    # Тренд показываем, только если ВЕСЬ предыдущий период попадает в реальные данные
    prev_total, prev_valid = None, False
    if prev and prev_idx is not None and len(results) > prev_idx:
        pr = rows_to_dicts(results[prev_idx]); raw_prev = int(pr[0]["cnt"]) if pr else 0
        if data_start and prev[0] >= data_start:
            prev_total, prev_valid = raw_prev, True

    def _int(v):
        try: return int(float(v or 0))
        except: return 0
    top_stage = ({"key": stage_rows[0]["sk"], "label": WORK_STATUSES.get(stage_rows[0]["sk"], stage_rows[0]["sk"]),
                  "count": _int(stage_rows[0]["cnt"]), "totalDays": _int(stage_rows[0].get("total"))}
                 if stage_rows else None)
    top_reason = ({"reason": reason_rows[0]["reason"], "count": _int(reason_rows[0]["cnt"]),
                   "totalDays": _int(reason_rows[0].get("total")),
                   "kind": REASON_KIND.get(reason_rows[0]["reason"])}
                  if reason_rows else None)
    total = len(rows0)
    trend_pct = round((total - prev_total) / prev_total * 100) if (prev_valid and prev_total) else None

    return {
        "queue":          "ALL" if len(selected) == len(QUEUES) else ",".join(selected),
        "dateFrom":       date_from, "dateTo": date_to,
        "totalBlockings": total,
        "blockedTasks":   len(parents),
        "topStage":       top_stage,
        "topReason":      top_reason,
        "avgDays":        round(sum(days) / len(days), 1) if days else 0,
        "p70":            _pctl(days, 0.70),
        "p85":            _pctl(days, 0.85),
        "dataStart":      data_start,
        "prevFrom":       prev[0] if prev_valid else None,
        "prevTo":         prev[1] if prev_valid else None,
        "prevTotal":      prev_total,
        "trendPct":       trend_pct,
    }

def build_template(f: dict) -> str:
    if not f["totalBlockings"]:
        return "За выбранный период блокировок не найдено."
    parts = []
    if f["topStage"] and f["topReason"]:
        parts.append(f"Дольше всего время теряется на этапе **{f['topStage']['label']}** "
                     f"и из-за причины **{f['topReason']['reason']}** "
                     f"(**{f['topReason']['totalDays']} дн.** суммарно).")
    elif f["topReason"]:
        parts.append(f"Дольше всего простаивают из-за причины **{f['topReason']['reason']}** "
                     f"(**{f['topReason']['totalDays']} дн.** суммарно).")
    s = f"Всего за период — **{f['totalBlockings']}** блокировок по **{f['blockedTasks']}** задачам"
    if f["trendPct"] is not None and f.get("prevFrom") and f.get("prevTo"):
        period = f"предыдущий период (**{_ddmm(f['prevFrom'])}–{_ddmm(f['prevTo'])}**)"
        if f["trendPct"] > 0:   s += f", это на **{f['trendPct']}%** больше, чем за {period}"
        elif f["trendPct"] < 0: s += f", это на **{abs(f['trendPct'])}%** меньше, чем за {period}"
        else:                   s += f", столько же, сколько за {period}"
    s += "."
    parts.append(s)
    if f["avgDays"]:
        parts.append(f"Среднее время разблокировки — **{f['avgDays']} дн.** (P85 **{f['p85']} дн.**).")
    return " ".join(parts)

async def mistral_insight(f: dict) -> str | None:
    if not MISTRAL_API_KEY or not f["totalBlockings"]:
        return None
    lines = [
        f"Очередь: {f['queue']}. Период: {f['dateFrom']}–{f['dateTo']}.",
        f"Всего блокировок: {f['totalBlockings']} по {f['blockedTasks']} задачам.",
        f"Этап с наибольшим СУММАРНЫМ временем простоя: "
        f"{f['topStage']['label'] if f['topStage'] else '—'}"
        f" ({f['topStage']['totalDays'] if f['topStage'] else 0} дн.).",
        f"Главная причина — по СУММАРНОМУ времени простоя (это и есть приоритет, а не количество): "
        f"{f['topReason']['reason'] if f['topReason'] else '—'}"
        f" ({f['topReason']['totalDays'] if f['topReason'] else 0} дн. суммарно, "
        f"{f['topReason']['count'] if f['topReason'] else 0} блокировок).",
    ]
    if f["topReason"] and f["topReason"].get("kind"):
        lines.append(f"Характер главной причины: {f['topReason']['kind']} (классификация фиксирована — следуй ей).")
    if f["topReason"] and f["topReason"]["reason"] in ("Причина не известна", "Не указана"):
        lines.append("ВАЖНО про эту причину: она означает «Нет рук» — людей не хватает. "
                     "НЕ пиши, что причины не записывают/не фиксируют — это неверно.")
    lines.append(f"Среднее время разблокировки: {f['avgDays']} дн., P85: {f['p85']} дн.")
    if f["trendPct"] is not None and f.get("prevFrom"):
        lines.append(f"Динамика к предыдущему периоду ({_ddmm(f['prevFrom'])}–{_ddmm(f['prevTo'])}): {f['trendPct']:+d}%.")
    facts_txt = "\n".join(lines) + "\n"
    system = (
        "Ты — аналитик процессов разработки в VkusVill.\n"
        "ЖЁСТКИЕ ПРАВИЛА (нарушать НЕЛЬЗЯ):\n"
        "1) Причина блокировки заполняется ВСЕГДА. ЗАПРЕЩЕНО писать, что причины не фиксируют / нет культуры фиксации / непонятно, что тормозит.\n"
        "2) Причина «Причина не известна» / «Не указана» = «Нет рук» (не хватает людей), это ВНУТРЕННЕЕ. Советуй про людей и загрузку, а не про запись причин.\n"
        "3) SLA есть на всех этапах ВСЕГДА. ЗАПРЕЩЕНО писать «нет SLA» или «ввести/добавить SLA». Если долго — пиши «SLA не соблюдается».\n"
        "4) Бери «Характер главной причины» как есть. Внутренняя → меры внутри команды, БЕЗ упоминания внешних команд. Внешняя → договориться/эскалация.\n"
        "5) ЗАПРЕЩЁННЫЕ слова: «проактивно», «точки контроля», «команда-донор», «фиксация причин», «цепочка поставки», «синхронизация подразделений», «корневая причина».\n\n"
        "Дай короткий разбор на русском, ровно в формате (по одному предложению):\n"
        "Маркер: что в планировании/процессе пошло не так.\n"
        "Рекомендация: один конкретный следующий шаг (для внутренней — про людей/приоритеты/планирование + эксперимент «Мы полагаем, что… приведёт к…»; для внешней — договориться или эскалировать по SLA).\n"
        "Опирайся ТОЛЬКО на факты, числа не выдумывай. Без приветствий и воды.\n"
        "ТОН: просто и по-человечески, как объясняешь коллеге за кофе. Короткие живые фразы, без канцелярита. "
        "Например: «у вас не хватает людей», «договоритесь с командой X, чтобы отвечали быстрее», «задачи мешают друг другу».\n\n"
        + PRACTICE_BRIEF + "\n\n" + DOMAIN_NOTES)
    body = {"model": MISTRAL_MODEL,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": facts_txt}],
            "temperature": 0.25, "max_tokens": 300}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post("https://api.mistral.ai/v1/chat/completions",
                                  headers={"Authorization": f"Bearer {MISTRAL_API_KEY}"}, json=body)
            r.raise_for_status()
            return (r.json()["choices"][0]["message"]["content"] or "").strip()
    except Exception as e:
        print(f"[mistral] {e}")
        return None

@app.get("/insight-summary")
async def insight_summary(
    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA"),
    date_from: str = Query(""),
    date_to: str = Query(""),
    refresh: bool = Query(False),
):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    ck = f"{','.join(sorted(selected))}|{date_from}|{date_to}"
    if not refresh and ck in _insight_cache:
        return JSONResponse(_insight_cache[ck])
    facts = await compute_facts(selected, date_from, date_to)
    res = {"facts": facts, "template": build_template(facts),
           "ai": await mistral_insight(facts), "hasAI": False,
           "practiceUrl": PRACTICE_URL}
    res["hasAI"] = bool(res["ai"])
    if len(_insight_cache) > 200:
        _insight_cache.clear()
    _insight_cache[ck] = res
    return JSONResponse(res)

@app.get("/downtime-analysis")
async def downtime_analysis(
    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA"),
    date_from: str = Query(""),
    date_to: str = Query(""),
):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    q_ph = ",".join("?" * len(selected))
    args: list = [*selected]
    date_filter = ""
    if date_from:
        date_filter += " AND start_date >= ?"
        args.append(date_from)
    if date_to:
        date_filter += " AND start_date <= ?"
        args.append(date_to)

    days_expr_b = """CASE
        WHEN b.status='closed' AND b.start_date!='' AND b.end_date!=''
            THEN CAST(julianday(b.end_date)-julianday(b.start_date) AS INTEGER)+1
        WHEN b.status!='closed' AND b.start_date!=''
            THEN CAST(julianday(date('now'))-julianday(b.start_date) AS INTEGER)+1
        ELSE 0 END"""
    date_filter_b = date_filter.replace("start_date", "b.start_date")

    results = await turso_execute([
        stmt(f"""
        SELECT
            reason,
            SUM(CASE
                WHEN status = 'closed' AND start_date != '' AND end_date != ''
                    THEN CAST(julianday(end_date) - julianday(start_date) AS INTEGER) + 1
                WHEN status != 'closed' AND start_date != ''
                    THEN CAST(julianday(date('now')) - julianday(start_date) AS INTEGER) + 1
                ELSE 0
            END) AS total_days,
            COUNT(*) as cnt
        FROM blockings
        WHERE queue IN ({q_ph}){date_filter}
        GROUP BY reason
        ORDER BY total_days DESC
    """, args),
        # задачи по каждой причине (со стадией для группировки)
        stmt(f"""SELECT b.reason as reason, b.key as blocking_key, b.parent_key as parent_key,
                    b.start_date, b.end_date, b.status as b_status, b.queue,
                    p.title as parent_title, bs.status_display as stage,
                    {days_expr_b} as days_val
                 FROM blockings b
                 LEFT JOIN parent_tasks p ON p.key=b.parent_key
                 LEFT JOIN blocking_status bs ON bs.blocking_key=b.key
                 WHERE b.queue IN ({q_ph}){date_filter_b}""", args),
    ])

    rows = rows_to_dicts(results[0]) if results else []
    task_rows = rows_to_dicts(results[1]) if len(results) > 1 else []

    by_reason: dict = {}
    for r in task_rows:
        try: d = int(float(r.get("days_val") or 0))
        except: d = 0
        if d <= 0: continue
        by_reason.setdefault(r.get("reason") or "Не указана", []).append({
            "blockingKey": r.get("blocking_key", ""),
            "parentKey":   r.get("parent_key", ""),
            "parentTitle": r.get("parent_title") or "—",
            "url":         f"https://tracker.yandex.ru/{r.get('parent_key','')}",
            "queue":       r.get("queue", ""),
            "stage":       r.get("stage") or "Без этапа",
            "startDate":   (r.get("start_date") or "")[:10],
            "endDate":     (r.get("end_date") or "")[:10],
            "isActive":    r.get("b_status") != "closed",
            "days":        d,
        })
    for k in by_reason:
        by_reason[k].sort(key=lambda t: t["days"], reverse=True)

    total = sum(int(float(r["total_days"] or 0)) for r in rows)
    items = []
    for r in rows:
        d = int(float(r["total_days"] or 0))
        if d > 0:
            reason = r["reason"] or "Не указана"
            items.append({
                "reason":     reason,
                "totalDays":  d,
                "count":      int(r["cnt"] or 0),
                "pct":        round(d / total * 100, 1) if total else 0,
                "tasks":      by_reason.get(reason, []),
            })

    return JSONResponse({"items": items, "totalDays": total})

@app.get("/data")
async def data(
    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA"),
    date_from: str = Query(""),
    date_to: str = Query(""),
):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    return JSONResponse(await query_dashboard(selected, date_from, date_to))

# ── SLE анализ (PUTKURERA) ──────────────────────────────────────────────────────

SLE_SUB_QUEUES = "UDOSTAVKA, POOLING, DOSTAVKAPIKO"
SLE_DONE_SUB = {"gotovoKRabote", "closed", "backlogKomandy", "produktovyjBacklog"}
SLE_QUERIES = {
    "current":    'Type: newFeature Queue: PUTKURERA Status: inProgress Putkurera."sle risk": notEmpty() "Sort by": Putkurera."sle risk" DESC',
    "historical": 'Type: newFeature Queue: PUTKURERA Status: zaverseno, analizRezults, closed Putkurera."sle risk": notEmpty() "Sort by": Putkurera."sle risk" DESC',
}

def _field(issue: dict, suffix: str, default=None):
    k = next((k for k in issue if k.endswith(suffix)), None)
    return issue.get(k, default) if k is not None else default

async def fetch_comments(client, key: str, limit: int = 8) -> str:
    try:
        data = await tracker_request(client, "GET", f"/v2/issues/{key}/comments")
        arr = data if isinstance(data, list) else []
        texts = [(c.get("text") or "").replace("\n", " ").strip() for c in arr]
        return " | ".join(t for t in texts if t)[-1400:]
    except Exception:
        return ""

async def tracker_query(client, query: str, per_page: int = 100) -> list:
    out, page = [], 1
    while True:
        data = await tracker_request(client, "POST",
            f"/v2/issues/_search?perPage={per_page}&page={page}", {"query": query})
        chunk = data if isinstance(data, list) else []
        out.extend(chunk)
        if len(chunk) < per_page:
            break
        page += 1
        await asyncio.sleep(0.3)
    return out

async def fetch_sle_tasks(which: str) -> dict:
    which = which if which in SLE_QUERIES else "current"
    async with httpx.AsyncClient(timeout=60) as client:
        parents = await tracker_query(client, SLE_QUERIES[which])
        keys = [p["key"] for p in parents if p.get("key")]
        subs = []
        if keys:
            # берём ВСЕ дочерние задачи (любые очереди, не только три dev-очереди)
            subs = await tracker_query(client, f'"Parent issue": {", ".join(keys)}')

    # подзадачи по родителю
    subs_by_parent: dict = {}
    for s in subs:
        pk = (s.get("parent") or {}).get("key")
        if pk:
            subs_by_parent.setdefault(pk, []).append(s)

    # блокировки подзадач из нашей БД (по ключам подзадач)
    sub_keys = [s.get("key") for s in subs if s.get("key")]
    sub_blockings: dict = {}
    if sub_keys:
        ph = ",".join("?" * len(sub_keys))
        try:
            res = await turso_execute([stmt(
                f"SELECT parent_key, reason, status, start_date, end_date "
                f"FROM blockings WHERE parent_key IN ({ph})", sub_keys)])
            for r in rows_to_dicts(res[0]) if res else []:
                sub_blockings.setdefault(r["parent_key"], []).append({
                    "reason": r.get("reason") or "Не указана",
                    "status": r.get("status"),
                    "startDate": (r.get("start_date") or "")[:10],
                    "endDate": (r.get("end_date") or "")[:10],
                })
        except Exception:
            pass

    tasks = []
    for p in parents:
        pk = p["key"]
        plist = subs_by_parent.get(pk, [])
        active = [s for s in plist if (s.get("status") or {}).get("key") not in SLE_DONE_SUB]
        hidden_blocked = len(plist) > 0 and len(active) == 0
        sub_out, blocked_subs, blocked_details = [], [], []
        for s in plist:
            sk = s.get("key")
            s_active = (s.get("status") or {}).get("key") not in SLE_DONE_SUB
            blks = sub_blockings.get(sk, [])
            # блок значим, только если сама подзадача В РАБОТЕ и блок не закрыт
            has_active_block = s_active and any((b.get("status") or "") != "closed" for b in blks)
            if has_active_block:
                blocked_subs.append(sk)
                reasons = [b.get("reason") for b in blks if (b.get("status") or "") != "closed" and b.get("reason")]
                blocked_details.append({"key": sk, "url": f"https://tracker.yandex.ru/{sk}",
                                        "reason": "; ".join(reasons) or "Причина не указана"})
            sub_out.append({
                "key": sk,
                "summary": s.get("summary", "—"),
                "queue": (s.get("queue") or {}).get("key", ""),
                "status": (s.get("status") or {}).get("display", ""),
                "statusKey": (s.get("status") or {}).get("key", ""),
                "isActive": (s.get("status") or {}).get("key") not in SLE_DONE_SUB,
                "hasActiveBlock": has_active_block,
                "url": f"https://tracker.yandex.ru/{sk}",
                "blockings": blks,
            })
        # сигналы риска значимы только для ТЕКУЩИХ задач (in-progress) при умеренном+ риске;
        # на истории «нет активных подзадач» — это норма (задача завершена), не сигнал.
        risk_level = _risk_level(_field(p, "--sleRisk") or "")
        at_risk = which == "current" and risk_level in ("нарушен", "высокий", "умеренный")
        signals = []
        # Правило 2: блок висит в активной подзадаче
        if blocked_subs:
            signals.append("Блок висит в подзадаче: " + ", ".join(blocked_subs))
        # Правило 1: по НВ фактически никто не работает (нет активных подзадач)
        if len(plist) == 0:
            signals.append("Нет связанных подзадач — работа не заведена")
        elif len(active) == 0:
            signals.append("По задаче никто не работает: нет активных подзадач (все завершены или в беклоге)")
        # если есть активные подзадачи и нет блоков — это нормальная работа, не триггерим
        needs_attention = at_risk and len(signals) > 0
        # кластеризуем только реально рисковые: нарушен/высокий, либо умеренный с блокерами.
        # низкий и умеренный без блокеров — ещё ничего не нарушено, кластер не присваиваем.
        any_block = bool(blocked_subs) or any(sub_blockings.get(s.get("key")) for s in plist) \
            or bool(p.get("theLastReasonForBlocking")) or bool(p.get("historyOfBlockingReasons"))
        # История (завершённые): кластеризуем только реально НАРУШЕННЫЕ.
        # Текущие: нарушен всегда; высокий/умеренный — только если есть блокеры.
        if which == "historical":
            clusterable = risk_level == "нарушен"
        else:
            clusterable = risk_level == "нарушен" or (risk_level in ("высокий", "умеренный") and any_block)
        tasks.append({
            "riskLevel": risk_level,
            "clusterable": clusterable,
            "riskSignals": signals if at_risk else [],
            "needsAttention": needs_attention,
            "blockedSubs": blocked_subs,
            "blockedDetails": blocked_details if at_risk else [],
            "key": pk,
            "summary": p.get("summary", "—"),
            "url": f"https://tracker.yandex.ru/{pk}",
            "assignee": (p.get("assignee") or {}).get("display", "—"),
            "status": (p.get("status") or {}).get("display", ""),
            "sleRisk": _field(p, "--sleRisk") or "—",
            "sle": _field(p, "--sle"),
            "p70": _field(p, "--p70"),
            "effort": p.get("effort"),
            "effortFact": _field(p, "--anEffortFact"),
            "jobCategory": _field(p, "--jobCategory"),
            "deadline": p.get("deadline"),
            "end": p.get("end"),
            "daysInWork": p.get("daysInTheWork"),
            "tags": p.get("tags") or [],
            "lastBlockingReason": p.get("theLastReasonForBlocking") or "",
            "blockingHistory": p.get("historyOfBlockingReasons") or "",
            "subtasks": sub_out,
            "subCount": len(plist),
            "activeSubCount": len(active),
            "hiddenBlocked": hidden_blocked,
        })

    return {"which": which, "count": len(tasks), "tasks": tasks}

SLE_SNAPSHOT_VERSION = 10  # bump при изменении логики сигналов/полей — старые снапшоты инвалидируются

async def load_snapshot(which: str):
    try:
        res = await turso_execute([stmt("SELECT data, updated_at FROM sle_snapshot WHERE which=?", [which])])
        rows = rows_to_dicts(res[0]) if res else []
        if rows and rows[0].get("data"):
            obj = json.loads(rows[0]["data"])
            if isinstance(obj, dict) and obj.get("v") == SLE_SNAPSHOT_VERSION:
                return obj.get("tasks", []), rows[0].get("updated_at")
    except Exception as e:
        print(f"[sle-snapshot load] {e}")
    return None, None

async def save_snapshot(which: str, tasks: list):
    try:
        await turso_execute([stmt(
            "INSERT INTO sle_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [which, json.dumps({"v": SLE_SNAPSHOT_VERSION, "tasks": tasks}, ensure_ascii=False)])])
    except Exception as e:
        print(f"[sle-snapshot save] {e}")

@app.get("/sle-analysis")
async def sle_analysis(which: str = Query("current")):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    which = which if which in SLE_QUERIES else "current"
    snap, ts = await load_snapshot(which)
    if snap is not None:
        return JSONResponse({"ok": True, "which": which, "count": len(snap), "tasks": snap, "updatedAt": ts})
    try:
        return JSONResponse({"ok": True, **(await fetch_sle_tasks(which))})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

# ── AI-кластеризация причин нарушения SLE ───────────────────────────────────────

# Таксономия из ручной разметки пользователя
SLE_CLUSTERS = [
    {"key": "external", "label": "Внешние зависимости",
     "hint": "работа на стороне другой команды/ДВХ/маршрутизатора/провайдера, ожидание внешних команд, долгие согласования архитектуры или ФА, моратории"},
    {"key": "large", "label": "Крупная задача / не MMF",
     "hint": "много сторей/подзадач, XL или L без декомпозиции, SLE нарушен уже на момент заведения, слабая декомпозиция по MMF, менялись требования и приоритеты"},
    {"key": "tech", "label": "Техническая блокировка",
     "hint": "заблокирована багом или техпроблемой, демо/релиз отложены до исправления"},
    {"key": "estimate", "label": "Ошибка оценки",
     "hint": "неверно проставлены категория/SLE, на момент установки срок уже был превышен, реальный Effort больше (M/L вместо S), по факту не нарушен (статусы сдвинули поздно, праздники), долго лежала в беклоге вне приоритета / под мораторием"},
]
_CLUSTER_LABELS = {c["label"] for c in SLE_CLUSTERS}
_sle_cluster_cache: dict = {}

# Ручная разметка пользователя (эталон) — приоритет: ручная правка > seed > ИИ
SLE_SEED = {
    "PUTKURERA-900": "Внешние зависимости",
    "PUTKURERA-927": "Внешние зависимости",
    "PUTKURERA-818": "Внешние зависимости",
    "PUTKURERA-787": "Внешние зависимости",
    "PUTKURERA-424": "Крупная задача / не MMF",
    "PUTKURERA-740": "Крупная задача / не MMF",
    "PUTKURERA-848": "Крупная задача / не MMF",
    "PUTKURERA-794": "Техническая блокировка",
    "PUTKURERA-148": "Ошибка оценки",
    "PUTKURERA-893": "Ошибка оценки",
    "PUTKURERA-878": "Ошибка оценки",
}

def _risk_level(s: str) -> str:
    s = (s or "").lower()
    if "наруш" in s: return "нарушен"
    if "высок" in s: return "высокий"
    if "умерен" in s: return "умеренный"
    if "низк" in s: return "низкий"
    return "—"

async def classify_sle_task(client, t: dict) -> dict:
    sub_block = "; ".join(
        f"{s['key']}({s['queue']},{s['status']})"
        + (": " + ", ".join(b["reason"] for b in s["blockings"]) if s.get("blockings") else "")
        for s in t.get("subtasks", [])[:12]
    ) or "нет"
    # жёсткие вычисляемые признаки
    jc = (t.get("jobCategory") or "").upper()
    # «крупная» — по КАТЕГОРИИ (XL/L), а не по числу подзадач (у S-задачи тоже бывает много подзадач)
    is_large = jc.startswith("XL") or jc.startswith("L")
    cat_small = jc.startswith("S") or jc.startswith("M")
    try: _ef = float(t.get("effortFact") or t.get("daysInWork") or 0)
    except: _ef = 0
    try: _sle = float(t.get("sle") or 0)
    except: _sle = 0
    overran = _sle > 0 and _ef > _sle * 1.2
    # для детектора берём только ПРИЧИНЫ блокировок (не названия статусов подзадач —
    # статус вроде «Согласование архитектуры Готово» означает завершённый этап, не блок)
    sub_reasons = "; ".join(b.get("reason", "") for s in t.get("subtasks", []) for b in s.get("blockings", []))
    blob = " ".join([str(t.get("lastBlockingReason") or ""), str(t.get("blockingHistory") or ""),
                     str(t.get("comments") or ""), str(t.get("subComments") or ""), sub_reasons]).lower()
    has_tech = any(w in blob for w in ["баг", "bug", "дефект", "ошибк", "фронт", "демо отлож", "не работает", "падает"])
    has_external = any(w in blob for w in ["архитект", "фа ", " фа", "провайдер", "вендор", "маршрутизатор",
                                           "двх", "мораторий", "согласован", "заказчик", "другая команда", "ждем команду"])
    facts = (
        f"Задача: {t['key']} — {t['summary']}\n"
        f"SLE риск: {t['sleRisk']}; SLE: {t['sle']}; P70: {t['p70']}; "
        f"Effort: {t['effort']}; факт.усилия: {t['effortFact']}; категория: {t['jobCategory']}.\n"
        f"Дедлайн: {t.get('deadline')}; завершена: {t.get('end')}; дней в работе: {t.get('daysInWork')}.\n"
        f"Подзадач: {t['subCount']} (активных {t['activeSubCount']}); "
        f"скрытая блокировка: {'да' if t['hiddenBlocked'] else 'нет'}.\n"
        f"ПризнакКрупной (категория XL/L): {'да' if is_large else 'нет'}.\n"
        f"МаленькаяКатегория (S/M): {'да' if cat_small else 'нет'}; "
        f"Переработала (факт сильно больше SLE): {'да' if overran else 'нет'}.\n"
        f"ЕстьБаг/ТехПроблема в тексте: {'да' if has_tech else 'нет'}.\n"
        f"ЕстьЯвноеВнешнееОжидание в тексте: {'да' if has_external else 'нет'}.\n"
        f"Последняя причина блокировки: {(t.get('lastBlockingReason') or '—')[:400]}\n"
        f"История блокировок: {(t.get('blockingHistory') or '—')[:400]}\n"
        f"Комментарии НВ: {(t.get('comments') or '—')[:800]}\n"
        f"Комментарии в подзадачах с блоком: {(t.get('subComments') or '—')[:800]}\n"
        f"Подзадачи и их блокировки: {sub_block[:500]}\n"
        f"Теги: {', '.join(t.get('tags') or []) or '—'}"
    )
    # Детерминированное правило (приоритет соблюдается всегда, не зависит от модели)
    if has_tech:
        cluster = "Техническая блокировка"
    elif cat_small and overran:
        cluster = "Ошибка оценки"
    elif is_large:
        cluster = "Крупная задача / не MMF"
    elif has_external:
        cluster = "Внешние зависимости"
    else:
        cluster = "Ошибка оценки"

    # ИИ пишет только человеческое пояснение под уже выбранный кластер
    reason = None
    if MISTRAL_API_KEY:
        system = (
            f"Причина нарушения SLE для этой задачи уже определена как: «{cluster}». "
            "Напиши РОВНО ОДНО короткое предложение на русском, почему так, простым человеческим языком, "
            "без канцелярита и штампов. "
            "СТРОГО опирайся только на факты ниже. НЕ придумывай конкретику, которой нет в тексте "
            "(роли, команды, причины вроде «архитекторы», «провайдер» — только если они реально упомянуты). "
            "ВАЖНО: статусы подзадач вроде «Согласование архитектуры Готово», «Разработка готово» означают, что "
            "этот этап ЗАВЕРШЁН, а НЕ что задача чего-то ждёт — не делай вывод о блокировке из названия статуса. "
            "Если конкретики нет — скажи общими словами. Без вступлений."
        )
        body = {"model": MISTRAL_MODEL,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": facts}],
                "temperature": 0.3, "max_tokens": 120}
        try:
            r = await client.post("https://api.mistral.ai/v1/chat/completions",
                                  headers={"Authorization": f"Bearer {MISTRAL_API_KEY}"}, json=body)
            r.raise_for_status()
            reason = (r.json()["choices"][0]["message"]["content"] or "").strip().replace("*", "")
        except Exception as e:
            print(f"[sle-cluster] {e}")
    return {"cluster": cluster, "reason": reason}

@app.get("/sle-clusters")
async def sle_clusters(which: str = Query("current"), refresh: bool = Query(False)):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    which = which if which in SLE_QUERIES else "current"

    # 1. читаем из БД-снапшота (мгновенно), либо пересчитываем по refresh/отсутствию
    snap, ts = (None, None) if refresh else await load_snapshot(which)
    if snap is not None:
        tasks = snap
    else:
        try:
            data = await fetch_sle_tasks(which)
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)})
        tasks = data["tasks"]
        # кластеризуем (и тратим ИИ) только на рисковых задачах + эталонные (seed)
        todo = [t for t in tasks if t.get("clusterable") or t["key"] in SLE_SEED]
        async with httpx.AsyncClient(timeout=60) as client:
            comments = await asyncio.gather(*[fetch_comments(client, t["key"]) for t in todo],
                                            return_exceptions=True)
            for t, c in zip(todo, comments):
                t["comments"] = c if isinstance(c, str) else ""
            # комментарии заблокированных подзадач (для анализа причины)
            pairs = [(t, sk) for t in todo for sk in (t.get("blockedSubs") or [])]
            if pairs:
                sc = await asyncio.gather(*[fetch_comments(client, sk) for _, sk in pairs],
                                          return_exceptions=True)
                acc: dict = {}
                for (t, sk), c in zip(pairs, sc):
                    if isinstance(c, str) and c:
                        acc.setdefault(t["key"], []).append(f"{sk}: {c}")
                for t in todo:
                    t["subComments"] = " || ".join(acc.get(t["key"], []))
            results = await asyncio.gather(*[classify_sle_task(client, t) for t in todo])
        cls = {t["key"]: res for t, res in zip(todo, results)}
        for t in tasks:
            res = cls.get(t["key"], {})
            t["aiCluster"] = res.get("cluster")
            t["clusterReason"] = res.get("reason")
            t.pop("comments", None)
            t.pop("subComments", None)
        await save_snapshot(which, tasks)
        ts = "только что"

    # 2. приоритет: ручная правка > эталонная разметка (seed) > ИИ
    try:
        ores = await turso_execute([stmt("SELECT task_key, cluster FROM sle_overrides")])
        ov = {r["task_key"]: r["cluster"] for r in (rows_to_dicts(ores[0]) if ores else [])}
    except Exception:
        ov = {}
    for t in tasks:
        ai = t.get("aiCluster")
        if ov.get(t["key"]):
            t["cluster"], t["source"], t["overridden"] = ov[t["key"]], "override", True
        elif t["key"] in SLE_SEED:
            t["cluster"], t["source"], t["overridden"] = SLE_SEED[t["key"]], "seed", False
        elif t.get("clusterable") and ai:
            t["cluster"], t["source"], t["overridden"] = ai, "ai", False
        else:
            # низкий риск / умеренный без блокеров — ещё ничего не нарушено, кластер не присваиваем
            t["cluster"], t["source"], t["overridden"] = None, None, False
        t["aiCluster"] = ai

    agg = {c["label"]: 0 for c in SLE_CLUSTERS}
    for t in tasks:
        if t["cluster"] in agg:
            agg[t["cluster"]] += 1
    clusters = [{"label": c["label"], "key": c["key"], "count": agg[c["label"]]} for c in SLE_CLUSTERS]
    clustered = sum(1 for t in tasks if t.get("cluster"))
    attention = sum(1 for t in tasks if t.get("needsAttention"))
    return JSONResponse({"ok": True, "which": which, "count": len(tasks), "clustered": clustered,
                         "clusters": clusters, "tasks": tasks, "attention": attention,
                         "updatedAt": ts, "clusterOptions": [c["label"] for c in SLE_CLUSTERS]})

@app.post("/sle-override")
async def sle_override(key: str = Query(...), cluster: str = Query("")):
    if cluster and cluster not in _CLUSTER_LABELS:
        return JSONResponse({"ok": False, "error": "неизвестный кластер"})
    try:
        if cluster:
            await turso_execute([stmt(
                "INSERT INTO sle_overrides(task_key,cluster,updated_at) VALUES(?,?,datetime('now')) "
                "ON CONFLICT(task_key) DO UPDATE SET cluster=excluded.cluster, updated_at=excluded.updated_at",
                [key, cluster])])
        else:
            await turso_execute([stmt("DELETE FROM sle_overrides WHERE task_key=?", [key])])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
    return JSONResponse({"ok": True})

# ── Static (React build) ──────────────────────────────────────────────────────

import os as _os

@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    file = f"static/{full_path}"
    if _os.path.isfile(file):
        return FileResponse(file)
    return FileResponse("static/index.html")

app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")
