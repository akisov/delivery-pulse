import { useEffect, useMemo, useRef, useState } from "react"
import { RefreshCw, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
function mlabel(m: string) { const [y, mo] = m.split("-"); return `${RU[+mo - 1]} ${y.slice(2)}` }

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]
const TYPE_COLORS: Record<string, string> = {
  "Story": "#3B82F6", "ТехДолг": "#F59E0B", "Тех. улучшение": "#A78BFA",
  "Инцидент": "#EF4444", "Аналитика": "#06B6D4", "Поддержка": "#10B981",
}
function typeColor(t: string) { return TYPE_COLORS[t] || "#94A3B8" }

interface Status { running: boolean; pct: number; msg: string; error: string }
interface Emp { name: string; total: number; by: Record<string, number>; pct: number }
interface CrossOut { name: string; cols: Record<string, number>; total: number }
interface CrossIn { name: string; team: string; hours: number }
interface Resp {
  ok: boolean; error?: string
  data: Record<string, Record<string, Record<string, number>>> | null  // month -> queue -> type -> hours
  months?: string[]; queues?: Record<string, string>; types?: string[]
  employees?: Record<string, Record<string, Emp[]>>   // month -> queue -> сотрудники
  crossOut?: Record<string, Record<string, CrossOut[]>>
  crossIn?: Record<string, Record<string, CrossIn[]>>
  updatedAt?: string; status?: Status
}

// число часов с подписью «ч» (ноль — точкой)
function H({ n, bold }: { n: number; bold?: boolean }) {
  const r = Math.round(n)
  if (!r) return <span className="text-muted-foreground/50">·</span>
  return <span className={cn("tabular-nums text-foreground", bold && "font-bold")}>{r}<span className="text-[10px] font-normal text-muted-foreground"> ч</span></span>
}

function Trend({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev == null) return null
  const d = cur - prev
  if (Math.abs(d) < 0.5) return <span className="text-[10px] text-muted-foreground">≈</span>
  const up = d > 0
  const pct = prev > 0 ? Math.round((d / prev) * 100) : null
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[10px] font-bold whitespace-nowrap",
      up ? "text-emerald-500" : "text-rose-500")}>
      {up ? "▲" : "▼"}{up ? "+" : ""}{Math.round(d)}ч{pct != null ? ` ${up ? "+" : ""}${pct}%` : ""}
    </span>
  )
}

const TH = "text-right px-2.5 py-2 border-b border-border whitespace-nowrap"
const TD = "px-2.5 py-2 border-b border-border/50 text-right"

function top<T>(arr: T[], val: (x: T) => number): T | null {
  let best: T | null = null, bv = 0
  for (const x of arr) { const v = val(x); if (v > bv) { bv = v; best = x } }
  return best
}

