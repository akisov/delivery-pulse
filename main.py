import os
import re
import asyncio
import httpx
from datetime import date, datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, Query, Request
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import json

TRACKER_TOKEN = os.environ.get("TRACKER_TOKEN", "")
ORG_ID        = os.environ.get("ORG_ID", "7405124")
TURSO_URL     = os.environ.get("TURSO_URL", "").replace("libsql://", "https://")
TURSO_TOKEN   = os.environ.get("TURSO_TOKEN", "")
MISTRAL_API_KEY = os.environ.get("MISTRAL_TOKEN", "") or os.environ.get("MISTRAL_API_KEY", "")
MISTRAL_MODEL   = os.environ.get("MISTRAL_MODEL", "mistral-small-latest")
CLAUDE_TOKEN    = os.environ.get("CLAUDE_TOKEN", "") or os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL    = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-20250514")
AI_ENABLED      = bool(CLAUDE_TOKEN or MISTRAL_API_KEY)
PRACTICE_URL    = "https://evawiki.int.vkusvill.ru/project/Document/DOC-037888#analiz-blokirovok"


async def ai_complete(system: str, user: str, *, max_tokens: int = 400,
                      temperature: float = 0.3) -> str | None:
    """Единый вызов LLM. Приоритет — Claude (CLAUDE_TOKEN); при ошибке/отсутствии
    откатывается на Mistral. Возвращает текст ответа или None."""
    # 1) Claude (Anthropic Messages API)
    if CLAUDE_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=40) as client:
                r = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": CLAUDE_TOKEN,
                             "anthropic-version": "2023-06-01",
                             "content-type": "application/json"},
                    json={"model": CLAUDE_MODEL, "max_tokens": max_tokens,
                          "temperature": temperature, "system": system,
                          "messages": [{"role": "user", "content": user}]})
                r.raise_for_status()
                parts = r.json().get("content") or []
                txt = "".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()
                if txt:
                    return txt
        except Exception as e:
            print(f"[claude] {e}; fallback to mistral")
    # 2) Mistral (fallback)
    if MISTRAL_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=40) as client:
                r = await client.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {MISTRAL_API_KEY}"},
                    json={"model": MISTRAL_MODEL,
                          "messages": [{"role": "system", "content": system},
                                       {"role": "user", "content": user}],
                          "temperature": temperature, "max_tokens": max_tokens})
                r.raise_for_status()
                return (r.json()["choices"][0]["message"]["content"] or "").strip()
        except Exception as e:
            print(f"[mistral] {e}")
    return None

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
        stmt("""CREATE TABLE IF NOT EXISTS flow_snapshot (
            week TEXT PRIMARY KEY,
            discovery_p90 REAL, discovery_count INTEGER,
            delivery_p90 REAL, delivery_count INTEGER,
            saved_at TEXT
        )"""),
        stmt("""CREATE TABLE IF NOT EXISTS osp_snapshot (
            which TEXT PRIMARY KEY,
            data TEXT,
            updated_at TEXT
        )"""),
        stmt("""CREATE TABLE IF NOT EXISTS osp_pulse (
            team TEXT, month TEXT, criterion TEXT, score REAL, updated_at TEXT,
            PRIMARY KEY(team, month, criterion)
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

# ── Планировщик: ежедневный синк блокировок ─────────────────────────────────────
SYNC_HOUR_MSK = 6  # во сколько (по МСК) гонять авто-синк

async def _daily_scheduler():
    await asyncio.sleep(20)  # дать приложению подняться
    while True:
        try:
            now = datetime.utcnow()
            target = now.replace(hour=(SYNC_HOUR_MSK - 3) % 24, minute=0, second=0, microsecond=0)
            if target <= now:
                target += timedelta(days=1)
            await asyncio.sleep(max(60, (target - now).total_seconds()))
            if TRACKER_TOKEN and not _sync_status["running"]:
                print("[scheduler] ежедневный синк блокировок")
                await run_sync_job(list(QUEUES), False)
                # сбрасываем SLE-кэш, чтобы при заходе подхватились свежие статусы блоков
                try:
                    await turso_execute([stmt("DELETE FROM sle_snapshot")])
                except Exception as e:
                    print(f"[scheduler] sle invalidate: {e}")
                # догружаем worklog текущего месяца из API
                try:
                    if not _wl_status["running"]:
                        await run_osp_worklog_current(date.today().year)
                except Exception as e:
                    print(f"[scheduler] worklog current: {e}")
        except Exception as e:
            print(f"[scheduler] {e}")
            await asyncio.sleep(3600)

# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    asyncio.create_task(_daily_scheduler())
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
    if not AI_ENABLED or not f["totalBlockings"]:
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
    return await ai_complete(system, facts_txt, max_tokens=300, temperature=0.25)

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
    # окно периода: дни блокировки считаем С ОБРЕЗКОЙ по [date_from, date_to]
    # (как в ОСП и в Power BI) — блокировка попадает в период своей частью, а не вся по дате старта
    today = date.today()
    win_start = _date_only(date_from) if date_from else None
    win_end = (_date_only(date_to) if date_to else None) or today

    where = f"b.queue IN ({q_ph}) AND b.start_date != '' AND b.start_date <= ?"
    args: list = [*selected, win_end.isoformat()]
    if win_start:
        where += " AND (b.status != 'closed' OR (b.end_date != '' AND b.end_date >= ?))"
        args.append(win_start.isoformat())

    results = await turso_execute([
        stmt(f"""SELECT b.reason as reason, b.key as blocking_key, b.parent_key as parent_key,
                    b.start_date, b.end_date, b.status as b_status, b.queue,
                    p.title as parent_title, bs.status_display as stage
                 FROM blockings b
                 LEFT JOIN parent_tasks p ON p.key=b.parent_key
                 LEFT JOIN blocking_status bs ON bs.blocking_key=b.key
                 WHERE {where}""", args),
    ])
    rows = rows_to_dicts(results[0]) if results else []

    by_reason: dict = {}
    reason_days: dict = {}
    seen: set = set()
    for r in rows:
        bkey = r.get("blocking_key", "")
        if bkey in seen:  # LEFT JOIN со стадиями мог продублировать строку
            continue
        seen.add(bkey)
        s = _date_only(r.get("start_date"))
        if not s:
            continue
        closed = r.get("b_status") == "closed"
        e = _date_only(r.get("end_date")) if (closed and r.get("end_date")) else today
        if not e or e < s:
            e = s
        lo = max(s, win_start) if win_start else s
        hi = min(e, win_end)
        if hi < lo:
            continue
        d = (hi - lo).days + 1
        reason = r.get("reason") or "Не указана"
        reason_days[reason] = reason_days.get(reason, 0) + d
        by_reason.setdefault(reason, []).append({
            "blockingKey": bkey,
            "parentKey":   r.get("parent_key", ""),
            "parentTitle": r.get("parent_title") or "—",
            "url":         f"https://tracker.yandex.ru/{r.get('parent_key','')}",
            "queue":       r.get("queue", ""),
            "stage":       r.get("stage") or "Без этапа",
            "startDate":   (r.get("start_date") or "")[:10],
            "endDate":     (r.get("end_date") or "")[:10],
            "isActive":    not closed,
            "days":        d,
        })
    for k in by_reason:
        by_reason[k].sort(key=lambda t: t["days"], reverse=True)

    total = sum(reason_days.values())
    items = []
    for reason, d in sorted(reason_days.items(), key=lambda x: -x[1]):
        if d <= 0:
            continue
        items.append({
            "reason":    reason,
            "totalDays": d,
            "count":     len(by_reason.get(reason, [])),
            "pct":       round(d / total * 100, 1) if total else 0,
            "tasks":     by_reason.get(reason, []),
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
        is_current = which == "current"
        at_risk = is_current and risk_level in ("нарушен", "высокий", "умеренный")
        signals = []
        # Блок в активной подзадаче — сигнал при риске умеренный+
        if blocked_subs and at_risk:
            signals.append("Блок висит в подзадаче: " + ", ".join(blocked_subs))
        # Нет активных подзадач (скрытая блокировка) — как в n8n, при ЛЮБОМ риске
        if is_current and len(plist) > 0 and len(active) == 0:
            signals.append("Нет активных подзадач — по задаче сейчас никто не работает")
        needs_attention = is_current and len(signals) > 0
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
            "riskSignals": signals,
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
            "hiddenBlocked": hidden_blocked and which == "current",
        })

    return {"which": which, "count": len(tasks), "tasks": tasks}

SLE_SNAPSHOT_VERSION = 12  # bump при изменении логики сигналов/полей — старые снапшоты инвалидируются

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
    if AI_ENABLED:
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
        txt = await ai_complete(system, facts, max_tokens=120, temperature=0.3)
        if txt:
            reason = txt.replace("*", "")
    return {"cluster": cluster, "reason": reason}

@app.get("/sle-clusters")
async def sle_clusters(which: str = Query("current"), refresh: bool = Query(False)):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    which = which if which in SLE_QUERIES else "current"

    # 1. читаем из БД-снапшота (мгновенно), либо пересчитываем по refresh/отсутствию.
    # Снапшот и overrides тянем одним пайплайном = один round-trip в Turso.
    snap, ts, ov, ov_loaded = None, None, {}, False
    if not refresh:
        try:
            res = await turso_execute([
                stmt("SELECT data, updated_at FROM sle_snapshot WHERE which=?", [which]),
                stmt("SELECT task_key, cluster FROM sle_overrides"),
            ])
            srows = rows_to_dicts(res[0]) if len(res) > 0 else []
            if srows and srows[0].get("data"):
                obj = json.loads(srows[0]["data"])
                if isinstance(obj, dict) and obj.get("v") == SLE_SNAPSHOT_VERSION:
                    snap, ts = obj.get("tasks", []), srows[0].get("updated_at")
            ov = {r["task_key"]: r["cluster"] for r in (rows_to_dicts(res[1]) if len(res) > 1 else [])}
            ov_loaded = True
        except Exception as e:
            print(f"[sle-clusters read] {e}")

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
    # overrides уже прочитаны вместе со снапшотом; добираем только если шли по refresh-пути
    if not ov_loaded:
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

# ── Поток: Discovery / Delivery (WIP Age) ───────────────────────────────────────

_FLOW_COMMON = ('Type: newFeature Queue: PUTKURERA PUTKURERA."Operating mode": !Отложено '
                'Resolution: empty() "Status Type": !cancelled "Status Type": !done')
FLOW_DISCOVERY_QUERY = _FLOW_COMMON + " Status: podtverzdenieBoli, confirmed, proverkaIdej"
FLOW_DELIVERY_QUERY  = _FLOW_COMMON + " Status: inProgress"
WIP_DISCOVERY = int(os.environ.get("WIP_DISCOVERY", "25"))
WIP_DELIVERY  = int(os.environ.get("WIP_DELIVERY", "20"))
FLOW_TARGET   = int(os.environ.get("FLOW_TARGET", "60"))  # целевой WIP Age (красная линия)

# Историческая динамика (из ручного учёта): (дата, discP90, discCount, delivP90, delivCount)
SEED_FLOW_HISTORY = [
    ("2025-10-01", 112.4, None, 112.0, None),
    ("2026-03-20", 162.9, None, 123.0, None),
    ("2026-04-03", 123.8, 32, 117.8, 19),
    ("2026-04-17", 74.9, 34, 124.0, 18),
    ("2026-04-30", 84.1, 34, 53.6, 15),
    ("2026-05-05", 101.0, 34, 70.6, 15),
    ("2026-05-08", 104.1, 34, 71.4, 17),
    ("2026-05-11", 105.2, 27, 73.4, 17),
    ("2026-05-21", 100.5, 16, 53.8, 18),
    ("2026-06-04", 103.8, 22, 64.6, 18),
]

def _pctl_interp(vals: list, p: float) -> int:
    # P90 как в n8n: линейная интерполяция между соседними рангами
    v = [x for x in vals if x is not None]
    if not v: return 0
    s = sorted(v)
    idx = p * (len(s) - 1)
    lo = int(idx); hi = min(lo + 1, len(s) - 1)
    return round(s[lo] + (s[hi] - s[lo]) * (idx - lo))

def _flow_days(issue: dict, hint: str) -> int:
    k = next((k for k in issue if hint in k.lower()), None)
    v = issue.get(k) if k else None
    if v is None:
        v = issue.get("daysOnTheStatus")
    try: return int(float(v or 0))
    except: return 0

def _flow_pack(issues: list, hint: str, limit: int) -> dict:
    items = []
    for t in issues:
        items.append({
            "key": t.get("key"), "summary": t.get("summary", "—"),
            "assignee": (t.get("assignee") or {}).get("display", "—"),
            "status": (t.get("status") or {}).get("display", ""),
            "url": f"https://tracker.yandex.ru/{t.get('key')}",
            "days": _flow_days(t, hint),
            "statusKey": (t.get("status") or {}).get("key", ""),
            "sleRisk": _field(t, "--sleRisk") or "",
        })
    items.sort(key=lambda x: x["days"], reverse=True)
    days = [i["days"] for i in items]
    return {"count": len(items), "p90": _pctl_interp(days, 0.90), "limit": limit,
            "overLimit": len(items) > limit, "top": items[:5], "tasks": items}

@app.get("/flow-metrics")
async def flow_metrics():
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            # обе очереди тянем параллельно (один клиент, два конкурентных запроса)
            disc, deliv = await asyncio.gather(
                tracker_query(client, FLOW_DISCOVERY_QUERY),
                tracker_query(client, FLOW_DELIVERY_QUERY),
            )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    discovery = _flow_pack(disc, "research", WIP_DISCOVERY)
    delivery = _flow_pack(deliv, "work", WIP_DELIVERY)

    # SLE-риск в Delivery
    sle_break: dict = {}
    for t in delivery["tasks"]:
        sle_break[t["sleRisk"] or "—"] = sle_break.get(t["sleRisk"] or "—", 0) + 1

    # недельный снапшот: текущую неделю всегда обновляем актуальными значениями
    # (прошлые недели/сид не трогаем)
    y, w, _ = date.today().isocalendar()
    week = f"{y}-W{w:02d}"
    today = date.today().isoformat()
    rows = []
    try:
        # SELECT (читает состояние до апсёрта) + INSERT одним пайплайном = один round-trip
        res = await turso_execute([
            stmt("SELECT week, discovery_p90, discovery_count, delivery_p90, delivery_count, saved_at FROM flow_snapshot ORDER BY saved_at"),
            stmt(
                "INSERT INTO flow_snapshot(week,discovery_p90,discovery_count,delivery_p90,delivery_count,saved_at) "
                "VALUES(?,?,?,?,?,datetime('now')) ON CONFLICT(week) DO UPDATE SET "
                "discovery_p90=excluded.discovery_p90, discovery_count=excluded.discovery_count, "
                "delivery_p90=excluded.delivery_p90, delivery_count=excluded.delivery_count, saved_at=excluded.saved_at",
                [week, discovery["p90"], discovery["count"], delivery["p90"], delivery["count"]]),
        ])
        rows = rows_to_dicts(res[0]) if res else []
        cur = next((r for r in rows if r["week"] == week), None)
        vals = {"discovery_p90": discovery["p90"], "discovery_count": discovery["count"],
                "delivery_p90": delivery["p90"], "delivery_count": delivery["count"], "saved_at": today}
        if cur: cur.update(vals)
        else: rows.append({"week": week, **vals})
    except Exception as e:
        print(f"[flow-snapshot] {e}")

    # объединяем сид-историю и снапшоты из БД по дате
    def _short(iso: str) -> str:
        try:
            d = date.fromisoformat(iso[:10]); return f"{d.day:02d}.{d.month:02d}"
        except Exception:
            return iso
    points: dict = {}
    for dt, dp, dc, vp, vc in SEED_FLOW_HISTORY:
        points[dt] = {"discoveryP90": dp, "deliveryP90": vp, "discoveryCount": dc, "deliveryCount": vc}
    for r in rows:
        dt = (r.get("saved_at") or "")[:10] or today
        points[dt] = {"discoveryP90": r.get("discovery_p90"), "deliveryP90": r.get("delivery_p90"),
                      "discoveryCount": r.get("discovery_count"), "deliveryCount": r.get("delivery_count")}
    history = [{"date": dt, "label": _short(dt), **v} for dt, v in sorted(points.items())]

    return JSONResponse({"ok": True, "discovery": discovery, "delivery": delivery,
                         "sleBreakdown": sle_break, "week": week, "target": FLOW_TARGET,
                         "history": history})

@app.get("/flow-completed")
async def flow_completed(months: int = Query(8), refresh: bool = Query(False)):
    """Сколько задач PUTKURERA перешло в «Завершено» по месяцам (по дате завершения)."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    months = max(1, min(int(months or 8), 24))
    ckey = f"flowdone-{months}-v1"
    if not refresh:
        try:
            res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?", [ckey])])
            rows = rows_to_dicts(res[0]) if res else []
            if rows and rows[0].get("data"):
                obj = json.loads(rows[0]["data"]); obj["updatedAt"] = rows[0].get("updated_at") or ""
                return JSONResponse(obj)
        except Exception as e:
            print(f"[flow-completed load] {e}")

    month_list = _osp_month_list(months)
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            issues = await tracker_query(client, "Type: newFeature Queue: PUTKURERA Status: zaverseno, analizRezults, closed")
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    counts = {m: 0 for m in month_list}
    items: list[dict] = []
    for iss in issues:
        endraw = iss.get("end") or iss.get("resolvedAt") or ""
        mo = _msk_month(endraw)
        if mo not in counts:
            continue
        counts[mo] += 1
        items.append({
            "month": mo, "key": iss.get("key"), "summary": iss.get("summary") or "—",
            "url": f"https://tracker.yandex.ru/{iss.get('key')}",
            "end": _msk_date(endraw) if endraw else "",
            "status": (iss.get("status") or {}).get("display", ""),
            "assignee": (iss.get("assignee") or {}).get("display", "—"),
        })
    data = [{"month": m, "label": _osp_label(m), "count": counts[m]} for m in month_list]
    payload = {"ok": True, "months": month_list, "data": data, "items": items, "total": sum(counts.values())}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ckey, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[flow-completed save] {e}")
    payload["updatedAt"] = "только что"
    return JSONResponse(payload)

# ── ОСП: обзор сервиса поставки (3 очереди курьеров) ────────────────────────────

# очереди курьеров → отображаемые имена
OSP_QUEUES = {"POOLING": "Курьеры X", "UDOSTAVKA": "Курьеры U", "DOSTAVKAPIKO": "Курьеры R"}
# категории «сколько сделали»
OSP_CATEGORIES = [
    {"key": "story",     "label": "Story"},            # Работа по ТЗ
    {"key": "techDebt",  "label": "ТехДолг"},
    {"key": "techImpr",  "label": "Тех. улучшение"},
    {"key": "analytics", "label": "Аналитика"},
    {"key": "incident",  "label": "Инциденты"},
]
_RU_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

def _osp_category(type_key: str | None, type_display: str | None) -> str | None:
    """Категория задачи по типу Трекера. Сопоставляем и по ключу, и по названию —
    устойчиво к тому, какой именно ключ у типа в очередях курьеров."""
    k = (type_key or "").lower()
    d = (type_display or "").lower()
    if "incident" in k or "инцидент" in d:
        return "incident"
    if "analy" in k or "аналитик" in d:
        return "analytics"
    if "improvement" in k or "улучшен" in d:  # Тех. улучшение — раньше ТехДолга
        return "techImpr"
    if "techdebt" in k or "debt" in k or "техдолг" in d or "тех. долг" in d or "технический долг" in d:
        return "techDebt"
    if "story" in k or "работа по тз" in d or "по тз" in d:
        return "story"
    return None

def _osp_month_list(n: int) -> list[str]:
    today = date.today()
    y, m, out = today.year, today.month, []
    for _ in range(n):
        out.append(f"{y}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))

def _osp_label(ym: str) -> str:
    try:
        y, m = ym.split("-")
        return f"{_RU_MON[int(m) - 1]} {y[2:]}"
    except Exception:
        return ym

def _msk_dt(ts: str):
    """ISO-таймстамп Трекера (любой офсет) → datetime по МСК (UTC+3)."""
    if not ts or len(ts) < 19:
        return None
    try:
        base = datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")
        off = 0
        m = re.search(r"([+-])(\d{2}):?(\d{2})", ts[19:])
        if m:
            off = (1 if m.group(1) == "+" else -1) * (int(m.group(2)) * 60 + int(m.group(3)))
        return base - timedelta(minutes=off) + timedelta(minutes=180)  # → UTC → МСК
    except Exception:
        return None

def _msk_month(ts: str) -> str:
    d = _msk_dt(ts)
    return d.strftime("%Y-%m") if d else (ts or "")[:7]

def _msk_date(ts: str) -> str:
    d = _msk_dt(ts)
    return d.strftime("%Y-%m-%d") if d else (ts or "")[:10]

def _fmt_spent(s) -> str:
    """ISO-8601 длительность Трекера (P1W4DT4H45M) → «1н 4д 4ч 45м»."""
    if not s or not isinstance(s, str):
        return ""
    m = re.match(r"P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$", s)
    if not m:
        return ""
    w, d, h, mi, _sec = [int(x) if x else 0 for x in m.groups()]
    parts = []
    if w: parts.append(f"{w}н")
    if d: parts.append(f"{d}д")
    if h: parts.append(f"{h}ч")
    if mi: parts.append(f"{mi}м")
    return " ".join(parts)

def _osp_grab(v) -> str:
    if isinstance(v, dict):
        return v.get("display") or v.get("name") or ""
    if isinstance(v, list):
        return ", ".join((x.get("display") if isinstance(x, dict) else str(x)) for x in v)
    return str(v) if v not in (None, "") else ""

def _osp_jobcat(iss: dict, field: dict | None, suffixes: list[str]) -> str:
    """Значение «Категории работы». Сначала пробуем поле этой очереди, затем —
    ключи, найденные в других очередях (локальные поля часто имеют общий ключ)."""
    if field:
        v = iss.get(field.get("id") or "")
        if v is None and field.get("key"):
            v = _field(iss, "--" + field["key"])
        s = _osp_grab(v)
        if s:
            return s
    for suf in suffixes:
        s = _osp_grab(_field(iss, suf))
        if s:
            return s
    return ""

def _osp_resolution_ok(res: dict | None) -> bool:
    """Учитываем как «сделано» только резолюции «Решён» и «Отменено с часами»
    (не Дубликат / Не делаем / Отменено без часов и т.п.)."""
    d = ((res or {}).get("display") or "").lower()
    k = ((res or {}).get("key") or "").lower()
    if "решен" in d or "решён" in d or k == "fixed":
        return True
    if "отменено с часами" in d or "с часами" in d:
        return True
    return False

def _osp_days_field(iss: dict):
    """Поле Трекера «Дней в работе» (daysInTheWork); суффиксный матч ловит и локальный префикс."""
    v = _field(iss, "daysInTheWork")
    if isinstance(v, dict):
        v = v.get("value") if v.get("value") is not None else v.get("display")
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None

def _osp_days_in_work(start: str, resolved: str):
    """Фолбэк: дней в работе ≈ дата завершения − дата начала (календарные дни)."""
    if not start or not resolved:
        return None
    try:
        d1 = datetime.strptime(start[:10], "%Y-%m-%d")
        d2 = datetime.strptime(resolved[:10], "%Y-%m-%d")
        return max((d2 - d1).days, 0)
    except Exception:
        return None

OSP_SNAPSHOT_TTL_H = 12  # сколько часов кэш считается свежим
OSP_SNAPSHOT_VERSION = 9  # поднимать при изменении состава полей/логики (инвалидирует кэш)

# ── ОСП: распределение времени (worklog) ────────────────────────────────────────
OSP_WL_VERSION = 1  # версия снапшота worklog
_QTEAM = {"POOLING": "X", "UDOSTAVKA": "U", "DOSTAVKAPIKO": "R"}
_wl_status: dict = {"running": False, "pct": 0, "msg": "", "error": ""}

def _iso_dur_hours(s) -> float:
    """ISO-8601 длительность worklog → часы. Трекер: 1д = 8ч, 1н = 40ч."""
    if not s or not isinstance(s, str):
        return 0.0
    m = re.match(r"P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$", s)
    if not m:
        return 0.0
    w, d, h, mi, sec = m.groups()
    return (int(w or 0) * 40 + int(d or 0) * 8 + int(h or 0)
            + int(mi or 0) / 60 + float(sec or 0) / 3600)

async def _wl_fetch(client, key):
    try:
        return await tracker_request(client, "GET", f"/v2/issues/{key}/worklog")
    except Exception:
        return []

def _wl_type_label(display: str | None) -> str | None:
    """Приводим тип задачи к меткам отчёта. Прочие типы (Деливери, Тестирование и т.п.)
    в часах НЕ учитываем — как в месячных отчётах."""
    d = (display or "").lower()
    if "инцидент" in d or "incident" in d:
        return "Инцидент"
    if "улучшен" in d:
        return "Тех. улучшение"
    if "техдолг" in d or "тех. долг" in d or "технический долг" in d or "debt" in d:
        return "ТехДолг"
    if "аналит" in d or "анализ" in d or "analy" in d:
        return "Аналитика"
    if "поддержк" in d or "support" in d:
        return "Поддержка"
    if "story" in d or "работа по тз" in d or "по тз" in d:
        return "Story"
    return None

async def run_osp_worklog_current(year: int):
    """Догружает worklog ТЕКУЩЕГО месяца из API и подмешивает в снапшот (прошлые месяцы из Excel не трогаем)."""
    global _wl_status
    _wl_status = {"running": True, "pct": 2, "msg": "Текущий месяц: ищем списания…", "error": ""}
    try:
        today = date.today()
        cm = f"{year}-{today.month:02d}"
        m0 = f"{cm}-01"
        agg: dict = {q: {} for q in OSP_QUEUES}
        async with httpx.AsyncClient(timeout=60) as client:
            todo: list[tuple] = []
            for q in OSP_QUEUES:
                page = 1
                while True:
                    data = await tracker_request(client, "POST",
                        f"/v2/issues/_search?perPage=100&page={page}",
                        {"filter": {"queue": q, "updatedAt": {"from": f"{m0}T00:00:00", "to": "2099-01-01T00:00:00"}}})
                    chunk = data if isinstance(data, list) else []
                    for iss in chunk:
                        if not iss.get("spent"):
                            continue
                        tp = _wl_type_label((iss.get("type") or {}).get("display"))
                        if not tp:  # типы вне отчётного набора (напр. Деливери) не учитываем
                            continue
                        todo.append((iss["key"], q, tp))
                    if len(chunk) < 100:
                        break
                    page += 1
                    await asyncio.sleep(0.4)
            total, done, B = len(todo), 0, 3
            _wl_status["msg"] = f"Текущий месяц: задач {total}, тянем worklog…"
            for i in range(0, total, B):
                chunk = todo[i:i + B]
                wls = await asyncio.gather(*[_wl_fetch(client, k) for (k, _, _) in chunk], return_exceptions=True)
                for (k, q, tp), wl in zip(chunk, wls):
                    if not isinstance(wl, list):
                        continue
                    for e in wl:
                        if (e.get("start") or "")[:7] != cm:
                            continue
                        hrs = _iso_dur_hours(e.get("duration"))
                        if hrs > 0:
                            agg[q][tp] = agg[q].get(tp, 0.0) + hrs
                done += len(chunk)
                await asyncio.sleep(0.3)
                _wl_status["pct"] = 5 + round(done / max(total, 1) * 92)
                _wl_status["msg"] = f"worklog {done}/{total}"
        for q in agg:
            for tp in list(agg[q]):
                agg[q][tp] = round(agg[q][tp], 2)
        key = f"wl-{year}-v{OSP_WL_VERSION}"
        snap = await _osp_snap(key) or {"ok": True, "year": year, "months": [], "queues": OSP_QUEUES, "types": [], "data": {}}
        snap.setdefault("data", {})[cm] = agg
        snap["months"] = sorted(set((snap.get("months") or []) + [cm]))
        ts = set(snap.get("types") or [])
        for q in agg:
            ts |= set(agg[q].keys())
        snap["types"] = sorted(ts)
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [key, json.dumps(snap, ensure_ascii=False)])])
        _wl_status = {"running": False, "pct": 100, "msg": "Готово", "error": ""}
    except Exception as e:
        _wl_status = {"running": False, "pct": 0, "msg": "", "error": str(e)}

