import { useEffect, useState } from "react"
import { LineChart, Line, BarChart, Bar, Cell, LabelList, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from "recharts"
import { ExternalLink, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

interface FlowTask { key: string; summary: string; assignee: string; status?: string; statusKey: string; url: string; days: number; sleRisk: string }
interface Stream { count: number; p90: number; limit: number; overLimit: boolean; top: FlowTask[]; tasks: FlowTask[] }
interface Hist { date: string; label: string; discoveryP90: number; deliveryP90: number; discoveryCount?: number | null; deliveryCount?: number | null }
interface Resp {
  ok: boolean; error?: string; discovery: Stream; delivery: Stream
  sleBreakdown: Record<string, number>; week: string; target?: number; history: Hist[]
}

const DISC = "#EAB308" // Исследования (жёлтый, как в учётной таблице)
const DELI = "#10B981" // В работе (зелёный)
const PERSON_LIMIT = 5
// статусы Discovery — по statusKey (надёжно), цвета как на графике
const DISC_STATUSES = [
  { key: "proverkaIdej", label: "Проверка идей", color: "#38BDF8" },
  { key: "podtverzdenieBoli", label: "Подтверждение боли", color: "#FB923C" },
  { key: "confirmed", label: "Подтверждено", color: "#4ADE80" },
]
const STATUS_COLOR: Record<string, string> = Object.fromEntries(DISC_STATUSES.map(s => [s.key, s.color]))

function shortName(n: string) {
  const p = n.trim().split(/\s+/)
  return p.length >= 3 ? `${p[0]} ${p[p.length - 1]}` : n // убираем отчество
}
function initials(n: string) {
  const p = shortName(n).split(/\s+/)
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase()
}
function avatarColor(n: string) {
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360}, 55%, 52%)`
}

interface ProdRow { name: string; short: string; count: number; maxDays: number; old: boolean; over: boolean; critical: boolean; tasks: FlowTask[]; [k: string]: any }

function aggProducts(tasks: FlowTask[], oldThreshold: number, highlight: boolean): ProdRow[] {
  const m: Record<string, any> = {}
  tasks.forEach(t => {
    const name = (t.assignee && t.assignee !== "—") ? t.assignee : "Без исполнителя"
    const r = (m[name] ||= { name, count: 0, old: false, maxDays: 0, tasks: [], proverkaIdej: 0, podtverzdenieBoli: 0, confirmed: 0 })
    r.count++; r.tasks.push(t); r.maxDays = Math.max(r.maxDays, t.days)
    if (t.days >= oldThreshold) r.old = true
    if (r[t.statusKey] !== undefined) r[t.statusKey]++
  })
  return Object.values(m).map((r: any) => {
    const over = highlight && r.count > PERSON_LIMIT
    return { ...r, over, critical: over && r.old, short: shortName(r.name) }
  }).sort((x, y) => y.count - x.count)
}

// тик оси: аватар + короткое имя + маркер перегруза
function ProductTick(rows: ProdRow[]) {
  return ({ x, y, index }: any) => {
    const r = rows[index]; if (!r) return null
    return (
      <foreignObject x={x - 168} y={y - 11} width={164} height={22}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5, height: 22 }}>
          {r.critical ? <span>🔥</span> : r.over ? <span>⚠️</span> : null}
          <span style={{ width: 18, height: 18, borderRadius: 9, background: avatarColor(r.name), color: "#fff",
            fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {initials(r.name)}
          </span>
          <span style={{ fontSize: 11, color: "hsl(var(--foreground))", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.short}</span>
        </div>
      </foreignObject>
    )
  }
}

// скругление правого края только у последнего ненулевого сегмента
function RoundedRight(props: any) {
  const { x, y, width, height, fill, isLast } = props
  if (!width || width <= 0 || !height || height <= 0) return null
  const r = isLast ? 4 : 0
  return <path d={`M${x},${y} h${width - r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 -${r},${r} H${x} Z`} fill={fill} />
}

function ProductChart({ title, emoji, color, tasks, oldThreshold, stacked, highlight, onPick }: {
  title: string; emoji: string; color: string; tasks: FlowTask[]; oldThreshold: number
  stacked?: boolean; highlight?: boolean; onPick: (r: ProdRow) => void
}) {
  const data = aggProducts(tasks, oldThreshold, !!highlight)
  const critical = data.filter(d => d.critical).length
  const over = data.filter(d => d.over && !d.critical).length
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <CardTitle>{emoji} {title}</CardTitle>
          {highlight && (critical > 0 || over > 0) && (
            <span className="text-xs font-semibold">
              {critical > 0 && <span className="text-destructive">🔥 {critical} перегруз+старая</span>}
              {critical > 0 && over > 0 && <span className="text-muted-foreground"> · </span>}
              {over > 0 && <span className="text-orange-500">{over} перегруз</span>}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {stacked ? "По статусам · " : "Задач на продакте · "}
          {highlight ? `🔥 = >${PERSON_LIMIT} и есть задача старше P90 (${oldThreshold} дн.) · ` : ""}нажми на столбец
        </p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={Math.max(130, data.length * 36 + (stacked ? 40 : 16))}>
          <BarChart data={data} layout="vertical" margin={{ top: 2, right: 36, left: 4, bottom: 2 }} barSize={16}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="short" width={172} tickLine={false} axisLine={false} tick={ProductTick(data)} interval={0} />
            <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
              content={({ active, payload }: any) => active && payload?.length
                ? <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-xl">
                    <b>{payload[0].payload.name}</b>: {payload[0].payload.count} задач · старейшая {payload[0].payload.maxDays} дн.
                    {payload[0].payload.critical && <div className="text-destructive">перегруз + старая задача</div>}
                    <div className="text-muted-foreground/70">нажми для списка</div>
                  </div> : null} />
            {stacked
              ? DISC_STATUSES.map((s, i) => (
                  <Bar key={s.key} dataKey={s.key} stackId="a" fill={s.color} name={s.label} style={{ cursor: "pointer" }}
                    onClick={(d: any) => onPick(d?.tasks ? d : d?.payload)}
                    shape={(p: any) => {
                      const row = p.payload || {}
                      const isLast = DISC_STATUSES.slice(i + 1).every(st => !row[st.key])
                      return <RoundedRight {...p} isLast={isLast} />
                    }} />
                ))
              : (
                <Bar dataKey="count" radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }} onClick={(d: any) => onPick(d?.tasks ? d : d?.payload)}>
                  {data.map(d => <Cell key={d.name} fill={d.critical ? "#B91C1C" : d.over ? "#F97316" : color} />)}
                  <LabelList dataKey="count" position="right" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                </Bar>
              )}
            {stacked && <Legend wrapperStyle={{ fontSize: 11 }} />}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

const RISK_DOT: Record<string, string> = { "нарушен": "#EF4444", "высок": "#F97316", "умерен": "#EAB308", "низк": "#10B981" }
function riskColor(r: string) {
  const s = (r || "").toLowerCase()
  return Object.entries(RISK_DOT).find(([k]) => s.includes(k))?.[1] || "#94A3B8"
}

function ProductModal({ row, onClose }: { row: ProdRow | null; onClose: () => void }) {
  if (!row) return null
  const tasks = [...row.tasks].sort((a, b) => b.days - a.days)
  return (
    <Modal open={!!row} onClose={onClose} title={shortName(row.name)} subtitle={`${tasks.length} задач в потоке`} wide>
      <div className="rounded-xl border border-border overflow-hidden">
        {tasks.map(t => (
          <div key={t.key} className="border-b border-border last:border-0 px-4 py-2.5 flex items-center gap-3 hover:bg-accent/30 transition-colors">
            {t.sleRisk && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: riskColor(t.sleRisk) }} title={t.sleRisk} />}
            <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1 shrink-0">
              {t.key} <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-xs text-muted-foreground truncate flex-1">{t.summary}</span>
            {t.status && (
              <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 shrink-0"
                style={{ background: `${STATUS_COLOR[t.statusKey] || "#94A3B8"}22`, color: STATUS_COLOR[t.statusKey] || "#94A3B8" }}>
                {t.status}
              </span>
            )}
            <span className="text-sm font-black text-foreground shrink-0">{t.days} <span className="text-[10px] font-normal text-muted-foreground">дн.</span></span>
          </div>
        ))}
      </div>
    </Modal>
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
  const [product, setProduct] = useState<ProdRow | null>(null)

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
            <ProductChart title="Discovery — по продактам" emoji="🔬" color={DISC} tasks={data.discovery.tasks}
              oldThreshold={data.discovery.p90} stacked highlight onPick={setProduct} />
            <ProductChart title="Delivery — по продактам" emoji="🚀" color={DELI} tasks={data.delivery.tasks}
              oldThreshold={data.delivery.p90} onPick={setProduct} />
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

      <ProductModal row={product} onClose={() => setProduct(null)} />
    </div>
  )
}
