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
import { SectionInfo } from "@/components/SectionInfo"
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

// ── Стоимость инцидента: часы × ставка роли (₽/час) ────────────────────────────
const ROLE_RATES: Record<string, number> = {
  "Аналитик": 2900, "Архитектор": 4900, "Дата аналитик": 2550, "Дизайнер": 2300,
  "Инженер платформы": 3550, "Консультант": 1350, "Менеджер": 2400, "Программист": 3300,
  "Руководитель группы": 4900, "Руководитель команды": 3350, "Руководитель проекта": 3000,
  "Техлид": 4100, "Технический писатель": 1200, "QA Engineer": 1900,
}
// фамилия (норм., ё→е) → роль
const PERSON_ROLE: Record<string, string> = {
  "кисов": "Руководитель команды", "степин": "QA Engineer", "яцушко": "Программист",
  "асотикова": "Программист", "резенова": "Аналитик", "спиридонов": "Техлид",
  "источников": "Программист", "драгун": "QA Engineer", "копосов": "Программист",
  "ким": "Программист", "корякин": "QA Engineer", "гусев": "Программист",
  "мартова": "QA Engineer", "рогова": "QA Engineer", "разумова": "Аналитик",
  "борискин": "Аналитик", "доронин": "Программист", "подлинов": "Программист",
  "егоров": "Аналитик", "ву": "QA Engineer", "туралиева": "QA Engineer",
  "исабаев": "QA Engineer", "тюриков": "Руководитель группы", "махмутова": "Аналитик",
  "мартынов": "Программист", "шестопалов": "Программист", "перевезенцева": "Аналитик",
  "киреев": "Программист", "памшев": "Программист", "селезнев": "Архитектор",
  "кушевский": "Программист", "салихьянов": "Программист", "исмаилов": "Программист",
  "надененко": "Программист", "самрякова": "QA Engineer",
}
function roleOf(assignee: string): string | null {
  for (const t of (assignee || "").toLowerCase().replace(/ё/g, "е").split(/\s+/)) {
    if (PERSON_ROLE[t]) return PERSON_ROLE[t]
  }
  return null
}
// стоимость = сумма по логам (кто сколько залогировал × ставка его роли);
// если логов нет — фолбэк на часы исполнителя
function costOf(it: { assignee: string; spentHours: number | null; worklog?: { name: string; hours: number }[] }): number | null {
  if (it.worklog && it.worklog.length) {
    let c = 0, known = false
    for (const w of it.worklog) {
      const role = roleOf(w.name); if (!role) continue
      const rate = ROLE_RATES[role]; if (!rate) continue
      c += w.hours * rate; known = true
    }
    return known ? Math.round(c) : null
  }
  const role = roleOf(it.assignee)
  if (!role || it.spentHours == null) return null
  const rate = ROLE_RATES[role]
  return rate ? Math.round(it.spentHours * rate) : null
}
function fmtRub(n: number) { return `${n.toLocaleString("ru-RU")} ₽` }
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
  worklog?: { name: string; hours: number; month?: string }[]
}
// ставка ₽/час по имени логировавшего (0, если роль не задана)
function rateOfName(name: string): number {
  const role = roleOf(name)
  return role ? (ROLE_RATES[role] || 0) : 0
}
interface Resp { ok: boolean; error?: string; queues: Record<string, string>; months: string[]; items: Incident[]; updatedAt?: string }
interface WlResp { ok: boolean; data?: Record<string, Record<string, Record<string, number>>>; months?: string[] }

const isResolved = (it: Incident) => !!it.resolution || it.statusKey === "closed"

function renderMd(s: string) {
  return s.split(/\*\*/).map((p, i) => i % 2 === 1
    ? <strong key={i} className="font-bold text-foreground">{p}</strong>
    : <span key={i}>{p}</span>)
}