async def run_osp_worklog_job(year: int):
    """Фоном собирает worklog по 3 очередям с начала года и пишет агрегат в osp_snapshot.
    ВАЖНО: каждая запись о списании относится к месяцу по СВОЕЙ дате (worklog.start),
    а не по дате обновления задачи. updatedAt используется лишь чтобы выбрать задачи,
    у которых вообще могли быть списания в этом году. Часы = месяц × команда (очередь
    по ключу) × тип. Так работа за апрель не попадёт в май, даже если задачу трогали в мае."""
    global _wl_status
    _wl_status = {"running": True, "pct": 2, "msg": "Ищем задачи со списаниями…", "error": ""}
    try:
        jan1 = f"{year}-01-01"
        today = date.today()
        last_m = today.month if year == today.year else 12
        months = [f"{year}-{m:02d}" for m in range(1, last_m + 1)]
        agg = {mo: {q: {} for q in OSP_QUEUES} for mo in months}
        seen_types: set = set()
        async with httpx.AsyncClient(timeout=60) as client:
            # 1. задачи трёх очередей, обновлённые в этом году, со списанным временем
            todo: list[tuple] = []
            for q in OSP_QUEUES:
                page = 1
                while True:
                    data = await tracker_request(client, "POST",
                        f"/v2/issues/_search?perPage=100&page={page}",
                        {"filter": {"queue": q, "updatedAt": {"from": f"{jan1}T00:00:00", "to": "2099-01-01T00:00:00"}}})
                    chunk = data if isinstance(data, list) else []
                    for iss in chunk:
                        if not iss.get("spent"):
                            continue  # без списаний worklog пустой
                        todo.append((iss["key"], q, (iss.get("type") or {}).get("display") or "—"))
                    if len(chunk) < 100:
                        break
                    page += 1
                    await asyncio.sleep(0.4)
            total = len(todo)
            _wl_status["msg"] = f"Задач со списаниями: {total}. Тянем worklog…"
            # 2. worklog по каждой задаче (чанками, бережём rate limit)
            B, done = 3, 0
            for i in range(0, total, B):
                if _wl_status.get("cancel"):
                    _wl_status = {"running": False, "pct": 0, "msg": "Остановлено", "error": ""}
                    return
                chunk = todo[i:i + B]
                wls = await asyncio.gather(*[_wl_fetch(client, k) for (k, _, _) in chunk],
                                           return_exceptions=True)
                for (k, q, tp), wl in zip(chunk, wls):
                    if not isinstance(wl, list):
                        continue
                    for e in wl:
                        mo = (e.get("start") or "")[:7]
                        if mo not in agg:
                            continue
                        hrs = _iso_dur_hours(e.get("duration"))
                        if hrs <= 0:
                            continue
                        seen_types.add(tp)
                        agg[mo][q][tp] = agg[mo][q].get(tp, 0.0) + hrs
                done += len(chunk)
                await asyncio.sleep(0.3)
                _wl_status["pct"] = 5 + round(done / max(total, 1) * 92)
                _wl_status["msg"] = f"worklog {done}/{total}"
        for mo in agg:
            for q in agg[mo]:
                for tp in list(agg[mo][q]):
                    agg[mo][q][tp] = round(agg[mo][q][tp], 2)
        payload = {"ok": True, "year": year, "months": months, "queues": OSP_QUEUES,
                   "types": sorted(seen_types), "data": agg}
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [f"wl-{year}-v{OSP_WL_VERSION}", json.dumps(payload, ensure_ascii=False)])])
        _wl_status = {"running": False, "pct": 100, "msg": "Готово", "error": ""}
    except Exception as e:
        _wl_status = {"running": False, "pct": 0, "msg": "", "error": str(e)}

