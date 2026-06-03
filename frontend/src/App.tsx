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

function fmt(d: Date) { return d.toISOString().slice(0, 10) }

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "задач"
  if (m10 === 1) return "задача"
  if (m10 >= 2 && m10 <= 4) return "задачи"
  return "задач"
}

const PRESETS = [
  { label: "7 дней",    getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 7);  return { from: fmt(s), to: fmt(e) } } },
  { label: "Месяц",     getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 30); return { from: fmt(s), to: fmt(e) } } },
  { label: "Квартал",   getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 90); return { from: fmt(s), to: fmt(e) } } },
  { label: "Весь год",  getDates: () => { const e = new Date(); return { from: `${e.getFullYear()}-01-01`, to: fmt(e) } } },
  { label: "Всё время", getDates: () => ({ from: "", to: "" }) },
] as const

function initDates() {
  const e = new Date(), s = new Date()
  s.setFullYear(s.getFullYear(), 0, 1) // с начала года
  return { from: fmt(s), to: fmt(e) }
}

export default function App() {
  const [queue, setQueue] = useState<Queue>("ALL")
  const [dates, setDates] = useState(initDates)
  const [activePreset, setActivePreset] = useState("Весь год")
  const [activeReasons, setActiveReasons] = useState<Set<string> | null>(null)

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
    try { const info = await fetchSyncInfo(); setSyncInfo(info); return info }
    catch { return null }
  }, [])

  const load = useCallback(async (from = dates.from, to = dates.to) => {
    setError(null); setEmptyDb(false)
    const info = await loadSyncInfo()
    if (!info || !Object.values(info).some(v => v)) { setEmptyDb(true); setData(null); return }
    setLoading(true)
    try {
      const d = await fetchDashboard(from || undefined, to || undefined)
      setData(d)
      setActiveReasons(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [dates, loadSyncInfo])

  const doSync = useCallback((full: boolean) => {
    setSyncing(true); setSyncPct(2)
    setSyncTitle(full ? "Полная синхронизация…" : "Инкрементальный синк…")
    setSyncMsg("Подключаемся к Трекеру…")
    const es = startSync(full, (msg) => {
      if (msg.type === "progress") { setSyncTitle(msg.msg ?? ""); setSyncPct(msg.pct ?? 0) }
      else if (msg.type === "done") { es.close(); setSyncing(false); loadSyncInfo().then(() => load()) }
      else if (msg.type === "error") { es.close(); setSyncing(false); setError(msg.msg ?? "Ошибка") }
    })
    es.onerror = () => { es.close(); setSyncing(false); setError("Ошибка соединения") }
  }, [load, loadSyncInfo])

  useEffect(() => { load() }, [])

  useEffect(() => {
    const t = setInterval(() => { if (!syncing) load() }, 30 * 60 * 1000)
    return () => clearInterval(t)
  }, [syncing, load])

  // Фильтрация по очереди
  const queueTasks: BlockedTask[] = !data ? [] :
    queue === "ALL" ? data.tasks : (data.queues[queue]?.tasks ?? [])

  // Переключение причины в легенде
  const handleToggleReason = (reason: string) => {
    if (reason === "__clear__") { setActiveReasons(null); return }
    setActiveReasons(prev => {
      const next = new Set(prev ?? [])
      if (next.size === 0) {
        // первый клик — включаем только эту
        // сначала собираем все причины
        const all = new Set<string>()
        queueTasks.forEach(t => t.blockings.forEach(b => all.add(b.reason)))
        all.forEach(r => { if (r !== reason) next.add(r) })
        // инвертируем: оставляем только выбранную
        return new Set([reason])
      }
      if (next.has(reason)) {
        next.delete(reason)
        return next.size === 0 ? null : next
      } else {
        next.add(reason)
        return next
      }
    })
  }

  const totalDays = queueTasks.reduce((s, t) => s + t.totalDays, 0)
  const activeTasks = queueTasks.filter(t => t.blockings.some(b => b.isActive))
  const totalBlockings = queueTasks.reduce((s, t) => s + t.blockings.length, 0)
  const avgDays = queueTasks.length ? Math.round(totalDays / queueTasks.length) : 0

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
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Время разрешения блокировок</h1>
          <p className="text-sm text-muted-foreground mt-1">Длительность и причины блокировок по задачам трёх очередей</p>
        </div>

        {/* Фильтр по периоду */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
            {PRESETS.map(p => (
              <button key={p.label}
                onClick={() => {
                  const d = p.getDates()
                  setDates(d); setActivePreset(p.label); load(d.from, d.to)
                }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap",
                  activePreset === p.label
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-border" />

          <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 h-9">
            <span className="text-xs text-muted-foreground whitespace-nowrap">с</span>
            <input type="date" value={dates.from}
              onChange={e => { setDates(d => ({ ...d, from: e.target.value })); setActivePreset("") }}
              className="bg-transparent border-none text-sm text-foreground outline-none w-[110px] [color-scheme:light] dark:[color-scheme:dark]" />
            <span className="text-muted-foreground text-xs">—</span>
            <span className="text-xs text-muted-foreground whitespace-nowrap">по</span>
            <input type="date" value={dates.to}
              onChange={e => { setDates(d => ({ ...d, to: e.target.value })); setActivePreset("") }}
              className="bg-transparent border-none text-sm text-foreground outline-none w-[110px] [color-scheme:light] dark:[color-scheme:dark]" />
          </div>

          <Button onClick={() => load(dates.from, dates.to)} disabled={loading || syncing} size="sm">
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            Показать
          </Button>
        </div>

        <SyncBar info={syncInfo} loading={!syncInfo} />

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            ⚠️ {error}
          </div>
        )}

        {syncing && <SyncProgress title={syncTitle} msg={syncMsg} pct={syncPct} hint="Загружаем блокировки из Трекера…" />}

        {!syncing && emptyDb && (
          <div className="rounded-xl border border-border bg-card p-16 text-center">
            <div className="text-5xl mb-5">🗄️</div>
            <h2 className="text-2xl font-black tracking-tight mb-3">База данных пустая</h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
              Данные о блокировках ещё не загружены. Запустите полный синк.
            </p>
            <Button size="lg" onClick={() => doSync(true)} className="text-base h-12 px-8">
              <RotateCcw className="w-4 h-4" /> Запустить полный синк
            </Button>
          </div>
        )}

        {!syncing && !emptyDb && (
          <>
            {/* Queue tabs */}
            <div className="flex gap-3 flex-wrap">
              {QUEUES.map(q => {
                const tasks = q === "ALL" ? (data?.tasks ?? []) : (data?.queues[q]?.tasks ?? [])
                const isActive = queue === q
                return (
                  <button key={q} onClick={() => { setQueue(q); setActiveReasons(null) }}
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
                <StatCard label="Заблокированных задач" value={queueTasks.length}  sub="с хотя бы одной блокировкой" icon="🔒" color="purple" />
                <StatCard label="Активных блокировок"   value={activeTasks.length} sub="ещё не закрыты"               icon="⏳" color="rose" />
                <StatCard label="Всего блокировок"      value={totalBlockings}      sub="суммарно по задачам"           icon="🔢" color="sky" />
                <StatCard label="Среднее время"         value={`${avgDays}д`}        sub="на одну заблок. задачу"        icon="📊" color="amber" />
              </div>
            )}

            {/* Chart */}
            {loading ? (
              <Skeleton className="h-96 rounded-xl" />
            ) : data && (
              <BlockingChart
                tasks={queueTasks}
                onTaskClick={setSelectedTask}
                activeReasons={activeReasons}
                onToggleReason={handleToggleReason}
              />
            )}

            {/* Table */}
            {loading ? (
              <Skeleton className="h-96 rounded-xl" />
            ) : data && (
              <BlockingTable tasks={queueTasks} />
            )}
          </>
        )}
      </main>

      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  )
}
