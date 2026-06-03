import { useState, useEffect, useCallback } from "react"
import { RefreshCw, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { StatCard } from "@/components/StatCard"
import { SyncBar } from "@/components/SyncBar"
import { SyncProgress } from "@/components/SyncProgress"
import { BlockingChart } from "@/components/BlockingChart"
import { BlockingTable } from "@/components/BlockingTable"
import { TaskDetailModal } from "@/components/TaskDetailModal"
import { fetchDashboard, fetchSyncInfo, startSync } from "@/lib/api"
import type { DashboardData, SyncInfo, BlockedTask } from "@/lib/types"
import { cn } from "@/lib/utils"

const QUEUES = ["ALL", "POOLING", "DOSTAVKAPIKO", "UDOSTAVKA"] as const
type Queue = typeof QUEUES[number]

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "задач"
  if (m10 === 1) return "задача"
  if (m10 >= 2 && m10 <= 4) return "задачи"
  return "задач"
}

export default function App() {
  const [queue, setQueue] = useState<Queue>("ALL")
  const [data, setData] = useState<DashboardData | null>(null)
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncTitle, setSyncTitle] = useState("")
  const [syncMsg, setSyncMsg] = useState("")
  const [syncPct, setSyncPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [emptyDb, setEmptyDb] = useState(false)
  const [selectedTask, setSelectedTask] = useState<BlockedTask | null>(null)

  const loadSyncInfo = useCallback(async () => {
    try {
      const info = await fetchSyncInfo()
      setSyncInfo(info)
      return info
    } catch { return null }
  }, [])

  const load = useCallback(async () => {
    setError(null)
    setEmptyDb(false)
    const info = await loadSyncInfo()
    const hasDb = info && Object.values(info).some(v => v)
    if (!hasDb) { setEmptyDb(true); setData(null); return }
    setLoading(true)
    try {
      const d = await fetchDashboard()
      setData(d)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [loadSyncInfo])

  const doSync = useCallback((full: boolean) => {
    setSyncing(true)
    setSyncPct(2)
    setSyncTitle(full ? "Полная синхронизация…" : "Инкрементальный синк…")
    setSyncMsg("Подключаемся к Трекеру…")
    const es = startSync(full, (msg: { type: string; msg?: string; pct?: number }) => {
      if (msg.type === "progress") { setSyncTitle(msg.msg ?? ""); setSyncPct(msg.pct ?? 0) }
      else if (msg.type === "done") {
        es.close(); setSyncing(false)
        loadSyncInfo().then(() => load())
      } else if (msg.type === "error") {
        es.close(); setSyncing(false)
        setError(msg.msg ?? "Ошибка синхронизации")
      }
    })
    es.onerror = () => { es.close(); setSyncing(false); setError("Ошибка соединения при синхронизации") }
  }, [load, loadSyncInfo])

  useEffect(() => { load() }, [])

  // Авто-обновление каждые 30 мин
  useEffect(() => {
    const interval = setInterval(() => {
      if (!syncing) load()
    }, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [syncing, load])

  const viewTasks: BlockedTask[] = !data ? [] :
    queue === "ALL" ? data.tasks : (data.queues[queue]?.tasks ?? [])

  const totalDays = viewTasks.reduce((s, t) => s + t.totalDays, 0)
  const activeTasks = viewTasks.filter(t => t.blockings.some(b => b.isActive))
  const totalBlockings = viewTasks.reduce((s, t) => s + t.blockings.length, 0)
  const avgDays = viewTasks.length ? Math.round(totalDays / viewTasks.length) : 0

  return (
    <div className="min-h-screen bg-background">
      {/* Topnav */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-base">🔒</div>
            <div>
              <p className="text-sm font-bold leading-none">Блокировки</p>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5">POOLING · DOSTAVKAPIKO · UDOSTAVKA</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => doSync(false)} disabled={syncing}>
              <RefreshCw className="w-3.5 h-3.5" /> Синк
            </Button>
            <Button variant="ghost" size="sm" disabled={syncing}
              onClick={() => { if (confirm("Полный синк перезагрузит все блокировки. Продолжить?")) doSync(true) }}>
              <RotateCcw className="w-3.5 h-3.5" /> Полный
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Время разрешения блокировок</h1>
          <p className="text-sm text-muted-foreground mt-1">Длительность и причины блокировок по задачам трёх очередей</p>
        </div>

        {/* Sync info */}
        <SyncBar info={syncInfo} loading={!syncInfo} />

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            ⚠️ {error}
          </div>
        )}

        {/* Sync progress */}
        {syncing && <SyncProgress title={syncTitle} msg={syncMsg} pct={syncPct} hint="Загружаем блокировки из Трекера…" />}

        {/* Empty DB */}
        {!syncing && emptyDb && (
          <div className="rounded-xl border border-border bg-card p-16 text-center">
            <div className="text-5xl mb-5">🗄️</div>
            <h2 className="text-2xl font-black tracking-tight mb-3">База данных пустая</h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
              Данные о блокировках ещё не загружены. Запустите полный синк — он загрузит все задачи и их подзадачи-блокировки.
            </p>
            <Button size="lg" onClick={() => doSync(true)} className="text-base h-12 px-8">
              <RotateCcw className="w-4 h-4" /> Запустить полный синк
            </Button>
            <p className="text-xs text-muted-foreground mt-4">Займёт несколько минут</p>
          </div>
        )}

        {/* Dashboard */}
        {!syncing && !emptyDb && (
          <>
            {/* Queue tabs */}
            <div className="flex gap-3 flex-wrap">
              {QUEUES.map(q => {
                const tasks = q === "ALL" ? (data?.tasks ?? []) : (data?.queues[q]?.tasks ?? [])
                const isActive = queue === q
                return (
                  <button key={q} onClick={() => setQueue(q)}
                    className={cn(
                      "flex flex-col text-left px-4 py-3 rounded-xl border transition-all duration-200 min-w-[140px]",
                      "hover:-translate-y-0.5 active:scale-[0.98]",
                      isActive
                        ? "border-primary bg-card shadow-[0_4px_20px_rgba(108,99,255,0.3)]"
                        : "border-border bg-card hover:border-primary/50 hover:shadow-[0_4px_16px_rgba(108,99,255,0.12)]"
                    )}>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      {q === "ALL" ? "Все очереди" : q}
                    </span>
                    {loading ? <Skeleton className="h-8 w-12 mb-1" /> : (
                      <div className="mb-1 flex items-baseline gap-1">
                        <span className="text-3xl font-black tracking-tighter text-primary leading-none">{tasks.length}</span>
                        <span className="text-xs text-muted-foreground">{plural(tasks.length)}</span>
                      </div>
                    )}
                    <div className="flex gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" />
                        {tasks.filter(t => t.blockings.some(b => b.isActive)).length} активн.
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        {tasks.reduce((s, t) => s + t.blockings.length, 0)} блок.
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Stat cards */}
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Заблокированных задач" value={viewTasks.length} sub="с хотя бы одной блокировкой" icon="🔒" color="purple" />
                <StatCard label="Активных блокировок"   value={activeTasks.length} sub="ещё не закрыты"              icon="⏳" color="rose" />
                <StatCard label="Всего блокировок"      value={totalBlockings}      sub="суммарно по задачам"          icon="🔢" color="sky" />
                <StatCard label="Среднее время"         value={`${avgDays}д`}        sub="на одну заблок. задачу"       icon="📊" color="amber" />
              </div>
            )}

            {/* Chart */}
            {loading ? (
              <Skeleton className="h-96 rounded-xl" />
            ) : data && (
              <BlockingChart tasks={viewTasks} onTaskClick={setSelectedTask} />
            )}

            {/* Table */}
            {loading ? (
              <Skeleton className="h-96 rounded-xl" />
            ) : data && (
              <BlockingTable tasks={viewTasks} />
            )}
          </>
        )}
      </main>

      {/* Task detail modal */}
      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  )
}