@app.get("/osp-delivery")
async def osp_delivery(months: int = Query(6), refresh: bool = Query(False)):
    """Сколько сделали (завершено) по месяцам: Story / Тех. долг / Инциденты
    по трём очередям курьеров. Группировка — по дате завершения (resolvedAt).
    Результат кэшируется в БД (osp_snapshot); пересчёт — при refresh или протухании."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    months = max(1, min(int(months or 6), 24))
    key = f"{months}-v{OSP_SNAPSHOT_VERSION}"

    # 1. читаем кэш из БД и отдаём мгновенно (любой свежести). Пересчёт — только по refresh.
    if not refresh:
        try:
            res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?", [key])])
            rows = rows_to_dicts(res[0]) if res else []
            if rows and rows[0].get("data"):
                obj = json.loads(rows[0]["data"])
                obj["updatedAt"], obj["cached"] = rows[0].get("updated_at") or "", True
                return JSONResponse(obj)
        except Exception as e:
            print(f"[osp-snapshot load] {e}")

    month_list = _osp_month_list(months)
    cutoff = month_list[0] + "-01"

    async def _fetch(client, q):
        # завершённые (есть резолюция) с датой решения от cutoff
        query = f'Queue: {q} Resolution: notEmpty() Resolved: >= "{cutoff}"'
        return await tracker_query(client, query)

    async def _catfield(client, q):
        # локальное поле очереди «Категория работы» — у каждой очереди своё
        try:
            lf = await tracker_request(client, "GET", f"/v2/queues/{q}/localFields")
            cand = None
            for f in (lf or []):
                name = (f.get("name") or "").lower()
                if "категор" in name:  # Категория работы / Категории …
                    if "работ" in name:  # точное «Категория работы» — приоритет
                        return f
                    cand = cand or f
                elif ("categor" in (f.get("key") or "").lower()) and cand is None:
                    cand = f
            return cand
        except Exception as e:
            print(f"[osp localFields {q}] {e}")
        return None

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            results = await asyncio.gather(*[_fetch(client, q) for q in OSP_QUEUES])
            catfields = await asyncio.gather(*[_catfield(client, q) for q in OSP_QUEUES])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
    catfield_by_q = dict(zip(OSP_QUEUES, catfields))
    # суффиксы ключей всех найденных полей — пробуем кросс-очередь (часто ключ общий)
    cat_suffixes = []
    for f in catfields:
        if f and f.get("key"):
            suf = "--" + f["key"]
            if suf not in cat_suffixes:
                cat_suffixes.append(suf)
    if "--jobCategory" not in cat_suffixes:
        cat_suffixes.append("--jobCategory")

    cats = [c["key"] for c in OSP_CATEGORIES]
    zero = lambda: {**{c: 0 for c in cats}, "total": 0}
    buckets = {m: {q: zero() for q in OSP_QUEUES} for m in month_list}
    totals = {c: 0 for c in cats}
    seen_types: dict[str, int] = {}
    seen_res: dict[str, int] = {}
    items: list[dict] = []  # задачи для модалки (по клику на тип/столбец)

    for q, issues in zip(OSP_QUEUES, results):
        for iss in issues:
            ra = iss.get("resolvedAt") or ""
            mo = _msk_month(ra)  # месяц по МСК (как «Дата завершения» в Трекере)
            if mo not in buckets:
                continue
            res = iss.get("resolution") or {}
            rdisp = res.get("display") or res.get("key") or "—"
            seen_res[rdisp] = seen_res.get(rdisp, 0) + 1
            t = iss.get("type") or {}
            disp = t.get("display") or t.get("key") or "—"
            seen_types[disp] = seen_types.get(disp, 0) + 1
            cat = _osp_category(t.get("key"), t.get("display"))
            if not cat:
                continue
            # для всех типов — только «Решён» и «Отменено с часами»
            if not _osp_resolution_ok(res):
                continue
            buckets[mo][q][cat] += 1
            buckets[mo][q]["total"] += 1
            totals[cat] += 1
            par = iss.get("parent") or {}
            start = (iss.get("start") or "")[:10]
            dwork = _osp_days_field(iss)
            if dwork is None:
                dwork = _osp_days_in_work(start, ra)
            items.append({
                "key": iss.get("key"), "summary": iss.get("summary") or "—",
                "url": f"https://tracker.yandex.ru/{iss.get('key')}",
                "queue": q, "category": cat, "month": mo, "type": disp,
                "resolvedAt": _msk_date(ra),
                "assignee": (iss.get("assignee") or {}).get("display", "—"),
                "status": (iss.get("status") or {}).get("display", ""),
                "parentKey": par.get("key") or "",
                "parentSummary": par.get("display") or "",
                "start": start,
                "daysInWork": dwork,
                "jobCategory": _osp_jobcat(iss, catfield_by_q.get(q), cat_suffixes),
                "spent": _fmt_spent(iss.get("spent")),
            })

    data = []
    for m in month_list:
        row: dict = {"month": m, "label": _osp_label(m)}
        allc = zero()
        for q in OSP_QUEUES:
            row[q] = buckets[m][q]
            for c in cats + ["total"]:
                allc[c] += buckets[m][q][c]
        row["all"] = allc
        data.append(row)

    payload = {"ok": True, "queues": OSP_QUEUES, "categories": OSP_CATEGORIES,
               "months": month_list, "data": data, "totals": totals, "items": items,
               "seenTypes": dict(sorted(seen_types.items(), key=lambda x: -x[1])),
               "seenResolutions": dict(sorted(seen_res.items(), key=lambda x: -x[1])),
               "catFields": {q: ({"name": f.get("name"), "key": f.get("key")} if f else None)
                             for q, f in catfield_by_q.items()}}

    # 2. сохраняем снапшот в БД
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [key, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[osp-snapshot save] {e}")

    payload["updatedAt"], payload["cached"] = "только что", False
    return JSONResponse(payload)

@app.get("/osp-incidents")
async def osp_incidents(months: int = Query(8), refresh: bool = Query(False)):
    """Сколько инцидентов заведено (создано) по месяцам — по дате создания."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    months = max(1, min(int(months or 8), 24))
    ckey = f"inc-{months}-v2"
    if not refresh:
        try:
            res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?", [ckey])])
            rows = rows_to_dicts(res[0]) if res else []
            if rows and rows[0].get("data"):
                obj = json.loads(rows[0]["data"]); obj["updatedAt"] = rows[0].get("updated_at") or ""
                return JSONResponse(obj)
        except Exception as e:
            print(f"[osp-inc load] {e}")

    month_list = _osp_month_list(months)
    cutoff = month_list[0] + "-01"

    async def _fetch(client, q):
        return await tracker_query(client, f'Queue: {q} Created: >= "{cutoff}"')

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            results = await asyncio.gather(*[_fetch(client, q) for q in OSP_QUEUES])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    buckets = {m: {q: 0 for q in OSP_QUEUES} for m in month_list}
    items: list[dict] = []
    for q, issues in zip(OSP_QUEUES, results):
        for iss in issues:
            t = iss.get("type") or {}
            if _osp_category(t.get("key"), t.get("display")) != "incident":
                continue
            mo = _msk_month(iss.get("createdAt") or "")
            if mo not in buckets:
                continue
            buckets[mo][q] += 1
            st = iss.get("status") or {}
            items.append({
                "month": mo, "queue": q, "key": iss.get("key"),
                "summary": iss.get("summary") or "—",
                "url": f"https://tracker.yandex.ru/{iss.get('key')}",
                "created": _msk_date(iss.get("createdAt") or ""),
                "status": st.get("display", ""), "statusKey": st.get("key", ""),
                "daysInWork": _osp_days_field(iss),
                "assignee": (iss.get("assignee") or {}).get("display", "—"),
            })

    data = []
    for m in month_list:
        row = {"month": m, "label": _osp_label(m), "all": 0}
        for q in OSP_QUEUES:
            row[q] = buckets[m][q]
            row["all"] += buckets[m][q]
        data.append(row)
    payload = {"ok": True, "queues": OSP_QUEUES, "months": month_list, "data": data, "items": items}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ckey, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[osp-inc save] {e}")
    payload["updatedAt"] = "только что"
    return JSONResponse(payload)

