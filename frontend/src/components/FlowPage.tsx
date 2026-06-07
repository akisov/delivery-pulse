import { useEffect, useState } from "react"
import { LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts"
import { ExternalLink, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface FlowTask { key: string; summary: string; assignee: string; status: string; url: string; days: number; sleRisk: string }
interface Stream { count: number; p90: number; limit: number; overLimit: boolean; top: FlowTask[]; tasks: FlowTask[] }
interface Hist { date: string; label: string; discoveryP90: number; deliveryP90: number; discoveryCount?: number | null; deliveryCount?: number | null }
interface Resp {
  ok: boolean; error?: string; discovery: Stream; delivery: Stream
  sleBreakdown: Record<string, number>; week: string; target?: number; history: Hist[]
}

const DISC = "#EAB308" // Исследования (жёлтый, как в учётной таблице)
const DELI = "#10B981" // В работе (зелёный)
const PERSON_LIMIT = 5

function byAssignee(tasks: FlowTask[]) {
  const m: Record<string, number> = {}
  tasks.forEach(t => { m[t.assignee] = (m[t.assignee] || 0) + 1 })
  return Object.entries(m).map(([a, count]) => ({ a, count })).sort((x, y) => y.count - x.count)
}

function AssigneeChart({ title, emoji, color, tasks }: { title: string; emoji: string; color: string; tasks: FlowTask[] }) {
  const data = byAssignee(tasks)
  const over = data.filter(d => d.count > PERSON_LIMIT).length
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between">
          <CardTitle>{emoji} {title}</CardTitle>
          {over > 0 && <span className="text-xs font-semibold text-destructive">⚠️ {over} перегружено</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Задач на продакте · красным — больше {PERSON_LIMIT}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32 + 16)}>
          <BarChart data={data} layout="vertical" margin={{ top: 2, right: 32, left: 4, bottom: 2 }} barSize={16}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="a" width={150} tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]}>
              {data.map(d => <Cell key={d.a} fill={d.count > PERSON_LIMIT ? "#EF4444" : color} />)}
              <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function StreamCard({ title, emoji, color, s }: { title: string; emoji: string; color: string; s: Stream }) {
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{emoji} {title}</CardTitle>
          <span className={cn("inline-flex items-center gap-1 text-xs font-semibold",
            s.overLimit ? "text-destructive" : "text-emerald-500")}>
            {s.overLimit ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
            WIP {s.count}/{s.limit}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">WIP Age P90</p>
            <p className="text-4xl font-black tracking-tighter leading-none mt-1" style={{ color }}>{s.p90}<span className="text-base font-bold text-muted-foreground ml-1">дн.</span></p>
          </div>
        </div>
        {/* WIP-бар */}
        <div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{
              width: `${Math.min(100, s.count / s.limit * 100)}%`,
              background: s.overLimit ? "#EF4444" : color,
            }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {s.overLimit ? `Превышен WIP-лимит на ${s.count - s.limit}` : `В пределах WIP-лимита (${s.limit})`}
          </p>
        </div>
        {/* Топ по возрасту */}
        {s.top.length > 0 && (
          <div className="space-y-1 pt-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Дольше всего в потоке</p>
            {s.top.map(t => (
              <div key={t.key} className="flex items-center gap-2 text-[11px] rounded-md bg-secondary/40 px-2 py-1">
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline flex items-center gap-1">
                  {t.key} <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-muted-foreground/70 truncate flex-1">{t.summary}</span>
                <span className="text-muted-foreground shrink-0">{t.assignee}</span>
                <span className="font-bold text-foreground shrink-0">{t.days} дн.</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function FlowPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    fetch("/flow-metrics").then(r => r.json())
      .then((d: Resp) => { if (d.ok) setData(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Поток — Discovery / Delivery</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Возраст работы в потоке (WIP Age P90) и WIP-лимиты по очереди PUTKURERA
            {data?.week && <span className="ml-1">· неделя {data.week}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} title="Обновить"
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" />
        </div>
      ) : data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StreamCard title="Discovery" emoji="🔬" color={DISC} s={data.discovery} />
            <StreamCard title="Delivery" emoji="🚀" color={DELI} s={data.delivery} />
          </div>

          {/* Загрузка по продактам */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AssigneeChart title="Discovery — по продактам" emoji="🔬" color={DISC} tasks={data.discovery.tasks} />
            <AssigneeChart title="Delivery — по продактам" emoji="🚀" color={DELI} tasks={data.delivery.tasks} />
          </div>

          {/* Тренд P90 по неделям */}
          {data.history.length > 1 && (
            <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
              <CardHeader className="pb-1">
                <CardTitle>📈 WIP Age динамика</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">Динамика возраста работы по датам · красная линия — цель {data.target ?? 60} дн.</p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.history} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit=" дн." />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={data.target ?? 60} stroke="#EF4444" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="discoveryP90" name="Исследования" stroke={DISC} strokeWidth={2.5} dot={{ r: 2.5 }} />
                    <Line type="monotone" dataKey="deliveryP90" name="В работе" stroke={DELI} strokeWidth={2.5} dot={{ r: 2.5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {data.history.length <= 1 && (
            <p className="text-xs text-muted-foreground">📈 Тренд по неделям появится после нескольких недель сбора (снимок сохраняется раз в неделю).</p>
          )}

          {/* Тренд количества в потоке */}
          {(() => {
            const cnt = data.history.filter(h => h.discoveryCount != null || h.deliveryCount != null)
            if (cnt.length < 2)
              return <p className="text-xs text-muted-foreground">📊 Тренд количества задач в потоке начнёт строиться с этой недели (исторических чисел нет).</p>
            return (
              <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
                <CardHeader className="pb-1">
                  <CardTitle>📊 Кол-во задач в потоке по неделям</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Пунктир — WIP-лимиты ({data.discovery.limit} / {data.delivery.limit})</p>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={cnt} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <ReferenceLine y={data.discovery.limit} stroke={DISC} strokeDasharray="4 4" />
                      <ReferenceLine y={data.delivery.limit} stroke={DELI} strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="discoveryCount" name="Исследования" stroke={DISC} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} />
                      <Line type="monotone" dataKey="deliveryCount" name="В работе" stroke={DELI} strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )
          })()}
        </>
      )}
    </div>
  )
}
