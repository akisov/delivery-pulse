import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from "recharts"
import { RefreshCw, ChevronDown, ChevronUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const CAT_COLORS: Record<string, string> = {
  story:    "#3B82F6", // Работа по ТЗ
  tech:     "#F59E0B", // Тех. долг (+ Тех. улучшение)
  incident: "#EF4444", // Инциденты
}

interface CatCounts { story: number; tech: number; incident: number; total: number }
interface Row { month: string; label: string; all: CatCounts; [q: string]: any }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  categories: { key: string; label: string }[]
  months: string[]
  data: Row[]
  totals: Record<string, number>
  seenTypes: Record<string, number>
}

const PERIODS = [["6", "6 мес."], ["9", "9 мес."], ["12", "12 мес."]] as const

export function OSPPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState("6")
  const [queue, setQueue] = useState<string>("POOLING")  // отчёт показываем по одной команде
  const [showTypes, setShowTypes] = useState(false)

  const load = (m = months) => {
    setLoading(true); setError(null)
    fetch(`/osp-delivery?months=${m}`).then(r => r.json())
      .then((d: Resp) => { if (d.ok) setData(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [months])

  // данные графика для выбранной очереди (или сумма по всем)
  const chartData = useMemo(() => {
    if (!data) return []
    return data.data.map(row => {
      const c: CatCounts = queue === "all" ? row.all : row[queue]
      return { label: row.label, story: c.story, tech: c.tech, incident: c.incident, total: c.total }
    })
  }, [data, queue])

  // суммы по выбранной очереди за весь период
  const totals = useMemo(() => {
    const t = { story: 0, tech: 0, incident: 0, total: 0 }
    chartData.forEach(r => { t.story += r.story; t.tech += r.tech; t.incident += r.incident; t.total += r.total })
    return t
  }, [chartData])

  const cats = data?.categories ?? []
  // команды (очереди курьеров) — выбираем одну; «Все» в конце как опция
  const queueTabs: [string, string][] = [...Object.entries(data?.queues ?? {}), ["all", "Все команды"]]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">ОСП — обзор сервиса поставки</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Сколько сделали по месяцам · Story · Тех. долг · Инциденты · по командам курьеров (X / U / R)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
            {PERIODS.map(([v, label]) => (
              <button key={v} onClick={() => setMonths(v)}
                className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
                  months === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-secondary")}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => load()} disabled={loading} title="Обновить"
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {/* Выбор команды — отчёт показываем по одной команде за месяц */}
      {data && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {queueTabs.map(([v, label]) => (
              <button key={v} onClick={() => setQueue(v)}
                className={cn("px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap",
                  queue === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : data && (
        <>
          {/* Сводка по категориям */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Всего сделано</p>
              <p className="text-2xl font-black tracking-tight leading-none mt-1 text-foreground">{totals.total}</p>
            </div>
            {cats.map(c => (
              <div key={c.key} className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: CAT_COLORS[c.key] }} /> {c.label}
                </p>
                <p className="text-2xl font-black tracking-tight leading-none mt-1" style={{ color: CAT_COLORS[c.key] }}>
                  {(totals as any)[c.key]}
                </p>
              </div>
            ))}
          </div>

          {/* График по месяцам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between">
                <CardTitle>📦 Сколько мы сделали — по месяцам</CardTitle>
                <span className="text-xs text-muted-foreground">{queueTabs.find(([v]) => v === queue)?.[1]}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Завершённые задачи (по дате завершения), с накоплением по категориям</p>
            </CardHeader>
            <CardContent>
              {totals.total === 0 ? (
                <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Нет завершённых задач за период</div>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barSize={28}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {cats.map((c, i) => (
                      <Bar key={c.key} dataKey={c.key} stackId="a" name={c.label} fill={CAT_COLORS[c.key]}
                        radius={i === cats.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                        {i === cats.length - 1 && (
                          <LabelList dataKey="total" position="top"
                            style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                        )}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Диагностика: какие типы задач реально встретились (для проверки маппинга) */}
          {data.seenTypes && Object.keys(data.seenTypes).length > 0 && (
            <div>
              <button onClick={() => setShowTypes(s => !s)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                {showTypes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                типы задач в выборке ({Object.keys(data.seenTypes).length})
              </button>
              {showTypes && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(data.seenTypes).map(([t, n]) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
                      {t} <span className="font-bold text-foreground">{n}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