# Пороги SLE (гарантия 85%): порог LT в днях и трудозатрат в часах, по командам и типам
OSP_SLE_TARGET = 85
OSP_SLE = {
    "POOLING":      {"incident": {"lt": 24, "hours": 30}, "tech": {"lt": 38, "hours": 37}, "story": {"lt": 108, "hours": 217}},
    "UDOSTAVKA":    {"incident": {"lt": 22, "hours": 26}, "tech": {"lt": 38, "hours": 46}, "story": {"lt": 51, "hours": 104}},
    "DOSTAVKAPIKO": {"incident": {"lt": 14, "hours": 26}, "tech": {"lt": 22, "hours": 34}, "story": {"lt": 44, "hours": 85}},
}
OSP_SLE_CATS = [
    {"key": "incident", "label": "Инциденты"},
    {"key": "techDebt", "label": "ТехДолг"},
    {"key": "techImpr", "label": "Тех. улучшение"},
    {"key": "story",    "label": "Story"},
]
# ТехДолг и Тех. улучшение делят общий порог «tech» (см. OSP_SLE)
_SLE_THR_KEY = {"incident": "incident", "techDebt": "tech", "techImpr": "tech", "story": "story"}

def _sle_cat(type_key, type_display):
    c = _osp_category(type_key, type_display)
    if c in ("incident", "techDebt", "techImpr", "story"):
        return c
    return None

