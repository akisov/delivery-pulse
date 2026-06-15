import { useState, useEffect, useCallback, useRef } from "react"
import { RefreshCw, Home, Lock, Target, Workflow, Truck, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { StatCard } from "@/components/StatCard"
import { SyncBar } from "@/components/SyncBar"
import { SyncProgress } from "@/components/SyncProgress"
import { BlockingChart } from "@/components/BlockingChart"
import { InsightInformer } from "@/components/InsightInformer"
import { SLEPage } from "@/components/SLEPage"
import { HomePage } from "@/components/HomePage"
import { FlowPage } from "@/components/FlowPage"
import { OSPPage } from "@/components/OSPPage"
import { IncidentsPage } from "@/components/IncidentsPage"
import { PageHeader } from "@/components/PageHeader"
import { BlockingTable } from "@/components/BlockingTable"
import { DowntimeChart } from "@/components/DowntimeChart"
import { BlockingDaysTrend } from "@/components/BlockingDaysTrend"
import { InsightsPanel } from "@/components/InsightsPanel"
import { TaskDetailModal } from "@/components/TaskDetailModal"
import { TaskListModal, type StatFilter } from "@/components/TaskListModal"
import { fetchDashboard, fetchSyncInfo, fetchSyncStatus, startSync } from "@/lib/api"
import type { DashboardData, SyncInfo, BlockedTask } from "@/lib/types"
import { cn } from "@/lib/utils"

const QUEUES = ["ALL", "POOLING", "DOSTAVKAPIKO", "UDOSTAVKA"] as const
type Queue = typeof QUEUES[number]

function fmt(d: Date) {
  // локальная дата YYYY-MM-DD (toISOString сдвигал бы на день в МСК)
  const m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

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
  { label: "Пр. месяц", getDates: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() - 1, 1); const e = new Date(n.getFullYear(), n.getMonth(), 0); return { from: fmt(s), to: fmt(e) } } },
  { label: "Квартал",   getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 90); return { from: fmt(s), to: fmt(e) } } },
] as const

function initDates() {
  return { from: "2026-01-01", to: fmt(new Date()) }
}

