import { useState, useEffect, useMemo } from "react"
import { Landmark } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { ArchStatCard } from "@/components/ArchStatCard"
import { FunnelChart } from "@/components/FunnelChart"
import { TimelineChart } from "@/components/TimelineChart"
import { QueueBreakdown } from "@/components/QueueBreakdown"
import { TypeBreakdown } from "@/components/TypeBreakdown"
import { TypeFilter } from "@/components/TypeFilter"
import { MonthlyChart } from "@/components/MonthlyChart"
import { CycleTrendChart } from "@/components/CycleTrendChart"
import { ArchCommitteeReport } from "@/components/ArchCommitteeReport"
import { ArchAiSummary } from "@/components/ArchAiSummary"
import { HealthStrip } from "@/components/HealthStrip"
import { InsightBar } from "@/components/InsightBar"
import { ArchTaskListModal, type ArchModalData } from "@/components/ArchTaskListModal"
import { fetchArchDashboard, fetchArchCurrent } from "@/lib/api"
import type { ArchReturnTask, ArchTask } from "@/lib/types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

// Причины возвратов из подзадач (тег + поле «Причина»), раздельно АрхКом / ТА
function ReturnReasonsCard({ tasks }: { tasks: ArchReturnTask[] }) {
  const { v1, v2, totV1, totV2, wr1, wr2 } = useMemo(() => {
    const m1 = new Map<string, number>(), m2 = new Map<string, number>()
    let t1 = 0, t2 = 0, r1 = 0, r2 = 0   // t = всего возвратов, r = возвратов С причиной
    tasks.forEach(t => {
      t1 += t.v1n || 0; t2 += t.v2n || 0
      ;(t.returns || []).forEach(r => {
        // одна подзадача = один возврат; причин может быть несколько — считаем КАЖДУЮ
        const parts = (r.reason || "").split(";").map(s => s.trim()).filter(Boolean)
        if (!parts.length) return
        if (r.kind === "v1") r1++; else r2++
        const m = r.kind === "v1" ? m1 : m2
        parts.forEach(p => m.set(p, (m.get(p) || 0) + 1))
      })
    })
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])
    return { v1: top(m1), v2: top(m2), totV1: t1, totV2: t2, wr1: r1, wr2: r2 }
  }, [tasks])
  if (!v1.length && !v2.length && totV1 === 0 && totV2 === 0) return null
  const max1 = Math.max(1, ...v1.map(x => x[1])), max2 = Math.max(1, ...v2.map(x => x[1]))
  const col = (title: string, color: string, rows: [string, number][], mx: number, tot: number, withReason: number) => {
    return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-bold mb-2" style={{ color }}>
        {title} · {tot} <span className="font-normal text-muted-foreground">возвратов</span>
        {tot > withReason && <span className="font-normal text-muted-foreground"> ({withReason} с причиной)</span>}
      </p>
      {rows.length === 0 ? <p className="text-xs text-muted-foreground">{tot > 0 ? "причины не заполнены (старые возвраты)" : "нет возвратов"}</p> : (
        <div className="space-y-1.5">
          {rows.map(([reason, n]) => (
            <div key={reason} className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-foreground truncate" title={reason}>{reason}</span>
                <span className="font-bold tabular-nums shrink-0" style={{ color }}>{n}</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary mt-0.5">
                <div className="h-full rounded-full" style={{ width: `${n / mx * 100}%`, background: color }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    )
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <h3 className="text-sm font-black text-foreground mb-1">Причины возвратов</h3>
      <p className="text-xs text-muted-foreground mb-3">Один возврат (подзадача) = 1, даже если в нём несколько причин — но каждая причина учитывается в списке отдельно. Причина есть у возвратов-подзадач (новый процесс); у старых (по истории статусов) — нет.</p>
      <div className="flex gap-6 flex-col sm:flex-row">
        {col("🔄 АрхКом", "#14b8a6", v1, max1, totV1, wr1)}
        {col("↩️ ТА", "#f43f5e", v2, max2, totV2, wr2)}
      </div>
    </div>
  )
}

const QUEUES = ["ALL", "POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"] as const
type Queue = typeof QUEUES[number]
const QUEUE_LABEL: Record<Queue, string> = {
  ALL: "Все команды", POOLING: "Курьеры X", UDOSTAVKA: "Курьеры U", DOSTAVKAPIKO: "Курьеры R",
}

function fmt(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}

function initDates() {
  const end = new Date(), start = new Date()
  start.setDate(start.getDate() - 30)
  return { from: fmt(start), to: fmt(end) }
}

// Предыдущий период такой же длины, идущий встык до текущего
function prevRange(from: string, to: string) {
  const f = new Date(from + "T00:00:00"), t = new Date(to + "T00:00:00")
  const len = Math.round((t.getTime() - f.getTime()) / 86400000) + 1
  const pt = new Date(f); pt.setDate(pt.getDate() - 1)
  const pf = new Date(pt); pf.setDate(pf.getDate() - (len - 1))
  return { from: fmt(pf), to: fmt(pt) }
}

const PRESETS = [
  { label: "7 дней",    getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 7);  return { from: fmt(s), to: fmt(e) } } },
  { label: "Месяц",     getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 30); return { from: fmt(s), to: fmt(e) } } },
  { label: "Пр. месяц", getDates: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() - 1, 1); const e = new Date(n.getFullYear(), n.getMonth(), 0); return { from: fmt(s), to: fmt(e) } } },
  { label: "Квартал",   getDates: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 90); return { from: fmt(s), to: fmt(e) } } },
] as const