@app.get("/osp-sle")
async def osp_sle(months: int = Query(6), refresh: bool = Query(False)):
    """Попадание в SLE: доля завершённых задач, уложившихся в порог по LT (дни в работе)
    и по трудозатратам (часы), против цели 85% — по типам и командам."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    months = max(1, min(int(months or 6), 24))
    ckey = f"sle-{months}-v3"
    if not refresh:
        try:
            res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?", [ckey])])
            rows = rows_to_dicts(res[0]) if res else []
            if rows and rows[0].get("data"):
                obj = json.loads(rows[0]["data"]); obj["updatedAt"] = rows[0].get("updated_at") or ""
                return JSONResponse(obj)
        except Exception as e:
            print(f"[osp-sle load] {e}")

    cutoff = _osp_month_list(months)[0] + "-01"

    async def _fetch(client, q):
        return await tracker_query(client, f'Queue: {q} Resolution: notEmpty() Resolved: >= "{cutoff}"')

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            results = await asyncio.gather(*[_fetch(client, q) for q in OSP_QUEUES])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    # сбор LT (дни) и часов по queue×cat
    acc = {q: {c["key"]: {"lt": [], "hours": []} for c in OSP_SLE_CATS} for q in OSP_QUEUES}
    items: list[dict] = []
    for q, issues in zip(OSP_QUEUES, results):
        for iss in issues:
            if not _osp_resolution_ok(iss.get("resolution") or {}):
                continue
            t = iss.get("type") or {}
            sc = _sle_cat(t.get("key"), t.get("display"))
            if not sc:
                continue
            dw = _osp_days_field(iss)
            if dw is None:
                dw = _osp_days_in_work((iss.get("start") or "")[:10], (iss.get("resolvedAt") or "")[:10])
            if dw is not None:
                acc[q][sc]["lt"].append(dw)
            sh = _iso_dur_hours(iss.get("spent"))
            if sh > 0:
                acc[q][sc]["hours"].append(sh)
            items.append({
                "queue": q, "cat": sc, "key": iss.get("key"),
                "summary": iss.get("summary") or "—",
                "url": f"https://tracker.yandex.ru/{iss.get('key')}",
                "days": dw, "hours": round(sh, 1) if sh > 0 else None,
                "resolved": _msk_date(iss.get("resolvedAt") or ""),
                "assignee": (iss.get("assignee") or {}).get("display", "—"),
            })

    def _pct(vals, thr):
        if not vals:
            return None
        return round(sum(1 for v in vals if v <= thr) / len(vals) * 100)

    sle = {}
    for q in OSP_QUEUES:
        sle[q] = {}
        for c in OSP_SLE_CATS:
            ck = c["key"]
            thr = OSP_SLE.get(q, {}).get(_SLE_THR_KEY.get(ck, ck), {})
            lt, hrs = acc[q][ck]["lt"], acc[q][ck]["hours"]
            sle[q][ck] = {
                "ltThr": thr.get("lt"), "hoursThr": thr.get("hours"),
                "ltBase": len(lt), "ltPct": _pct(lt, thr.get("lt", 1e9)),
                "hrsBase": len(hrs), "hrsPct": _pct(hrs, thr.get("hours", 1e9)),
            }

    payload = {"ok": True, "queues": OSP_QUEUES, "cats": OSP_SLE_CATS,
               "target": OSP_SLE_TARGET, "sle": sle, "items": items}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ckey, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[osp-sle save] {e}")
    payload["updatedAt"] = "только что"
    return JSONResponse(payload)

# ── ОСП: оценка продакта (Pulse) ────────────────────────────────────────────────
OSP_PULSE_CRITERIA = [
    "Сколько мы сделали",
    "Что именно мы сделали",
    "Сколько это стоило",
    "Как долго мы это делали",
    "Насколько качественно и эффективно",
]
OSP_PULSE_SCALE = {
    "1": "К сожалению, ожидания не оправданы",
    "2": "Не все важные потребности были учтены",
    "3": "Ожидания в целом оправдались, есть только несколько мелких моментов",
    "4": "Вполне попали в ожидания",
    "5": "Превзошли ожидания",
}

@app.get("/osp-pulse")
async def osp_pulse():
    try:
        res = await turso_execute([stmt("SELECT team, month, criterion, score FROM osp_pulse")])
        rows = rows_to_dicts(res[0]) if res else []
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
    data: dict = {}
    months: set = set()
    for r in rows:
        q, m, c = r.get("team"), r.get("month"), r.get("criterion")
        if not (q and m and c):
            continue
        try:
            sc = float(r.get("score"))
        except (TypeError, ValueError):
            continue
        data.setdefault(q, {}).setdefault(m, {})[c] = sc
        months.add(m)
    return JSONResponse({"ok": True, "queues": OSP_QUEUES, "criteria": OSP_PULSE_CRITERIA,
                         "scale": OSP_PULSE_SCALE, "months": sorted(months), "data": data})

@app.post("/osp-pulse/submit")
async def osp_pulse_submit(team: str = Query(...), month: str = Query(...), request: Request = None):
    if team not in OSP_QUEUES:
        return JSONResponse({"ok": False, "error": "неизвестная команда"})
    if not re.match(r"^\d{4}-\d{2}$", month or ""):
        return JSONResponse({"ok": False, "error": "месяц в формате YYYY-MM"})
    try:
        scores = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"bad json: {e}"})
    stmts = []
    for c, v in (scores or {}).items():
        if c not in OSP_PULSE_CRITERIA:
            continue
        try:
            sc = float(v)
        except (TypeError, ValueError):
            continue
        stmts.append(stmt(
            "INSERT INTO osp_pulse(team,month,criterion,score,updated_at) VALUES(?,?,?,?,datetime('now')) "
            "ON CONFLICT(team,month,criterion) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at",
            [team, month, c, sc]))
    if stmts:
        try:
            await turso_execute(stmts)
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)})
    return JSONResponse({"ok": True, "saved": len(stmts)})

async def _osp_snap(which: str):
    try:
        res = await turso_execute([stmt("SELECT data FROM osp_snapshot WHERE which=?", [which])])
        rows = rows_to_dicts(res[0]) if res else []
        if rows and rows[0].get("data"):
            return json.loads(rows[0]["data"])
    except Exception:
        pass
    return None

def _prev_month(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:7]); mo -= 1
    if mo == 0:
        y, mo = y - 1, 12
    return f"{y}-{mo:02d}"

async def _osp_blocking_days(q: str, ym: str) -> int:
    m0, m1 = _month_bounds(ym)
    try:
        res = await turso_execute([stmt(
            "SELECT start_date, end_date, status FROM blockings WHERE queue=? AND start_date!='' "
            "AND start_date <= ? AND (status!='closed' OR (end_date!='' AND end_date >= ?))",
            [q, m1.isoformat(), m0.isoformat()])])
        rows = rows_to_dicts(res[0]) if res else []
    except Exception:
        return 0
    today, total = date.today(), 0
    for r in rows:
        s = _date_only(r.get("start_date"))
        if not s:
            continue
        closed = r.get("status") == "closed"
        e = _date_only(r.get("end_date")) if (closed and r.get("end_date")) else today
        if not e or e < s:
            e = s
        lo, hi = max(s, m0), min(e, m1)
        if hi >= lo:
            total += (hi - lo).days + 1
    return total

async def _osp_ai_summary_build(team: str, month: str) -> str | None:
    if not AI_ENABLED:
        return None
    prev = _prev_month(month)
    deliv = await _osp_snap(f"6-v{OSP_SNAPSHOT_VERSION}")
    inc = await _osp_snap("inc-8-v2")
    wl = await _osp_snap(f"wl-{date.today().year}-v{OSP_WL_VERSION}")

    def drow(m):
        for r in (deliv or {}).get("data", []):
            if r.get("month") == m:
                return r.get(team) or {}
        return {}
    def irow(m):
        for r in (inc or {}).get("data", []):
            if r.get("month") == m:
                return r.get(team) or 0
        return 0
    def wrow(m):
        return ((wl or {}).get("data", {}).get(m, {}) or {}).get(team, {}) or {}

    dM, dP = drow(month), drow(prev)
    iM, iP = irow(month), irow(prev)
    wM, wP = wrow(month), wrow(prev)
    bM, bP = await _osp_blocking_days(team, month), await _osp_blocking_days(team, prev)

    def d(a, b):
        a, b = a or 0, b or 0
        return f"{a} (было {b}, {'+' if a-b>=0 else ''}{round(a-b,1)})"
    cat_lbl = {"story": "Story", "techDebt": "ТехДолг", "techImpr": "Тех.улучшение", "analytics": "Аналитика", "incident": "Инциденты"}
    lines = [
        f"Команда: {OSP_QUEUES.get(team, team)}. Отчётный месяц: {_osp_label(month)} (сравнение с {_osp_label(prev)}).",
        f"Сделано задач всего: {d(dM.get('total'), dP.get('total'))}.",
        "  по типам: " + ", ".join(f"{cat_lbl[k]} {d(dM.get(k), dP.get(k))}" for k in cat_lbl),
        f"Инцидентов заведено за месяц: {d(iM, iP)}.",
        f"Дней блокировок (в этом месяце): {d(bM, bP)}.",
        f"Списано часов всего: {d(round(sum(wM.values()),1), round(sum(wP.values()),1))}.",
        "  часы по типам: " + ", ".join(f"{k} {d(wM.get(k), wP.get(k))}" for k in sorted(set(list(wM) + list(wP)))) if (wM or wP) else "  часы: нет данных",
    ]
    facts = "\n".join(lines)
    system = (
        "Ты — аналитик процессов поставки (delivery) в команде курьеров. На вход — метрики команды "
        "за отчётный месяц и сравнение с предыдущим. Подсветь 2–4 ГЛАВНЫХ узких места и тревожных тренда "
        "для продакта.\n"
        "Примеры наблюдений: инцидентов завели больше, а закрыли меньше; времени на техдолг стало больше "
        "при том же объёме; выросли дни блокировок; перекос в сторону инцидентов в ущерб Story.\n"
        "ФОРМАТ СТРОГО:\n"
        "— Каждый пункт с новой строки, начинается с подходящего эмодзи: 📈 рост, 📉 спад, 🚨/🔥 тревога, "
        "⚠️ риск, ✅ хорошо, 🧱 блокировки, 🐌 медленно, 🐞 инциденты/баги.\n"
        "— После эмодзи — короткая суть; ключевые числа оборачивай в **двойные звёздочки** (жирный).\n"
        "— 2–4 пункта, каждый одно живое предложение, по-человечески, без канцелярита и без вступления.\n"
        "Только на основе чисел, ничего не выдумывай. Если данных мало — скажи одним пунктом."
    )
    return await ai_complete(system, facts, max_tokens=320, temperature=0.3)

@app.get("/osp-ai-summary")
async def osp_ai_summary(team: str = Query(...), month: str = Query(...), refresh: bool = Query(False)):
    if team not in OSP_QUEUES:
        return JSONResponse({"ok": False, "error": "неизвестная команда"})
    if not re.match(r"^\d{4}-\d{2}$", month or ""):
        return JSONResponse({"ok": False, "error": "месяц в формате YYYY-MM"})
    ck = f"ai-{team}-{month}-v2"
    if not refresh:
        snap = await _osp_snap(ck)
        if snap:
            return JSONResponse(snap)
    text = await _osp_ai_summary_build(team, month)
    payload = {"ok": True, "team": team, "month": month, "summary": text or ""}
    if text:
        try:
            await turso_execute([stmt(
                "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
                "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                [ck, json.dumps(payload, ensure_ascii=False)])])
        except Exception as e:
            print(f"[osp-ai save] {e}")
    return JSONResponse(payload)

async def _osp_metric_context(team: str, month: str) -> str:
    lines = []
    wl = await _osp_snap(f"wl-{date.today().year}-v{OSP_WL_VERSION}")
    wm = ((wl or {}).get("data", {}).get(month, {}) or {}).get(team, {}) or {}
    if wm:
        lines.append("Часы по типам: " + ", ".join(f"{k} {round(v)}ч" for k, v in sorted(wm.items(), key=lambda x: -x[1])))
    inc = await _osp_snap("inc-8-v2")
    for r in (inc or {}).get("data", []):
        if r.get("month") == month:
            lines.append(f"Инцидентов заведено за месяц: {r.get(team, 0)}")
    try:
        lines.append(f"Дней блокировок за месяц: {await _osp_blocking_days(team, month)}")
    except Exception:
        pass
    return "\n".join(lines) or "метрик нет"

async def _improve_generate(team, month, criterion, score, dislike, suggestion, ctx):
    fallback_sum = (suggestion or dislike or f"Улучшение: {criterion}")[:90]
    fallback_desc = (f"### Мы полагаем, что\n{suggestion or '…'}\n\n### Приведёт к\n…\n\n"
                     f"### Если мы были правы, то увидим\n- …\n\n### Чтобы проверить, нужно сделать\n- …")
    if not AI_ENABLED:
        return fallback_sum, fallback_desc
    system = (
        "Ты помогаешь продакту команды курьеров оформить гипотезу улучшения процесса. "
        "На вход: что не нравится, предложение продакта и метрики команды за месяц. "
        "Сформируй заголовок и описание-гипотезу.\n"
        "Верни СТРОГО в формате (заголовки секций через '### ', списки через '- '):\n"
        "ЗАГОЛОВОК: <короткий заголовок улучшения, без кавычек>\n"
        "===\n"
        "### Мы полагаем, что\n<гипотеза на основе предложения и проблемы>\n\n"
        "### Приведёт к\n<ожидаемый эффект>\n\n"
        "### Если мы были правы, то увидим\n- <признак/метрика>\n- <…>\n\n"
        "### Чтобы проверить, нужно сделать\n- <шаг>\n- <…>\n"
        "Опирайся на текст продакта и подкрепляй метриками. По-человечески, без канцелярита и воды. "
        "НЕ используй ** и другие markdown-выделения, только '### ' для заголовков и '- ' для списков."
    )
    user = (f"Команда: {OSP_QUEUES.get(team, team)}. Месяц: {month}. "
            f"Критерий оценки: «{criterion}», оценка {score}/5.\n"
            f"Что не нравится: {dislike or '—'}\n"
            f"Предложение продакта: {suggestion or '—'}\n"
            f"Метрики команды:\n{ctx}")
    txt = await ai_complete(system, user, max_tokens=600, temperature=0.4)
    if not txt:
        return fallback_sum, fallback_desc
    m = re.search(r"ЗАГОЛОВОК:\s*(.+)", txt)
    summary = (m.group(1).strip() if m else fallback_sum)[:120]
    desc = txt.split("===", 1)[1].strip() if "===" in txt else txt
    return summary, (desc or fallback_desc)

@app.get("/diag/issue")
async def diag_issue(key: str = Query(...)):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "no token"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await tracker_request(client, "GET", f"/v2/issues/{key}")
        return JSONResponse(r)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

@app.get("/diag/field")
async def diag_field(queue: str = Query("RKDS"), key: str = Query("team")):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "no token"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await tracker_request(client, "GET", f"/v2/queues/{queue}/localFields/{key}")
        return JSONResponse(r)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

@app.get("/diag/setteam")
async def diag_setteam(key: str = Query(...), field: str = Query(...), val: str = Query(...)):
    """Тест: ставим значение поля и возвращаем сырой ответ Трекера (статус+тело)."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "no token"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.patch(f"https://api.tracker.yandex.net/v2/issues/{key}",
                                   headers=tracker_headers(), json={field: val})
        return JSONResponse({"status": r.status_code, "body": r.text[:1500]})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

