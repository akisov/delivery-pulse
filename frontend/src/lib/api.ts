import type { DashboardData, SyncInfo } from "./types"

export async function fetchDashboard(): Promise<DashboardData> {
  const r = await fetch(`/data`)
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

export function startSync(full: boolean, onMessage: (msg: { type: string; msg?: string; pct?: number }) => void): EventSource {
  const es = new EventSource(`/sync?full=${full}`)
  es.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)) } catch {}
  }
  return es
}
