import os
import asyncio
import httpx
from datetime import date, timedelta
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
        [queue, date.today().isoformat()]
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
        tasks_map[parent_key]["blockings"].append(blocking)
        tasks_map[parent_key]["totalDays"] += days

    tasks = sorted(tasks_map.values(), key=lambda t: t["totalDays"], reverse=True)

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

# ── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(lifespan=lifespan)

@app.get("/sync-info")
async def sync_info():
    return await get_sync_info()

@app.get("/sync")
async def sync(full: bool = Query(False), queues: str = Query("POOLING,DOSTAVKAPIKO,UDOSTAVKA")):
    selected = [q for q in queues.split(",") if q in QUEUES] or QUEUES

    async def generate():
        async def send(msg):
            yield f"data: {json.dumps(msg)}\n\n"

        async with httpx.AsyncClient(timeout=60) as client:
            for qi, queue in enumerate(selected):
                q_msgs: asyncio.Queue = asyncio.Queue()

                async def _send(m, q=q_msgs):
                    await q.put(m)

                task = asyncio.create_task(sync_queue(client, queue, _send))
                while not task.done() or not q_msgs.empty():
                    try:
                        m = q_msgs.get_nowait()
                        yield f"data: {json.dumps(m)}\n\n"
                    except asyncio.QueueEmpty:
                        await asyncio.sleep(0.1)
                await task
                while not q_msgs.empty():
                    yield f"data: {json.dumps(q_msgs.get_nowait())}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

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