@app.get("/diag/localfields")
async def diag_localfields(queue: str = Query("RKDS")):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "no token"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await tracker_request(client, "GET", f"/v2/queues/{queue}/localFields")
        out = [{"id": f.get("id"), "key": f.get("key"), "name": f.get("name"),
                "type": (f.get("type") or {}).get("id") if isinstance(f.get("type"), dict) else f.get("type")}
               for f in (r or [])]
        return JSONResponse({"ok": True, "fields": out})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

@app.get("/diag/board")
async def diag_board(id: int = Query(...)):
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "no token"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await tracker_request(client, "GET", f"/v2/boards/{id}")
        return JSONResponse(r)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

@app.post("/osp-improve")
async def osp_improve(request: Request):
    """AI-предложение улучшения по тексту продакта + метрикам."""
    try:
        b = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"bad json: {e}"})
    team = b.get("team")
    if team not in OSP_QUEUES:
        return JSONResponse({"ok": False, "error": "неизвестная команда"})
    ctx = await _osp_metric_context(team, b.get("month", ""))
    summary, description = await _improve_generate(
        team, b.get("month", ""), b.get("criterion", ""), b.get("score", ""),
        (b.get("dislike") or "").strip(), (b.get("suggestion") or "").strip(), ctx)
    return JSONResponse({"ok": True, "summary": summary, "description": description})

