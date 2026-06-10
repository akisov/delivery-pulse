import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell,
} from "recharts"
import {
  AlertTriangle, RefreshCw, ExternalLink, Layers, Tag, ChevronDown, ChevronUp, Flame, User, Sparkles, Clock, Hourglass,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]
const TEAM_COLOR: Record<string, string> = { POOLING: "#3B82F6", UDOSTAVKA: "#8B5CF6", DOSTAVKAPIKO: "#06B6D4" }
const PRIO_COLOR: Record<string, string> = {
  blocker: "#DC2626", critical: "#EF4444", high: "#F97316", normal: "#EAB308", minor: "#10B981", trivial: "#94A3B8",
}
const RU_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
function monLabel(ym: string) {
  const [y, m] = (ym || "").split("-"); const i = parseInt(m) - 1
  return i >= 0 && i < 12 ? `${RU_MON[i]} ${(y || "").slice(2)}` : ym
}
function stackColor(s: string) {
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360}, 60%, 50%)`
}
function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
const PRESETS = [
  { label: "С начала года", get: () => ({ from: `${new Date().getFullYear()}-01-01`, to: fmtDate(new Date()) }) },
  { label: "Квартал", get: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 90); return { from: fmtDate(s), to: fmtDate(e) } } },
  { label: "Месяц", get: () => { const e = new Date(), s = new Date(); s.setDate(s.getDate() - 30); return { from: fmtDate(s), to: fmtDate(e) } } },
  { label: "Пр. месяц", get: () => { const n = new Date(); const s = new Date(n.getFullYear(), n.getMonth() - 1, 1); const e = new Date(n.getFullYear(), n.getMonth(), 0); return { from: fmtDate(s), to: fmtDate(e) } } },
]

interface Incident {
  month: string; queue: string; key: string; summary: string; url: string
  created: string; resolved: string; status: string; statusKey: string
  resolution: string; priority: string; priorityKey: string; assignee: string
  daysInWork: number | null; spentHours: number | null; cause: string; stack: string[]; sleStatus: string
}
interface Resp { ok: boolean; error?: string; queues: Record<string, string>; months: string[]; items: Incident[]; updatedAt?: string }
interface WlResp { ok: boolean; data?: Record<string, Record<string, Record<string, number>>>; months?: string[] }

const isResolved = (it: Incident) => !!it.resolution || it.statusKey === "closed"

function renderMd(s: string) {
  return s.split(/\*\*/).map((p, i) => i % 2 === 1
    ? <strong key={i} className="font-bold text-foreground">{p}</strong>
    : <span key={i}>{p}</span>)
}

function IncidentsAI({ team, refreshKey }: { team: string; refreshKey: number }) {
  const [summary, setSummary] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const load = (refresh = false) => {
    setLoading(true)
    fetch(`/incidents-ai?team=${team}&months=12${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json()).then((d: any) => setSummary(d?.summary || ""))
      .catch(() => setSummary("")).finally(() => setLoading(false))
  }
  useEffect(() => { setSummary(""); load() }, [team])
  useEffect(() => { if (refreshKey) load(true) }, [refreshKey])
  const lines = (summary || "").split("\n").map(s => s.trim()).filter(Boolean)
  if (!loading && !summary) return null
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-[0_0_32px_rgba(108,99,255,0.12)]">
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20"><Sparkles className="h-5 w-5 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">AI-сводка по инцидентам</span>
            <span className="text-[10px] text-muted-foreground">· Claude + ваши данные</span>
            <button onClick={() => load(true)} disabled={loading} title="Пересобрать вывод"
              className="ml-auto text-muted-foreground/60 transition-colors hover:text-primary">
              <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </button>
          </div>
          {loading ? (
            <div className="space-y-2 py-0.5">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 text-sm leading-relaxed text-foreground animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                  <span>{renderMd(l.replace(/^[•\-*]\s*/, ""))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{label}
    </span>
  )
}
function StackChips({ stack }: { stack: string[] }) {
  if (!stack?.length) return <span className="text-[10px] text-muted-foreground/50">— без стека</span>
  return <span className="inline-flex flex-wrap gap-1">{stack.map(s => <Chip key={s} label={s} color={stackColor(s)} />)}</span>
}

function IncidentRow({ it, queues, showCause = true }: { it: Incident; queues: Record<string, string>; showCause?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
          {it.key} <ExternalLink className="w-3 h-3" />
        </a>
        {it.priority && <Chip label={it.priority} color={PRIO_COLOR[it.priorityKey] || "#94A3B8"} />}
        <Chip label={queues[it.queue] || it.queue} color={TEAM_COLOR[it.queue] || "#94A3B8"} />
        {!isResolved(it) && <span className="text-[10px] font-bold text-amber-500">● открыт</span>}
        <StackChips stack={it.stack} />
        <span className="ml-auto text-[10px] text-muted-foreground whitespace-nowrap">
          {it.daysInWork != null && <>в работе {it.daysInWork}д · </>}
          {it.spentHours != null && <>{it.spentHours}ч · </>}
          {it.created}
        </span>
      </div>
      <p className="text-xs text-foreground mt-1 leading-snug">{it.summary}</p>
      {showCause && (
        <p className="text-[11px] text-muted-foreground mt-0.5">
          <span className="text-muted-foreground/60">причина:</span> {it.cause}
          <span className="ml-2 text-muted-foreground/60">· {it.assignee}</span>
          {it.sleStatus && <span className={cn("ml-2 font-semibold", /выполн/i.test(it.sleStatus) ? "text-emerald-500" : "text-amber-500")}>SLE: {it.sleStatus}</span>}
        </p>
      )}
    </div>
  )
}

export function IncidentsPage() {
  const [resp, setResp] = useState<Resp | null>(null)
  const [wl, setWl] = useState<WlResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<string>("all")
  const [groupBy, setGroupBy] = useState<"cause" | "stack" | "priority" | "assignee">("cause")
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [monthSel, setMonthSel] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dates, setDates] = useState(() => ({ from: `${new Date().getFullYear()}-01-01`, to: fmtDate(new Date()) }))
  const [preset, setPreset] = useState("С начала года")

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    Promise.all([
      fetch(`/incidents?months=12${refresh ? "&refresh=true" : ""}`).then(r => r.json()),
      fetch("/osp-worklog").then(r => r.json()).catch(() => null),
    ]).then(([d, w]: [Resp, WlResp]) => {
      if (d.ok) setResp(d); else setError(d.error || "Ошибка")
      setWl(w || null)
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const queues = resp?.queues ?? {}
  const teamQueues = team === "all" ? TEAM_ORDER : [team]
  const inRange = (dstr: string) => !!dstr && dstr >= dates.from && dstr <= dates.to
  const monthInRange = (m: string) => m >= dates.from.slice(0, 7) && m <= dates.to.slice(0, 7)

  // инциденты команды, созданные в выбранном периоде
  const items = useMemo(() => (resp?.items ?? [])
    .filter(it => team === "all" || it.queue === team)
    .filter(it => inRange(it.created)), [resp, team, dates])

  const monthsR = useMemo(() => (resp?.months ?? []).filter(monthInRange), [resp, dates])

  // ВОЛНА: доля времени на инциденты от всех типов (worklog) по месяцам
  const waveData = useMemo(() => monthsR.map(m => {
    let inc = 0, tot = 0
    for (const q of teamQueues) {
      const byType = wl?.data?.[m]?.[q] || {}
      for (const [t, h] of Object.entries(byType)) { tot += h; if (t === "Инцидент") inc += h }
    }
    return { month: m, label: monLabel(m), pct: tot > 0 ? Math.round(inc / tot * 100) : 0, inc: Math.round(inc) }
  }), [wl, monthsR, team])
  const avgShare = waveData.length ? Math.round(waveData.reduce((s, r) => s + r.pct, 0) / waveData.length) : 0

  // СОЗДАНО vs ЗАВЕРШЕНО по месяцам (когорта по месяцу создания: решено/открыто)
  const createdResolved = useMemo(() => monthsR.map(m => {
    const cohort = items.filter(it => it.month === m)
    const res = cohort.filter(isResolved).length
    return { month: m, label: monLabel(m), resolved: res, open: cohort.length - res, total: cohort.length }
  }), [items, monthsR])

  // тренд числа инцидентов к пред. месяцу
  const trend = useMemo(() => {
    if (createdResolved.length < 2) return null
    const cur = createdResolved[createdResolved.length - 1].total, prev = createdResolved[createdResolved.length - 2].total
    return { cur, prev, delta: cur - prev }
  }, [createdResolved])

  // группировка
  const groups = useMemo(() => {
    const totalCount = items.length || 1
    const totalHours = items.reduce((s, it) => s + (it.spentHours || 0), 0) || 1
    const map = new Map<string, Incident[]>()
    const push = (k: string, it: Incident) => (map.get(k) || map.set(k, []).get(k)!).push(it)
    for (const it of items) {
      if (groupBy === "cause") push(it.cause || "— не указана", it)
      else if (groupBy === "priority") push(it.priority || "— без приоритета", it)
      else if (groupBy === "assignee") push(it.assignee || "— без исполнителя", it)
      else { const keys = it.stack?.length ? it.stack : ["— без стека"]; for (const k of keys) push(k, it) }
    }
    return Array.from(map.entries()).map(([key, list]) => {
      const hours = list.reduce((s, it) => s + (it.spentHours || 0), 0)
      return { key, list, count: list.length, pct: Math.round(list.length / totalCount * 100), hours: Math.round(hours), hoursPct: Math.round(hours / totalHours * 100) }
    }).sort((a, b) => b.count - a.count)
  }, [items, groupBy])
  const maxGroup = Math.max(1, ...groups.map(g => g.count))

  // топы
  const topDays = useMemo(() => items.filter(i => i.daysInWork != null).slice().sort((a, b) => (b.daysInWork || 0) - (a.daysInWork || 0)).slice(0, 5), [items])
  const topHours = useMemo(() => items.filter(i => i.spentHours != null).slice().sort((a, b) => (b.spentHours || 0) - (a.spentHours || 0)).slice(0, 5), [items])
  const topCauses = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) { const c = it.cause || "— не указана"; m.set(c, (m.get(c) || 0) + 1) }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [items])

  // сводка
  const stats = useMemo(() => {
    const crit = items.filter(it => it.priorityKey === "critical" || it.priorityKey === "blocker").length
    const done = items.filter(isResolved).length
    const hours = Math.round(items.reduce((s, it) => s + (it.spentHours || 0), 0))
    const rate = items.length ? Math.round(done / items.length * 100) : 0
    return { total: items.length, crit, done, open: items.length - done, hours, rate }
  }, [items])

  const monthList = useMemo(() => monthSel
    ? items.filter(it => it.month === monthSel).sort((a, b) => (b.created || "").localeCompare(a.created || ""))
    : [], [monthSel, items])

  const teamTabs: [string, string][] = [["all", "Все команды"], ...TEAM_ORDER.map(q => [q, queues[q] || q] as [string, string])]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground flex items-center gap-2">
            <AlertTriangle className="w-7 h-7 text-rose-500" /> Инциденты
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Все инциденты трёх очередей курьеров (X / U / R) · причина, стек, приоритет · доля времени и динамика
            {resp?.updatedAt && <span className="ml-1">· обновлено: {resp.updatedAt}</span>}
          </p>
        </div>
        <button onClick={() => { load(true); setRefreshKey(k => k + 1) }} disabled={loading} title="Пересчитать заново"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Обновить
        </button>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {/* Команда + период */}
      <div className="flex items-center gap-4 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {teamTabs.map(([v, label]) => (
              <button key={v} onClick={() => setTeam(v)}
                className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap",
                  team === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Период</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {PRESETS.map(p => (
              <button key={p.label} onClick={() => { setDates(p.get()); setPreset(p.label) }}
                className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all whitespace-nowrap",
                  preset === p.label ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 bg-secondary/60 border border-border rounded-lg px-2 h-9">
            <input type="date" value={dates.from} onChange={e => { setDates(d => ({ ...d, from: e.target.value })); setPreset("") }}
              className="bg-transparent border-none text-xs text-foreground outline-none w-[104px] [color-scheme:light] dark:[color-scheme:dark]" />
            <span className="text-muted-foreground text-xs">—</span>
            <input type="date" value={dates.to} onChange={e => { setDates(d => ({ ...d, to: e.target.value })); setPreset("") }}
              className="bg-transparent border-none text-xs text-foreground outline-none w-[104px] [color-scheme:light] dark:[color-scheme:dark]" />
          </div>
        </div>
      </div>

      {!loading && resp && <IncidentsAI team={team} refreshKey={refreshKey} />}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : resp && (
        <>
          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {[
              { label: "Всего инцидентов", value: stats.total, color: "text-foreground" },
              { label: "Критичных", value: stats.crit, color: "text-rose-500" },
              { label: "Открытых", value: stats.open, color: "text-amber-500" },
              { label: "% завершено", value: `${stats.rate}%`, color: "text-emerald-500" },
              { label: "% времени (ср.)", value: `${avgShare}%`, color: "text-primary" },
              { label: "Часов суммарно", value: stats.hours, color: "text-foreground" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                <p className={cn("text-2xl font-black tracking-tight leading-none mt-1", s.color)}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* ВОЛНА: доля времени на инциденты */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <CardTitle>🌊 Доля времени на инциденты</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">% залогированных часов на инциденты от всех типов работ по месяцам · в среднем {avgShare}%</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={waveData} margin={{ top: 14, right: 16, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id="incWave" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EF4444" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#EF4444" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis unit="%" domain={[0, "auto"]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ stroke: "hsl(var(--border))" }}
                    content={({ active, payload }: any) => active && payload?.length
                      ? <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-xl"><b>{payload[0].payload.label}</b>: {payload[0].payload.pct}% времени · {payload[0].payload.inc}ч на инциденты</div> : null} />
                  <Area type="monotone" dataKey="pct" stroke="#EF4444" strokeWidth={2} fill="url(#incWave)">
                    <LabelList dataKey="pct" position="top" formatter={(v: number) => `${v}%`} style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* СОЗДАНО vs ЗАВЕРШЕНО */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>📊 Создано и завершено по месяцам</CardTitle>
                {trend && (
                  <span className={cn("text-xs font-bold inline-flex items-center gap-1", trend.delta > 0 ? "text-rose-500" : trend.delta < 0 ? "text-emerald-500" : "text-muted-foreground")}>
                    {trend.delta > 0 ? "▲" : trend.delta < 0 ? "▼" : "≈"} к пр. месяцу {trend.delta > 0 ? "+" : ""}{trend.delta}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Высота столбца = создано за месяц; 🟢 завершено / 🟡 открыто · всего завершаем {stats.rate}% · клик — список</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={createdResolved} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barSize={30}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="resolved" stackId="a" name="Завершено" fill="#10B981" style={{ cursor: "pointer" }} onClick={(d: any) => setMonthSel(d?.payload?.month)} />
                  <Bar dataKey="open" stackId="a" name="Открыто" fill="#F59E0B" radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }} onClick={(d: any) => setMonthSel(d?.payload?.month)}>
                    <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ТОПЫ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-amber-500" /> Дольше всех в работе</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {topDays.length === 0 && <span className="text-xs text-muted-foreground/60">нет данных</span>}
                {topDays.map(it => (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline shrink-0">{it.key}</a>
                    <span className="flex-1 truncate text-muted-foreground">{it.summary}</span>
                    <span className="font-black text-amber-500 shrink-0">{it.daysInWork}д</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Hourglass className="w-4 h-4 text-primary" /> Самые трудозатратные</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {topHours.length === 0 && <span className="text-xs text-muted-foreground/60">нет данных</span>}
                {topHours.map(it => (
                  <div key={it.key} className="flex items-center gap-2 text-xs">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline shrink-0">{it.key}</a>
                    <span className="flex-1 truncate text-muted-foreground">{it.summary}</span>
                    <span className="font-black text-primary shrink-0">{it.spentHours}ч</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Tag className="w-4 h-4 text-rose-400" /> Частые причины</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {topCauses.length === 0 && <span className="text-xs text-muted-foreground/60">нет данных</span>}
                {topCauses.map(([c, n]) => (
                  <div key={c} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-foreground">{c}</span>
                    <span className="font-black text-rose-400 shrink-0">{n}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Разбор по группам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>🧩 Разбор инцидентов</CardTitle>
                <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
                  {([["cause", "По причине", Tag], ["stack", "По стеку", Layers], ["priority", "По приоритету", Flame], ["assignee", "По исполнителю", User]] as const).map(([v, label, Icon]) => (
                    <button key={v} onClick={() => { setGroupBy(v); setOpenGroup(null) }}
                      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                        groupBy === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground")}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {{ cause: "Сгруппировано по причине инцидента", stack: "Сгруппировано по стеку", priority: "Сгруппировано по приоритету", assignee: "Сгруппировано по исполнителю («пожарные»)" }[groupBy]} · доля от числа и от часов · клик — раскрыть
              </p>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {groups.length === 0 && <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">Нет инцидентов за период</div>}
              {groups.map(g => {
                const isOpen = openGroup === g.key
                let header: React.ReactNode
                if (groupBy === "stack") header = <Chip label={g.key} color={stackColor(g.key)} />
                else if (groupBy === "priority") header = <Chip label={g.key} color={PRIO_COLOR[g.list[0]?.priorityKey] || "#94A3B8"} />
                else if (groupBy === "assignee") header = <span className="inline-flex items-center gap-1.5 text-sm text-foreground"><User className="w-3.5 h-3.5 text-primary" />{g.key}</span>
                else header = <span className="inline-flex items-center gap-1.5 text-sm text-foreground"><Tag className="w-3.5 h-3.5 text-rose-400 shrink-0" />{g.key}</span>
                return (
                  <div key={g.key} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button onClick={() => setOpenGroup(o => o === g.key ? null : g.key)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left">
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className="flex-1 min-w-0 truncate">{header}</span>
                      <div className="hidden sm:flex items-center gap-2 w-32 shrink-0">
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.round(g.count / maxGroup * 100)}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-black text-foreground tabular-nums shrink-0 w-10 text-right">{g.count}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0 w-24 text-right whitespace-nowrap">{g.pct}% · {g.hours}ч</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-1.5 bg-secondary/20">
                        {g.list.slice().sort((a, b) => (b.spentHours || 0) - (a.spentHours || 0)).map(it => (
                          <IncidentRow key={it.key} it={it} queues={queues} showCause={groupBy !== "cause"} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </>
      )}

      <Modal open={!!monthSel} onClose={() => setMonthSel(null)}
        title={`Инциденты · ${monthSel ? monLabel(monthSel) : ""}`}
        subtitle={`${team === "all" ? "все команды" : (queues[team] || team)} · ${monthList.length} инц. · по ключу — в Трекер`} wide>
        {monthList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет инцидентов</div>
        ) : (
          <div className="space-y-1.5">{monthList.map(it => <IncidentRow key={it.key} it={it} queues={queues} />)}</div>
        )}
      </Modal>
    </div>
  )
}