interface Metrics { total: number; ok: number; pctOk: number; v1: number; v2: number; both: number; cuts: number }
// Событийная модель: «Пришло» — вошедшие в комитет в периоде; возвраты — по всем, у кого возврат в периоде.
function calcMetrics(tasks: ArchReturnTask[]): Metrics {
  const entrants = tasks.filter(t => t.entered)
  const ok = entrants.filter(t => t.total === 0).length
  return {
    total: entrants.length,
    ok,
    pctOk: entrants.length ? Math.round(ok / entrants.length * 100) : 0,
    v1: tasks.filter(t => t.v1n > 0).length,
    v2: tasks.filter(t => t.v2n > 0).length,
    both: tasks.filter(t => t.v1n > 0 && t.v2n > 0).length,
    cuts: tasks.reduce((s, t) => s + t.total, 0),
  }
}

// Клиентский пересчёт под выбранный период (как в Инцидентах): данные грузим один раз
// широким окном, а смена периода/команды/типа фильтруется на клиенте — мгновенно.
const inP = (d: string, from: string, to: string) => d >= from && d <= to
function clipToPeriod(t: ArchReturnTask, from: string, to: string): ArchReturnTask {
  const eD = t.entryDates.filter(d => inP(d, from, to))
  const v1 = t.v1Dates.filter(d => inP(d, from, to))
  const v2 = t.v2Dates.filter(d => inP(d, from, to))
  return {
    ...t, entryDates: eD, v1Dates: v1, v2Dates: v2,
    entered: eD.length > 0, entryDate: eD.length ? [...eD].sort()[0] : null,
    v1n: v1.length, v2n: v2.length, total: v1.length + v2.length,
  }
}
// Задача попадает в выборку периода, если в нём был вход или возврат (как на бэке)
function tasksInPeriod(tasks: ArchReturnTask[], from: string, to: string): ArchReturnTask[] {
  return tasks.map(t => clipToPeriod(t, from, to)).filter(t => t.entered || t.total > 0)
}