function IncidentsAI({ team, from, to, refreshKey }: { team: string; from: string; to: string; refreshKey: number }) {
  const [summary, setSummary] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const load = (refresh = false) => {
    setLoading(true)
    fetch(`/incidents-ai?team=${team}&months=12&from=${from}&to=${to}${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json()).then((d: any) => setSummary(d?.summary || ""))
      .catch(() => setSummary("")).finally(() => setLoading(false))
  }
  useEffect(() => { setSummary(""); load() }, [team, from, to])
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
        <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap">
          {it.daysInWork != null && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-black text-amber-600 dark:text-amber-400" title="дней в работе">
              <Clock className="w-3 h-3" />{it.daysInWork}д
            </span>
          )}
          {it.spentHours != null && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-black text-primary" title="залогировано часов">
              <Hourglass className="w-3 h-3" />{Math.round(it.spentHours)}ч
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">{it.created}</span>
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
  const [clusterMap, setClusterMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [team, setTeam] = useState<string>("all")
  const [groupBy, setGroupBy] = useState<"cause" | "stack" | "priority" | "assignee">("cause")
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [sel, setSel] = useState<{ month: string; mode: "created" | "closed" } | null>(null)
  const [statSel, setStatSel] = useState<"all" | "crit" | "open" | null>(null)
  const [costTeam, setCostTeam] = useState<string | null>(null)  // фильтр графика стоимости по команде
  const [refreshKey, setRefreshKey] = useState(0)
  const [dates, setDates] = useState(() => ({ from: `${new Date().getFullYear()}-01-01`, to: fmtDate(new Date()) }))
  const [preset, setPreset] = useState("С начала года")

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    Promise.all([
      fetch(`/incidents?months=12${refresh ? "&refresh=true" : ""}`).then(r => r.json()),
      fetch("/osp-worklog").then(r => r.json()).catch(() => null),
      fetch(`/incidents-clusters?months=12${refresh ? "&refresh=true" : ""}`).then(r => r.json()).catch(() => null),
    ]).then(([d, w, c]: [Resp, WlResp, any]) => {
      if (d.ok) setResp(d); else setError(d.error || "Ошибка")
      setWl(w || null)
      setClusterMap((c && c.clusters) || {})
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // сырую причину → AI-кластер (или сама причина, если не кластеризована)
  const clusterOf = (cause: string) => {
    const c = (cause || "").trim()
    if (!c || c === "— не указана") return "— не указана"
    return clusterMap[c] || c
  }

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

  // все инциденты команды (без фильтра по дате) — для подсчёта закрытий по дате закрытия
  const teamItemsAll = useMemo(() => (resp?.items ?? []).filter(it => team === "all" || it.queue === team), [resp, team])
  // СОЗДАНО (по дате создания) vs ЗАКРЫТО (по дате закрытия) по месяцам
  const createdClosed = useMemo(() => monthsR.map(m => ({
    month: m, label: monLabel(m),
    created: teamItemsAll.filter(it => it.month === m).length,
    closed: teamItemsAll.filter(it => isResolved(it) && (it.resolved || "").slice(0, 7) === m).length,
  })), [teamItemsAll, monthsR])
  const flow = useMemo(() => {
    const c = createdClosed.reduce((s, r) => s + r.created, 0)
    const cl = createdClosed.reduce((s, r) => s + r.closed, 0)
    return { created: c, closed: cl, ratio: c ? Math.round(cl / c * 100) : 0 }
  }, [createdClosed])

  // СТОИМОСТЬ по месяцам — деньги, потраченные В каждом месяце (по дате списания часов),
  // по ВСЕМ инцидентам команды (открытым и закрытым), стек по командам
  const costByMonth = useMemo(() => {
    const acc: Record<string, Record<string, number>> = {}  // month -> queue -> ₽
    for (const it of teamItemsAll) {
      for (const w of (it.worklog || [])) {
        if (!w.month) continue
        const rub = w.hours * rateOfName(w.name)
        if (!rub) continue
        ;(acc[w.month] ||= {})[it.queue] = ((acc[w.month] || {})[it.queue] || 0) + rub
      }
    }
    return monthsR.map(m => {
      const row: Record<string, any> = { month: m, label: monLabel(m), total: 0 }
      for (const q of teamQueues) {
        row[q] = Math.round((acc[m]?.[q]) || 0); row.total += row[q]
      }
      return row
    })
  }, [teamItemsAll, monthsR, team])
  const totalCost = useMemo(() => costByMonth.reduce((s, r) => s + r.total, 0), [costByMonth])
  // команды, показанные на графике стоимости (клик по чипу — оставить одну)
  const costTeams = costTeam && teamQueues.includes(costTeam) ? [costTeam] : teamQueues
  const costRows = costByMonth.map(r => ({ ...r, shownCost: costTeams.reduce((s, q) => s + (r[q] || 0), 0) }))

  // тренд: выбранный период к ПРЕДЫДУЩЕМУ такой же длины (текущий месяц не закончен)
  const trend = useMemo(() => {
    const fromD = new Date(dates.from), toD = new Date(dates.to)
    const len = Math.round((toD.getTime() - fromD.getTime()) / 86400000)
    if (!(len >= 0) || !resp) return null
    const pt = new Date(fromD); pt.setDate(pt.getDate() - 1)
    const pf = new Date(pt); pf.setDate(pf.getDate() - len)
    const pfs = fmtDate(pf), pts = fmtDate(pt)
    const teamOk = (it: Incident) => team === "all" || it.queue === team
    const cur = items.length
    const prev = (resp.items || []).filter(it => teamOk(it) && it.created >= pfs && it.created <= pts).length
    return { cur, prev, delta: cur - prev, pf: pfs, pt: pts }
  }, [items, resp, team, dates])

  // для «Разбора» исключаем нереальные инциденты (резолюция «Не делаем»)
  const realItems = useMemo(() => items.filter(it => !/не\s*делаем/i.test(it.resolution || "")), [items])
  // группировка
  const groups = useMemo(() => {
    const totalCount = realItems.length || 1
    const totalHours = realItems.reduce((s, it) => s + (it.spentHours || 0), 0) || 1
    const map = new Map<string, Incident[]>()
    const push = (k: string, it: Incident) => (map.get(k) || map.set(k, []).get(k)!).push(it)
    for (const it of realItems) {
      if (groupBy === "cause") push(clusterOf(it.cause), it)
      else if (groupBy === "priority") push(it.priority || "— без приоритета", it)
      else if (groupBy === "assignee") push(it.assignee || "— без исполнителя", it)
      else { const keys = it.stack?.length ? it.stack : ["— без стека"]; for (const k of keys) push(k, it) }
    }
    return Array.from(map.entries()).map(([key, list]) => {
      const hours = list.reduce((s, it) => s + (it.spentHours || 0), 0)
      return { key, list, count: list.length, pct: Math.round(list.length / totalCount * 100), hours: Math.round(hours), hoursPct: Math.round(hours / totalHours * 100) }
    }).sort((a, b) => b.count - a.count)
  }, [realItems, groupBy, clusterMap])
  const maxGroup = Math.max(1, ...groups.map(g => g.count))

  // топы
  const topDays = useMemo(() => items.filter(i => i.daysInWork != null).slice().sort((a, b) => (b.daysInWork || 0) - (a.daysInWork || 0)).slice(0, 10), [items])
  const topCost = useMemo(() => items.filter(i => i.spentHours != null)
    .map(it => ({ it, cost: costOf(it) }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || (b.it.spentHours || 0) - (a.it.spentHours || 0))
    .slice(0, 10), [items])
  // сводка
  const stats = useMemo(() => {
    const crit = items.filter(it => it.priorityKey === "critical" || it.priorityKey === "blocker").length
    const done = items.filter(isResolved).length
    const hours = Math.round(items.reduce((s, it) => s + (it.spentHours || 0), 0))
    const rate = items.length ? Math.round(done / items.length * 100) : 0
    return { total: items.length, crit, done, open: items.length - done, hours, rate }
  }, [items])

  const statList = useMemo(() => {
    if (!statSel) return []
    const l = statSel === "crit" ? items.filter(it => it.priorityKey === "critical" || it.priorityKey === "blocker")
      : statSel === "open" ? items.filter(it => !isResolved(it))
      : items
    return l.slice().sort((a, b) => (b.created || "").localeCompare(a.created || ""))
  }, [statSel, items])

  const modalList = useMemo(() => {
    if (!sel) return []
    const list = sel.mode === "closed"
      ? teamItemsAll.filter(it => isResolved(it) && (it.resolved || "").slice(0, 7) === sel.month)
      : teamItemsAll.filter(it => it.month === sel.month)
    return list.sort((a, b) => {
      const key = (x: Incident) => (sel.mode === "closed" ? x.resolved : x.created) || ""
      return key(b).localeCompare(key(a))
    })
  }, [sel, teamItemsAll])

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
        <div className="flex items-center gap-2">
          <SectionInfo section="incidents" />
          <button onClick={() => { load(true); setRefreshKey(k => k + 1) }} disabled={loading} title="Пересчитать заново"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Обновить
          </button>
        </div>
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

      {!loading && resp && <IncidentsAI team={team} from={dates.from} to={dates.to} refreshKey={refreshKey} />}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">{Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : resp && (
        <>
          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            {([
              { label: "Всего инцидентов", value: stats.total, color: "text-foreground", kind: "all" as const },
              { label: "Критичных", value: stats.crit, color: "text-rose-500", kind: "crit" as const },
              { label: "Открытых", value: stats.open, color: "text-amber-500", kind: "open" as const },
              { label: "% завершено", value: `${stats.rate}%`, color: "text-emerald-500" },
              { label: "% времени (ср.)", value: `${avgShare}%`, color: "text-primary" },
              { label: "Часов суммарно", value: stats.hours, color: "text-foreground" },
            ] as { label: string; value: any; color: string; kind?: "all" | "crit" | "open" }[]).map(s => (
              <div key={s.label} onClick={s.kind ? () => setStatSel(s.kind!) : undefined}
                className={cn("rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]",
                  s.kind && "cursor-pointer hover:border-primary/40")}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}{s.kind && " ›"}</p>
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

          {/* СОЗДАНО vs ЗАКРЫТО по месяцам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>📊 Создано и закрыто по месяцам</CardTitle>
                {trend && (
                  <span className={cn("text-xs font-bold inline-flex items-center gap-1", trend.delta > 0 ? "text-rose-500" : trend.delta < 0 ? "text-emerald-500" : "text-muted-foreground")}
                    title={`Создано за период: ${trend.cur} · предыдущий равный (${trend.pf}–${trend.pt}): ${trend.prev}`}>
                    {trend.delta > 0 ? "▲" : trend.delta < 0 ? "▼" : "≈"} создано к пред. периоду {trend.delta > 0 ? "+" : ""}{trend.delta}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-semibold text-[#3B82F6]">создано</span> (по дате создания) и <span className="font-semibold text-emerald-500">закрыто</span> (по дате закрытия) · за период: создано <b>{flow.created}</b>, закрыто <b>{flow.closed}</b> — <b>{flow.ratio}%</b> · клик по столбцу — список
              </p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={createdClosed} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barGap={2} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                    content={({ active, payload, label }: any) => active && payload?.length
                      ? <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-xl">
                          <b>{label}</b><br />создано: {payload.find((p: any) => p.dataKey === "created")?.value ?? 0} · закрыто: {payload.find((p: any) => p.dataKey === "closed")?.value ?? 0}
                        </div> : null} />
                  <Bar dataKey="created" name="Создано" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={34} style={{ cursor: "pointer" }} onClick={(d: any) => d?.payload?.month && setSel({ month: d.payload.month, mode: "created" })}>
                    <LabelList dataKey="created" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#3B82F6" }} />
                  </Bar>
                  <Bar dataKey="closed" name="Закрыто" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={34} style={{ cursor: "pointer" }} onClick={(d: any) => d?.payload?.month && setSel({ month: d.payload.month, mode: "closed" })}>
                    <LabelList dataKey="closed" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#10B981" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-4 mt-3 justify-center text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#3B82F6]" /> создано (по дате создания)</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> закрыто (по дате закрытия)</span>
              </div>
            </CardContent>
          </Card>

          {/* СТОИМОСТЬ по месяцам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <CardTitle>💰 Стоимость инцидентов по месяцам</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">сколько потрачено в каждом месяце (по дате списания часов, все инциденты) = Σ часы × ставка роли · всего за период <b>{fmtRub(totalCost)}</b></p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={costRows} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barSize={34}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}к` : `${v}`} />
                  <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                    content={({ active, payload, label }: any) => active && payload?.length
                      ? <div className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs shadow-xl">
                          <b>{label}</b><br />{payload.map((p: any) => <div key={p.dataKey}>{queues[p.dataKey] || p.dataKey}: {fmtRub(p.value)}</div>)}
                          {costTeams.length > 1 && <div className="mt-0.5 border-t border-border pt-0.5">всего: {fmtRub(payload[0].payload.shownCost)}</div>}
                        </div> : null} />
                  {costTeams.map((q, i) => (
                    <Bar key={q} dataKey={q} stackId="a" name={queues[q] || q} fill={TEAM_COLOR[q]}
                      radius={i === costTeams.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                      {i === costTeams.length - 1 && (
                        <LabelList dataKey="shownCost" position="top" formatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}к` : (v || "")}
                          style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                      )}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 mt-3 justify-center">
                {teamQueues.map(q => {
                  const on = !costTeam || costTeam === q
                  return (
                    <button key={q} onClick={() => setCostTeam(t => t === q ? null : q)} disabled={teamQueues.length < 2}
                      className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition-all",
                        on ? "bg-secondary text-foreground" : "bg-secondary/30 text-muted-foreground/40 line-through",
                        teamQueues.length < 2 ? "cursor-default" : "hover:-translate-y-0.5")}>
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: TEAM_COLOR[q], opacity: on ? 1 : 0.3 }} />{queues[q] || q}
                    </button>
                  )
                })}
                {costTeam && <button onClick={() => setCostTeam(null)} className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">Сбросить</button>}
              </div>
            </CardContent>
          </Card>

          {/* ТОПЫ — каждый блок на всю ширину */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Clock className="w-4 h-4 text-amber-500" /> Дольше всех в работе — топ 10</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {topDays.length === 0 && <span className="text-xs text-muted-foreground/60">нет данных</span>}
              {topDays.map((it, i) => (
                <div key={it.key} className="flex items-center gap-2.5 text-xs rounded-md px-1.5 py-1 hover:bg-accent/30 transition-colors">
                  <span className="w-4 text-right text-muted-foreground/50 font-bold shrink-0">{i + 1}</span>
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline shrink-0 inline-flex items-center gap-1">{it.key} <ExternalLink className="w-3 h-3" /></a>
                  <span className="flex-1 truncate text-foreground">{it.summary}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{it.spentHours != null && <>{Math.round(it.spentHours)}ч · </>}{queues[it.queue] || it.queue}</span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 shrink-0 w-12 justify-center"><Clock className="w-3 h-3" />{it.daysInWork}д</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><Hourglass className="w-4 h-4 text-primary" /> Самые дорогие — топ 10</CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">стоимость = часы × ставка роли исполнителя</p>
            </CardHeader>
            <CardContent className="space-y-1">
              {topCost.length === 0 && <span className="text-xs text-muted-foreground/60">нет данных</span>}
              {topCost.map(({ it, cost }, i) => (
                <div key={it.key} className="flex items-center gap-2.5 text-xs rounded-md px-1.5 py-1 hover:bg-accent/30 transition-colors">
                  <span className="w-4 text-right text-muted-foreground/50 font-bold shrink-0">{i + 1}</span>
                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline shrink-0 inline-flex items-center gap-1">{it.key} <ExternalLink className="w-3 h-3" /></a>
                  <span className="flex-1 truncate text-foreground">{it.summary}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0">{Math.round(it.spentHours || 0)}ч{it.worklog?.length ? ` · ${it.worklog.length} логир.` : ""}</span>
                  {cost != null
                    ? <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-black text-emerald-600 dark:text-emerald-400 shrink-0 whitespace-nowrap">{fmtRub(cost)}</span>
                    : <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold text-primary shrink-0 w-12 justify-center" title="роль не задана — нет ставки"><Hourglass className="w-3 h-3" />{Math.round(it.spentHours || 0)}ч</span>}
                </div>
              ))}
            </CardContent>
          </Card>


          {/* Разбор по группам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle>🧩 Разбор инцидентов</CardTitle>
                <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
                  {([["cause", "По причине (AI)", Tag], ["stack", "По стеку", Layers], ["priority", "По приоритету", Flame], ["assignee", "По исполнителю", User]] as const).map(([v, label, Icon]) => (
                    <button key={v} onClick={() => { setGroupBy(v); setOpenGroup(null) }}
                      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                        groupBy === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground")}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {{ cause: "Причины, сгруппированные в кластеры через AI (внутри — исходные причины)", stack: "Сгруппировано по стеку", priority: "Сгруппировано по приоритету", assignee: "Сгруппировано по исполнителю («пожарные»)" }[groupBy]} · без резолюции «Не делаем» · доля от числа и от часов · клик — раскрыть
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
                          <IncidentRow key={it.key} it={it} queues={queues} showCause />
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

      <Modal open={!!sel} onClose={() => setSel(null)}
        title={`${sel?.mode === "closed" ? "Закрыто" : "Создано"} · ${sel ? monLabel(sel.month) : ""}`}
        subtitle={`${team === "all" ? "все команды" : (queues[team] || team)} · ${modalList.length} инц. · ${sel?.mode === "closed" ? "по дате закрытия" : "по дате создания"} · по ключу — в Трекер`} wide>
        {modalList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет инцидентов</div>
        ) : (
          <div className="space-y-1.5">{modalList.map(it => <IncidentRow key={it.key} it={it} queues={queues} />)}</div>
        )}
      </Modal>

      <Modal open={!!statSel} onClose={() => setStatSel(null)}
        title={{ all: "Все инциденты", crit: "Критичные инциденты", open: "Открытые инциденты" }[statSel || "all"]}
        subtitle={`${team === "all" ? "все команды" : (queues[team] || team)} · ${statList.length} инц. · за период · по ключу — в Трекер`} wide>
        {statList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет инцидентов</div>
        ) : (
          <div className="space-y-1.5">{statList.map(it => <IncidentRow key={it.key} it={it} queues={queues} />)}</div>
        )}
      </Modal>
    </div>
  )
}
