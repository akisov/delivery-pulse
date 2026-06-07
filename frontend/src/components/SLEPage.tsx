import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Cell, LabelList, ResponsiveContainer, Tooltip,
} from "recharts"
import { ExternalLink, RefreshCw, ChevronDown, ChevronUp, EyeOff, X, Check, Lock, Unlock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const CLUSTER_ORDER = [
  "Внешние зависимости", "Крупная задача / не MMF", "Техническая блокировка", "Ошибка оценки",
]
const CLUSTER_COLORS: Record<string, string> = {
  "Внешние зависимости":      "#3B82F6",
  "Крупная задача / не MMF":  "#8B5CF6",
  "Техническая блокировка":   "#EF4444",
  "Ошибка оценки":            "#EAB308",
}
function clusterColor(c?: string | null) { return (c && CLUSTER_COLORS[c]) || "#94A3B8" }

const RISK_ORDER = ["нарушен", "высокий", "умеренный", "низкий"]
const RISK_COLOR: Record<string, string> = { "нарушен": "#EF4444", "высокий": "#F97316", "умеренный": "#EAB308", "низкий": "#10B981" }
function riskKey(r: string) {
  const s = (r || "").toLowerCase()
  return RISK_ORDER.find(k => s.includes(k.slice(0, 5))) || "низкий"
}
function riskRank(r: string) { return RISK_ORDER.indexOf(riskKey(r)) }

interface Sub { key: string; summary: string; queue: string; status: string; isActive: boolean; url: string; blockings: { reason: string; status?: string }[] }
interface SleTask {
  key: string; summary: string; url: string; assignee: string; status: string
  sleRisk: string; sle: number | null; p70: number | null; effort: number | null
  jobCategory: string | null; deadline: string | null; daysInWork: number | null
  subCount: number; activeSubCount: number; hiddenBlocked: boolean
  subtasks: Sub[]; cluster: string | null; clusterReason: string | null
  aiCluster?: string | null; overridden?: boolean; source?: string
  riskSignals?: string[]; needsAttention?: boolean
  blockedDetails?: { key: string; url: string; reason: string }[]
}

// Цветной дропдаун выбора кластера
function ClusterSelect({ value, options, onPick }: { value: string | null; options: string[]; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold text-white shadow-sm transition-transform hover:scale-[1.03]"
        style={{ background: clusterColor(value) }} title="Изменить кластер">
        {value || "—"} <ChevronDown className="w-3 h-3 opacity-80" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-60 rounded-xl border border-border bg-card p-1 shadow-2xl">
            {options.map(o => (
              <button key={o} onClick={() => { onPick(o); setOpen(false) }}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left text-foreground hover:bg-secondary transition-colors">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: clusterColor(o) }} />
                <span className="flex-1">{o}</span>
                {value === o && <Check className="w-3.5 h-3.5 text-primary" />}
              </button>
            ))}
            <div className="my-1 h-px bg-border" />
            <button onClick={() => { onPick(""); setOpen(false) }}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left text-muted-foreground hover:bg-secondary transition-colors">
              <RefreshCw className="w-3 h-3" /> Сбросить к AI
            </button>
          </div>
        </>
      )}
    </div>
  )
}
interface Resp {
  ok: boolean; error?: string; which: string; count: number
  clusters: { label: string; key: string; count: number }[]
  clusterOptions: string[]; tasks: SleTask[]; attention?: number; updatedAt?: string
}

function riskCounts(tasks: { sleRisk: string }[]) {
  const c: Record<string, number> = { "нарушен": 0, "высокий": 0, "умеренный": 0, "низкий": 0 }
  tasks.forEach(t => { c[riskKey(t.sleRisk)]++ })
  return RISK_ORDER.map(k => ({ key: k, name: k, count: c[k], fill: RISK_COLOR[k] }))
}