export default function App() {
  const [queue, setQueue] = useState<Queue>("ALL")
  const [dates, setDates] = useState(initDates)
  const [activePreset, setActivePreset] = useState("")
  const [activeReasons, setActiveReasons] = useState<Set<string> | null>(null)
  const [view, setView] = useState<"chart" | "table">("chart")
  const [section, setSection] = useState<"home" | "blockings" | "sle" | "flow" | "osp" | "incidents">("home")
  const [sleReloadKey, setSleReloadKey] = useState(0)  // пересбор SLE после синка

  const [data, setData] = useState<DashboardData | null>(null)
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState("")
  const [syncPct, setSyncPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [emptyDb, setEmptyDb] = useState(false)
  const [selectedTask, setSelectedTask] = useState<BlockedTask | null>(null)
  const [statModal, setStatModal] = useState<StatFilter | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadSyncInfo = useCallback(async () => {
    try {
      const info = await fetchSyncInfo()
      // убираем служебное поле __status__
      const { __status__: _, ...clean } = info as any
      setSyncInfo(clean)
      return clean
    } catch { return null }
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

  // Polling статуса синка
  const startPoll = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      try {
        const s = await fetchSyncStatus()
        setSyncMsg(s.msg)
        setSyncPct(s.pct)
        if (!s.running) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setSyncing(false)
          if (s.error) {
            setError(s.error)
          } else {
            await loadSyncInfo()
            await load()
            // после синка блокировок пересобираем анализ SLE (он зависит от блокировок).
            // refresh дешёвый: AI-разбор кэшируется по фактам, платим только за изменившееся.
            Promise.all([
              fetch("/sle-clusters?which=current&refresh=true").catch(() => {}),
              fetch("/sle-clusters?which=historical&refresh=true").catch(() => {}),
            ]).then(() => setSleReloadKey(k => k + 1))
          }
        }
      } catch {}
    }, 2000)
  }, [load, loadSyncInfo])

  const doSync = useCallback(async () => {
    setSyncing(true)
    setSyncPct(2)
    setSyncMsg("Запускаем синк…")
    setError(null)
    try {
      const res = await startSync(false)
      if (!res.ok) { setSyncing(false); setError(res.error ?? "Ошибка"); return }
      startPoll()
    } catch (e: any) {
      setSyncing(false); setError(e.message)
    }
  }, [startPoll])

  useEffect(() => { load() }, [])

  // Тихое авто-обновление данных раз в час — только за сегодня
  useEffect(() => {
    const t = setInterval(async () => {
      const today = fmt(new Date())
      try {
        const fresh = await fetchDashboard(today, today)
        setData(prev => {
          if (!prev) return fresh
          const freshKeys = new Set(fresh.tasks.map(t => t.key))
          const merged = [
            ...prev.tasks.filter(t => !freshKeys.has(t.key)),
            ...fresh.tasks,
          ].sort((a, b) => b.totalDays - a.totalDays)
          const queues = { ...prev.queues }
          for (const q of Object.keys(queues)) {
            const freshQ = fresh.queues[q]?.tasks ?? []
            const freshQKeys = new Set(freshQ.map((t: any) => t.key))
            queues[q] = { tasks: [...(queues[q]?.tasks ?? []).filter(t => !freshQKeys.has(t.key)), ...freshQ] }
          }
          return { ...prev, tasks: merged, queues }
        })
      } catch {}
    }, 60 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // Проверяем при загрузке — вдруг синк уже идёт
  useEffect(() => {
    fetchSyncStatus().then(s => {
      if (s.running) { setSyncing(true); setSyncMsg(s.msg); setSyncPct(s.pct); startPoll() }
    }).catch(() => {})
  }, [startPoll])

  const queueTasks: BlockedTask[] = !data ? [] :
    queue === "ALL" ? data.tasks : (data.queues[queue]?.tasks ?? [])

  const handleToggleReason = (reason: string) => {
    if (reason === "__clear__") { setActiveReasons(null); return }
    setActiveReasons(prev => {
      const next = new Set(prev ?? [])
      if (next.size === 0) return new Set([reason])
      if (next.has(reason)) { next.delete(reason); return next.size === 0 ? null : next }
      else { next.add(reason); return next }
    })
  }

  const totalDays = queueTasks.reduce((s, t) => s + t.totalDays, 0)
  const activeTasks = queueTasks.filter(t => t.blockings.some(b => b.isActive))
  const totalBlockings = queueTasks.reduce((s, t) => s + t.blockings.length, 0)
  const avgDays = queueTasks.length ? Math.round(totalDays / queueTasks.length) : 0

  // Дата последнего синка (минимальная из всех очередей)
  const lastSync = syncInfo
    ? Object.values(syncInfo).filter(Boolean).sort()[0] ?? null
    : null

  return (
    <div className="min-h-screen bg-background">
      {/* Topnav */}
      <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-base">📊</div>
            <div>
              <p className="text-sm font-bold leading-none">Пульс доставки</p>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Блокировки · SLE · Поток</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Кнопка синка с датой */}
            <button
              onClick={doSync}
              disabled={syncing}
              className={cn(
                "flex items-center gap-2 px-3 h-9 rounded-lg border text-xs font-semibold transition-all",
                syncing
                  ? "border-primary/40 bg-primary/10 text-primary cursor-not-allowed"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground hover:shadow-[0_2px_12px_rgba(108,99,255,0.2)]"
              )}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
              <span>{syncing ? "Синкуем…" : "Синк"}</span>
              {lastSync && !syncing && (
                <span className="text-muted-foreground/60 font-normal">· {lastSync}</span>
              )}
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto flex gap-6 px-6">
        {/* Боковое меню */}
        <aside className="hidden md:block w-52 shrink-0 py-8 sticky top-14 self-start">
          <nav className="rounded-2xl border border-border bg-card p-2 shadow-[var(--shadow-card)]">
            <p className="px-3 pt-1.5 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">Разделы</p>
            {([["home", Home, "Главная"], ["blockings", Lock, "Блокировки"], ["incidents", AlertTriangle, "Инциденты"], ["sle", Target, "Анализ SLE"], ["flow", Workflow, "Поток E2E"], ["osp", Truck, "ОСП"]] as const).map(([v, Icon, label]) => {
              const active = section === v
              return (
                <button key={v} onClick={() => setSection(v)}
                  className={cn(
                    "relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left mb-0.5",
                    active
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}>
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-primary" />}
                  <Icon className="w-4 h-4 shrink-0" /> {label}
                </button>
              )
            })}
          </nav>
        </aside>

        <main className="flex-1 min-w-0 py-8 space-y-6">
        {section === "home" ? <HomePage onGo={setSection} /> :
         section === "osp" ? <OSPPage onGo={setSection} /> :
         section === "incidents" ? <IncidentsPage /> :
         section === "flow" ? <FlowPage /> :
         section === "sle" ? <SLEPage reloadKey={sleReloadKey} /> : (
        <>
        <PageHeader icon={Lock} title="Время разрешения блокировок" info="blockings"
          subtitle="Длительность и причины блокировок по задачам трёх очередей" />

        {/* Фильтр по периоду */}
        <div className="flex items-center gap-2 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground mr-1">Период</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1">
            {PRESETS.map(p => (
              <button key={p.label}
                onClick={() => { const d = p.getDates(); setDates(d); setActivePreset(p.label); load(d.from, d.to) }}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap",
                  activePreset === p.label
                    ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                )}>
                {p.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-border" />

          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-lg px-3 h-9 focus-within:border-primary/50 focus-within:shadow-[0_0_0_2px_rgba(108,99,255,0.15)] transition-all">
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

        {syncing && <SyncProgress title="Синхронизация с Трекером…" msg={syncMsg} pct={syncPct} hint="Загружаем блокировки с даты последнего синка" />}

        {!syncing && emptyDb && (
          <div className="rounded-xl border border-border bg-card p-16 text-center">
            <div className="text-5xl mb-5">🗄️</div>
            <h2 className="text-2xl font-black tracking-tight mb-3">База данных пустая</h2>
            <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
              Данные о блокировках ещё не загружены. Нажмите Синк.
            </p>
            <Button size="lg" onClick={doSync} className="text-base h-12 px-8">
              <RefreshCw className="w-4 h-4" /> Запустить синк
            </Button>
          </div>
        )}

        {!syncing && !emptyDb && (
          <>
            <div className="flex gap-3 flex-wrap">
              {QUEUES.map(q => {
                const tasks = q === "ALL" ? (data?.tasks ?? []) : (data?.queues[q]?.tasks ?? [])
                const isActive = queue === q
                return (
                  <button key={q} onClick={() => { setQueue(q); setActiveReasons(null) }}
                    className={cn(
                      "flex flex-col text-left px-4 py-3 rounded-xl border transition-all duration-200 min-w-[140px]",
                      "hover:-translate-y-[3px] hover:scale-[1.01] active:scale-[0.98]",
                      isActive
                        ? "border-primary bg-card shadow-[0_4px_24px_rgba(108,99,255,0.35),0_0_0_1px_rgba(108,99,255,0.3)]"
                        : "border-border bg-card hover:border-primary/60 hover:shadow-[0_6px_28px_rgba(108,99,255,0.25),0_0_0_1px_rgba(108,99,255,0.15)]"
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

            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="animate-fade-in-up stagger-1"><StatCard label="Заблокированных задач" value={queueTasks.length}  sub="с хотя бы одной блокировкой" icon="🔒" color="purple" onClick={() => setStatModal("all")} /></div>
                <div className="animate-fade-in-up stagger-2"><StatCard label="Активных блокировок"   value={activeTasks.length} sub="ещё не закрыты"               icon="⏳" color="rose"   onClick={() => setStatModal("active")} /></div>
                <div className="animate-fade-in-up stagger-3"><StatCard label="Всего блокировок"      value={totalBlockings}      sub="суммарно по задачам"           icon="🔢" color="sky"    onClick={() => setStatModal("blocked")} /></div>
                <div className="animate-fade-in-up stagger-4"><StatCard label="Среднее время" value={`${avgDays}д`} sub={data.p70 ? `P70 ${data.p70}д · P85 ${data.p85}д` : "на одну заблок. задачу"} icon="📊" color="amber" onClick={() => setStatModal("avg")} /></div>
              </div>
            )}

            {/* AI-сводка по текущим фильтрам */}
            {!loading && data && (
              <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
                <InsightInformer dateFrom={dates.from} dateTo={dates.to} queue={queue} />
              </div>
            )}

            {loading ? (
              <Skeleton className="h-96 rounded-xl" />
            ) : data && (
              <div className="animate-fade-in-up" style={{ animationDelay: "0.25s" }}>
                {/* Переключатель вид */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
                    {([["chart", "📊 График"], ["table", "📋 Таблица"]] as const).map(([v, label]) => (
                      <button key={v} onClick={() => setView(v)}
                        className={cn(
                          "px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                          view === v
                            ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                        )}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {view === "chart" ? (
                  <BlockingChart
                    tasks={queueTasks}
                    onTaskClick={setSelectedTask}
                    activeReasons={activeReasons}
                    onToggleReason={handleToggleReason}
                  />
                ) : (
                  <BlockingTable tasks={queueTasks} />
                )}
              </div>
            )}

            {/* Общее время простоя по причинам */}
            {!loading && data && (
              <div className="animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
                <DowntimeChart dateFrom={dates.from} dateTo={dates.to} queue={queue} />
              </div>
            )}

            {/* Дни блокировок по месяцам — тренд */}
            {!loading && data && (
              <div className="animate-fade-in-up" style={{ animationDelay: "0.42s" }}>
                <BlockingDaysTrend queue={queue} />
              </div>
            )}

            {/* Аналитика блокировок — 5 графиков (включая этапы работы) */}
            {!loading && data && (
              <div className="animate-fade-in-up" style={{ animationDelay: "0.45s" }}>
                <InsightsPanel dateFrom={dates.from} dateTo={dates.to} queue={queue} />
              </div>
            )}
          </>
        )}
        </>
        )}
        </main>
      </div>

      <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} />
      <TaskListModal
        open={!!statModal}
        onClose={() => setStatModal(null)}
        tasks={queueTasks}
        filter={statModal ?? "all"}
      />
    </div>
  )
}
