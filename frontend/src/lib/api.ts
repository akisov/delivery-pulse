import type { DashboardData, SyncInfo, ArchDashboardData, ArchTask, Sprint, SprintPlanFact } from "./types"

export async function fetchDashboard(dateFrom?: string, dateTo?: string): Promise<DashboardData> {
  const params = new URLSearchParams()
  if (dateFrom) params.set("date_from", dateFrom)
  if (dateTo)   params.set("date_to", dateTo)
  const r = await fetch(`/data?${params}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  if (d.error) throw new Error(d.error)
  return d
}

export async function fetchSyncInfo(): Promise<SyncInfo> {
  const r = await fetch("/sync-info")
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function startSync(full: boolean): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`/sync?full=${full}`, { method: "POST" })
  return r.json()
}

export async function fetchSyncStatus(): Promise<{ running: boolean; pct: number; msg: string; error: string }> {
  const r = await fetch("/sync-status")
  return r.json()
}

// ── Арх. комитет (возвраты) ────────────────────────────────────────────────────
export async function fetchArchDashboard(dateFrom: string, dateTo: string): Promise<ArchDashboardData> {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
  const r = await fetch(`/arch-data?${params}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  if (d.error) throw new Error(d.error)
  return d
}

export async function fetchArchCurrent(queues?: string): Promise<ArchTask[]> {
  const q = queues ? `?queues=${queues}` : ""
  const r = await fetch(`/arch-current${q}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ── Оценка (план-факт спринта) ─────────────────────────────────────────────────
async function jpost(url: string, body?: any) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}

export async function fetchSprints(team = "U"): Promise<Sprint[]> {
  const r = await fetch(`/sprints?team=${team}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()).sprints
}
export const createSprint = (b: { team: string; name: string; date_from: string; date_to: string }) =>
  jpost("/sprints", b).then(d => d.id as number)
export const deleteSprint = (id: number) => fetch(`/sprints/${id}`, { method: "DELETE" })
export const addSprintTask = (id: number, key: string) => jpost(`/sprints/${id}/task`, { key })
export const removeSprintTask = (id: number, key: string) => fetch(`/sprints/${id}/task/${key}`, { method: "DELETE" })
export const setSprintPlan = (id: number, task_key: string, role: string, sp: number) =>
  jpost(`/sprints/${id}/plan`, { task_key, role, sp })
export const finalizeSprint = (id: number) => jpost(`/sprints/${id}/finalize`)
export const reopenSprint = (id: number) => jpost(`/sprints/${id}/reopen`)
export async function fetchPlanFact(id: number): Promise<SprintPlanFact> {
  const r = await fetch(`/sprints/${id}/plan-fact`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || "Ошибка")
  return d
}
