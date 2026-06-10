import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell,
} from "recharts"
import { AlertTriangle, RefreshCw, ExternalLink, Layers, Tag, ChevronDown, ChevronUp, Clock } from "lucide-react"
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

interface Incident {
  month: string; queue: string; key: string; summary: string; url: string
  created: string; resolved: string; status: string; statusKey: string
  resolution: string; priority: string; priorityKey: string; assignee: string
  daysInWork: number | null; spentHours: number | null; cause: string; stack: string[]; sleStatus: string
}
interface Resp {
  ok: boolean; error?: string; queues: Record<string, string>
  months: string[]; items: Incident[]; updatedAt?: string
}

function Chip({ label, color, dim }: { label: string; color: string; dim?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color, opacity: dim ? 0.5 : 1 }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{label}
    </span>
  )
}

function StackChips({ stack }: { stack: string[] }) {
  if (!stack?.length) return <span className="text-[10px] text-muted-foreground/50">— без стека</span>
  return <span className="inline-flex flex-wrap gap-1">{stack.map(s => <Chip key={s} label={s} color={stackColor(s)} />)}</span>
}

// строка инцидента
function IncidentRow({ it, queues, showCause = true }: { it: Incident; queues: Record<string, string>; showCause?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">
          {it.key} <ExternalLink className="w-3 h-3" />
        </a>
        {it.priority && <Chip label={it.priority} color={PRIO_COLOR[it.priorityKey] || "#94A3B8"} />}
        <Chip label={queues[it.queue] || it.queue} color={TEAM_COLOR[it.queue] || "#94A3B8"} />
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<string>("all")
  const [groupBy, setGroupBy] = useState<"cause" | "stack">("cause")
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [monthSel, setMonthSel] = useState<string | null>(null)

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/incidents?months=12${refresh ? "&refresh=true" : ""}`).then(r => r.json())
      .then((d: Resp) => { if (d.ok) setResp(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const queues = resp?.queues ?? {}
  const months = resp?.months ?? []
  const items = useMemo(() => (resp?.items ?? []).filter(it => team === "all" || it.queue === team), [resp, team])

  // данные графика по месяцам (стек по командам или одна полоса)
  const chartData = useMemo(() => months.map(m => {
    const row: Record<string, any> = { month: m, label: monLabel(m), total: 0 }
    for (const q of TEAM_ORDER) {
      const n = items.filter(it => it.month === m && it.queue === q).length
      if (team === "all") row[q] = n
      row.total += n
    }
    if (team !== "all") row.one = row.total
    return row
  }), [items, months, team])

  // тренд: последний месяц к предыдущему
  const trend = useMemo(() => {
    const withData = chartData.filter(r => r.total > 0 || true)
    if (withData.length < 2) return null
    const cur = withData[withData.length - 1].total, prev = withData[withData.length - 2].total
    return { cur, prev, delta: cur - prev }
  }, [chartData])

  // группировка по причине / стеку
  const groups = useMemo(() => {
    const totalCount = items.length || 1
    const totalHours = items.reduce((s, it) => s + (it.spentHours || 0), 0) || 1
    const map = new Map<string, Incident[]>()
    for (const it of items) {
      if (groupBy === "cause") {
        const k = it.cause || "— не указана"
        ;(map.get(k) || map.set(k, []).get(k)!).push(it)
      } else {
        const keys = it.stack?.length ? it.stack : ["— без стека"]
        for (const k of keys) (map.get(k) || map.set(k, []).get(k)!).push(it)
      }
    }
    return Array.from(map.entries()).map(([key, list]) => {
      const hours = list.reduce((s, it) => s + (it.spentHours || 0), 0)
      return {
        key, list, count: list.length,
        pct: Math.round(list.length / totalCount * 100),
        hours: Math.round(hours), hoursPct: Math.round(hours / totalHours * 100),
      }
    }).sort((a, b) => b.count - a.count)
  }, [items, groupBy])

  const maxGroup = Math.max(1, ...groups.map(g => g.count))

  // сводка
  const stats = useMemo(() => {
    const crit = items.filter(it => it.priorityKey === "critical" || it.priorityKey === "blocker").length
    const done = items.filter(it => it.statusKey === "closed" || it.resolution).length
    const hours = Math.round(items.reduce((s, it) => s + (it.spentHours || 0), 0))
    const avgDays = items.length ? Math.round(items.reduce((s, it) => s + (it.daysInWork || 0), 0) / items.length) : 0
    return { total: items.length, crit, done, open: items.length - done, hours, avgDays }
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
            Все инциденты трёх очередей курьеров (X / U / R) по месяцам · причина и стек · группировка
            {resp?.updatedAt && <span className="ml-1">· обновлено: {resp.updatedAt}</span>}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading} title="Пересчитать заново"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Обновить
        </button>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {/* Фильтр по команде */}
      <div className="flex items-center gap-2.5 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
        <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
          {teamTabs.map(([v, label]) => (
            <button key={v} onClick={() => setTeam(v)}
              className={cn("px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap",
                team === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : resp && (
        <>
          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Всего инцидентов", value: stats.total, color: "text-foreground" },
              { label: "Критичных", value: stats.crit, color: "text-rose-500" },
              { label: "Решено / открыто", value: `${stats.done} / ${stats.open}`, color: "text-emerald-500" },
              { label: "Часов суммарно", value: stats.hours, color: "text-primary" },
              { label: "Ср. дней в работе", value: stats.avgDays, color: "text-amber-500" },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                <p className={cn("text-2xl font-black tracking-tight leading-none mt-1", s.color)}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* График по месяцам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>📈 Инциденты по месяцам</CardTitle>
                {trend && (
                  <span className={cn("text-xs font-bold inline-flex items-center gap-1",
                    trend.delta > 0 ? "text-rose-500" : trend.delta < 0 ? "text-emerald-500" : "text-muted-foreground")}>
                    {trend.delta > 0 ? "▲" : trend.delta < 0 ? "▼" : "≈"} к пр. месяцу {trend.delta > 0 ? "+" : ""}{trend.delta}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Клик по столбцу — список инцидентов месяца, далее по ключу — в Трекер</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barSize={28}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                  {team === "all" ? TEAM_ORDER.map((q, i) => (
                    <Bar key={q} dataKey={q} stackId="a" name={queues[q] || q} fill={TEAM_COLOR[q]}
                      radius={i === TEAM_ORDER.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} style={{ cursor: "pointer" }}
                      onClick={(d: any) => setMonthSel(d?.payload?.month)}>
                      {i === TEAM_ORDER.length - 1 && <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />}
                    </Bar>
                  )) : (
                    <Bar dataKey="one" name="Инциденты" radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }}
                      onClick={(d: any) => setMonthSel(d?.payload?.month)}>
                      {chartData.map(r => <Cell key={r.month} fill={TEAM_COLOR[team] || "#EF4444"} />)}
                      <LabelList dataKey="total" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                    </Bar>
                  )}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Группировка по причине / стеку */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>🧩 Разбор инцидентов</CardTitle>
                <div className="flex gap-1 bg-secondary/60 rounded-lg p-1">
                  {([["cause", "По причине", Tag], ["stack", "По стеку", Layers]] as const).map(([v, label, Icon]) => (
                    <button key={v} onClick={() => { setGroupBy(v); setOpenGroup(null) }}
                      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                        groupBy === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground")}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {groupBy === "cause" ? "Сгруппировано по причине инцидента" : "Сгруппировано по стеку"} · доля от числа и от часов · клик — раскрыть
              </p>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {groups.length === 0 && <div className="h-20 flex items-center justify-center text-sm text-muted-foreground">Нет инцидентов за период</div>}
              {groups.map(g => {
                const isOpen = openGroup === g.key
                const isStack = groupBy === "stack"
                return (
                  <div key={g.key} className="rounded-xl border border-border bg-card overflow-hidden">
                    <button onClick={() => setOpenGroup(o => o === g.key ? null : g.key)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left">
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <div className="shrink-0">
                        {isStack ? <Chip label={g.key} color={stackColor(g.key)} /> : <Tag className="w-3.5 h-3.5 text-rose-400 inline" />}
                      </div>
                      <span className="flex-1 min-w-0 text-sm text-foreground truncate">{isStack ? "" : g.key}</span>
                      <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
                        <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                          <div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.round(g.count / maxGroup * 100)}%` }} />
                        </div>
                      </div>
                      <span className="text-xs font-black text-foreground tabular-nums shrink-0 w-10 text-right">{g.count}</span>
                      <span className="text-[11px] text-muted-foreground shrink-0 w-24 text-right whitespace-nowrap">{g.pct}% · {g.hours}ч</span>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-1.5 bg-secondary/20">
                        {g.list.sort((a, b) => (b.spentHours || 0) - (a.spentHours || 0)).map(it => (
                          <IncidentRow key={it.key} it={it} queues={queues} showCause={isStack} />
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

      {/* Модалка: инциденты выбранного месяца */}
      <Modal open={!!monthSel} onClose={() => setMonthSel(null)}
        title={`Инциденты · ${monthSel ? monLabel(monthSel) : ""}`}
        subtitle={`${team === "all" ? "все команды" : (queues[team] || team)} · ${monthList.length} инц. · по ключу — в Трекер`} wide>
        {monthList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет инцидентов</div>
        ) : (
          <div className="space-y-1.5">
            {monthList.map(it => <IncidentRow key={it.key} it={it} queues={queues} />)}
          </div>
        )}
      </Modal>
    </div>
  )
}