// Доп. таблицы по выбранной команде: по сотрудникам, в чужих очередях, чужие здесь
function TeamTables({ resp, month, q }: { resp: Resp; month: string; q: string }) {
  const types = resp.types ?? []
  const emps = resp.employees?.[month]?.[q] ?? []
  const cout = resp.crossOut?.[month]?.[q] ?? []
  const cin = resp.crossIn?.[month]?.[q] ?? []
  const outCols = Array.from(new Set(cout.flatMap(r => Object.keys(r.cols || {}))))
  if (!emps.length && !cout.length && !cin.length) return null

  // ключевые метрики
  const mostHours = top(emps, e => e.total)
  const leadStory = top(emps, e => e.by?.["Story"] || 0)
  const leadTech = top(emps, e => (e.by?.["ТехДолг"] || 0) + (e.by?.["Тех. улучшение"] || 0))
  const fireman = top(emps, e => e.by?.["Инцидент"] || 0)
  const outside = top(cout, r => r.total)
  const outsideTop = outside ? Object.entries(outside.cols || {}).sort((a, b) => b[1] - a[1])[0] : null
  const helper = top(cin, r => r.hours)
  const metrics: { icon: string; label: string; who: string; detail: string }[] = []
  if (mostHours) metrics.push({ icon: "🏆", label: "Больше всех часов", who: mostHours.name, detail: `${Math.round(mostHours.total)} ч` })
  if (leadStory) metrics.push({ icon: "📦", label: "Лидер по Story", who: leadStory.name, detail: `${Math.round(leadStory.by?.["Story"] || 0)} ч` })
  if (leadTech) metrics.push({ icon: "🛠", label: "Лидер по тех. долгу", who: leadTech.name, detail: `${Math.round((leadTech.by?.["ТехДолг"] || 0) + (leadTech.by?.["Тех. улучшение"] || 0))} ч` })
  if (fireman) metrics.push({ icon: "🚒", label: "Главный «пожарный»", who: fireman.name, detail: `${Math.round(fireman.by?.["Инцидент"] || 0)} ч на инциденты` })
  if (outside) metrics.push({ icon: "↗", label: "Работа вне своей очереди", who: outside.name, detail: `${Math.round(outside.total)} ч${outsideTop ? ` · ${outsideTop[0]}` : ""}` })
  if (helper) metrics.push({ icon: "🤝", label: "Кто помогал снаружи", who: helper.name, detail: `${Math.round(helper.hours)} ч · ${helper.team}` })

  return (
    <div className="mt-6 space-y-6">
      {metrics.length > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-foreground mb-2">⭐ Ключевые метрики</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {metrics.map(m => (
              <div key={m.label} className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
                <span className="text-lg leading-none mt-0.5">{m.icon}</span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{m.label}</p>
                  <p className="text-sm font-bold text-foreground truncate">{m.who}</p>
                  <p className="text-[11px] text-muted-foreground">{m.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {emps.length > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-foreground mb-2">👤 Часы по сотрудникам</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead><tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-2.5 py-2 border-b border-border">Сотрудник</th>
                <th className={TH}>Всего</th>
                {types.map(t => <th key={t} className={TH} style={{ color: typeColor(t) }}>{t}</th>)}
                <th className={TH}>%</th>
              </tr></thead>
              <tbody>
                {emps.map(e => (
                  <tr key={e.name} className="hover:bg-accent/30 transition-colors">
                    <td className="px-2.5 py-2 border-b border-border/50 whitespace-nowrap text-foreground">{e.name}</td>
                    <td className={TD}><H n={e.total} bold /></td>
                    {types.map(t => <td key={t} className={TD}><H n={e.by?.[t] || 0} /></td>)}
                    <td className={cn(TD, "tabular-nums text-muted-foreground")}>{e.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cout.length > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-foreground mb-2">↗ Часы команды в других очередях</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead><tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-2.5 py-2 border-b border-border">Сотрудник</th>
                {outCols.map(c => <th key={c} className={TH}>{c}</th>)}
                <th className={TH}>Итого вне своей</th>
              </tr></thead>
              <tbody>
                {cout.map(r => (
                  <tr key={r.name} className="hover:bg-accent/30 transition-colors">
                    <td className="px-2.5 py-2 border-b border-border/50 whitespace-nowrap text-foreground">{r.name}</td>
                    {outCols.map(c => <td key={c} className={TD}><H n={r.cols?.[c] || 0} /></td>)}
                    <td className={TD}><H n={r.total} bold /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {cin.length > 0 && (
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-foreground mb-2">↘ Сотрудники других команд в этой очереди</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead><tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-2.5 py-2 border-b border-border">Сотрудник</th>
                <th className="text-left px-2.5 py-2 border-b border-border">Команда</th>
                <th className={TH}>Часы</th>
              </tr></thead>
              <tbody>
                {cin.map((r, i) => (
                  <tr key={r.name + i} className="hover:bg-accent/30 transition-colors">
                    <td className="px-2.5 py-2 border-b border-border/50 whitespace-nowrap text-foreground">{r.name}</td>
                    <td className="px-2.5 py-2 border-b border-border/50 text-muted-foreground whitespace-nowrap">{r.team}</td>
                    <td className={TD}><H n={r.hours} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export function OSPTime({ queue, month: gMonth, refreshKey }: { queue?: string; month?: string; refreshKey?: number }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = (): Promise<Resp | null> =>
    fetch("/osp-worklog").then(r => r.json()).then((d: Resp) => { setResp(d); return d }).catch(() => null)

  const startPoll = () => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const s = await fetch("/osp-worklog/status").then(r => r.json()).catch(() => null) as Status | null
      setResp(prev => prev ? { ...prev, status: s || prev.status } : prev)
      if (s && !s.running) {
        clearInterval(pollRef.current!); pollRef.current = null
        await fetchData()
      }
    }, 2500)
  }

  useEffect(() => {
    fetchData().then(d => {
      setLoading(false)
      if (d && d.data == null && d.status?.running) startPoll()
    })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // общий рефреш из шапки ОСП — просто перечитываем кэш (без пересбора worklog)
  useEffect(() => { if (refreshKey) fetchData() }, [refreshKey])

  const build = async () => {
    await fetch("/osp-worklog/build", { method: "POST" }).catch(() => {})
    setResp(prev => prev ? { ...prev, status: { running: true, pct: 2, msg: "Запускаем…", error: "" } } : prev)
    startPoll()
  }

  const months = resp?.months ?? []
  // отчётный месяц задаётся глобально; если его нет в данных — берём последний доступный ≤ него
  const month = useMemo(() => {
    if (gMonth && months.includes(gMonth)) return gMonth
    const le = months.filter(m => !gMonth || m <= gMonth)
    return le.length ? le[le.length - 1] : (months[months.length - 1] || "")
  }, [gMonth, months])
  const prevMonth = useMemo(() => {
    const i = months.indexOf(month)
    return i > 0 ? months[i - 1] : undefined
  }, [months, month])

  // часы: тип -> команда -> ч (для месяца m)
  const hoursFor = (m: string | undefined, q: string, t: string) =>
    (m && resp?.data?.[m]?.[q]?.[t]) || 0
  const types = resp?.types ?? []
  const allTeams = TEAM_ORDER.filter(q => resp?.queues?.[q])
  // общий фильтр команды (из раздела ОСП): одна команда → показываем только её
  const teams = queue && queue !== "all" ? allTeams.filter(q => q === queue) : allTeams
  const showTotal = teams.length > 1

  const colTotal = (m: string | undefined, q: string) => types.reduce((s, t) => s + hoursFor(m, q, t), 0)
  const rowTotal = (m: string | undefined, t: string) => teams.reduce((s, q) => s + hoursFor(m, q, t), 0)
  const grand = (m: string | undefined) => teams.reduce((s, q) => s + colTotal(m, q), 0)
  // сумма часов по типу в текущей выборке (для скрытия нулевых типов)
  const typeTotal = (m: string | undefined, t: string) => showTotal ? rowTotal(m, t) : (teams[0] ? hoursFor(m, teams[0], t) : 0)
  // итог по выбранной команде/командам
  const selTotal = (m: string | undefined) => showTotal ? grand(m) : (teams[0] ? colTotal(m, teams[0]) : 0)
  const visibleTypes = types.filter(t => typeTotal(month, t) > 0)
  const pct = (m: string | undefined, t: string) => {
    const tot = selTotal(m); return tot ? Math.round(typeTotal(m, t) / tot * 1000) / 10 : 0
  }
  // выбрана одна команда → показываем посотрудниковый разрез и кросс-очередь
  const singleQ = queue && queue !== "all" ? queue : null

  const status = resp?.status

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Clock className="w-4 h-4" /> Распределение времени</CardTitle>
          {resp?.updatedAt && <span className="text-[11px] text-muted-foreground">обновлено: {resp.updatedAt}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Часы списаны в пределах месяца (по дате worklog), а не по дате задачи · по типам и командам · тренд — к предыдущему месяцу</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : status?.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {status.error}</div>
        ) : !resp?.data ? (
          <div className="flex flex-col items-center justify-center gap-3 h-48 text-center">
            {status?.running ? (
              <>
                <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Собираем worklog из Трекера… {status.pct}%</p>
                <p className="text-xs text-muted-foreground/70">{status.msg}</p>
                <div className="w-64 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${status.pct}%` }} />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Данные worklog ещё не собраны</p>
                <button onClick={build} className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 h-9 text-sm font-semibold">
                  <RefreshCw className="w-4 h-4" /> Собрать
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {/* отчётный месяц (задаётся глобально) + чип итога часов */}
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <span className="text-sm font-bold text-foreground capitalize">{mlabel(month)}</span>
              <div className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Итого</span>
                <span className="text-base font-black tracking-tight text-foreground">{Math.round(selTotal(month))}<span className="text-xs font-bold text-muted-foreground"> ч</span></span>
                <Trend cur={selTotal(month)} prev={prevMonth ? selTotal(prevMonth) : undefined} />
              </div>
            </div>

            {/* таблица тип × команда (+ % и тренд) */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-2.5 py-2 border-b border-border">Тип</th>
                    {teams.map(q => <th key={q} className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">{resp.queues?.[q]}, ч</th>)}
                    {showTotal && <th className="text-right px-2.5 py-2 border-b border-border">Итого, ч</th>}
                    <th className="text-right px-2.5 py-2 border-b border-border">%</th>
                    <th className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">Δ м/м</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTypes.map(t => (
                    <tr key={t} className="hover:bg-accent/30 transition-colors">
                      <td className="px-2.5 py-2 border-b border-border/50 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: typeColor(t) }} />{t}</span>
                      </td>
                      {teams.map(q => (
                        <td key={q} className="px-2.5 py-2 border-b border-border/50 text-right"><H n={hoursFor(month, q, t)} bold={!showTotal} /></td>
                      ))}
                      {showTotal && <td className="px-2.5 py-2 border-b border-border/50 text-right"><H n={rowTotal(month, t)} bold /></td>}
                      <td className="px-2.5 py-2 border-b border-border/50 text-right tabular-nums text-muted-foreground">{pct(month, t)}%</td>
                      <td className="px-2.5 py-2 border-b border-border/50 text-right"><Trend cur={typeTotal(month, t)} prev={prevMonth ? typeTotal(prevMonth, t) : undefined} /></td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="px-2.5 py-2 border-t-2 border-border">ИТОГО</td>
                    {teams.map(q => (
                      <td key={q} className="px-2.5 py-2 border-t-2 border-border text-right"><H n={colTotal(month, q)} bold /></td>
                    ))}
                    {showTotal && <td className="px-2.5 py-2 border-t-2 border-border text-right"><H n={grand(month)} bold /></td>}
                    <td className="px-2.5 py-2 border-t-2 border-border text-right tabular-nums text-muted-foreground">100%</td>
                    <td className="px-2.5 py-2 border-t-2 border-border text-right"><Trend cur={selTotal(month)} prev={prevMonth ? selTotal(prevMonth) : undefined} /></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Доп. таблицы по одной команде */}
            {singleQ && <TeamTables resp={resp} month={month} q={singleQ} />}
          </>
        )}
      </CardContent>
    </Card>
  )
}
