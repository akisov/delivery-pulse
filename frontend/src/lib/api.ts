import type { DashboardData, SyncInfo, ArchDashboardData, ArchTask, Sprint, SprintPlanFact, FeatureRefs, FeatureAnalysis, FeatureCategory, WorklogStacks, FeatureRefInfo, FlowTeamData, FlowSyncStatus, SlackersData } from "./types"

export async function fetchFlowTeam(team: string): Promise<FlowTeamData> {
  const r = await fetch(`/flow-teams?team=${encodeURIComponent(team)}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
export async function startFlowSync(full = false): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`/flow-teams/sync${full ? "?full=true" : ""}`, { method: "POST" })
  return r.json()
}
export async function fetchFlowSyncStatus(): Promise<FlowSyncStatus> {
  const r = await fetch("/flow-teams/sync-status")
  return r.json()
}
export async function fetchSlackers(refresh = false): Promise<SlackersData> {
  const r = await fetch(`/slackers${refresh ? "?refresh=true" : ""}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
export async function setSlackerLeave(body: { id: string; on: boolean; name?: string; team?: string; label?: string; kind?: string }): Promise<void> {
  const r = await fetch("/slackers/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`)
}

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
export const createSprint = (b: { team: string; name: string; date_from: string; date_to: string; carry_from?: number | null }) =>
  jpost("/sprints", b).then(d => ({ id: d.id as number, carried: (d.carried as number) || 0 }))
export const deleteSprint = (id: number) => fetch(`/sprints/${id}`, { method: "DELETE" })
export const addSprintTask = (id: number, key: string) => jpost(`/sprints/${id}/task`, { key })
export const removeSprintTask = (id: number, key: string) => fetch(`/sprints/${id}/task/${key}`, { method: "DELETE" })
export const setSprintPlan = (id: number, task_key: string, role: string, sp: number) =>
  jpost(`/sprints/${id}/plan`, { task_key, role, sp })
export const setSprintCapacity = (id: number, role: string, capacity: number) =>
  jpost(`/sprints/${id}/capacity`, { role, capacity })
export const setSprintOrder = (id: number, keys: string[]) =>
  jpost(`/sprints/${id}/order`, { keys })

// ── Оценка новых возможностей ──────────────────────────────────────────────────
export async function fetchFeatureRefs(refresh = false): Promise<FeatureRefs> {
  const r = await fetch(`/est/references${refresh ? "?refresh=true" : ""}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
export async function analyzeFeature(body: { text?: string; key?: string }): Promise<FeatureAnalysis> {
  const r = await fetch("/est/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}
export async function fetchWorklogStacks(refresh = false): Promise<WorklogStacks> {
  const r = await fetch(`/est/worklog-stacks${refresh ? "?refresh=true" : ""}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
export async function fetchFeatureSettings(): Promise<FeatureCategory[]> {
  const r = await fetch("/est/settings")
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()).categories
}
export async function saveFeatureSettings(categories: FeatureCategory[]): Promise<void> {
  const r = await fetch("/est/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories }) })
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || "Ошибка")
}
export async function addFeatureComment(key: string, text: string): Promise<string> {
  const r = await fetch("/est/comment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, text }) })
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || "Ошибка")
  return d.url
}
export async function setFeatureEffort(key: string, effort: number): Promise<{ effort: number; category: string | null; jobCategory: string | null }> {
  const r = await fetch("/est/set-effort", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, effort }) })
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || "Ошибка")
  return { effort: d.effort, category: d.category ?? null, jobCategory: d.jobCategory ?? null }
}
export async function fetchRefInfo(keys: string[]): Promise<FeatureRefInfo[]> {
  const r = await fetch(`/est/ref-info?keys=${encodeURIComponent(keys.join(","))}`)
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d.items
}
export const finalizeSprint = (id: number) => jpost(`/sprints/${id}/finalize`)
export const reopenSprint = (id: number) => jpost(`/sprints/${id}/reopen`)
export async function fetchPlanFact(id: number): Promise<SprintPlanFact> {
  const r = await fetch(`/sprints/${id}/plan-fact`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const d = await r.json()
  if (!d.ok) throw new Error(d.error || "Ошибка")
  return d
}
