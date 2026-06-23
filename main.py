import os
import re
import asyncio
import hashlib
import httpx
from datetime import date, datetime, timedelta, timezone
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


async def ai_cached(prefix: str, system: str, user: str, *, max_tokens: int = 400,
                    temperature: float = 0.3, refresh: bool = False) -> str | None:
    """LLM-вызов с кэшем по ХЕШУ входа (system+user+модель). Если те же факты уже
    считались — берём из БД, не платим за повтор. Экономит на повторных загрузках,
    смене дат периода (когда цифры те же) и рестартах."""
    h = hashlib.md5(f"{CLAUDE_MODEL}|{system}|{user}".encode("utf-8")).hexdigest()[:20]
    ck = f"aic-{prefix}-{h}"
    if not refresh:
        snap = await _osp_snap(ck)
        if isinstance(snap, dict) and snap.get("text") is not None:
            return snap["text"]
    txt = await ai_complete(system, user, max_tokens=max_tokens, temperature=temperature)
    if txt:
        try:
            await turso_execute([stmt(
                "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
                "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                [ck, json.dumps({"text": txt}, ensure_ascii=False)])])
        except Exception as e:
            print(f"[ai-cache] {e}")
    return txt

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

# ── Арх. комитет (возвраты): константы ──────────────────────────────────────────
MSK = timezone(timedelta(hours=3))   # даты статусов в Трекере — по московскому времени
ARCH_ENTRY_STATUS = "180"   # analiticeskaaProrabotkaGotovo — задача пришла к техархам
ARCH_V1_FROM, ARCH_V1_TO = "180", "151"   # АрхКом: аналит.проработка готово → ревью аналитики
ARCH_V2_FROM, ARCH_V2_TO = "145", "175"   # ТА: согласование архитектуры → доработка
# Типы задач, проходящих через арх. комитет
ARCH_ISSUE_TYPES = ["story", "analytics", "technicaldebt", "improvement", "elaboration"]
# Статусы, в которых задача считается «сейчас в Арх. комитете»
ARCH_STATUSES = {
    "180": "Аналитическая проработка готово",
    "151": "Ревью аналитики",
    "145": "Согласование архитектуры",
    "175": "Доработка",
}
_ARCH_TEST_RE = re.compile(r"\b(?:test|тест|тестов\w*)\b", re.IGNORECASE)

def arch_is_test_task(title: str) -> bool:
    """Тестовые задачи: слово «тест»/«test» или «тестовый/тестовая/тестовое»."""
    return bool(_ARCH_TEST_RE.search(title or ""))

# ── Оценка (план-факт спринта): роли/сотрудники Курьеров U ───────────────────────
SP_HOURS = 8  # 1 SP = 8 часов
SPRINT_ROLES = ["SA", "GO", "Front", "QA", "1С", "AQA"]  # порядок в отчёте
SPRINT_ROLE_LABEL = {"SA": "SA", "GO": "GO", "Front": "FE", "QA": "QA", "1С": "1C", "AQA": "AQA"}
# роль → варианты имён в worklog Трекера (с отчеством и без — суммируем оба)
SPRINT_ROLE_MEMBERS = {
    "SA":    ["Полина Алексеевна Резенова"],
    "GO":    ["Роман Олегович Источников", "Андрей Дмитриевич Ким"],
    "Front": ["Евгений Сергеевич Копосов", "Светлана Асотикова", "Светлана Валерьевна Асотикова"],
    "QA":    ["Олег Олегович Степин", "Олег Степин", "Владислав Игоревич Корякин"],
    "1С":    ["Максим Валерьевич Яцушко", "Гусев Алексеевич Иван"],
    "AQA":   ["Юлия Сергеевна Драгун"],
}
def _sprint_norm(s: str) -> str:
    return str(s or "").replace("ё", "е").replace("Ё", "Е").strip().lower()
_SPRINT_NAME_ROLE = {_sprint_norm(n): r for r, names in SPRINT_ROLE_MEMBERS.items() for n in names}
def _person_role(display: str):
    """Имя из worklog → роль (или None, если сотрудник не из команды U)."""
    return _SPRINT_NAME_ROLE.get(_sprint_norm(display))

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
        # ── Арх. комитет (возвраты): задачи + история переходов статусов ──────────
        stmt("""CREATE TABLE IF NOT EXISTS arch_tasks (
            key TEXT PRIMARY KEY, title TEXT, queue TEXT, created_at TEXT,
            issue_type TEXT, issue_type_display TEXT,
            status_key TEXT, status_display TEXT, assignee TEXT, status_start TEXT)"""),
        stmt("""CREATE TABLE IF NOT EXISTS arch_transitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            issue_key TEXT NOT NULL, from_status TEXT, to_status TEXT, ts TEXT NOT NULL)"""),
        stmt("CREATE INDEX IF NOT EXISTS idx_arch_trans_key ON arch_transitions(issue_key)"),
        stmt("CREATE INDEX IF NOT EXISTS idx_arch_trans_ts  ON arch_transitions(ts)"),
        stmt("CREATE INDEX IF NOT EXISTS idx_arch_trans_to  ON arch_transitions(to_status)"),
        # Отдельный журнал синка арх.кома — НЕ мешаем с sync_log блокировок
        stmt("""CREATE TABLE IF NOT EXISTS arch_sync_log (
            queue TEXT PRIMARY KEY, last_synced TEXT)"""),
        # ── Оценка: спринты и план по ролям ──────────────────────────────────────
        stmt("""CREATE TABLE IF NOT EXISTS sprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            team TEXT, name TEXT, date_from TEXT, date_to TEXT,
            finalized INTEGER DEFAULT 0, final_data TEXT, created_at TEXT)"""),
        stmt("""CREATE TABLE IF NOT EXISTS sprint_plan (
            sprint_id INTEGER NOT NULL, task_key TEXT NOT NULL, title TEXT,
            role TEXT NOT NULL, planned_sp REAL DEFAULT 0,
            PRIMARY KEY(sprint_id, task_key, role))"""),
        stmt("CREATE INDEX IF NOT EXISTS idx_sprint_plan_sid ON sprint_plan(sprint_id)"),
        stmt("""CREATE TABLE IF NOT EXISTS sprint_capacity (
            sprint_id INTEGER NOT NULL, role TEXT NOT NULL, capacity_sp REAL DEFAULT 0,
            PRIMARY KEY(sprint_id, role))"""),
    ])
    # Миграция: добавляем колонки если не существуют (игнорируем ошибку если уже есть)
    for col_sql in [
        "ALTER TABLE parent_tasks ADD COLUMN issue_type TEXT",
        "ALTER TABLE parent_tasks ADD COLUMN issue_type_display TEXT",
        "ALTER TABLE sprint_plan ADD COLUMN position INTEGER DEFAULT 0",
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

# ── Арх. комитет: синк истории переходов + запросы ──────────────────────────────

async def get_arch_sync_info():
    results = await turso_execute([stmt("SELECT queue, last_synced FROM arch_sync_log")])
    return {r["queue"]: r["last_synced"] for r in rows_to_dicts(results[0])} if results else {}

async def fetch_arch_issues_page(client, queue, updated_from, page):
    """Задачи очереди нужных типов, обновлённые с updated_from."""
    frm = updated_from if "T" in updated_from else f"{updated_from}T00:00:00"
    data = await tracker_request(client, "POST",
        f"/v2/issues/_search?perPage=100&page={page}",
        {"filter": {"queue": queue, "type": ARCH_ISSUE_TYPES,
                    "updatedAt": {"from": frm, "to": "2099-01-01T00:00:00"}}})
    return data if isinstance(data, list) else []

async def fetch_arch_changelog(client, key):
    """Полная история переходов статусов задачи (с пагинацией)."""
    all_entries, page = [], 1
    while True:
        try:
            data = await tracker_request(client, "GET",
                f"/v2/issues/{key}/changelog?perPage=100&page={page}&type=IssueWorkflow")
        except Exception as e:
            print(f"  [WARN] arch changelog {key} page {page} failed: {e}")
            break
        if not isinstance(data, list) or not data:
            break
        all_entries.extend(data)
        if len(data) < 100:
            break
        page += 1
        await asyncio.sleep(0.2)
    return all_entries

async def _sync_arch_queue(client, queue, updated_from, send):
    """Синк очереди арх.кома: задачи + история переходов начиная с updated_from."""
    await send({"type": "progress", "msg": f"АрхКом {queue}: загружаем задачи…", "pct": 5})

    issues = await fetch_arch_issues_page(client, queue, updated_from, 1)
    if len(issues) == 100:
        page = 2
        while True:
            data = await fetch_arch_issues_page(client, queue, updated_from, page)
            issues.extend(data)
            await asyncio.sleep(0.5)
            if len(data) < 100:
                break
            page += 1

    await send({"type": "progress", "msg": f"АрхКом {queue}: {len(issues)} задач, история…", "pct": 15})

    BATCH = 3
    for i in range(0, len(issues), BATCH):
        chunk = issues[i:i + BATCH]
        changelogs = await asyncio.gather(
            *[fetch_arch_changelog(client, iss["key"]) for iss in chunk],
            return_exceptions=True)
        await asyncio.sleep(1.0)

        stmts = []
        for iss, cl in zip(chunk, changelogs):
            if isinstance(cl, Exception):
                print(f"  [FAIL] arch {iss.get('key')}: {cl}")
                continue
            key = iss["key"]
            itype = iss.get("type", {}) or {}
            status = iss.get("status", {}) or {}
            assignee = (iss.get("assignee") or {}).get("display", "")
            status_change_ts = [
                (e.get("updatedAt") or e.get("createdAt") or "")
                for e in cl
                for f in e.get("fields", [])
                if f.get("field", {}).get("id") == "status"
            ]
            status_start = max(status_change_ts) if status_change_ts else iss.get("createdAt", "")
            stmts.append(stmt(
                "INSERT INTO arch_tasks(key,title,queue,created_at,issue_type,issue_type_display,"
                "status_key,status_display,assignee,status_start) VALUES(?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(key) DO UPDATE SET title=excluded.title, issue_type=excluded.issue_type, "
                "issue_type_display=excluded.issue_type_display, status_key=excluded.status_key, "
                "status_display=excluded.status_display, assignee=excluded.assignee, "
                "status_start=excluded.status_start",
                [key, iss.get("summary", "—"), queue, iss.get("createdAt", ""),
                 itype.get("key", ""), itype.get("display", ""),
                 str(status.get("id", "")), status.get("display", ""), assignee, status_start]))
            for e in cl:
                ts = e.get("updatedAt") or e.get("createdAt") or ""
                for f in e.get("fields", []):
                    if f.get("field", {}).get("id") == "status":
                        from_s = str(f.get("from", {}).get("id", ""))
                        to_s   = str(f.get("to",   {}).get("id", ""))
                        stmts.append(stmt(
                            "INSERT INTO arch_transitions(issue_key,from_status,to_status,ts) "
                            "SELECT ?,?,?,? WHERE NOT EXISTS ("
                            "SELECT 1 FROM arch_transitions WHERE issue_key=? AND ts=? AND to_status=?)",
                            [key, from_s, to_s, ts, key, ts, to_s]))
        if stmts:
            await turso_execute(stmts)

        done = i + len(chunk)
        pct = 15 + round(done / max(len(issues), 1) * 75)
        await send({"type": "progress", "msg": f"АрхКом {queue}: {done}/{len(issues)}", "pct": pct})

    await turso_execute([stmt(
        "INSERT INTO arch_sync_log(queue,last_synced) VALUES(?,?) "
        "ON CONFLICT(queue) DO UPDATE SET last_synced=excluded.last_synced",
        [queue, datetime.now(MSK).strftime("%Y-%m-%dT%H:%M:%S")])])

async def _arch_tables():
    """Источник данных арх.кома: наши arch_tasks/arch_transitions, либо — если они ещё
    пусты, а арх_ком жил в ТОЙ ЖЕ Turso-базе под общими именами — legacy tasks/transitions.
    Так данные показываются сразу (общая база), без долгого пересинка; при разных базах
    legacy-таблиц нет → используем arch_* (наполняются кнопкой «Синк»)."""
    try:
        r = await turso_execute([stmt("SELECT COUNT(*) AS c FROM arch_transitions")])
        if r and int(rows_to_dicts(r[0])[0]["c"]) > 0:
            return ("arch_tasks", "arch_transitions")
    except Exception:
        pass
    try:
        r = await turso_execute([stmt(
            "SELECT COUNT(*) AS c FROM sqlite_master "
            "WHERE type='table' AND name IN ('tasks','transitions')")])
        if r and int(rows_to_dicts(r[0])[0]["c"]) >= 2:
            r2 = await turso_execute([stmt("SELECT COUNT(*) AS c FROM transitions")])
            if r2 and int(rows_to_dicts(r2[0])[0]["c"]) > 0:
                return ("tasks", "transitions")
    except Exception:
        pass
    return ("arch_tasks", "arch_transitions")

async def query_arch_dashboard(date_from: str, date_to: str, queues: list[str]):
    """Событийная модель: задача попадает в выборку, если в периоде был хотя бы один из событий:
    вход в комитет (→180), возврат АрхКома (180→151) или возврат ТА (145→175)."""
    tk_tbl, tr_tbl = await _arch_tables()
    q_ph = ",".join("?" * len(queues))
    ev = await turso_execute([stmt(f"""
        SELECT tr.issue_key, tr.from_status AS frm, tr.to_status AS too,
               substr(tr.ts,1,10) AS d,
               tk.title, tk.queue, tk.issue_type, tk.issue_type_display
        FROM {tr_tbl} tr
        JOIN {tk_tbl} tk ON tk.key = tr.issue_key
        WHERE substr(tr.ts,1,10) >= ? AND substr(tr.ts,1,10) <= ?
          AND tk.queue IN ({q_ph})
          AND ( tr.to_status = ?
             OR (tr.from_status = ? AND tr.to_status = ?)
             OR (tr.from_status = ? AND tr.to_status = ?) )
    """, [date_from, date_to, *queues, ARCH_ENTRY_STATUS,
          ARCH_V1_FROM, ARCH_V1_TO, ARCH_V2_FROM, ARCH_V2_TO])])

    rows = rows_to_dicts(ev[0]) if ev else []
    rows = [r for r in rows if not arch_is_test_task(r.get("title"))]
    if not rows:
        return {"tasks": [], "queues": {q: {"tasks": []} for q in queues},
                "dateFrom": date_from, "dateTo": date_to}

    tmap: dict = {}
    for r in rows:
        k = r["issue_key"]
        t = tmap.get(k)
        if t is None:
            t = tmap[k] = {
                "key": k, "title": r["title"] or "—",
                "url": f"https://tracker.yandex.ru/{k}",
                "queue": r["queue"], "issueType": r.get("issue_type") or "story",
                "issueTypeDisplay": r.get("issue_type_display") or "Story",
                "entryDates": [], "v1Dates": [], "v2Dates": [],
            }
        frm, too, dd = str(r["frm"]), str(r["too"]), r["d"]
        if too == ARCH_ENTRY_STATUS:
            t["entryDates"].append(dd)
        elif frm == ARCH_V1_FROM and too == ARCH_V1_TO:
            t["v1Dates"].append(dd)
        elif frm == ARCH_V2_FROM and too == ARCH_V2_TO:
            t["v2Dates"].append(dd)

    keys = list(tmap)
    key_ph = ",".join("?" * len(keys))
    trans_results = await turso_execute([stmt(f"""
        SELECT issue_key, to_status, ts FROM {tr_tbl}
        WHERE issue_key IN ({key_ph}) ORDER BY ts ASC
    """, keys)])
    seq: dict = {}
    for tr in (rows_to_dicts(trans_results[0]) if trans_results else []):
        seq.setdefault(tr["issue_key"], []).append(tr)

    def cycle_days(key: str):
        items = seq.get(key, [])
        entry = next((t["ts"] for t in items if str(t["to_status"]) == ARCH_ENTRY_STATUS), None)
        if not entry:
            return None
        exit_ts = next((t["ts"] for t in items
                        if t["ts"] > entry and str(t["to_status"]) not in ARCH_STATUSES), None)
        if not exit_ts:
            return None  # ещё в комитете
        try:
            return max(0, (date.fromisoformat(exit_ts[:10]) - date.fromisoformat(entry[:10])).days)
        except ValueError:
            return None

    tasks, queues_out = [], {q: {"tasks": []} for q in queues}
    for k, t in tmap.items():
        v1n, v2n = len(t["v1Dates"]), len(t["v2Dates"])
        entered = len(t["entryDates"]) > 0
        task = {
            **t, "entered": entered,
            "entryDate": sorted(t["entryDates"])[0] if entered else None,
            "v1n": v1n, "v2n": v2n, "total": v1n + v2n,
            "cycleDays": cycle_days(k),
        }
        tasks.append(task)
        if t["queue"] in queues_out:
            queues_out[t["queue"]]["tasks"].append(task)

    return {"tasks": tasks, "queues": queues_out, "dateFrom": date_from, "dateTo": date_to}

async def query_arch_current(queues: list[str]):
    """Задачи, которые сейчас находятся в одном из статусов Арх. комитета."""
    tk_tbl, tr_tbl = await _arch_tables()
    q_ph = ",".join("?" * len(queues))
    st_ph = ",".join("?" * len(ARCH_STATUSES))
    results = await turso_execute([stmt(f"""
        WITH latest AS (
            SELECT issue_key, to_status, ts,
                   ROW_NUMBER() OVER (PARTITION BY issue_key ORDER BY ts DESC, id DESC) AS rn
            FROM {tr_tbl}
        )
        SELECT l.issue_key, l.to_status, l.ts AS latest_ts,
               tk.title, tk.queue, tk.issue_type, tk.issue_type_display,
               tk.assignee, tk.status_start, tk.status_display
        FROM latest l
        JOIN {tk_tbl} tk ON tk.key = l.issue_key
        WHERE l.rn = 1 AND l.to_status IN ({st_ph}) AND tk.queue IN ({q_ph})
    """, [*ARCH_STATUSES.keys(), *queues])])

    rows = rows_to_dicts(results[0]) if results else []
    rows = [r for r in rows if not arch_is_test_task(r.get("title"))]
    if not rows:
        return []

    keys_all = [r["issue_key"] for r in rows]
    key_ph = ",".join("?" * len(keys_all))
    cut_results = await turso_execute([stmt(f"""
        SELECT issue_key,
               SUM(CASE WHEN from_status=? AND to_status=? THEN 1 ELSE 0 END) AS v1n,
               SUM(CASE WHEN from_status=? AND to_status=? THEN 1 ELSE 0 END) AS v2n
        FROM {tr_tbl} WHERE issue_key IN ({key_ph}) GROUP BY issue_key
    """, [ARCH_V1_FROM, ARCH_V1_TO, ARCH_V2_FROM, ARCH_V2_TO, *keys_all])])
    cuts = {r["issue_key"]: (int(r["v1n"] or 0), int(r["v2n"] or 0))
            for r in rows_to_dicts(cut_results[0])} if cut_results else {}

    # Живое обогащение из Трекера: исполнитель, актуальный статус и дата входа
    live: dict = {}
    if TRACKER_TOKEN:
        async def _fetch(client, key):
            try:
                return key, await tracker_request(client, "GET", f"/v2/issues/{key}")
            except Exception:
                return key, None
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                fetched = await asyncio.gather(*[_fetch(client, k) for k in keys_all])
            live = {k: iss for k, iss in fetched if iss}
        except Exception:
            live = {}

    today = datetime.now(MSK).date()
    out = []
    for r in rows:
        key = r["issue_key"]
        iss = live.get(key)
        if iss is not None:
            st = iss.get("status", {}) or {}
            st_id = str(st.get("id", ""))
            if st_id and st_id not in ARCH_STATUSES:
                continue  # уже вышла из статусов арх.кома
            status_disp = ARCH_STATUSES.get(st_id) or st.get("display") or "—"
            status_key = st_id or str(r["to_status"])
            assignee = (iss.get("assignee") or {}).get("display", "") or ""
            started = (iss.get("statusStartTime") or r.get("status_start") or r.get("latest_ts") or "")[:10]
        else:
            status_key = str(r["to_status"])
            status_disp = ARCH_STATUSES.get(status_key) or r.get("status_display") or "—"
            assignee = r.get("assignee") or ""
            started = (r.get("status_start") or r.get("latest_ts") or "")[:10]

        days = 0
        if started:
            try:
                days = max(1, (today - date.fromisoformat(started)).days + 1)
            except ValueError:
                days = 0

        v1n, v2n = cuts.get(key, (0, 0))
        out.append({
            "key": key, "title": r["title"] or "—",
            "url": f"https://tracker.yandex.ru/{key}", "queue": r["queue"],
            "issueType": r.get("issue_type") or "story",
            "issueTypeDisplay": r.get("issue_type_display") or "Story",
            "status": status_disp, "statusKey": status_key,
            "assignee": assignee, "since": started, "daysInStatus": days,
            "v1n": v1n, "v2n": v2n,
        })
    out.sort(key=lambda t: t["daysInStatus"], reverse=True)
    return out

# ── Оценка: план-факт спринта (live из worklog) ─────────────────────────────────

async def _sprint_plan_rows(sprint_id: int):
    res = await turso_execute([stmt(
        "SELECT task_key, title, role, planned_sp, position FROM sprint_plan WHERE sprint_id=? "
        "ORDER BY position ASC, task_key ASC", [sprint_id])])
    return rows_to_dicts(res[0]) if res else []

async def _sprint_fact(sprint: dict):
    """Считает план-факт спринта. План — из sprint_plan (SP по ролям).
    Факт — worklog Трекера, СПИСАННЫЙ В ПЕРИОД спринта, по ролям → SP (1 SP = 8ч)."""
    sid = int(sprint["id"])
    rows = await _sprint_plan_rows(sid)
    # план: {task_key: {role: sp}} + заголовки
    tasks: dict = {}
    for r in rows:
        k = r["task_key"]
        t = tasks.setdefault(k, {"key": k, "title": r.get("title") or k,
                                 "plan": {role: 0.0 for role in SPRINT_ROLES},
                                 "fact": {role: 0.0 for role in SPRINT_ROLES}})
        if r.get("title"):
            t["title"] = r["title"]
        try:
            t["plan"][r["role"]] = float(r["planned_sp"] or 0)
        except (ValueError, TypeError):
            pass

    date_from, date_to = sprint.get("date_from", ""), sprint.get("date_to", "")
    keys = list(tasks)
    # факт по worklog за период
    if keys and TRACKER_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                B = 4
                for i in range(0, len(keys), B):
                    chunk = keys[i:i + B]
                    wls = await asyncio.gather(*[_wl_fetch(client, k) for k in chunk],
                                               return_exceptions=True)
                    for k, wl in zip(chunk, wls):
                        if not isinstance(wl, list):
                            continue
                        for e in wl:
                            d = (e.get("start") or e.get("createdAt") or "")[:10]
                            if date_from and d < date_from:
                                continue
                            if date_to and d > date_to:
                                continue
                            hrs = _iso_dur_hours(e.get("duration"))
                            if hrs <= 0:
                                continue
                            role = _person_role((e.get("createdBy") or {}).get("display"))
                            if role and role in tasks[k]["fact"]:
                                tasks[k]["fact"][role] += hrs / SP_HOURS
                    await asyncio.sleep(0.2)
        except Exception as ex:
            print(f"[sprint fact] {ex}")

    # капасити по ролям (редактируемая, по умолчанию 0)
    cap_res = await turso_execute([stmt(
        "SELECT role, capacity_sp FROM sprint_capacity WHERE sprint_id=?", [sid])])
    cap = {r["role"]: float(r["capacity_sp"] or 0) for r in rows_to_dicts(cap_res[0])} if cap_res else {}

    out_tasks, by_role = [], {role: {"plan": 0.0, "fact": 0.0} for role in SPRINT_ROLES}
    for k, t in tasks.items():
        for role in SPRINT_ROLES:
            t["fact"][role] = round(t["fact"][role], 1)
            by_role[role]["plan"] += t["plan"][role]
            by_role[role]["fact"] += t["fact"][role]
        plan_total = round(sum(t["plan"].values()), 1)
        fact_total = round(sum(t["fact"].values()), 1)
        out_tasks.append({**t, "planTotal": plan_total, "factTotal": fact_total,
                          "pct": round(fact_total / plan_total * 100) if plan_total else 0})
    for role in SPRINT_ROLES:
        by_role[role]["plan"] = round(by_role[role]["plan"], 1)
        by_role[role]["fact"] = round(by_role[role]["fact"], 1)
        c = round(cap.get(role, 0.0), 1)
        by_role[role]["capacity"] = c
        by_role[role]["remaining"] = round(c - by_role[role]["plan"], 1)
        by_role[role]["load"] = round(by_role[role]["plan"] / c * 100) if c else 0
    total_plan = round(sum(t["planTotal"] for t in out_tasks), 1)
    total_fact = round(sum(t["factTotal"] for t in out_tasks), 1)
    return {
        "tasks": out_tasks,
        "byRole": by_role,
        "roles": SPRINT_ROLES,
        "roleLabels": SPRINT_ROLE_LABEL,
        "totals": {
            "tasks": len(out_tasks),
            "plan": total_plan, "fact": total_fact,
            "pct": round(total_fact / total_plan * 100) if total_plan else 0,
            "delta": round(total_fact - total_plan, 1),
        },
    }

async def _sprint_get(sprint_id: int):
    res = await turso_execute([stmt(
        "SELECT id, team, name, date_from, date_to, finalized, final_data FROM sprints WHERE id=?",
        [sprint_id])])
    rows = rows_to_dicts(res[0]) if res else []
    return rows[0] if rows else None

_CLOSED_STATUS = {"closed", "resolved", "rejected", "cancelled", "done"}
def _issue_closed(iss) -> bool:
    if not isinstance(iss, dict):
        return False
    if iss.get("resolution"):
        return True
    return (iss.get("status") or {}).get("key", "") in _CLOSED_STATUS

async def _carry_unclosed(src_id: int, dst_id: int):
    """Переносит НЕзакрытые задачи (и их план + капасити) из спринта src в dst."""
    res = await turso_execute([stmt(
        "SELECT task_key, title, role, planned_sp FROM sprint_plan WHERE sprint_id=?", [src_id])])
    rows = rows_to_dicts(res[0]) if res else []
    if not rows:
        return 0
    tasks: dict = {}
    for r in rows:
        t = tasks.setdefault(r["task_key"], {"title": r.get("title") or r["task_key"], "roles": {}})
        if r.get("title"):
            t["title"] = r["title"]
        try:
            t["roles"][r["role"]] = float(r["planned_sp"] or 0)
        except (ValueError, TypeError):
            t["roles"][r["role"]] = 0.0
    keys = list(tasks)
    # статус из Трекера: закрытые не переносим (если токена нет — переносим все)
    closed: dict = {}
    if TRACKER_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=40) as client:
                issues = await asyncio.gather(*[fetch_issue(client, k) for k in keys], return_exceptions=True)
            for k, iss in zip(keys, issues):
                closed[k] = _issue_closed(iss) if not isinstance(iss, Exception) else False
        except Exception:
            closed = {}
    stmts, moved = [], 0
    for k, t in tasks.items():
        if closed.get(k):
            continue
        moved += 1
        for role in SPRINT_ROLES:
            stmts.append(stmt(
                "INSERT INTO sprint_plan(sprint_id,task_key,title,role,planned_sp) VALUES(?,?,?,?,?) "
                "ON CONFLICT(sprint_id,task_key,role) DO UPDATE SET planned_sp=excluded.planned_sp, title=excluded.title",
                [dst_id, k, t["title"], role, t["roles"].get(role, 0.0)]))
    if stmts:
        await turso_execute(stmts)
    return moved

async def _copy_capacity(src_id: int, dst_id: int):
    """Переносит капасити (доступную загрузку) по ролям из спринта src в dst."""
    cap = await turso_execute([stmt("SELECT role, capacity_sp FROM sprint_capacity WHERE sprint_id=?", [src_id])])
    rows = rows_to_dicts(cap[0]) if cap else []
    if not rows:
        return
    await turso_execute([stmt(
        "INSERT INTO sprint_capacity(sprint_id,role,capacity_sp) VALUES(?,?,?) "
        "ON CONFLICT(sprint_id,role) DO UPDATE SET capacity_sp=excluded.capacity_sp",
        [dst_id, r["role"], r["capacity_sp"]]) for r in rows])

# ── Background sync job ───────────────────────────────────────────────────────

_sync_status: dict = {"running": False, "pct": 0, "msg": "", "error": ""}

async def run_sync_job(selected: list[str], full: bool):
    global _sync_status
    _sync_status = {"running": True, "pct": 2, "msg": "Подключаемся к Трекеру…", "error": ""}
    try:
        info = await get_sync_info()
        arch_info = await get_arch_sync_info()
        async with httpx.AsyncClient(timeout=60) as client:
            # ── Фаза 1: блокировки (0–80%) ──────────────────────────────────────
            for qi, queue in enumerate(selected):
                # Дата с которой грузим: полный = 2 года, инкрементальный = с последнего синка
                if full or queue not in info or not info[queue]:
                    updated_from = (date.today() - timedelta(days=730)).isoformat()
                else:
                    # Конвертируем "2026-06-03 14:35" → "2026-06-03T14:35:00"
                    raw = info[queue]
                    updated_from = raw.replace(" ", "T") + ":00" if " " in raw else raw

                base_pct = qi * (80 // len(selected))

                async def send(m, _base=base_pct, _total=len(selected)):
                    if m.get("type") == "progress":
                        _sync_status["msg"] = m.get("msg", "")
                        _sync_status["pct"] = _base + (m.get("pct", 0) * (80 // _total) // 100)

                # Переопределяем updated_from в sync_queue через временную замену DATE_FROM
                await _sync_queue_from(client, queue, updated_from, send)

            # ── Фаза 2: арх. комитет / возвраты (80–95%) ────────────────────────
            for qi, queue in enumerate(selected):
                if full or queue not in arch_info or not arch_info[queue]:
                    a_from = (date.today() - timedelta(days=730)).isoformat()
                else:
                    a_from = arch_info[queue]

                a_base = 80 + qi * (15 // len(selected))

                async def arch_send(m, _base=a_base, _total=len(selected)):
                    if m.get("type") == "progress":
                        _sync_status["msg"] = m.get("msg", "")
                        _sync_status["pct"] = _base + (m.get("pct", 0) * (15 // _total) // 100)

                await _sync_arch_queue(client, queue, a_from, arch_send)

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
                # сбрасываем кэш «Завершено по месяцам» (Поток E2E), иначе график замораживается
                try:
                    await turso_execute([stmt("DELETE FROM osp_snapshot WHERE which LIKE 'flowdone-%'")])
                except Exception as e:
                    print(f"[scheduler] flowdone invalidate: {e}")
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
    # инициализацию БД оборачиваем, чтобы сбой/таймаут Turso не блокировал старт
    # приложения (иначе health-check на холодном старте может не пройти).
    try:
        await init_db()
    except Exception as e:
        print(f"[init_db] WARNING: {e}")
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

# ── Арх. комитет (возвраты) ─────────────────────────────────────────────────────
@app.get("/arch-data")
async def arch_data(date_from: str = Query(None), date_to: str = Query(None),
                    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA")):
    if not date_from:
        date_from = (date.today() - timedelta(days=30)).isoformat()
    if not date_to:
        date_to = date.today().isoformat()
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    return JSONResponse(await query_arch_dashboard(date_from, date_to, selected))

@app.get("/arch-current")
async def arch_current(queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA")):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    return JSONResponse(await query_arch_current(selected))

# ── Оценка: спринты (план-факт) ─────────────────────────────────────────────────
@app.get("/sprints")
async def sprints_list(team: str = Query("U")):
    res = await turso_execute([stmt(
        "SELECT id, team, name, date_from, date_to, finalized FROM sprints "
        "WHERE team=? ORDER BY date_from DESC, id DESC", [team])])
    rows = rows_to_dicts(res[0]) if res else []
    for r in rows:
        r["id"] = int(r["id"]); r["finalized"] = bool(int(r.get("finalized") or 0))
    return JSONResponse({"ok": True, "sprints": rows})

@app.post("/sprints")
async def sprints_create(request: Request):
    b = await request.json()
    name = (b.get("name") or "").strip()
    if not name:
        return JSONResponse({"ok": False, "error": "Укажите название спринта"})
    await turso_execute([stmt(
        "INSERT INTO sprints(team,name,date_from,date_to,finalized,created_at) VALUES(?,?,?,?,0,?)",
        [b.get("team") or "U", name, b.get("date_from") or "", b.get("date_to") or "",
         (datetime.utcnow() + timedelta(hours=3)).strftime("%Y-%m-%d %H:%M")])])
    res = await turso_execute([stmt("SELECT last_insert_rowid() AS id")])
    sid = int(rows_to_dicts(res[0])[0]["id"]) if res else None
    moved = 0
    if sid:
        # капасити (доступную загрузку) ВСЕГДА берём из последнего спринта команды
        try:
            prev = await turso_execute([stmt(
                "SELECT id FROM sprints WHERE team=? AND id<>? ORDER BY date_from DESC, id DESC LIMIT 1",
                [b.get("team") or "U", sid])])
            prow = rows_to_dicts(prev[0]) if prev else []
            if prow:
                await _copy_capacity(int(prow[0]["id"]), sid)
        except Exception as e:
            print(f"[sprint capacity carry] {e}")
        # перенос незакрытых задач — по флажку
        carry_from = b.get("carry_from")
        if carry_from:
            try:
                moved = await _carry_unclosed(int(carry_from), sid)
            except Exception as e:
                print(f"[sprint carry] {e}")
    return JSONResponse({"ok": True, "id": sid, "carried": moved})

@app.delete("/sprints/{sprint_id}")
async def sprints_delete(sprint_id: int):
    await turso_execute([
        stmt("DELETE FROM sprint_plan WHERE sprint_id=?", [sprint_id]),
        stmt("DELETE FROM sprint_capacity WHERE sprint_id=?", [sprint_id]),
        stmt("DELETE FROM sprints WHERE id=?", [sprint_id]),
    ])
    return JSONResponse({"ok": True})

@app.post("/sprints/{sprint_id}/task")
async def sprints_add_task(sprint_id: int, request: Request):
    b = await request.json()
    key = (b.get("key") or "").strip().upper()
    if not key:
        return JSONResponse({"ok": False, "error": "Укажите ключ задачи"})
    title = key
    if TRACKER_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                iss = await fetch_issue(client, key)
            if isinstance(iss, dict) and iss.get("summary"):
                title = iss["summary"]
        except Exception:
            pass
    # позиция новой задачи — в конец списка
    pres = await turso_execute([stmt(
        "SELECT COALESCE(MAX(position),-1)+1 AS p FROM sprint_plan WHERE sprint_id=?", [sprint_id])])
    pos = int(rows_to_dicts(pres[0])[0]["p"]) if pres else 0
    # строки плана по всем ролям с 0 (если задачи ещё нет)
    await turso_execute([stmt(
        "INSERT INTO sprint_plan(sprint_id,task_key,title,role,planned_sp,position) VALUES(?,?,?,?,0,?) "
        "ON CONFLICT(sprint_id,task_key,role) DO UPDATE SET title=excluded.title",
        [sprint_id, key, title, role, pos]) for role in SPRINT_ROLES])
    return JSONResponse({"ok": True, "key": key, "title": title})

@app.delete("/sprints/{sprint_id}/task/{task_key}")
async def sprints_remove_task(sprint_id: int, task_key: str):
    await turso_execute([stmt(
        "DELETE FROM sprint_plan WHERE sprint_id=? AND task_key=?", [sprint_id, task_key.upper()])])
    return JSONResponse({"ok": True})

@app.post("/sprints/{sprint_id}/plan")
async def sprints_set_plan(sprint_id: int, request: Request):
    b = await request.json()
    key = (b.get("task_key") or "").strip().upper()
    role = b.get("role")
    if role not in SPRINT_ROLES or not key:
        return JSONResponse({"ok": False, "error": "Некорректная роль/ключ"})
    try:
        sp = float(b.get("sp") or 0)
    except (ValueError, TypeError):
        sp = 0.0
    await turso_execute([stmt(
        "INSERT INTO sprint_plan(sprint_id,task_key,title,role,planned_sp) VALUES(?,?,?,?,?) "
        "ON CONFLICT(sprint_id,task_key,role) DO UPDATE SET planned_sp=excluded.planned_sp",
        [sprint_id, key, key, role, sp])])
    return JSONResponse({"ok": True})

@app.post("/sprints/{sprint_id}/capacity")
async def sprints_set_capacity(sprint_id: int, request: Request):
    b = await request.json()
    role = b.get("role")
    if role not in SPRINT_ROLES:
        return JSONResponse({"ok": False, "error": "Некорректная роль"})
    try:
        cap = float(b.get("capacity") or 0)
    except (ValueError, TypeError):
        cap = 0.0
    await turso_execute([stmt(
        "INSERT INTO sprint_capacity(sprint_id,role,capacity_sp) VALUES(?,?,?) "
        "ON CONFLICT(sprint_id,role) DO UPDATE SET capacity_sp=excluded.capacity_sp",
        [sprint_id, role, cap])])
    return JSONResponse({"ok": True})

@app.post("/sprints/{sprint_id}/order")
async def sprints_set_order(sprint_id: int, request: Request):
    """Порядок задач: keys в нужной последовательности → проставляем position."""
    b = await request.json()
    keys = b.get("keys") or []
    if not isinstance(keys, list) or not keys:
        return JSONResponse({"ok": False, "error": "Нужен список ключей"})
    await turso_execute([stmt(
        "UPDATE sprint_plan SET position=? WHERE sprint_id=? AND task_key=?",
        [i, sprint_id, str(k).upper()]) for i, k in enumerate(keys)])
    return JSONResponse({"ok": True})

@app.get("/sprints/{sprint_id}/plan-fact")
async def sprints_plan_fact(sprint_id: int):
    sp = await _sprint_get(sprint_id)
    if not sp:
        return JSONResponse({"ok": False, "error": "Спринт не найден"})
    meta = {"id": int(sp["id"]), "name": sp.get("name"), "team": sp.get("team"),
            "dateFrom": sp.get("date_from"), "dateTo": sp.get("date_to"),
            "finalized": bool(int(sp.get("finalized") or 0))}
    if meta["finalized"] and sp.get("final_data"):
        try:
            data = json.loads(sp["final_data"])
            return JSONResponse({"ok": True, "sprint": meta, "finalized": True, **data})
        except Exception:
            pass
    data = await _sprint_fact(sp)
    return JSONResponse({"ok": True, "sprint": meta, "finalized": meta["finalized"], **data})

@app.post("/sprints/{sprint_id}/finalize")
async def sprints_finalize(sprint_id: int):
    sp = await _sprint_get(sprint_id)
    if not sp:
        return JSONResponse({"ok": False, "error": "Спринт не найден"})
    data = await _sprint_fact(sp)
    await turso_execute([stmt(
        "UPDATE sprints SET finalized=1, final_data=? WHERE id=?",
        [json.dumps(data, ensure_ascii=False), sprint_id])])
    return JSONResponse({"ok": True})

@app.post("/sprints/{sprint_id}/reopen")
async def sprints_reopen(sprint_id: int):
    await turso_execute([stmt("UPDATE sprints SET finalized=0 WHERE id=?", [sprint_id])])
    return JSONResponse({"ok": True})

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
    return await ai_cached("blk", system, facts_txt, max_tokens=300, temperature=0.25)

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
# Разбивка статусов подзадачи: завершено / не начато / (всё прочее = в работе).
SLE_SUB_DONE = {"closed"}                                       # реально завершена
SLE_SUB_NOTSTARTED = {"new", "open", "gotovoKRabote", "backlogKomandy", "produktovyjBacklog"}  # создана/в бэклоге — никто не работает
def _sub_phase(status_key: str) -> str:
    if status_key in SLE_SUB_DONE:       return "done"
    if status_key in SLE_SUB_NOTSTARTED: return "todo"
    return "working"                                            # inProgress, analyticalstudy, review, testing…
SLE_QUERIES = {
    "current":    'Type: newFeature Queue: PUTKURERA Status: inProgress PUTKURERA."Operating mode": "В работе" Putkurera."sle risk": notEmpty() "Sort by": Putkurera."sle risk" DESC',
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
        # фазы подзадач: завершено / в работе / не начато
        phases = [_sub_phase((s.get("status") or {}).get("key", "")) for s in plist]
        done_cnt = phases.count("done")
        working_cnt = phases.count("working")
        notstarted_cnt = phases.count("todo")
        # «никто не работает» = есть подзадачи, но ни одной В РАБОТЕ (все либо завершены,
        # либо не начаты: new/open/бэклог). new/open больше НЕ считаем активной работой.
        hidden_blocked = len(plist) > 0 and working_cnt == 0
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
        # Никто не работает: есть подзадачи, но ни одной В РАБОТЕ (все завершены или
        # не начаты — new/open/бэклог). При ЛЮБОМ риске SLE.
        if is_current and len(plist) > 0 and working_cnt == 0:
            signals.append("Никто не работает — есть подзадачи, но ни одной в работе")
        needs_attention = is_current and len(signals) > 0
        # кластеризуем только реально рисковые: нарушен/высокий, либо умеренный с АКТИВНЫМ блокером.
        # низкий и умеренный без активной блокировки — ещё ничего не нарушено, кластер не присваиваем.
        # ВАЖНО: учитываем только ОТКРЫТЫЕ блокировки в активных подзадачах (blocked_subs).
        # Снятые/исторические блокировки НЕ делают задачу «в блоке» — иначе ложные срабатывания
        # (задача всё в работе, блок давно снят, а она висит в разборе).
        any_block = bool(blocked_subs)
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
            "doneSubCount": done_cnt,
            "workingSubCount": working_cnt,
            "notStartedSubCount": notstarted_cnt,
            "hiddenBlocked": hidden_blocked and which == "current",
        })

    return {"which": which, "count": len(tasks), "tasks": tasks}

SLE_SNAPSHOT_VERSION = 15  # bump при изменении логики сигналов/полей — старые снапшоты инвалидируются

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
        # кэш по фактам: переразбор бесплатен, если ситуация по задаче не изменилась
        txt = await ai_cached("slecls", system, facts, max_tokens=120, temperature=0.3)
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

# ── Поток: Корзина (отложенные на Discovery) ────────────────────────────────────
DEFERRED_QUERY = ('Type: newFeature Queue: PUTKURERA PUTKURERA."Operating mode": "Отложено" '
                  'Resolution: empty() "Status Type": !cancelled "Status Type": !done')

async def _guillotine_changes(client, key: str):
    """Сколько раз меняли дату «Гильотина времени» (всего и за 30 дней) — по истории задачи."""
    try:
        data = await tracker_request(client, "GET", f"/v2/issues/{key}/changelog?perPage=100")
    except Exception:
        return 0, 0
    total, last30 = 0, 0
    cutoff = (date.today() - timedelta(days=30)).isoformat()
    for ev in (data if isinstance(data, list) else []):
        for f in (ev.get("fields") or []):
            fid = (f.get("field") or {}).get("id") or ""
            if fid.endswith("theGuillotineOfTime"):
                total += 1
                if (ev.get("updatedAt") or "")[:10] >= cutoff:
                    last30 += 1
    return total, last30

@app.get("/flow-deferred")
async def flow_deferred(refresh: bool = Query(False)):
    """Корзина: задачи в режиме «Отложено». Подсвечиваем требующие решения (гильотина
    наступила) и часто откладываемые (дату гильотины меняли многократно)."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    ckey = "flow-deferred-v3"
    if not refresh:
        try:
            res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?", [ckey])])
            rows = rows_to_dicts(res[0]) if res else []
            if rows and rows[0].get("data"):
                obj = json.loads(rows[0]["data"]); obj["updatedAt"] = rows[0].get("updated_at") or ""
                return JSONResponse(obj)
        except Exception as e:
            print(f"[flow-deferred load] {e}")

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            tasks = await tracker_query(client, DEFERRED_QUERY)
            chg = {}
            B = 4
            for i in range(0, len(tasks), B):
                chunk = tasks[i:i + B]
                rs = await asyncio.gather(*[_guillotine_changes(client, t["key"]) for t in chunk],
                                          return_exceptions=True)
                for t, r in zip(chunk, rs):
                    chg[t["key"]] = r if isinstance(r, tuple) else (0, 0)
                await asyncio.sleep(0.2)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    all_items = []
    for t in tasks:
        k = t["key"]
        # разницу с гильотиной берём из поля задачи: >=0 → гильотина НАСТУПИЛА, <0 → ещё нет.
        diff = _field(t, "--theDifferenceWithGw")
        try:
            diff = int(float(diff)) if diff is not None else None
        except (TypeError, ValueError):
            diff = None
        g_total, g_30 = chg.get(k, (0, 0))
        all_items.append({
            "key": k, "summary": t.get("summary", "—"),
            "url": f"https://tracker.yandex.ru/{k}",
            "assignee": (t.get("assignee") or {}).get("display", "—"),
            "team": t.get("team") or "",
            "status": (t.get("status") or {}).get("display", ""),
            "guillotine": _field(t, "--theGuillotineOfTime") or "",
            "diff": diff,
            "daysOnStatus": t.get("daysOnTheStatus"),
            "daysOfResearch": _field(t, "--daysOfResearch"),
            "gChanges": g_total, "gChanges30": g_30,
            "needsDecision": diff is not None and diff >= 0,
            "frequentlyParked": g_total >= 3 or g_30 >= 2,
        })
    # показываем ТОЛЬКО: наступившая гильотина (diff>=0) ИЛИ часто откладывают
    items = [x for x in all_items if x["needsDecision"] or x["frequentlyParked"]]
    items.sort(key=lambda x: (not x["needsDecision"], not x["frequentlyParked"],
                              -(x["diff"] if x["diff"] is not None else -10**9)))
    payload = {"ok": True, "items": items, "count": len(items), "totalBasket": len(all_items),
               "needsDecision": sum(1 for i in items if i["needsDecision"]),
               "frequentlyParked": sum(1 for i in items if i["frequentlyParked"])}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ckey, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[flow-deferred save] {e}")
    payload["updatedAt"] = "только что"
    return JSONResponse(payload)

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
    if d.strip() == "задача" or "task" in d:
        return "Задача"
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

# ── Инциденты: отдельный раздел (причина, стек, приоритет, SLE) ──────────────────
INCIDENTS_VERSION = 3  # v3: worklog с месяцем списания (для стоимости по месяцу траты)

@app.get("/incidents")
async def incidents(months: int = Query(12), refresh: bool = Query(False)):
    """Все инциденты трёх очередей за период: причина, стек, приоритет, часы, SLE.
    Бакетируем по месяцу создания. Фронт группирует по команде/причине/стеку."""
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан в секретах Space"})
    months = max(1, min(int(months or 12), 24))
    ckey = f"incidents-{months}-v{INCIDENTS_VERSION}"
    if not refresh:
        try:
            res = await turso_execute([stmt("SELECT data, updated_at FROM osp_snapshot WHERE which=?", [ckey])])
            rows = rows_to_dicts(res[0]) if res else []
            if rows and rows[0].get("data"):
                obj = json.loads(rows[0]["data"]); obj["updatedAt"] = rows[0].get("updated_at") or ""
                return JSONResponse(obj)
        except Exception as e:
            print(f"[incidents load] {e}")

    month_list = _osp_month_list(months)
    cutoff = month_list[0] + "-01"

    async def _fetch(client, q):
        return await tracker_query(client, f'Queue: {q} Type: incident Created: >= "{cutoff}"')

    try:
        async with httpx.AsyncClient(timeout=90) as client:
            results = await asyncio.gather(*[_fetch(client, q) for q in OSP_QUEUES])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

    def _as_list(v):
        if v is None:
            return []
        return v if isinstance(v, list) else [v]

    items: list[dict] = []
    for q, issues in zip(OSP_QUEUES, results):
        for iss in issues:
            if (iss.get("type") or {}).get("key") != "incident":
                continue
            mo = _msk_month(iss.get("createdAt") or "")
            if mo not in month_list:
                continue
            cause = (_field(iss, "--theCauseOfTheIncident") or "").strip() or "— не указана"
            stack = [str(s).strip() for s in _as_list(_field(iss, "--stackmultiple")) if str(s).strip()]
            spent_h = _iso_dur_hours(iss.get("spent"))
            pr = iss.get("priority") or {}
            res_ = iss.get("resolution") or {}
            st = iss.get("status") or {}
            items.append({
                "month": mo, "queue": q, "key": iss.get("key"),
                "summary": iss.get("summary") or "—",
                "url": f"https://tracker.yandex.ru/{iss.get('key')}",
                "created": _msk_date(iss.get("createdAt") or ""),
                "resolved": _msk_date(iss.get("resolvedAt") or "") if iss.get("resolvedAt") else "",
                "status": st.get("display", ""), "statusKey": st.get("key", ""),
                "resolution": res_.get("display", "") if res_ else "",
                "priority": pr.get("display", ""), "priorityKey": pr.get("key", ""),
                "assignee": (iss.get("assignee") or {}).get("display", "—"),
                "daysInWork": _osp_days_field(iss),
                "spentHours": round(spent_h, 1) if spent_h > 0 else None,
                "cause": cause,
                "stack": stack,
                "sleStatus": _field(iss, "--sleStatus") or "",
                "worklog": [],
            })

    # worklog по каждому инциденту со списаниями: кто сколько залогировал (для стоимости)
    by_key = {it["key"]: it for it in items}
    wl_keys = [it["key"] for it in items if it.get("spentHours")]
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            B = 4
            for i in range(0, len(wl_keys), B):
                chunk = wl_keys[i:i + B]
                wls = await asyncio.gather(*[_wl_fetch(client, k) for k in chunk], return_exceptions=True)
                for k, wl in zip(chunk, wls):
                    if not isinstance(wl, list):
                        continue
                    agg: dict = {}  # (исполнитель, месяц списания) -> часы
                    for e in wl:
                        hrs = _iso_dur_hours(e.get("duration"))
                        if hrs <= 0:
                            continue
                        who = (e.get("createdBy") or {}).get("display") or "—"
                        mo = _msk_month(e.get("start") or e.get("createdAt") or "")
                        agg[(who, mo)] = agg.get((who, mo), 0) + hrs
                    by_key[k]["worklog"] = [{"name": n, "month": mo, "hours": round(h, 2)}
                                            for (n, mo), h in sorted(agg.items(), key=lambda x: -x[1])]
                await asyncio.sleep(0.25)
    except Exception as e:
        print(f"[incidents worklog] {e}")

    payload = {"ok": True, "queues": OSP_QUEUES, "months": month_list, "items": items}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ckey, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[incidents save] {e}")
    payload["updatedAt"] = "только что"
    return JSONResponse(payload)

async def _incidents_items(months: int) -> list:
    inc = await _osp_snap(f"incidents-{months}-v{INCIDENTS_VERSION}")
    return (inc or {}).get("items", [])

@app.get("/incidents-clusters")
async def incidents_clusters(months: int = Query(12), refresh: bool = Query(False)):
    """AI-кластеризация сырых причин инцидентов в осмысленные группы.
    Возвращает {clusters: {исходная_причина: кластер}, names: [...]}. Кэшируется."""
    ckey = f"incidents-clusters-{months}-v2"
    if not refresh:
        snap = await _osp_snap(ckey)
        if snap:
            return JSONResponse(snap)
    items = await _incidents_items(months)
    causes = sorted({(it.get("cause") or "").strip() for it in items
                     if (it.get("cause") or "").strip() and (it.get("cause") or "").strip() != "— не указана"})
    if not causes or not AI_ENABLED:
        return JSONResponse({"ok": True, "clusters": {}, "names": [], "bad": []})
    numbered = "\n".join(f"{i}. {c}" for i, c in enumerate(causes))
    system = (
        "Ты группируешь причины инцидентов сервиса доставки в осмысленные кластеры (категории корневых причин). "
        "Сделай 5–9 кластеров с короткими понятными названиями на русском (например: «Ошибки фронта», "
        "«Интеграции/внешние API», «Данные и координаты», «Логика расчётов», «Инфраструктура/деплой», "
        "«Человеческий фактор», «Конфигурация»). Каждой исходной причине присвой ровно один кластер.\n"
        "Также пометь причины, записанные ФОРМАЛЬНО/«на отвали»: бессмысленные («111», «ааа», набор символов), "
        "отписки («хз», «не знаю», «тест»), или без понятного объяснения корневой причины — для них bad=true.\n"
        "Верни СТРОГО валидный JSON-массив без пояснений, формата: "
        "[{\"i\": <номер причины из списка>, \"cluster\": \"<название кластера>\", \"bad\": true|false}, ...]. "
        "Покрой ВСЕ номера. Никакого текста вокруг JSON."
    )
    txt = await ai_complete(system, "Причины:\n" + numbered, max_tokens=4000, temperature=0.2)
    mapping: dict = {}
    bad: list = []
    try:
        s = txt[txt.index("["): txt.rindex("]") + 1]
        for row in json.loads(s):
            i = int(row.get("i"))
            cl = str(row.get("cluster") or "").strip()
            if 0 <= i < len(causes):
                if cl:
                    mapping[causes[i]] = cl
                if row.get("bad") is True:
                    bad.append(causes[i])
    except Exception as e:
        print(f"[incidents-clusters parse] {e}")
    for c in causes:
        mapping.setdefault(c, "Прочее")
    names = sorted(set(mapping.values()))
    payload = {"ok": True, "clusters": mapping, "names": names, "bad": bad}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ckey, json.dumps(payload, ensure_ascii=False)])])
    except Exception as e:
        print(f"[incidents-clusters save] {e}")
    return JSONResponse(payload)

@app.get("/incidents-ai")
async def incidents_ai(team: str = Query("all"), months: int = Query(12),
                       date_from: str = Query("", alias="from"), date_to: str = Query("", alias="to"),
                       refresh: bool = Query(False)):
    """AI-сводка по инцидентам (Claude). Сравниваем выбранный период с ПРЕДЫДУЩИМ
    такой же длины (а не с прошлым месяцем — текущий месяц не закончен)."""
    if not AI_ENABLED:
        return JSONResponse({"ok": True, "summary": ""})
    titems = [it for it in await _incidents_items(months) if team == "all" or it.get("queue") == team]
    if not titems:
        return JSONResponse({"ok": True, "summary": ""})

    # окно периода и эквивалентное предыдущее
    pf = pt = ""
    prev_n = None
    if date_from and date_to:
        try:
            f = datetime.strptime(date_from, "%Y-%m-%d").date()
            t = datetime.strptime(date_to, "%Y-%m-%d").date()
            length = (t - f).days
            pt_d = f - timedelta(days=1)
            pf_d = pt_d - timedelta(days=length)
            pf, pt = pf_d.isoformat(), pt_d.isoformat()
            items = [it for it in titems if date_from <= (it.get("created") or "") <= date_to]
            prev_n = sum(1 for it in titems if pf <= (it.get("created") or "") <= pt)
        except Exception:
            items = titems
    else:
        items = titems
    if not items:
        return JSONResponse({"ok": True, "summary": ""})

    from collections import Counter
    by_team = Counter(it["queue"] for it in items)
    by_prio = Counter(it.get("priority") or "—" for it in items)
    # Причины только начали заполнять — НЕ кормим AI «— не указана»/пустыми,
    # иначе сводка пишет про «неизвестную причину», что сейчас бессмысленно.
    causes = Counter(
        c for it in items
        if (c := (it.get("cause") or "").strip()) and c != "— не указана"
    ).most_common(6)
    stacks = Counter(s for it in items for s in (it.get("stack") or [])).most_common(5)
    crit = sum(1 for it in items if it.get("priorityKey") in ("critical", "blocker"))
    done = sum(1 for it in items if it.get("resolution") or it.get("statusKey") == "closed")
    hours = round(sum(it.get("spentHours") or 0 for it in items))
    avg_days = round(sum(it.get("daysInWork") or 0 for it in items) / len(items), 1)
    team_lbl = OSP_QUEUES.get(team, team) if team != "all" else "все команды курьеров"
    lines = [
        f"Команда: {team_lbl}. Период: {date_from or 'все'}–{date_to or 'данные'}.",
        f"Инцидентов за период: {len(items)} (создано). Завершено: {done}, открыто: {len(items) - done}.",
    ]
    if prev_n is not None:
        lines.append(f"Предыдущий период такой же длины ({pf}–{pt}): {prev_n} инцидентов. "
                     f"ВАЖНО: сравнивай период с этим предыдущим периodом, НЕ говори про «текущий месяц», "
                     f"он может быть не завершён.")
    lines += [
        f"Критичных/блокеров: {crit}. Часов суммарно: {hours}. Средние дни в работе: {avg_days}.",
        "По командам: " + ", ".join(f"{OSP_QUEUES.get(q, q)} {n}" for q, n in by_team.most_common()),
        "По приоритету: " + ", ".join(f"{p} {n}" for p, n in by_prio.most_common()),
        "Топ причин: " + "; ".join(f"{c} ({n})" for c, n in causes),
        "Топ стека: " + (", ".join(f"{s} ({n})" for s, n in stacks) or "—"),
    ]
    facts = "\n".join(lines)
    system = (
        "Ты — аналитик надёжности сервиса доставки. На вход — статистика инцидентов за выбранный период "
        "и сравнение с предыдущим периодом такой же длины. Подсветь 2–4 ГЛАВНЫХ источника инцидентов "
        "и тревожных тренда для продакта/тимлида.\n"
        "Сравнивай период с предыдущим РАВНЫМ периодом. НЕ сравнивай 'текущий месяц с прошлым' — текущий "
        "период может быть не завершён, такой вывод обманчив.\n"
        "Примеры: динамика к прошлому равному периоду; доминирующая причина/стек; много критичных; долго чинят.\n"
        "Причины инцидентов ТОЛЬКО НАЧАЛИ заполнять — НЕ делай выводов о «неизвестной»/незаполненной "
        "причине, не упоминай отсутствие или нехватку причин. Работай только с заполненными причинами.\n"
        "ФОРМАТ СТРОГО:\n"
        "— Каждый пункт с новой строки, начинается с эмодзи: 📈 рост, 📉 спад, 🔥/🚨 тревога, ⚠️ риск, ✅ хорошо, "
        "🐞 баги/инциденты, 🧱 стек/тех, 🐌 долго чинят.\n"
        "— После эмодзи — короткая суть; ключевые числа и причины оборачивай в **двойные звёздочки** (жирный).\n"
        "— 2–4 пункта, каждый одно живое предложение, без канцелярита и без вступления.\n"
        "Только на основе чисел, ничего не выдумывай."
    )
    summary = await ai_cached("inc", system, facts, max_tokens=380, temperature=0.3, refresh=refresh)
    return JSONResponse({"ok": True, "team": team, "summary": summary or ""})

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

# ── ОСП: настройки (SLE-пороги по месяцам + переброс сотрудников) ───────────────
OSP_SETTINGS_KEY = "osp-settings-v1"
# дефолтные ручные привязки сотрудников к командам (как в ingest_reports.py)
OSP_DEFAULT_OVERRIDES = [
    {"name": "Гусев",  "team": "UDOSTAVKA",    "from": "2026-01"},
    {"name": "Памшев", "team": "DOSTAVKAPIKO", "from": "2026-01"},
]

def _osp_norm(s: str) -> str:
    return str(s or "").replace("ё", "е").replace("Ё", "Е").strip().lower()

def _osp_default_settings() -> dict:
    return {
        "sleVersions": [{"from": "2000-01", "sle": OSP_SLE}],
        "teamOverrides": [dict(o) for o in OSP_DEFAULT_OVERRIDES],
    }

async def _osp_settings() -> dict:
    snap = await _osp_snap(OSP_SETTINGS_KEY)
    if isinstance(snap, dict) and snap.get("sleVersions"):
        snap.setdefault("teamOverrides", [])
        return snap
    return _osp_default_settings()

def _sle_resolve(month: str, versions: list) -> dict:
    """Эффективные SLE-пороги для месяца: версия с наибольшим from ≤ month."""
    applicable = [v for v in (versions or []) if (v.get("from") or "") <= (month or "9999-99")]
    pick = max(applicable, key=lambda v: v.get("from", ""), default=None) \
        or (versions[0] if versions else {"sle": OSP_SLE})
    return pick.get("sle") or OSP_SLE

def _sle_compute(items: list, thr_map: dict) -> dict:
    acc = {q: {c["key"]: {"lt": [], "hours": []} for c in OSP_SLE_CATS} for q in OSP_QUEUES}
    for it in items:
        q, ck = it.get("queue"), it.get("cat")
        if q not in acc or ck not in acc[q]:
            continue
        if it.get("days") is not None:
            acc[q][ck]["lt"].append(it["days"])
        if it.get("hours") is not None:
            acc[q][ck]["hours"].append(it["hours"])
    def _pct(vals, thr):
        return round(sum(1 for v in vals if v <= thr) / len(vals) * 100) if vals else None
    sle = {}
    for q in OSP_QUEUES:
        sle[q] = {}
        for c in OSP_SLE_CATS:
            ck = c["key"]
            thr = thr_map.get(q, {}).get(_SLE_THR_KEY.get(ck, ck), {})
            lt, hrs = acc[q][ck]["lt"], acc[q][ck]["hours"]
            sle[q][ck] = {
                "ltThr": thr.get("lt"), "hoursThr": thr.get("hours"),
                "ltBase": len(lt), "ltPct": _pct(lt, thr.get("lt", 1e9)),
                "hrsBase": len(hrs), "hrsPct": _pct(hrs, thr.get("hours", 1e9)),
            }
    return sle

@app.get("/osp-settings")
async def osp_settings_get():
    s = await _osp_settings()
    return JSONResponse({"ok": True, "queues": OSP_QUEUES, "cats": OSP_SLE_CATS,
                         "thrKeys": _SLE_THR_KEY, "target": OSP_SLE_TARGET,
                         "baseline": OSP_SLE, **s})

@app.post("/osp-settings")
async def osp_settings_set(request: Request):
    try:
        body = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"bad json: {e}"})
    settings = {
        "sleVersions": body.get("sleVersions") or [{"from": "2000-01", "sle": OSP_SLE}],
        "teamOverrides": body.get("teamOverrides") or [],
    }
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [OSP_SETTINGS_KEY, json.dumps(settings, ensure_ascii=False)])])
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})
    return JSONResponse({"ok": True, **settings})

def _apply_team_overrides(snap: dict, overrides: list) -> dict:
    """Переброс сотрудников между командами в worklog-снапшоте (на чтении).
    Идемпотентно: если сотрудник уже в нужной команде — ничего не делает."""
    if not overrides:
        return snap
    months = snap.get("months", []) or []
    emps = snap.get("employees", {}) or {}
    cin = snap.get("crossIn", {}) or {}
    for ov in overrides:
        nm = _osp_norm(ov.get("name"))
        target = ov.get("team")
        frm = ov.get("from") or ""
        if not nm or target not in OSP_QUEUES:
            continue
        for m in months:
            if frm and m < frm:
                continue
            gained, moved_by = 0.0, {}
            disp = ov.get("name")
            # 1) забрать из employees других команд
            for q, lst in (emps.get(m) or {}).items():
                if q == target:
                    continue
                for e in list(lst):
                    if nm in _osp_norm(e.get("name")):
                        gained += e.get("total", 0) or 0
                        moved_by = e.get("by") or moved_by
                        disp = e.get("name") or disp
                        lst.remove(e)
            # 2) забрать из «чужих» в целевой очереди
            for q, lst in (cin.get(m) or {}).items():
                if q != target:
                    continue
                for r in list(lst):
                    if nm in _osp_norm(r.get("name")):
                        gained += r.get("hours", 0) or 0
                        disp = r.get("name") or disp
                        lst.remove(r)
            if gained <= 0:
                continue
            tl = emps.setdefault(m, {}).setdefault(target, [])
            ex = next((e for e in tl if nm in _osp_norm(e.get("name"))), None)
            if ex:
                ex["total"] = round((ex.get("total", 0) or 0) + gained, 2)
            else:
                tl.append({"name": disp, "total": round(gained, 2), "by": moved_by, "pct": 0})
            tt = sum(e.get("total", 0) for e in tl) or 1
            for e in tl:
                e["pct"] = round((e.get("total", 0) or 0) / tt * 100, 1)
            tl.sort(key=lambda x: -(x.get("total", 0) or 0))
    return snap

@app.get("/osp-sle/suggest")
async def osp_sle_suggest(months: int = Query(6)):
    """Предложить SLE-пороги по факту: 85-й перцентиль «дней в работе» (LT) и «часов»
    закрытых задач за последние N месяцев, по команде × категории."""
    months = max(1, min(int(months or 6), 24))
    snap = await _osp_snap(f"sle-{months}-v3")
    items = (snap or {}).get("items") or []
    if not items:
        return JSONResponse({"ok": False, "error": "Нет данных SLE за период — сначала обновите блок «Попадание в SLE»."})

    def p85(vals):
        vals = sorted(v for v in vals if v is not None)
        if not vals:
            return None
        k = max(0, (85 * len(vals) + 99) // 100 - 1)  # nearest-rank P85
        return vals[min(k, len(vals) - 1)]

    cats_for = {"incident": ["incident"], "tech": ["techDebt", "techImpr"], "story": ["story"]}
    sle = {}
    n_used = 0
    for q in OSP_QUEUES:
        sle[q] = {}
        for thr, cats in cats_for.items():
            sub = [it for it in items if it.get("queue") == q and it.get("cat") in cats]
            n_used += len(sub)
            lt = p85([it.get("days") for it in sub])
            hr = p85([it.get("hours") for it in sub])
            sle[q][thr] = {"lt": round(lt) if lt is not None else 0,
                           "hours": round(hr) if hr is not None else 0}
    return JSONResponse({"ok": True, "sle": sle, "months": months, "tasks": n_used})

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
                # пороги применяем «на лету» из настроек (без повторного запроса в Трекер)
                s = await _osp_settings()
                versions = s.get("sleVersions") or [{"from": "2000-01", "sle": OSP_SLE}]
                latest = max(versions, key=lambda v: v.get("from", ""), default={}).get("sle") or OSP_SLE
                obj["sle"] = _sle_compute(obj.get("items", []), latest)
                obj["thresholdVersions"] = versions
                obj["target"] = OSP_SLE_TARGET
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

    s = await _osp_settings()
    versions = s.get("sleVersions") or [{"from": "2000-01", "sle": OSP_SLE}]
    latest = max(versions, key=lambda v: v.get("from", ""), default={}).get("sle") or OSP_SLE
    sle = _sle_compute(items, latest)

    payload = {"ok": True, "queues": OSP_QUEUES, "cats": OSP_SLE_CATS,
               "target": OSP_SLE_TARGET, "sle": sle, "items": items,
               "thresholdVersions": versions}
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

@app.get("/diag/ai")
async def diag_ai():
    """Проверка LLM: какой провайдер/модель отвечает. Не раскрывает ключи."""
    out = {"claudeKey": bool(CLAUDE_TOKEN), "claudeModel": CLAUDE_MODEL,
           "mistralKey": bool(MISTRAL_API_KEY), "mistralModel": MISTRAL_MODEL,
           "claude": None, "mistral": None}
    # прямой пинг Claude (минуя fallback), чтобы увидеть реальный статус
    if CLAUDE_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={"x-api-key": CLAUDE_TOKEN, "anthropic-version": "2023-06-01",
                             "content-type": "application/json"},
                    json={"model": CLAUDE_MODEL, "max_tokens": 16, "temperature": 0,
                          "messages": [{"role": "user", "content": "Ответь одним словом: пинг"}]})
            if r.status_code == 200:
                parts = r.json().get("content") or []
                out["claude"] = {"ok": True, "reply": "".join(p.get("text", "") for p in parts).strip()[:50]}
            else:
                out["claude"] = {"ok": False, "status": r.status_code, "body": r.text[:300]}
        except Exception as e:
            out["claude"] = {"ok": False, "error": str(e)[:200]}
    # какой провайдер реально используется приложением (через общий помощник)
    out["active"] = await ai_complete("Ответь одним словом.", "Скажи: работает", max_tokens=16, temperature=0)
    return JSONResponse(out)

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
    # переброс сотрудников между командами (из настроек, на лету)
    try:
        s = await _osp_settings()
        _apply_team_overrides(snap, s.get("teamOverrides") or [])
    except Exception as e:
        print(f"[osp-wl overrides] {e}")
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

# ── Оценка новых возможностей (PUTKURERA): эталоны + AI-категоризация ────────────
EST_TEAM_MEMBERS = {"R": ["Светляков", "Иванов"], "X": ["Бескова", "Беляев"], "U": ["Петровская"]}
EST_TEAM_LABEL = {"R": "Курьеры R", "X": "Курьеры X", "U": "Курьеры U"}
# Разработчик → стек (для разбивки worklog эталонов; по фамилиям, токен-матч).
EST_STACK_MEMBERS = {
    "SA":     ["Резенова", "Махмутова", "Борискин", "Разумова", "Егоров", "Перевезенцева"],
    "GO":     ["Ким", "Источников", "Подлинов", "Доронин", "Мартынов", "Киреев"],
    "Front":  ["Копосов", "Асотикова", "Шестопалов", "Памшев"],
    "QA":     ["Мартова", "Рогова", "Ву", "Степин", "Корякин", "Туралиева"],
    "1С":     ["Яцушко", "Гусев"],
    "AQA":    ["Исабаев", "Драгун"],
    "АрхКом": ["Спиридонов", "Селезнев"],   # архитекторы/техлиды (ё→е норм.)
}
EST_QUEUE_PREFIXES = ("POOLING", "UDOSTAVKA", "DOSTAVKAPIKO")  # очереди курьеров (X/U/R)
def _tracker_key(s: str) -> str:
    """Ключ задачи из строки/ссылки (https://tracker.yandex.ru/PUTKURERA-1218 → PUTKURERA-1218)."""
    m = re.search(r"([A-Z][A-Z0-9]*-\d+)", (s or "").strip(), re.IGNORECASE)
    return m.group(1).upper() if m else ""

def _est_stack(display: str):
    toks = set(_sprint_norm(display).split())
    for stack, names in EST_STACK_MEMBERS.items():
        if any(_sprint_norm(n) in toks for n in names):
            return stack
    return None

# Категории: maxEff — верхняя граница Effort факт (None = без верха, L); sle — ожидаемый срок, дн.
EST_CATEGORIES_DEFAULT = [
    {"key": "S", "maxEff": 14, "sle": 55},
    {"key": "M", "maxEff": 40, "sle": 88},
    {"key": "L", "maxEff": None, "sle": 108},
]

async def _est_settings():
    """Редактируемые категории/SLE (snapshot est-settings-v1), иначе дефолт из исследования."""
    snap = await _osp_snap("est-settings-v1")
    if isinstance(snap, dict) and isinstance(snap.get("categories"), list) and snap["categories"]:
        return snap["categories"]
    return [dict(c) for c in EST_CATEGORIES_DEFAULT]

def _eff_cat(eff, cats):
    """Категория по Effort факт и текущим порогам (cats отсортированы S→M→L)."""
    try:
        e = float(eff)
    except (TypeError, ValueError):
        return None
    if e <= 0:
        return None
    for c in cats:
        mx = c.get("maxEff")
        if mx is None or e <= mx:
            return c["key"]
    return cats[-1]["key"] if cats else None

def _est_team(assignee: str):
    n = _sprint_norm(assignee)
    for team, names in EST_TEAM_MEMBERS.items():
        if any(_sprint_norm(x) in n for x in names):
            return team
    return None

async def _est_references():
    """Эталонные завершённые задачи PUTKURERA (чистые, с янв 2026), команда×категория."""
    cats = await _est_settings()
    sle_by = {c["key"]: c.get("sle") for c in cats}
    base = {"teams": list(EST_TEAM_LABEL.keys()), "teamLabels": EST_TEAM_LABEL,
            "categories": cats, "items": []}
    if not TRACKER_TOKEN:
        return base
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            issues = await tracker_query(client,
                "Type: newFeature Queue: PUTKURERA Status: zaverseno, analizRezults, closed")
    except Exception as e:
        print(f"[est refs] {e}")
        return base
    items = []
    for iss in issues:
        team = _est_team((iss.get("assignee") or {}).get("display", ""))
        if not team:
            continue
        eff = _field(iss, "--anEffortFact")
        eff_cat = _eff_cat(eff, cats)                  # категория по Effort факт
        if not eff_cat:
            continue
        start = (iss.get("start") or iss.get("createdAt") or "")[:10]
        if start and start < "2026-01-01":   # legacy — отбрасываем
            continue
        try:
            dv = float(iss.get("daysInTheWork") or 0)
        except (TypeError, ValueError):
            dv = 0
        if dv <= 0:
            continue
        try:
            if float(eff) and dv / float(eff) > 8:   # аномалия: зависла не по сложности
                continue
        except (TypeError, ValueError, ZeroDivisionError):
            pass
        # Эталон = задача, уложившаяся в SLE. Если по effort это S, но сроки S нарушены —
        # поднимаем до категории, чей SLE выполнен (S→M→L). Даже L превышен → не эталон.
        order = [c["key"] for c in cats]
        idx = order.index(eff_cat)
        while idx < len(order) and sle_by.get(order[idx]) and dv > sle_by[order[idx]]:
            idx += 1
        if idx >= len(order):
            continue
        cat = order[idx]
        items.append({
            "key": iss.get("key"), "title": iss.get("summary", "—"),
            "url": f"https://tracker.yandex.ru/{iss.get('key')}",
            "team": team, "category": cat, "effCat": eff_cat, "promoted": cat != eff_cat,
            "assignee": (iss.get("assignee") or {}).get("display", "—"),
            "effort": round(float(eff), 1), "days": round(dv),
        })
    items.sort(key=lambda x: (x["team"], x["category"], x["days"]))
    base["items"] = items
    return base

@app.get("/est/references")
async def est_references(refresh: bool = Query(False)):
    ck = "est-refs-v3"
    if not refresh:
        snap = await _osp_snap(ck)
        if snap:
            return JSONResponse({"ok": True, **snap})
    data = await _est_references()
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ck, json.dumps(data, ensure_ascii=False)])])
    except Exception as e:
        print(f"[est refs save] {e}")
    return JSONResponse({"ok": True, **data})

@app.get("/est/settings")
async def est_settings_get():
    return JSONResponse({"ok": True, "categories": await _est_settings()})

@app.post("/est/settings")
async def est_settings_set(request: Request):
    b = await request.json()
    cats = b.get("categories")
    if not isinstance(cats, list) or not cats:
        return JSONResponse({"ok": False, "error": "Нужны категории"})
    clean = []
    for c in cats:
        try:
            mx = c.get("maxEff")
            clean.append({"key": str(c.get("key")), "maxEff": (None if mx in (None, "", 0) else float(mx)),
                          "sle": float(c.get("sle") or 0)})
        except (TypeError, ValueError):
            continue
    await turso_execute([stmt(
        "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
        "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
        ["est-settings-v1", json.dumps({"categories": clean}, ensure_ascii=False)])])
    # сбрасываем кэш эталонов — категории могли поменяться
    try:
        await turso_execute([stmt("DELETE FROM osp_snapshot WHERE which=?", ["est-refs-v3"])])
    except Exception:
        pass
    return JSONResponse({"ok": True})

@app.post("/est/comment")
async def est_comment(request: Request):
    b = await request.json()
    key = _tracker_key(b.get("key"))
    text = (b.get("text") or "").strip()
    if not key or not text:
        return JSONResponse({"ok": False, "error": "Нужны ключ задачи и текст"})
    if not TRACKER_TOKEN:
        return JSONResponse({"ok": False, "error": "TRACKER_TOKEN не задан"})
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            await tracker_request(client, "POST", f"/v2/issues/{key}/comments", {"text": text})
        return JSONResponse({"ok": True, "url": f"https://tracker.yandex.ru/{key}"})
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)})

@app.get("/est/worklog-stacks")
async def est_worklog_stacks(refresh: bool = Query(False)):
    """Логи времени по эталонным задачам (worklog их подзадач) → разбивка по стекам.
    Стек определяется по автору записи (маппинг dev→стек). Неопознанные — в список unknown."""
    ck = "est-wl-stacks-v3"
    if not refresh:
        snap = await _osp_snap(ck)
        if snap:
            return JSONResponse({"ok": True, **snap})
    refs = await _est_references()
    keys = [it["key"] for it in refs["items"]]
    title_by_key = {it["key"]: it["title"] for it in refs["items"]}
    people: dict = {}                    # автор → часы (все, кто логировал в курьерских подзадачах)
    per_task: dict = {k: {} for k in keys}   # родитель → {стек: часы}  (только нужные люди)
    if TRACKER_TOKEN and keys:
        async with httpx.AsyncClient(timeout=90) as client:
            # 1) родитель → подзадачи (subtask, outward), оставляем только очереди курьеров
            link_pairs = []
            for i in range(0, len(keys), 5):
                chunk = keys[i:i + 5]
                lls = await asyncio.gather(*[fetch_issue_links(client, k) for k in chunk], return_exceptions=True)
                link_pairs.extend(zip(chunk, lls))
                await asyncio.sleep(0.3)
            sub_to_parent = {}
            for pk, links in link_pairs:
                if isinstance(links, Exception) or not isinstance(links, list):
                    continue
                for l in links:
                    if (l.get("type", {}) or {}).get("id") != "subtask" or l.get("direction") != "outward":
                        continue
                    sk = (l.get("object", {}) or {}).get("key") or ""
                    if sk.split("-")[0] in EST_QUEUE_PREFIXES:   # только X/U/R
                        sub_to_parent[sk] = pk
            subs = list(sub_to_parent)
            # 2) worklog по каждой курьерской подзадаче → часы по автору и по родителю
            for i in range(0, len(subs), 5):
                chunk = subs[i:i + 5]
                wls = await asyncio.gather(*[_wl_fetch(client, k) for k in chunk], return_exceptions=True)
                for sk, wl in zip(chunk, wls):
                    if not isinstance(wl, list):
                        continue
                    pk = sub_to_parent.get(sk)
                    for e in wl:
                        h = _iso_dur_hours(e.get("duration"))
                        if h <= 0:
                            continue
                        who = (e.get("createdBy") or {}).get("display") or "—"
                        people[who] = people.get(who, 0) + h
                        bucket = _est_stack(who) or "Другие"
                        if pk in per_task:
                            per_task[pk][bucket] = per_task[pk].get(bucket, 0) + h
                await asyncio.sleep(0.4)
    by_stack: dict = {}
    out_people, other = [], []
    for name, h in sorted(people.items(), key=lambda x: -x[1]):
        stack = _est_stack(name) or "Другие"
        out_people.append({"name": name, "hours": round(h, 1), "sp": round(h / SP_HOURS, 1), "stack": stack})
        by_stack[stack] = round(by_stack.get(stack, 0) + h / SP_HOURS, 1)
        if stack == "Другие":
            other.append({"name": name, "hours": round(h, 1)})
    tasks_out = []
    for k in keys:
        bs = {s: round(v / SP_HOURS, 1) for s, v in per_task[k].items() if v}
        if bs:
            tasks_out.append({"key": k, "title": title_by_key.get(k, k),
                              "url": f"https://tracker.yandex.ru/{k}", "byStack": bs,
                              "total": round(sum(bs.values()), 1)})
    data = {"byStack": by_stack, "people": out_people, "other": other,
            "perTask": tasks_out, "tasks": len(keys)}
    try:
        await turso_execute([stmt(
            "INSERT INTO osp_snapshot(which,data,updated_at) VALUES(?,?,datetime('now')) "
            "ON CONFLICT(which) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            [ck, json.dumps(data, ensure_ascii=False)])])
    except Exception as e:
        print(f"[est wl-stacks save] {e}")
    return JSONResponse({"ok": True, **data})

@app.post("/est/analyze")
async def est_analyze(request: Request):
    b = await request.json()
    text = (b.get("text") or "").strip()
    key = _tracker_key(b.get("key"))
    if key and TRACKER_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                iss = await fetch_issue(client, key)
            if isinstance(iss, dict):
                t = f"{iss.get('summary', '')}\n{(iss.get('description') or '')[:2000]}".strip()
                text = t or text
        except Exception:
            pass
    if not text:
        return JSONResponse({"ok": False, "error": "Введите описание задачи или ключ"})
    if not AI_ENABLED:
        return JSONResponse({"ok": False, "error": "AI недоступен (нет ключа в секретах)"})
    cats = await _est_settings()
    sle_map = {c["key"]: c.get("sle") for c in cats}
    thr = "; ".join(
        (f"{c['key']} ≤ {int(c['maxEff'])} дн effort" if c.get("maxEff") else f"{c['key']} > предыдущей")
        for c in cats)
    sle_txt = ", ".join(f"{c['key']}={c.get('sle')}" for c in cats)
    refs = await _est_references()
    by_cat: dict = {}
    for it in refs["items"]:
        by_cat.setdefault(it["category"], [])
        if len(by_cat[it["category"]]) < 3:
            by_cat[it["category"]].append(f"{it['key']} «{it['title']}» — effort {it['effort']}, {it['days']}д")
    examples = "\n".join(f"{c}: " + ("; ".join(by_cat.get(c, [])) or "—") for c in ("S", "M", "L"))
    system = (
        "Ты оцениваешь новую задачу команды Курьеры (очередь PUTKURERA). Делаешь ДВЕ вещи.\n"
        f"1) КАТЕГОРИЯ сложности по оценке EFFORT (человеко-дни): {thr}. "
        f"SLE (ожидаемый срок, дни): {sle_txt}. Дай категорию, оценку effort в днях (число), "
        "короткое обоснование и 1–3 похожих эталона из списка.\n"
        "2) ПРОВЕРКА MMF (Minimum Marketable Feature) — ОБЯЗАТЕЛЬНА, заполни всегда. По 5 критериям, "
        "по каждому ok (true/false) и заметка 1–2 предложения:\n"
        "   1. Одна проблема — фокус на одной проблеме/ценности.\n"
        "   2. Можно выпустить отдельно — самостоятельный релиз с пользой.\n"
        "   3. Есть метрика успеха — измеримый результат.\n"
        "   4. Один ключевой сценарий — основной happy-path понятен.\n"
        "   5. Проверка за разумное время — результат виден быстро.\n"
        "Плюс общий счёт (сколько ✅ из 5) и 1–3 конкретные рекомендации.\n"
        "Краткое rationale (1–3 предложения). Верни СТРОГО валидный JSON без пояснений и без markdown, "
        "ВСЕ поля обязательны:\n"
        "{\"category\":\"S|M|L\",\"effortDays\":<число>,\"rationale\":\"…\",\"similar\":[\"PUTKURERA-…\"],"
        "\"mmf\":{\"criteria\":[{\"name\":\"Одна проблема\",\"ok\":true,\"note\":\"…\"},"
        "{\"name\":\"Можно выпустить отдельно\",\"ok\":true,\"note\":\"…\"},"
        "{\"name\":\"Есть метрика успеха\",\"ok\":false,\"note\":\"…\"},"
        "{\"name\":\"Один ключевой сценарий\",\"ok\":true,\"note\":\"…\"},"
        "{\"name\":\"Проверка за разумное время\",\"ok\":true,\"note\":\"…\"}],"
        "\"score\":<0-5>,\"recommendations\":[\"…\"]}}"
    )
    user = f"Задача:\n{text[:2000]}\n\nЭталоны по категориям:\n{examples}"
    raw = await ai_cached("featest2", system, user, max_tokens=1600, temperature=0.2)
    out = {"category": None, "effortDays": None, "rationale": "", "similar": [], "mmf": None}
    try:
        s = raw[raw.index("{"): raw.rindex("}") + 1]
        j = json.loads(s)
        cat = str(j.get("category", "")).strip().upper()
        if cat in ("S", "M", "L"):
            out["category"] = cat
        out["effortDays"] = j.get("effortDays")
        out["rationale"] = str(j.get("rationale") or "")
        sim = j.get("similar") or []
        out["similar"] = [str(x) for x in sim][:3] if isinstance(sim, list) else []
        mmf = j.get("mmf")
        if isinstance(mmf, dict):
            crit = mmf.get("criteria") or []
            crit = [{"name": str(c.get("name") or ""), "ok": bool(c.get("ok")), "note": str(c.get("note") or "")}
                    for c in crit if isinstance(c, dict)]
            score = mmf.get("score")
            if not isinstance(score, (int, float)):
                score = sum(1 for c in crit if c["ok"])
            recs = mmf.get("recommendations") or []
            out["mmf"] = {"criteria": crit, "score": int(score), "total": len(crit) or 5,
                          "recommendations": [str(x) for x in recs][:3] if isinstance(recs, list) else []}
    except Exception as e:
        print(f"[est analyze parse] {e}")
        out["rationale"] = raw or ""
    out["sle"] = sle_map.get(out["category"]) if out["category"] else None
    return JSONResponse({"ok": True, **out})

# ── Static (React build) ──────────────────────────────────────────────────────

import os as _os

# index.html отдаём без кэша, чтобы новые сборки (с новым хешем JS) подхватывались
# сразу — иначе браузер держит старый index.html и тянет устаревший бандл.
_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}

# /assets монтируем ДО catch-all (иначе spa_fallback перехватывал бы и эти запросы)
app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")

@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    file = f"static/{full_path}"
    if _os.path.isfile(file) and not file.endswith("index.html"):
        return FileResponse(file)
    return FileResponse("static/index.html", headers=_NO_CACHE)