function RiskChart({ title, sub, tasks }: { title: string; sub: string; tasks: { sleRisk: string }[] }) {
  const data = riskCounts(tasks)
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <span className="text-xs text-muted-foreground">{tasks.length} задач</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }} barSize={20}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map(d => <Cell key={d.key} fill={d.fill} />)}
              <LabelList dataKey="count" position="right" style={{ fontSize: 12, fontWeight: 800, fill: "hsl(var(--foreground))" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function TaskCard({ t, options, onOverride }: { t: SleTask; options: string[]; onOverride: (key: string, cluster: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <div className="flex items-start gap-3">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: RISK_COLOR[riskKey(t.sleRisk)] }} title={t.sleRisk} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
              {t.key} <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-[11px] font-semibold" style={{ color: RISK_COLOR[riskKey(t.sleRisk)] }}>{t.sleRisk}</span>
            {t.daysInWork != null && (
              <span className="inline-flex items-center rounded-md px-1.5 py-px text-[10px] font-bold text-white"
                style={{ background: RISK_COLOR[riskKey(t.sleRisk)] }}
                title="Дней в работе / допустимый порог SLE (P85)">
                в работе {t.daysInWork}{t.sle != null ? `/${t.sle}` : ""} дн.
              </span>
            )}
            {t.hiddenBlocked && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-500" title="Есть подзадачи, но активных нет — работа не спланирована">
                <EyeOff className="w-3 h-3" /> скрытая блокировка
              </span>
            )}
          </div>
          <p className="text-sm text-foreground mt-1 leading-snug">{t.summary}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            👤 {t.assignee} · подзадач {t.subCount} (активных {t.activeSubCount})
          </p>

          <div className="mt-2 flex items-start gap-2 flex-wrap">
            <ClusterSelect value={t.cluster} options={options} onPick={c => onOverride(t.key, c)} />
            {t.source === "override" && <span className="text-[10px] text-muted-foreground self-center">правка вручную{t.aiCluster ? ` (AI: ${t.aiCluster})` : ""}</span>}
            {t.source === "seed" && <span className="text-[10px] text-emerald-500 self-center">ручная разметка</span>}
          </div>
          {t.clusterReason && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{t.clusterReason}</p>}

          {t.riskSignals && t.riskSignals.length > 0 && (
            <div className="mt-2 flex flex-col gap-1">
              {t.riskSignals.map((s, i) => (
                <span key={i} className="inline-flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                  <span className="shrink-0">⚠️</span>{s}
                </span>
              ))}
            </div>
          )}

          {t.subtasks.length > 0 && (
            <>
              <button onClick={() => setOpen(o => !o)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                подзадачи ({t.subtasks.length})
              </button>
              {open && (
                <div className="mt-1.5 space-y-1">
                  {t.subtasks.map(s => (
                    <div key={s.key} className="flex items-center gap-2 text-[11px] rounded-md bg-secondary/40 px-2 py-1">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.isActive ? "bg-destructive" : "bg-emerald-400")} />
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">{s.key}</a>
                      <span className="text-muted-foreground">{s.queue}</span>
                      <span className="text-muted-foreground/70 truncate flex-1">{s.summary}</span>
                      <span className="text-muted-foreground shrink-0">{s.status}</span>
                      {(() => {
                        const openB = s.blockings.filter(b => (b.status || "") !== "closed")
                        const closedB = s.blockings.filter(b => (b.status || "") === "closed")
                        return (
                          <>
                            {openB.length > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-destructive shrink-0" title={"Открытый блок: " + openB.map(b => b.reason).join(", ")}>
                                <Lock className="w-3 h-3" />{openB.length}
                              </span>
                            )}
                            {closedB.length > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-emerald-500 shrink-0" title={"Снятый блок: " + closedB.map(b => b.reason).join(", ")}>
                                <Unlock className="w-3 h-3" />{closedB.length}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function SLEPage() {
  const [which, setWhich] = useState<"current" | "historical">("current")
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<"cluster" | "risk">("cluster")

  // быстрые данные по риску для обоих разрезов (без ИИ)
  const [riskCur, setRiskCur] = useState<{ sleRisk: string }[] | null>(null)
  const [riskHist, setRiskHist] = useState<{ sleRisk: string }[] | null>(null)

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/sle-clusters?which=${which}${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json())
      .then((d: Resp) => { if (d.ok) setData(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [which])

  useEffect(() => {
    const get = (w: string) => fetch(`/sle-analysis?which=${w}`).then(r => r.json()).then(d => d.ok ? d.tasks : []).catch(() => [])
    get("current").then(setRiskCur)
    get("historical").then(setRiskHist)
  }, [])

  const overrideCluster = async (key: string, cluster: string) => {
    setData(prev => prev ? { ...prev, tasks: prev.tasks.map(t => t.key === key ? { ...t, cluster: cluster || t.aiCluster || t.cluster, overridden: !!cluster } : t) } : prev)
    await fetch(`/sle-override?key=${encodeURIComponent(key)}&cluster=${encodeURIComponent(cluster)}`, { method: "POST" }).catch(() => {})
    load()
  }

  const grouped = useMemo(() => {
    if (!data) return []
    const tasks = data.tasks.filter(t => !filter || t.cluster === filter)
    const g: Record<string, SleTask[]> = {}
    const byRisk = (a: SleTask, b: SleTask) => riskRank(a.sleRisk) - riskRank(b.sleRisk)
    if (groupBy === "risk") {
      tasks.forEach(t => { const k = riskKey(t.sleRisk); (g[k] ||= []).push(t) })
      return RISK_ORDER.filter(k => g[k]?.length).map(k => ({
        key: k, label: k, color: RISK_COLOR[k], tasks: g[k].sort(byRisk),
      }))
    }
    tasks.forEach(t => { const k = t.cluster || "—"; (g[k] ||= []).push(t) })
    return CLUSTER_ORDER.filter(c => g[c]?.length).map(c => ({
      key: c, label: c, color: clusterColor(c), tasks: g[c].sort(byRisk),
    }))
  }, [data, groupBy, filter])

  const attentionTasks = useMemo(
    () => data ? data.tasks.filter(t => t.needsAttention).sort((a, b) => riskRank(a.sleRisk) - riskRank(b.sleRisk)) : [],
    [data]
  )
  const maxCluster = Math.max(1, ...(data?.clusters.map(c => c.count) ?? [1]))
  const clusterChartData = (data?.clusters ?? []).map(c => ({ ...c, fill: clusterColor(c.label) }))

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Анализ нарушений SLE</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Очередь PUTKURERA · кластеризация причин (ИИ + правка вручную)
            {data?.updatedAt && <span className="ml-1">· обновлено: {data.updatedAt}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
            {([["current", "Текущая"], ["historical", "История"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => { setWhich(v); setFilter(null) }}
                className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                  which === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => load(true)} disabled={loading} title="Пересчитать (заново через ИИ)"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Риск: история + в работе */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {riskHist ? <RiskChart title="📉 Попадание в SLE (история)" sub="Завершённые задачи по уровню риска SLE" tasks={riskHist} /> : <Skeleton className="h-56 rounded-xl" />}
        {riskCur ? <RiskChart title="⚡ Риск по SLE (в работе)" sub="Задачи в работе по уровню риска SLE" tasks={riskCur} /> : <Skeleton className="h-56 rounded-xl" />}
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {/* Требуют внимания — самый заметный блок */}
      {data && attentionTasks.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/[0.06] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(245,158,11,0.18)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-600 dark:text-amber-400">
              ⚠️ Требуют внимания — {attentionTasks.length}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Задачи с риском SLE (умеренный+), где висит блок в подзадаче или работа не спланирована
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {attentionTasks.map(t => (
              <div key={t.key} className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-card px-3 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-[0_6px_20px_rgba(245,158,11,0.15)]">
                <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: RISK_COLOR[riskKey(t.sleRisk)] }} title={t.sleRisk} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {t.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-[11px] font-semibold" style={{ color: RISK_COLOR[riskKey(t.sleRisk)] }}>{t.sleRisk}</span>
                    <span className="text-xs text-muted-foreground truncate">{t.summary}</span>
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {(t.blockedDetails || []).map((b, i) => (
                      <span key={i} className="text-[11px] text-amber-600 dark:text-amber-400">
                        🔒 Блок в{" "}
                        <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">{b.key}</a>
                        : {b.reason}
                      </span>
                    ))}
                    {(t.riskSignals || []).filter(s => !s.startsWith("Блок висит")).map((s, i) => (
                      <span key={i} className="text-[11px] text-amber-600 dark:text-amber-400">→ {s}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">ИИ кластеризует причины… (может занять ~полминуты при первой загрузке)</div>
          <Skeleton className="h-40 rounded-xl" />
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : data && (
        <>
          {/* Кластеры — кликабельный график */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>🧩 Причины нарушения SLE — {which === "current" ? "в работе" : "история"}</CardTitle>
                <span className="text-xs text-muted-foreground">{data.count} задач · нажми на кластер</span>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(160, clusterChartData.length * 44 + 24)}>
                <BarChart data={clusterChartData} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }} barSize={24}>
                  <XAxis type="number" hide domain={[0, maxCluster]} />
                  <YAxis type="category" dataKey="label" width={180} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                    content={({ active, payload }: any) => active && payload?.length
                      ? <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-xl"><b>{payload[0].payload.label}</b>: {payload[0].value} задач · нажми для списка</div> : null} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }}
                    onClick={(d: any) => setFilter(f => f === d.label ? null : d.label)}>
                    {clusterChartData.map(d => (
                      <Cell key={d.label} fill={d.fill} fillOpacity={filter && filter !== d.label ? 0.35 : 1} />
                    ))}
                    <LabelList dataKey="count" position="right" style={{ fontSize: 12, fontWeight: 800, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {filter && (
                <button onClick={() => setFilter(null)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <X className="w-3 h-3" /> Сбросить фильтр: {filter}
                </button>
              )}
            </CardContent>
          </Card>

          {/* Список задач с переключателем группировки */}
          <div className="flex items-end justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-black tracking-tight text-foreground mb-1">
                Задачи — {which === "current" ? "в работе" : "завершённые (история)"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {data.count} задач с риском SLE. Кластер можно поправить вручную.
              </p>
            </div>
            <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
              {([["cluster", "По причинам"], ["risk", "По риску SLE"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setGroupBy(v)}
                  className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                    groupBy === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-5">
            {grouped.map(g => (
              <div key={g.key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: g.color }} />
                  <h3 className="text-sm font-black text-foreground">{g.label}</h3>
                  <span className="text-xs text-muted-foreground">{g.tasks.length}</span>
                </div>
                <div className="space-y-2.5">
                  {g.tasks.map(t => <TaskCard key={t.key} t={t} options={data.clusterOptions} onOverride={overrideCluster} />)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