@app.post("/osp-improve/create")
async def osp_improve_create(request: Request):
    """Создаёт задачу типа «Улучшение» в очереди RKDS."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан"})
    try:
        b = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"bad json: {e}"})
    summary = (b.get("summary") or "").strip()
    description = (b.get("description") or "").strip()
    team = b.get("team")
    if not summary:
        return JSONResponse({"ok": False, "error": "нужен заголовок"})
    # локальное поле «Команда» роутит на доску команды (X→815, U→3225, R→790)
    team_field = {"POOLING": "Команда X", "UDOSTAVKA": "Команда U",
                  "DOSTAVKAPIKO": "Команда R"}.get(team)
    base = {"queue": "RKDS", "summary": summary[:255], "type": "improvement", "description": description}
    key, err = None, None
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await tracker_request(client, "POST", "/v2/issues", base)
            key = (r or {}).get("key")
        except Exception as e:
            err = e
        if key:
            # очередь подставляет шаблон описания на создании → перезаписываем своим
            try:
                rr = await client.patch(f"https://api.tracker.yandex.net/v2/issues/{key}",
                                        headers=tracker_headers(), json={"description": description})
                rr.raise_for_status()
            except Exception as e:
                print(f"[osp-improve patch desc] {e}")
            # ставим команду (локальное поле RKDS «Команда») → роутит на доску команды
            if team_field:
                try:
                    rr = await client.patch(f"https://api.tracker.yandex.net/v2/issues/{key}",
                                            headers=tracker_headers(),
                                            json={"66d85e1786e9e1127dcf0f18--team": team_field})
                    rr.raise_for_status()
                except Exception as e:
                    print(f"[osp-improve patch team] {e}")
    if not key:
        return JSONResponse({"ok": False, "error": str(err) if err else "не удалось создать"})
    return JSONResponse({"ok": True, "key": key, "url": f"https://tracker.yandex.ru/{key}"})

@app.post("/osp-pulse/clear")
async def osp_pulse_clear(team: str = Query(...), month: str = Query(...)):
    if team not in OSP_QUEUES:
        return JSONResponse({"ok": False, "error": "неизвестная команда"})
    try:
        await turso_execute([stmt("DELETE FROM osp_pulse WHERE team=? AND month=?", [team, month])])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
    return JSONResponse({"ok": True})

@app.post("/osp-pulse/set")
async def osp_pulse_set(request: Request):
    """Массовая заливка: {data: {team: {month: {criterion: score}}}}."""
    try:
        payload = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"bad json: {e}"})
    data = (payload or {}).get("data") or {}
    stmts = []
    for team, by_month in data.items():
        if team not in OSP_QUEUES:
            continue
        for month, scores in (by_month or {}).items():
            for c, v in (scores or {}).items():
                if c not in OSP_PULSE_CRITERIA:
                    continue
                try:
                    sc = float(v)
                except (TypeError, ValueError):
                    continue
                stmts.append(stmt(
                    "INSERT INTO osp_pulse(team,month,criterion,score,updated_at) VALUES(?,?,?,?,datetime('now')) "
                    "ON CONFLICT(team,month,criterion) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at",
                    [team, month, c, sc]))
    if stmts:
        try:
            for i in range(0, len(stmts), 50):
                await turso_execute(stmts[i:i + 50])
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)})
    return JSONResponse({"ok": True, "saved": len(stmts)})

def _date_only(s: str):
    try:
        return date.fromisoformat((s or "")[:10])
    except Exception:
        return None

def _month_bounds(ym: str):
    y, m = int(ym[:4]), int(ym[5:7])
    first = date(y, m, 1)
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return first, nxt - timedelta(days=1)

@app.get("/osp-blockings")
async def osp_blockings(months: int = Query(6)):
    """Динамика блокировок по месяцам: дни блокировки, попадающие в каждый месяц
    (с обрезкой по границам), с разбивкой по причинам и командам."""
    months = max(1, min(int(months or 6), 24))
    month_list = _osp_month_list(months)
    m0 = month_list[0] + "-01"
    today = date.today()
    try:
        res = await turso_execute([stmt(
            "SELECT b.reason as reason, b.queue as queue, b.start_date as start_date, "
            "b.end_date as end_date, b.status as status, b.key as bkey, b.parent_key as parent_key, "
            "b.title as btitle, p.title as parent_title "
            "FROM blockings b LEFT JOIN parent_tasks p ON p.key=b.parent_key "
            "WHERE b.queue IN (?,?,?) AND b.start_date != '' AND b.start_date <= ? "
            "AND (b.status != 'closed' OR (b.end_date != '' AND b.end_date >= ?))",
            ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO", month_list[-1] + "-31", m0])])
        rows = rows_to_dicts(res[0]) if res else []
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    bounds = {m: _month_bounds(m) for m in month_list}
    data = {m: {q: {} for q in OSP_QUEUES} for m in month_list}
    reason_tot: dict = {}
    items: list[dict] = []
    for r in rows:
        q = r.get("queue")
        if q not in OSP_QUEUES:
            continue
        s = _date_only(r.get("start_date"))
        if not s:
            continue
        closed = r.get("status") == "closed"
        e = _date_only(r.get("end_date")) if (closed and r.get("end_date")) else today
        if not e or e < s:
            e = s
        reason = r.get("reason") or "Не указана"
        pkey = r.get("parent_key") or r.get("bkey") or ""
        for m in month_list:
            m0d, m1d = bounds[m]
            lo, hi = max(s, m0d), min(e, m1d)
            if hi < lo:
                continue
            days = (hi - lo).days + 1
            data[m][q][reason] = data[m][q].get(reason, 0) + days
            reason_tot[reason] = reason_tot.get(reason, 0) + days
            items.append({
                "month": m, "queue": q, "reason": reason, "key": pkey,
                "title": r.get("parent_title") or r.get("btitle") or "—",
                "url": f"https://tracker.yandex.ru/{pkey}",
                "start": s.isoformat(), "end": e.isoformat(),
                "days": days, "active": not closed,
            })

    reasons = [r for r, _ in sorted(reason_tot.items(), key=lambda x: -x[1])]
    out = []
    for m in month_list:
        row = {"month": m, "label": _osp_label(m)}
        allr: dict = {}
        for q in OSP_QUEUES:
            row[q] = data[m][q]
            for rs, d in data[m][q].items():
                allr[rs] = allr.get(rs, 0) + d
        row["all"] = allr
        out.append(row)
    return JSONResponse({"ok": True, "queues": OSP_QUEUES, "months": month_list,
                         "reasons": reasons, "data": out, "reasonTotals": reason_tot, "items": items})

@app.get("/osp-worklog")
async def osp_worklog():
    """Агрегат worklog по месяцам (часы × команда × тип). Если снапшота нет —
    запускаем фоновый сбор и отдаём пустой ответ со статусом."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    year = date.today().year
    snap, ts = None, None
    try:
        res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?",
                                        [f"wl-{year}-v{OSP_WL_VERSION}"])])
        rows = rows_to_dicts(res[0]) if res else []
        if rows and rows[0].get("data"):
            snap, ts = json.loads(rows[0]["data"]), rows[0].get("updated_at")
    except Exception as e:
        print(f"[osp-wl load] {e}")
    if snap is None:
        # НЕ запускаем медленный сбор автоматически — данные заливаем через /osp-worklog/set
        return JSONResponse({"ok": True, "data": None, "status": _wl_status})
    snap["updatedAt"], snap["status"] = ts, _wl_status
    return JSONResponse(snap)

