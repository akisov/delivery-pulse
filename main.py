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
            created_at TEXT
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
    ])

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
            "INSERT INTO parent_tasks(key,title,queue,created_at) VALUES(?,?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET title=excluded.title",
            [iss["key"], iss.get("summary", "—"), queue, iss.get("createdAt", "")]
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
                days = max(0, (end_d - start_d).days)
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

    return {
        "tasks": tasks,
        "queues": queues_out,
        "today": today,
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
            stmt("INSERT INTO parent_tasks(key,title,queue,created_at) VALUES(?,?,?,?) "
                 "ON CONFLICT(key) DO UPDATE SET title=excluded.title",
                 [iss["key"], iss.get("summary","—"), queue, iss.get("createdAt","")])
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
            CASE
                WHEN b.status = 'closed' AND b.start_date != '' AND b.end_date != ''
                    THEN CAST(julianday(b.end_date) - julianday(b.start_date) AS INTEGER)
                WHEN b.status != 'closed' AND b.start_date != ''
                    THEN CAST(julianday(date('now')) - julianday(b.start_date) AS INTEGER)
                ELSE 0
            END AS days_val
        FROM blockings b
        JOIN blocking_status bs ON bs.blocking_key = b.key
        WHERE b.queue IN ({q_ph}){date_filter}
          AND bs.status_key IS NOT NULL
    """, args)])

    rows = rows_to_dicts(results[0]) if results else []

    by_status: dict[str, list[int]] = {}
    for row in rows:
        sk = row["status_key"]
        if sk not in WORK_STATUSES:
            continue
        try:
            days = int(float(row["days_val"] or 0))
        except (ValueError, TypeError):
            days = 0
        if days > 0:
            by_status.setdefault(sk, []).append(days)

    def p90(values: list[int]) -> float:
        if not values: return 0
        s = sorted(values)
        idx = int(len(s) * 0.9)
        return round(s[min(idx, len(s)-1)], 1)

    def avg(values: list[int]) -> float:
        return round(sum(values) / len(values), 1) if values else 0

    # Порядок статусов по воронке
    order = ["analyticalstudy", "vRazrabotke", "testing", "pomesenieVProduktiv", "atthecustomersinspection"]
    data_out = []
    for sk in order:
        vals = by_status.get(sk, [])
        data_out.append({
            "statusKey":     sk,
            "statusDisplay": WORK_STATUSES[sk],
            "count":         len(vals),
            "avg":           avg(vals),
            "p90":           p90(vals),
            "values":        vals,
        })

    return JSONResponse({"statuses": data_out})

@app.get("/data")
async def data(
    queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA"),
    date_from: str = Query(""),
    date_to: str = Query(""),
):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES
    return JSONResponse(await query_dashboard(selected, date_from, date_to))

# ── Static (React build) ──────────────────────────────────────────────────────

import os as _os

@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    file = f"static/{full_path}"
    if _os.path.isfile(file):
        return FileResponse(file)
    return FileResponse("static/index.html")

app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")
