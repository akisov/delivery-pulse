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
interface Resp {
  ok: boolean; error?: string
  data: Record<string, Record<string, Record<string, number>>> | null  // month -> queue -> type -> hours
  months?: string[]; queues?: Record<string, string>; types?: string[]
  updatedAt?: string; status?: Status
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

export function OSPTime({ queue }: { queue?: string }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState<string>("")
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

  // выбираем последний месяц по умолчанию
  useEffect(() => {
    if (resp?.months?.length && !month) setMonth(resp.months[resp.months.length - 1])
  }, [resp, month])

  const build = async () => {
    await fetch("/osp-worklog/build", { method: "POST" }).catch(() => {})
    setResp(prev => prev ? { ...prev, status: { running: true, pct: 2, msg: "Запускаем…", error: "" } } : prev)
    startPoll()
  }

  const months = resp?.months ?? []
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

  const status = resp?.status

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Clock className="w-4 h-4" /> Распределение времени</CardTitle>
          <div className="flex items-center gap-2">
            {resp?.updatedAt && <span className="text-[11px] text-muted-foreground">обновлено: {resp.updatedAt}</span>}
            <button onClick={build} disabled={status?.running} title="Пересобрать worklog из Трекера"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
              <RefreshCw className={cn("w-4 h-4", status?.running && "animate-spin")} />
            </button>
          </div>
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
            {/* переключатель месяца + чип итога часов рядом */}
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex gap-1 bg-card border border-border rounded-lg p-1 flex-wrap">
                {months.map(m => (
                  <button key={m} onClick={() => setMonth(m)}
                    className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize",
                      month === m ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
                    {mlabel(m)}
                  </button>
                ))}
              </div>
              <div className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Итого</span>
                <span className="text-base font-black tracking-tight text-foreground">{Math.round(selTotal(month))}<span className="text-xs font-bold text-muted-foreground"> ч</span></span>
                <Trend cur={selTotal(month)} prev={prevMonth ? selTotal(prevMonth) : undefined} />
              </div>
            </div>

            {/* таблица тип × команда */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-2.5 py-2 border-b border-border">Тип</th>
                    {teams.map(q => <th key={q} className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">{resp.queues?.[q]}</th>)}
                    {showTotal && <th className="text-right px-2.5 py-2 border-b border-border">Итого</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleTypes.map(t => (
                    <tr key={t} className="hover:bg-accent/30 transition-colors">
                      <td className="px-2.5 py-2 border-b border-border/50 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: typeColor(t) }} />{t}</span>
                      </td>
                      {teams.map(q => (
                        <td key={q} className="px-2.5 py-2 border-b border-border/50 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="tabular-nums text-foreground">{Math.round(hoursFor(month, q, t)) || <span className="text-muted-foreground/50">·</span>}</span>
                            {!showTotal && <Trend cur={hoursFor(month, q, t)} prev={prevMonth ? hoursFor(prevMonth, q, t) : undefined} />}
                          </div>
                        </td>
                      ))}
                      {showTotal && (
                        <td className="px-2.5 py-2 border-b border-border/50 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="font-bold tabular-nums text-foreground">{Math.round(rowTotal(month, t))}</span>
                            <Trend cur={rowTotal(month, t)} prev={prevMonth ? rowTotal(prevMonth, t) : undefined} />
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td className="px-2.5 py-2 border-t-2 border-border">ИТОГО</td>
                    {teams.map(q => (
                      <td key={q} className="px-2.5 py-2 border-t-2 border-border text-right tabular-nums">{Math.round(colTotal(month, q))}</td>
                    ))}
                    {showTotal && <td className="px-2.5 py-2 border-t-2 border-border text-right tabular-nums">{Math.round(grand(month))}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