export function ArchPage() {
  const [dates, setDates] = useState(initDates)
  const [activePreset, setActivePreset] = useState("Месяц")
  const [queue, setQueue] = useState<Queue>("ALL")
  const [typeFilter, setTypeFilter] = useState("all")
  const [timeView, setTimeView] = useState<"weeks" | "months" | "cycle">("weeks")

  // окно ~6 мес — грузим один раз, дальше фильтр на клиенте. Покрывает все пресеты
  // (макс. квартал = 90д) и тренд к предыдущему равному периоду (квартал+квартал = 180д).
  const [wide] = useState(() => {
    const to = new Date(), from = new Date()
    from.setDate(from.getDate() - 190)
    return { from: fmt(from), to: fmt(to) }
  })
  const [rawTasks, setRawTasks] = useState<ArchReturnTask[] | null>(null)
  const [archTasks, setArchTasks] = useState<ArchTask[]>([])
  const [archLoading, setArchLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskModal, setTaskModal] = useState<ArchModalData | null>(null)

  useEffect(() => {
    setLoading(true); setError(null)
    fetchArchDashboard(wide.from, wide.to)
      .then(d => setRawTasks(d.tasks))
      .catch((e: any) => { setError(e.message); toast.error("Не удалось загрузить арх. комитет", { description: e.message }) })
      .finally(() => setLoading(false))
    setArchLoading(true)
    fetchArchCurrent().then(setArchTasks).catch(() => {}).finally(() => setArchLoading(false))
  }, [wide])

  // выборка под выбранный период + предыдущий равный период (для трендов) — на клиенте
  const periodTasks = useMemo(
    () => rawTasks ? tasksInPeriod(rawTasks, dates.from, dates.to) : [],
    [rawTasks, dates])
  const prevTasks = useMemo(() => {
    if (!rawTasks) return null
    const pr = prevRange(dates.from, dates.to)
    return tasksInPeriod(rawTasks, pr.from, pr.to)
  }, [rawTasks, dates])

  const viewByQueue = queue === "ALL" ? periodTasks : periodTasks.filter(t => t.queue === queue)
  const view = typeFilter === "all" ? viewByQueue : viewByQueue.filter(t => t.issueType === typeFilter)

  const typeCounts = { all: viewByQueue.length } as Record<string, number>
  for (const t of viewByQueue) typeCounts[t.issueType] = (typeCounts[t.issueType] ?? 0) + 1

  const m = calcMetrics(view)
  const total = m.total

  const prevView = !prevTasks ? null : (() => {
    const byQ = queue === "ALL" ? prevTasks : prevTasks.filter(t => t.queue === queue)
    return typeFilter === "all" ? byQ : byQ.filter(t => t.issueType === typeFilter)
  })()
  const pm = prevView ? calcMetrics(prevView) : null
  const dlt = (cur: number, prev: number | undefined) => prev === undefined ? undefined : cur - prev
  const pmReliable = !!prevView && prevView.filter(t => t.entered).length >= 5

  const archView = archTasks
    .filter(t => queue === "ALL" || t.queue === queue)
    .filter(t => typeFilter === "all" || t.issueType === typeFilter)

  const ready = !loading && rawTasks !== null
  const empty = ready && periodTasks.length === 0

  return (
    <>
      <PageHeader icon={Landmark} title="Возвраты в Арх. комитете" info="arch"
        subtitle="Прохождение арх. комитета и возвраты (АрхКом · ТА) по трём очередям" />

      {/* Команда + период — один блок (как в ОСП/Инцидентах) */}
      <div className="flex items-center gap-4 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {QUEUES.map(q => {
              const all = q === "ALL" ? periodTasks : periodTasks.filter(t => t.queue === q)
              const count = all.filter(t => t.entered).length
              const isActive = queue === q
              return (
                <button key={q} onClick={() => { setQueue(q); setTypeFilter("all") }}
                  className={cn("inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap",
                    isActive ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                  {QUEUE_LABEL[q]}
                  {ready && <span className={cn("text-xs", isActive ? "opacity-80" : "opacity-60")}>{count}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">Период</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1">
            {PRESETS.map(p => (
              <button key={p.label}
                onClick={() => { setDates(p.getDates()); setActivePreset(p.label) }}
                className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap",
                  activePreset === p.label ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-lg px-3 h-9 focus-within:border-primary/50 focus-within:shadow-[0_0_0_2px_rgba(108,99,255,0.15)] transition-all">
            <input type="date" value={dates.from}
              onChange={e => { setDates(d => ({ ...d, from: e.target.value })); setActivePreset("") }}
              className="bg-transparent border-none text-sm text-foreground outline-none w-[104px] [color-scheme:light] dark:[color-scheme:dark]" />
            <span className="text-muted-foreground text-xs">—</span>
            <input type="date" value={dates.to}
              onChange={e => { setDates(d => ({ ...d, to: e.target.value })); setActivePreset("") }}
              className="bg-transparent border-none text-sm text-foreground outline-none w-[104px] [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          ⚠️ {error}
        </div>
      )}

      {empty && (
        <div className="rounded-xl border border-border bg-card p-16 text-center">
          <div className="text-5xl mb-5">🏛</div>
          <h2 className="text-2xl font-black tracking-tight mb-3">Нет данных за период</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            За выбранный период событий комитета нет — попробуйте расширить период. Если арх. комитет
            ещё ни разу не синхронизировался — нажмите <b>Синк</b> в шапке.
          </p>
        </div>
      )}

      {!empty && (
        <>
          {/* Тип задачи */}
          {ready && <TypeFilter active={typeFilter} counts={typeCounts} onChange={setTypeFilter} />}

          {/* Карточки */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
            </div>
          ) : ready && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 items-stretch">
              <div className="animate-fade-in-up stagger-1 h-full"><ArchStatCard label="Пришло в АрхКом" value={total}      sub="за период"             icon="📋" color="purple" delta={dlt(m.total, pm?.total)} onClick={() => setTaskModal({ title: "Пришло в АрхКом за период", tasks: view.filter(t => t.entered) })} /></div>
              <div className="animate-fade-in-up stagger-1 h-full"><ArchStatCard label="С первого раза"  value={`${m.pctOk}%`} sub={`${m.ok} без возвратов`}  icon="🎯" color="teal" delta={pmReliable ? dlt(m.pctOk, pm?.pctOk) : undefined} deltaSuffix="%" onClick={() => setTaskModal({ title: "Прошли с первого раза", tasks: view.filter(t => t.entered && t.total === 0) })} /></div>
              <div className="animate-fade-in-up stagger-2 h-full"><ArchStatCard label="АрхКом"          value={m.v1}      sub="на ревью аналитики"    icon="🔄" color="teal" delta={dlt(m.v1, pm?.v1)} invert onClick={() => setTaskModal({ title: "Вернул АрхКом", tasks: view.filter(t => t.v1n > 0) })} /></div>
              <div className="animate-fade-in-up stagger-3 h-full"><ArchStatCard label="ТА"              value={m.v2}      sub="вернули на уточнение"  icon="↩️" color="rose" delta={dlt(m.v2, pm?.v2)} invert onClick={() => setTaskModal({ title: "Вернул ТА", tasks: view.filter(t => t.v2n > 0) })} /></div>
              <div className="animate-fade-in-up stagger-4 h-full"><ArchStatCard label="Оба типа"        value={m.both}    sub="вернули и АрхКом, и ТА" icon="⚡" color="amber" delta={dlt(m.both, pm?.both)} invert onClick={() => setTaskModal({ title: "Вернули и АрхКом, и ТА", tasks: view.filter(t => t.v1n > 0 && t.v2n > 0) })} /></div>
              <div className="animate-fade-in-up stagger-5 h-full"><ArchStatCard label="Всего возвратов" value={m.cuts}    sub="суммарно переходов"    icon="🔁" color="sky" delta={dlt(m.cuts, pm?.cuts)} invert onClick={() => setTaskModal({ title: "Задачи с возвратами", tasks: view.filter(t => t.total > 0) })} /></div>
            </div>
          )}

          {/* AI-итоги */}
          {ready && (
            <div className="animate-fade-in-up" style={{ animationDelay: "0.08s" }}>
              <ArchAiSummary dateFrom={dates.from} dateTo={dates.to}
                queues={queue === "ALL" ? "POOLING,DOSTAVKAPIKO,UDOSTAVKA" : queue} />
            </div>
          )}

          {/* Инсайт + слим-строка */}
          {ready && (
            <div className="space-y-3 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
              <InsightBar tasks={view} prevTasks={prevView} />
              <HealthStrip tasks={view} stuck={archView.filter(t => t.daysInStatus >= 7).length} onShowTasks={setTaskModal} />
            </div>
          )}

          {/* Сейчас в Арх. комитете */}
          {loading ? <Skeleton className="h-64 rounded-xl" /> : ready && (
            <div className="animate-fade-in-up" style={{ animationDelay: "0.15s" }}>
              <ArchCommitteeReport tasks={archView} loading={archLoading} />
            </div>
          )}

          {/* Funnel + Returns */}
          {loading ? <Skeleton className="h-72 rounded-xl" /> : ready && (
            <div className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
              <FunnelChart tasks={view} onShowTasks={setTaskModal} />
            </div>
          )}

          {/* Причины возвратов (из подзадач) */}
          {ready && (
            <div className="animate-fade-in-up" style={{ animationDelay: "0.22s" }}>
              <ReturnReasonsCard tasks={view} />
            </div>
          )}

          {/* Динамика */}
          {loading ? <Skeleton className="h-72 rounded-xl" /> : ready && (
            <div className="space-y-3 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
              <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 w-fit">
                {([
                  ["weeks", "📈 По неделям"],
                  ["months", "📊 По месяцам"],
                  ["cycle", "⏱ Время прохождения"],
                ] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTimeView(k)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap",
                      timeView === k
                        ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                        : "text-muted-foreground hover:text-foreground hover:bg-card"
                    )}>
                    {label}
                  </button>
                ))}
              </div>
              {timeView === "weeks" && <TimelineChart tasks={view} dateFrom={dates.from} dateTo={dates.to} onShowTasks={setTaskModal} />}
              {timeView === "months" && <MonthlyChart tasks={view} onShowTasks={setTaskModal} />}
              {timeView === "cycle" && <CycleTrendChart tasks={view} onShowTasks={setTaskModal} />}
            </div>
          )}

          {/* Разбивки: по очередям + качество по типам (donut убрал — дублировал воронку) */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" />
            </div>
          ) : ready && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
              <QueueBreakdown tasks={view} onShowTasks={setTaskModal} />
              <TypeBreakdown tasks={view} onShowTasks={setTaskModal} />
            </div>
          )}
        </>
      )}

      <ArchTaskListModal open={!!taskModal} onClose={() => setTaskModal(null)} data={taskModal} />
    </>
  )
}
