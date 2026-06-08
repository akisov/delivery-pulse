import { useEffect, useMemo, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const REASON_COLORS: Record<string, string> = {
  "Блок другой нашей задачей": "#7C6FF7",
  "Внешний фактор": "#F97316",
  "Переключились на срочную задачу": "#EF4444",
  "Ждем дату или событие": "#EAB308",
  "Отпуск, больничный": "#EC4899",
  "Ждем фун. архитекторов": "#F472B6",
  "Ждем ответа заказчика": "#06B6D4",
  "Ждем тех. архитектров": "#3B82F6",
  "Ждем тех. архитекторов": "#3B82F6",
  "Ждем другую команду": "#10B981",
  "Ждем партнера": "#F59E0B",
  "Мораторий": "#8B5CF6",
  "Ждем тестовую среду": "#14B8A6",
  "Причина не известна": "#94A3B8",
  "Не указана": "#64748B",
}
const EXTRA = ["#85EF47", "#FB923C", "#A78BFA", "#34D399", "#F87171", "#60A5FA"]

interface Row { month: string; label: string; all: Record<string, number>; [q: string]: any }
interface Resp { ok: boolean; queues: Record<string, string>; months: string[]; reasons: string[]; data: Row[] }

// для блокировок: рост дней — плохо (красный), снижение — хорошо (зелёный)
function Trend({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev == null) return null
  const dd = cur - prev
  if (Math.abs(dd) < 0.5) return <span className="text-[11px] text-muted-foreground">≈ как в прошлом месяце</span>
  const up = dd > 0
  const pct = prev > 0 ? Math.round((dd / prev) * 100) : null
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-bold", up ? "text-rose-500" : "text-emerald-500")}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{Math.round(dd)} дн{pct != null ? ` (${up ? "+" : ""}${pct}%)` : ""} к прошлому месяцу
    </span>
  )
}

export function BlockingDaysTrend({ queue }: { queue: string }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch("/osp-blockings?months=6").then(r => r.json())
      .then((d: Resp) => setResp(d.ok ? d : null))
      .catch(() => setResp(null))
      .finally(() => setLoading(false))
  }, [])

  const q = !queue || queue === "ALL" ? "all" : queue
  const rColor = (r: string) => REASON_COLORS[r] ?? EXTRA[(resp?.reasons.indexOf(r) ?? 0) % EXTRA.length]

  const chartData = useMemo(() => {
    if (!resp) return []
    return resp.data.map(row => {
      const src: Record<string, number> = q === "all" ? row.all : (row[q] || {})
      const o: Record<string, any> = { label: row.label, total: 0 }
      resp.reasons.forEach(rs => { o[rs] = src[rs] || 0; o.total += src[rs] || 0 })
      return o
    })
  }, [resp, q])

  const reasons = useMemo(
    () => (resp?.reasons ?? []).filter(rs => chartData.some(r => r[rs] > 0)),
    [resp, chartData]
  )
  const grand = chartData.reduce((s, r) => s + r.total, 0)
  const lastTwo = chartData.filter(r => r.total > 0)
  const cur = chartData.length ? chartData[chartData.length - 1].total : 0
  const prev = chartData.length > 1 ? chartData[chartData.length - 2].total : undefined

  if (!loading && (!resp || grand === 0)) return null

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>📉 Дни блокировок по месяцам</CardTitle>
          {!loading && lastTwo.length > 0 && <Trend cur={cur} prev={prev} />}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Суммарные дни блокировок, попавшие в каждый месяц (с обрезкой по границам) · по причинам
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barSize={36}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit=" д" />
                <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                {reasons.map((rs, i) => (
                  <Bar key={rs} dataKey={rs} stackId="a" name={rs} fill={rColor(rs)} radius={i === reasons.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                    {i === reasons.length - 1 && (
                      <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} formatter={(v: number) => `${v}д`} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3 justify-center">
              {reasons.map(rs => (
                <span key={rs} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: rColor(rs) }} />{rs}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
