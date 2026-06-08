import { useEffect, useMemo, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { RefreshCw, Lock, ExternalLink } from "lucide-react"
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
function reasonColor(r: string, i: number) { return REASON_COLORS[r] ?? EXTRA[i % EXTRA.length] }

interface Row { month: string; label: string; all: Record<string, number>; [q: string]: any }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  months: string[]
  reasons: string[]
  data: Row[]
}

export function OSPBlockings({ queue, onOpenDashboard }: { queue?: string; onOpenDashboard?: () => void }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    fetch("/osp-blockings?months=6").then(r => r.json())
      .then((d: Resp) => { if (d.ok) setResp(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const teamLabel = !queue || queue === "all" ? "Все команды" : (resp?.queues?.[queue] || queue)

  const chartData = useMemo(() => {
    if (!resp) return []
    return resp.data.map(row => {
      const src: Record<string, number> = (queue && queue !== "all") ? (row[queue] || {}) : row.all
      const o: Record<string, any> = { label: row.label, total: 0 }
      resp.reasons.forEach(rs => { o[rs] = src[rs] || 0; o.total += src[rs] || 0})
      return o
    })
  }, [resp, queue])

  // причины, реально встречающиеся в текущей выборке (чтобы не плодить пустые)
  const reasons = useMemo(() => {
    if (!resp) return []
    return resp.reasons.filter(rs => chartData.some(r => r[rs] > 0))
  }, [resp, chartData])

  const grandTotal = chartData.reduce((s, r) => s + r.total, 0)

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Lock className="w-4 h-4" /> Блокировки — динамика по месяцам</CardTitle>
          <div className="flex items-center gap-2">
            {onOpenDashboard && (
              <button onClick={onOpenDashboard}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-8 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                Дашборд блокировок <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={load} disabled={loading} title="Обновить"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Дни блокировки, попадающие в каждый месяц (с обрезкой по границам), с разбивкой по причинам · {teamLabel}
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}
        {loading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : grandTotal === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Нет блокировок за период</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barSize={36}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit=" д" />
                <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                {reasons.map((rs, i) => (
                  <Bar key={rs} dataKey={rs} stackId="a" name={rs} fill={reasonColor(rs, resp!.reasons.indexOf(rs))}
                    radius={i === reasons.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}>
                    {i === reasons.length - 1 && (
                      <LabelList dataKey="total" position="top"
                        style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} formatter={(v: number) => `${v}д`} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>

            {/* легенда причин */}
            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {reasons.map(rs => (
                <span key={rs} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: reasonColor(rs, resp!.reasons.indexOf(rs)) }} />
                  {rs}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
