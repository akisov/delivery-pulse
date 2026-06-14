import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, Cell, LabelList, ResponsiveContainer, Tooltip,
} from "recharts"
import { ExternalLink, RefreshCw, ChevronDown, ChevronUp, EyeOff, X, Check, Lock, Unlock, Download, Users, Tags, Activity } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { SectionInfo } from "@/components/SectionInfo"
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

interface Sub { key: string; summary: string; queue: string; status: string; statusKey?: string; isActive: boolean; url: string; blockings: { reason: string; status?: string }[] }

const NOT_STARTED_KEYS = ["new", "open", "gotovoKRabote", "backlogKomandy", "produktovyjBacklog"]
function subPhase(s: Sub): { color: string; title: string } {
  if (s.statusKey === "closed") return { color: "#10B981", title: "завершена" }
  if (s.statusKey && NOT_STARTED_KEYS.includes(s.statusKey)) return { color: "#94A3B8", title: "не начата" }
  return { color: "#3B82F6", title: "в работе" }
}
// Сводка по подзадачам: завершено / в работе / не начато (с бэкенда, иначе из subtasks)
function subStats(t: { subtasks: Sub[]; doneSubCount?: number; workingSubCount?: number; notStartedSubCount?: number }) {
  if (t.doneSubCount != null)
    return { done: t.doneSubCount, work: t.workingSubCount ?? 0, todo: t.notStartedSubCount ?? 0 }
  let done = 0, work = 0, todo = 0
  for (const s of t.subtasks) {
    const ph = subPhase(s).title
    if (ph === "завершена") done++; else if (ph === "не начата") todo++; else work++
  }
  return { done, work, todo }
}
function SubBreakdown({ t }: { t: SleTask }) {
  if (!t.subCount) return <span className="text-muted-foreground/70">без подзадач</span>
  const { done, work, todo } = subStats(t)
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-muted-foreground/80">{t.subCount} подзадач</span>
      <span className="inline-flex items-center gap-1" title="завершено"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10B981" }} />{done}</span>
      <span className="inline-flex items-center gap-1" title="в работе"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#3B82F6" }} />{work}</span>
      <span className="inline-flex items-center gap-1" title="не начато"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#94A3B8" }} />{todo}</span>
    </span>
  )
}
interface SleTask {
  key: string; summary: string; url: string; assignee: string; status: string
  sleRisk: string; sle: number | null; p70: number | null; effort: number | null
  jobCategory: string | null; deadline: string | null; daysInWork: number | null; end?: string | null
  subCount: number; activeSubCount: number; hiddenBlocked: boolean
  doneSubCount?: number; workingSubCount?: number; notStartedSubCount?: number
  subtasks: Sub[]; cluster: string | null; clusterReason: string | null
  aiCluster?: string | null; overridden?: boolean; source?: string
  riskSignals?: string[]; needsAttention?: boolean; riskLevel?: string
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

// Аватар-инициалы исполнителя
function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase()
}
function avatarColor(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360}, 58%, 52%)`
}
function Avatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span className="flex items-center justify-center rounded-full font-bold text-white shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(name) }}>
      {initials(name)}
    </span>
  )
}

function AssigneeSelect({ value, options, onPick }: { value: string; options: string[]; onPick: (a: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 h-9 text-xs text-foreground max-w-[220px] hover:border-primary/50 transition-colors">
        {value ? <Avatar name={value} /> : <Users className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="truncate">{value || "Все исполнители"}</span>
        <ChevronDown className="w-3 h-3 opacity-70 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-auto rounded-xl border border-border bg-card p-1 shadow-2xl">
            <button onClick={() => { onPick(""); setOpen(false) }}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left text-foreground hover:bg-secondary transition-colors">
              <Users className="w-4 h-4 text-muted-foreground" /> <span className="flex-1">Все исполнители</span>
              {!value && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
            {options.map(a => (
              <button key={a} onClick={() => { onPick(a); setOpen(false) }}
                className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left text-foreground hover:bg-secondary transition-colors">
                <Avatar name={a} /> <span className="flex-1 truncate">{a}</span>
                {value === a && <Check className="w-3.5 h-3.5 text-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function RiskChart({ title, sub, tasks, active, onPick }: { title: string; sub: string; tasks: { sleRisk: string }[]; active?: string | null; onPick?: (k: string) => void }) {
  const data = riskCounts(tasks)
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle>{title}</CardTitle>
          <span className="text-xs text-muted-foreground">{tasks.length} задач{onPick ? " · нажми на уровень" : ""}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }} barSize={20}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 12, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} style={{ cursor: onPick ? "pointer" : "default" }}
              onClick={(d: any) => onPick?.(d.key)}>
              {data.map(d => <Cell key={d.key} fill={d.fill} fillOpacity={active && active !== d.key ? 0.35 : 1} />)}
              <LabelList dataKey="count" position="right" style={{ fontSize: 12, fontWeight: 800, fill: "hsl(var(--foreground))" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

// Модалка: задачи выбранного уровня риска SLE (по клику на столбец)
function RiskTasksModal({ riskK, which, tasks, onClose }: { riskK: string | null; which: "current" | "historical"; tasks: SleTask[]; onClose: () => void }) {
  if (!riskK) return null
  const color = RISK_COLOR[riskK]
  const list = tasks.filter(t => riskKey(t.sleRisk) === riskK)
    .sort((a, b) => (b.daysInWork ?? 0) - (a.daysInWork ?? 0))
  return (
    <Modal open={!!riskK} onClose={onClose}
      title={`Риск SLE: ${riskK}`}
      subtitle={`${which === "current" ? "В работе" : "Завершённые"} · ${list.length} задач · отсортированы по дням в работе`} wide>
      {list.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет задач</div>
      ) : (
        <div className="space-y-2">
          {list.map(t => (
            <div key={t.key} className="rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent/30 transition-colors">
              <div className="flex items-start gap-2.5">
                <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: color }} title={t.sleRisk} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {t.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    {t.daysInWork != null && (
                      <span className="inline-flex items-center rounded-md px-1.5 py-px text-[10px] font-bold text-white"
                        style={{ background: color }} title="Дней в работе / допустимый порог SLE (P85)">
                        в работе {t.daysInWork}{t.sle != null ? `/${t.sle}` : ""} дн.
                      </span>
                    )}
                    {t.cluster && (
                      <span className="inline-flex items-center rounded-md px-1.5 py-px text-[10px] font-bold text-white" style={{ background: clusterColor(t.cluster) }}>
                        {t.cluster}
                      </span>
                    )}
                    {t.hiddenBlocked && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-500" title="Есть подзадачи, но активных нет — работа не спланирована">
                        <EyeOff className="w-3 h-3" /> скрытая блокировка
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground mt-1 leading-snug">{t.summary}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <Avatar name={t.assignee} size={14} /> {t.assignee} · <SubBreakdown t={t} />
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function AttentionRow({ t }: { t: SleTask }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-card px-3 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-[0_6px_20px_rgba(245,158,11,0.15)]">
      <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: RISK_COLOR[riskKey(t.sleRisk)] }} title={t.sleRisk} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
            {t.key} <ExternalLink className="w-3 h-3" />
          </a>
          <span className="text-[11px] font-semibold" style={{ color: RISK_COLOR[riskKey(t.sleRisk)] }}>{t.sleRisk}</span>
          <span className="text-xs text-muted-foreground truncate">{t.summary}</span>
        </div>
        <div className="mt-1 flex flex-col gap-1">
          {(t.blockedDetails || []).map((b, i) => (
            <span key={i} className="text-[11px] text-amber-600 dark:text-amber-400">
              🔒 Блок в <a href={b.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">{b.key}</a>: {b.reason}
            </span>
          ))}
          {(t.riskSignals || []).filter(s => !s.startsWith("Блок висит")).map((s, i) => (
            <span key={i} className="text-[11px] text-amber-600 dark:text-amber-400">→ {s}</span>
          ))}
        </div>
      </div>
    </div>
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
          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Avatar name={t.assignee} size={14} /> {t.assignee} · <SubBreakdown t={t} />
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
                  <div className="flex items-center gap-3 px-2 pb-0.5 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#3B82F6" }} /> в работе</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#94A3B8" }} /> не начата</span>
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10B981" }} /> завершена</span>
                    <span className="flex items-center gap-1 ml-auto"><Lock className="w-3 h-3 text-destructive" /> блок открыт · <Unlock className="w-3 h-3 text-emerald-500" /> снят</span>
                  </div>
                  {t.subtasks.map(s => (
                    <div key={s.key} className="flex items-center gap-2 text-[11px] rounded-md bg-secondary/40 px-2 py-1">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: subPhase(s).color }} title={subPhase(s).title} />
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
  const [assignee, setAssignee] = useState<string>("")
  const [riskModal, setRiskModal] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/sle-clusters?which=${which}${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json())
      .then((d: Resp) => { if (d.ok) setData(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [which])

  const overrideCluster = async (key: string, cluster: string) => {
    setData(prev => prev ? { ...prev, tasks: prev.tasks.map(t => t.key === key ? { ...t, cluster: cluster || t.aiCluster || t.cluster, overridden: !!cluster } : t) } : prev)
    await fetch(`/sle-override?key=${encodeURIComponent(key)}&cluster=${encodeURIComponent(cluster)}`, { method: "POST" }).catch(() => {})
    load()
  }

  const grouped = useMemo(() => {
    if (!data) return []
    // только кластеризованные (рисковые) задачи — низкий риск и умеренный без блокеров не показываем
    const tasks = data.tasks.filter(t => t.cluster && (!filter || t.cluster === filter)
      && (!assignee || t.assignee === assignee))
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
  }, [data, groupBy, filter, assignee])

  // список исполнителей (по рисковым задачам)
  const assignees = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.tasks.filter(t => t.cluster).map(t => t.assignee).filter(Boolean))).sort()
  }, [data])

  // тренд нарушений по месяцам (история) — из даты завершения
  const trend = useMemo(() => {
    if (!data || which !== "historical") return []
    const m: Record<string, { total: number; violated: number }> = {}
    data.tasks.forEach(t => {
      const ym = (t.end || "").slice(0, 7)
      if (!ym) return
      m[ym] ||= { total: 0, violated: 0 }
      m[ym].total++
      if (riskKey(t.sleRisk) === "нарушен") m[ym].violated++
    })
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, v]) => ({ ym, rate: Math.round(v.violated / v.total * 100), violated: v.violated, total: v.total }))
  }, [data, which])

  const exportCsv = () => {
    if (!data) return
    const rows = data.tasks.filter(t => t.cluster)
    const head = ["key", "summary", "assignee", "sleRisk", "daysInWork", "sleLimit", "cluster", "source", "reason", "url"]
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`
    const csv = [head.join(",")].concat(
      rows.map(t => [t.key, t.summary, t.assignee, t.riskLevel, t.daysInWork, t.sle, t.cluster, t.source, t.clusterReason, t.url].map(esc).join(","))
    ).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `sle_${which}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const attentionTasks = useMemo(
    () => data ? data.tasks.filter(t => t.needsAttention).sort((a, b) => riskRank(a.sleRisk) - riskRank(b.sleRisk)) : [],
    [data]
  )
  const maxCluster = Math.max(1, ...(data?.clusters.map(c => c.count) ?? [1]))
  const clusterChartData = (data?.clusters ?? []).map(c => ({ ...c, fill: clusterColor(c.label) }))
  const stats = useMemo(() => {
    if (!data) return null
    const total = data.count
    const violated = data.tasks.filter(t => riskKey(t.sleRisk) === "нарушен").length
    const risky = data.tasks.filter(t => t.cluster).length
    return { total, violated, risky, attention: data.attention ?? 0 }
  }, [data])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Анализ нарушений SLE</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Очередь PUTKURERA · {which === "current" ? "риски нарушения SLE" : "причины нарушений SLE"} (ИИ + правка вручную)
            {data?.updatedAt && <span className="ml-1">· обновлено: {data.updatedAt}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SectionInfo section="sle" />
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
            {([["current", "Текущая"], ["historical", "История"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => { setWhich(v); setFilter(null); setRiskModal(null); setAssignee(""); setExpanded(false) }}
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

      {/* Сводка */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {(which === "current"
            ? [
                { label: "В работе", value: stats.total, color: "text-foreground" },
                { label: "В зоне риска", value: stats.risky, color: "text-primary" },
                { label: "Требуют действий", value: stats.attention, color: "text-amber-500" },
              ]
            : [
                { label: "Завершено", value: stats.total, color: "text-foreground" },
                { label: "Нарушено SLE", value: stats.violated, color: "text-destructive" },
                { label: "Доля нарушений", value: `${Math.round(stats.violated / Math.max(stats.total, 1) * 100)}%`, color: "text-destructive" },
              ]
          ).map(s => (
            <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={cn("text-2xl font-black tracking-tight leading-none mt-1", s.color)}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* График риска для выбранной вкладки */}
      {data ? (
        <RiskChart
          title={which === "historical" ? "📉 Попадание в SLE (история)" : "⚡ Риск по SLE (в работе)"}
          sub={which === "historical" ? "Завершённые задачи по уровню риска SLE" : "Задачи в работе по уровню риска SLE"}
          tasks={data.tasks}
          onPick={k => setRiskModal(k)}
        />
      ) : <Skeleton className="h-56 rounded-xl" />}

      {/* Тренд нарушений по месяцам (история) */}
      {which === "historical" && trend.length > 1 && (
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
          <CardHeader className="pb-1">
            <CardTitle>📈 Доля нарушений SLE по месяцам</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">% завершённых задач с нарушенным SLE (по дате завершения)</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trend} margin={{ top: 14, right: 16, left: 0, bottom: 4 }}>
                <XAxis dataKey="ym" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit="%" domain={[0, 100]} />
                <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                  content={({ active, payload }: any) => active && payload?.length
                    ? <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-xl">
                        <b>{payload[0].payload.ym}</b>: {payload[0].payload.rate}% нарушений ({payload[0].payload.violated} из {payload[0].payload.total})
                      </div> : null} />
                <Bar dataKey="rate" radius={[4, 4, 0, 0]} fill="#EF4444">
                  <LabelList dataKey="rate" position="top" formatter={(v: number) => `${v}%`}
                    style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {/* Требуют внимания — самый заметный блок */}
      {data && attentionTasks.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/[0.06] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(245,158,11,0.18)]">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-600 dark:text-amber-400">
              ⚠️ Требуют действий сейчас — {attentionTasks.length}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
Никто не работает (есть подзадачи, но ни одной в работе — все завершены или не начаты) или висит открытый блок в активной подзадаче — при любом риске SLE
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: "block", title: "🔒 Блок в подзадаче", tasks: attentionTasks.filter(t => (t.blockedDetails?.length ?? 0) > 0) },
              { key: "idle", title: "💤 Никто не работает — нет подзадач в работе", tasks: attentionTasks.filter(t => !(t.blockedDetails?.length)) },
            ].filter(s => s.tasks.length > 0).map(s => (
              <div key={s.key}>
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-1.5">{s.title} — {s.tasks.length}</p>
                <div className="space-y-2">
                  {s.tasks.map(t => <AttentionRow key={t.key} t={t} />)}
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
                <CardTitle>{which === "current" ? "🧩 Риски нарушения SLE — в работе" : "🧩 Причины нарушения SLE — история"}</CardTitle>
                <span className="text-xs text-muted-foreground">{data.tasks.filter(t => t.cluster).length} рисковых задач · нажми на кластер</span>
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
                {data.tasks.filter(t => t.cluster).length} задач {which === "current" ? "с риском нарушения SLE" : "с нарушением SLE"} (низкий риск не учитываем). Кластер можно поправить вручную.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Фильтр по исполнителю */}
              <AssigneeSelect value={assignee} options={assignees} onPick={a => { setAssignee(a); setExpanded(false) }} />
              <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
                {([["cluster", "По причинам", Tags], ["risk", "По риску SLE", Activity]] as const).map(([v, label, Icon]) => (
                  <button key={v} onClick={() => setGroupBy(v)}
                    className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                      groupBy === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
                    <Icon className="w-3.5 h-3.5" /> {label}
                  </button>
                ))}
              </div>
              <button onClick={exportCsv} title="Скачать CSV"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
            </div>
          </div>

          {/* Активные фильтры */}
          {assignee && (
            <div className="flex items-center gap-2 flex-wrap -mt-2">
              {assignee && (
                <button onClick={() => setAssignee("")} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:border-primary/50">
                  <Avatar name={assignee} size={14} /> {assignee} <X className="w-3 h-3 text-muted-foreground" />
                </button>
              )}
            </div>
          )}
          {(() => {
            const LIMIT = 6
            const totalShown = grouped.reduce((s, g) => s + g.tasks.length, 0)
            let shown = 0
            return (
              <>
                <div className="space-y-5">
                  {grouped.map(g => {
                    if (!expanded && shown >= LIMIT) return null
                    const list = expanded ? g.tasks : g.tasks.slice(0, Math.max(0, LIMIT - shown))
                    shown += list.length
                    if (!list.length) return null
                    return (
                      <div key={g.key}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: g.color }} />
                          <h3 className="text-sm font-black text-foreground">{g.label}</h3>
                          <span className="text-xs text-muted-foreground">{g.tasks.length}</span>
                        </div>
                        <div className="space-y-2.5">
                          {list.map(t => <TaskCard key={t.key} t={t} options={data.clusterOptions} onOverride={overrideCluster} />)}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {totalShown > LIMIT && (
                  <button onClick={() => setExpanded(e => !e)}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground border-t border-border transition-colors">
                    {expanded ? <><ChevronUp className="w-3.5 h-3.5" /> Свернуть</> : <><ChevronDown className="w-3.5 h-3.5" /> Показать все {totalShown}</>}
                  </button>
                )}
              </>
            )
          })()}
        </>
      )}

      {/* Модалка со списком задач по выбранному уровню риска */}
      {data && (
        <RiskTasksModal riskK={riskModal} which={which} tasks={data.tasks} onClose={() => setRiskModal(null)} />
      )}
    </div>
  )
}