@app.post("/osp-worklog/build")
async def osp_worklog_build():
    if _wl_status["running"]:
        return JSONResponse({"ok": False, "error": "Сбор уже идёт"})
    asyncio.create_task(run_osp_worklog_job(date.today().year))
    return JSONResponse({"ok": True})

@app.post("/osp-worklog/sync-current")
async def osp_worklog_sync_current():
    """Догрузить worklog текущего месяца из API (подмешать в снапшот)."""
    if _wl_status["running"]:
        return JSONResponse({"ok": False, "error": "Сбор уже идёт"})
    asyncio.create_task(run_osp_worklog_current(date.today().year))
    return JSONResponse({"ok": True})

@app.post("/osp-worklog/stop")
async def osp_worklog_stop():
    _wl_status["cancel"] = True
    return JSONResponse({"ok": True})

@app.post("/osp-worklog/set")
async def osp_worklog_set(request: Request):
    """Прямая заливка агрегата worklog в БД (минуя медленный сбор по API).
    Тело — JSON вида {year, months:[...], queues:{...}, types:[...], data:{month:{queue:{type:hours}}}}."""
    try:
        payload = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"bad json: {e}"})
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        return JSONResponse({"ok": False, "error": "нужен объект с полем data"})
    year = int(payload.get("year") or date.today().year)
    payload["ok"] = True
    payload.setdefault("queues", OSP_QUEUES)
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [f"wl-{year}-v{OSP_WL_VERSION}", json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
    return JSONResponse({"ok": True, "year": year, "months": payload.get("months")})

@app.get("/osp-worklog/status")
async def osp_worklog_status():
    return JSONResponse(_wl_status)

# ── Static (React build) ──────────────────────────────────────────────────────

import os as _os

@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    file = f"static/{full_path}"
    if _os.path.isfile(file):
        return FileResponse(file)
    return FileResponse("static/index.html")

app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")
