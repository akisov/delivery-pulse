import { useEffect, useMemo, useState } from "react"
import { ExternalLink, RefreshCw, ChevronDown, ChevronUp, Pencil, EyeOff } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const CLUSTER_COLORS: Record<string, string> = {
  "Внешние зависимости":      "#3B82F6",
  "Крупная задача / не MMF":  "#8B5CF6",
  "Техническая блокировка":   "#EF4444",
  "Ошибка оценки":            "#EAB308",
}
function clusterColor(c?: string | null) { return (c && CLUSTER_COLORS[c]) || "#94A3B8" }

// порядок риска: нарушен > высокий > умеренный > низкий
function riskRank(r: string) {
  const s = (r || "").toLowerCase()
  if (s.includes("наруш")) return 0
  if (s.includes("высок")) return 1
  if (s.includes("умерен")) return 2
  if (s.includes("низк")) return 3
  return 4
}
function riskColor(r: string) {
  const k = riskRank(r)
  return ["#EF4444", "#F97316", "#EAB308", "#10B981", "#94A3B8"][k]
}

interface Sub {
  key: string; summary: string; queue: string; status: string; isActive: boolean
  url: string; blockings: { reason: string }[]
}
interface SleTask {
  key: string; summary: string; url: string; assignee: string; status: string
  sleRisk: string; sle: number | null; p70: number | null; effort: number | null
  jobCategory: string | null; deadline: string | null; daysInWork: number | null
  subCount: number; activeSubCount: number; hiddenBlocked: boolean
  subtasks: Sub[]; cluster: string | null; clusterReason: string | null
  aiCluster?: string | null; overridden?: boolean
}
interface Resp {
  ok: boolean; error?: string; which: string; count: number
  clusters: { label: string; key: string; count: number }[]
  clusterOptions: string[]; tasks: SleTask[]
}

function TaskCard({ t, options, onOverride }: { t: SleTask; options: string[]; onOverride: (key: string, cluster: string) => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/30">
      <div className="flex items-start gap-3">
        <span className="mt-1 w-2.5 h-2.5 rounded-full shrink-0" style={{ background: riskColor(t.sleRisk) }} title={t.sleRisk} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a href={t.url} target="_blank" rel="noopener noreferrer"
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
              {t.key} <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-[11px] font-semibold" style={{ color: riskColor(t.sleRisk) }}>{t.sleRisk}</span>
            {t.jobCategory && <Badge variant="outline" className="text-[10px]">{t.jobCategory}</Badge>}
            {t.hiddenBlocked && (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-500"
                title="Есть подзадачи, но активных нет — работа не спланирована">
                <EyeOff className="w-3 h-3" /> скрытая блокировка
              </span>
            )}
          </div>
          <p className="text-sm text-foreground mt-1 leading-snug">{t.summary}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            👤 {t.assignee} · SLE {t.sle ?? "—"} / P70 {t.p70 ?? "—"} · подзадач {t.subCount} (активных {t.activeSubCount})
          </p>

          {/* Кластер + причина */}
          <div className="mt-2 flex items-start gap-2 flex-wrap">
            {!editing ? (
              <button onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
                style={{ background: clusterColor(t.cluster) }} title="Изменить кластер">
                {t.cluster || "—"} <Pencil className="w-3 h-3 opacity-80" />
              </button>
            ) : (
              <select autoFocus defaultValue={t.cluster || ""}
                onChange={e => { onOverride(t.key, e.target.value); setEditing(false) }}
                onBlur={() => setEditing(false)}
                className="rounded-md border border-border bg-card text-xs px-2 py-1 text-foreground">
                {options.map(o => <option key={o} value={o}>{o}</option>)}
                <option value="">↺ Сбросить к AI</option>
              </select>
            )}
            {t.overridden && <span className="text-[10px] text-muted-foreground self-center">правка вручную{t.aiCluster ? ` (AI: ${t.aiCluster})` : ""}</span>}
          </div>
          {t.clusterReason && <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{t.clusterReason}</p>}

          {t.subtasks.length > 0 && (
            <>
              <button onClick={() => setOpen(o => !o)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
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
                      {s.blockings.length > 0 && <span className="text-amber-500 shrink-0" title={s.blockings.map(b => b.reason).join(", ")}>🔒{s.blockings.length}</span>}
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
    // оптимистично
    setData(prev => prev ? { ...prev, tasks: prev.tasks.map(t => t.key === key ? { ...t, cluster: cluster || t.aiCluster || t.cluster, overridden: !!cluster } : t) } : prev)
    await fetch(`/sle-override?key=${encodeURIComponent(key)}&cluster=${encodeURIComponent(cluster)}`, { method: "POST" }).catch(() => {})
    load()
  }

  const sortedTasks = useMemo(
    () => data ? [...data.tasks].sort((a, b) => riskRank(a.sleRisk) - riskRank(b.sleRisk)) : [],
    [data]
  )
  const hiddenCount = useMemo(() => data ? data.tasks.filter(t => t.hiddenBlocked).length : 0, [data])
  const violated = useMemo(() => data ? data.tasks.filter(t => riskRank(t.sleRisk) === 0).length : 0, [data])
  const maxCluster = Math.max(1, ...(data?.clusters.map(c => c.count) ?? [1]))

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Анализ нарушений SLE</h1>
          <p className="text-sm text-muted-foreground mt-1">Очередь PUTKURERA · кластеризация причин нарушения SLE (ИИ + правка вручную)</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
            {([["current", "Текущая"], ["historical", "История"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setWhich(v)}
                className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                  which === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                              : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
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

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {loading ? (
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">ИИ кластеризует причины… (может занять ~полминуты при первой загрузке)</div>
          <Skeleton className="h-32 rounded-xl" />
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : data && (
        <>
          {/* Распределение по кластерам */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle>📊 Кластеры причин нарушения SLE</CardTitle>
                <span className="text-xs text-muted-foreground">{data.count} задач · {violated} нарушено · {hiddenCount} скрытых блокировок</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.clusters.map(c => (
                <div key={c.label} className="flex items-center gap-3">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: clusterColor(c.label) }} />
                  <span className="text-xs text-foreground w-52 shrink-0">{c.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${c.count / maxCluster * 100}%`, background: clusterColor(c.label) }} />
                  </div>
                  <span className="text-xs font-bold text-foreground w-6 text-right">{c.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Список задач */}
          <div className="space-y-2.5">
            {sortedTasks.map(t => (
              <TaskCard key={t.key} t={t} options={data.clusterOptions} onOverride={overrideCluster} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
