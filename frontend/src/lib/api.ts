import type { DashboardData, SyncInfo, ArchDashboardData, ArchTask } from "./types"

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
