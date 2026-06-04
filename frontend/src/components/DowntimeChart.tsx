import { useEffect, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const REASON_COLORS: Record<string, string> = {
  "Блок другой нашей задачей":       "#7C6FF7",
  "Внешний фактор":                  "#F97316",
  "Переключились на срочную задачу": "#EF4444",
  "Ждем дату или событие":           "#EAB308",
  "Отпуск, больничный":              "#EC4899",
  "Ждем фун. архитекторов":          "#F472B6",
  "Ждем ответа заказчика":           "#06B6D4",
  "Ждем тех. архитектров":           "#3B82F6",
  "Ждем тех. архитекторов":          "#3B82F6",
  "Ждем другую команду":             "#10B981",
  "Ждем партнера":                   "#F59E0B",
  "Мораторий":                       "#8B5CF6",
  "Ждем тестовую среду":             "#14B8A6",
  "Причина не известна":             "#94A3B8",
  "Не указана":                      "#64748B",
}
const EXTRA = ["#85EF47","#FB923C","#A78BFA","#34D399","#F87171","#60A5FA"]

function getColor(reason: string, idx: number) {
  return REASON_COLORS[reason] ?? EXTRA[idx % EXTRA.length]
}

interface Item { reason: string; totalDays: number; count: number; pct: number }

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as Item
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs space-y-1">
      <p className="font-bold text-foreground">{d.reason}</p>
      <p className="text-muted-foreground">Суммарно: <span className="font-semibold text-foreground">{d.totalDays} дн.</span></p>
      <p className="text-muted-foreground">Блокировок: <span className="font-semibold text-foreground">{d.count}</span></p>
      <p className="text-muted-foreground">Доля: <span className="font-semibold text-foreground">{d.pct}%</span></p>
    </div>
  )
}

interface Props { dateFrom?: string; dateTo?: string; queue: string }

export function DowntimeChart({ dateFrom, dateTo, queue }: Props) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeReasons, setActiveReasons] = useState<Set<string> | null>(null)

  const toggleReason = (reason: string) => {
    setActiveReasons(prev => {
      const next = new Set(prev ?? [])
      if (next.size === 0) return new Set([reason])
      if (next.has(reason)) { next.delete(reason); return next.size === 0 ? null : next }
      next.add(reason); return next
    })
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (queue && queue !== "ALL") params.set("queues", queue)
    if (dateFrom) params.set("date_from", dateFrom)
    if (dateTo)   params.set("date_to", dateTo)
    fetch(`/downtime-analysis?${params}`)
      .then(r => r.json())
      .then(d => { setItems(d.items); setTotal(d.totalDays) })
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, queue])

  if (loading) return <Card><CardContent className="pt-6"><Skeleton className="h-48 w-full rounded-xl" /></CardContent></Card>
  if (!items?.length) return null

  const visibleItems = activeReasons && activeReasons.size > 0
    ? items.filter(i => activeReasons.has(i.reason))
    : items
  const visibleTotal = visibleItems.reduce((s, i) => s + i.totalDays, 0)
  const chartData = [{ name: "Итого", ...Object.fromEntries(visibleItems.map(i => [i.reason, i.totalDays])) }]

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>📉 Общее время простоя по причинам</CardTitle>
          <span className="text-xs font-semibold text-foreground">{visibleTotal} дн. суммарно</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Сколько дней суммарно заняла каждая причина блокировки
        </p>
        {/* Кликабельные чипы как в BlockingChart */}
        <div className="flex flex-wrap gap-2 mt-2">
          {items.map((item, i) => {
            const isActive = !activeReasons || activeReasons.size === 0 || activeReasons.has(item.reason)
            return (
              <button key={item.reason} onClick={() => toggleReason(item.reason)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all",
                  isActive ? "text-foreground bg-secondary" : "text-muted-foreground/40 bg-secondary/30 line-through"
                )}>
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 transition-opacity"
                  style={{ background: getColor(item.reason, i), opacity: isActive ? 1 : 0.3 }} />
                {item.reason}
                <span className={cn("font-semibold", isActive ? "text-foreground" : "text-muted-foreground/40")}>
                  {item.totalDays}д
                </span>
                <span className="text-muted-foreground/50">({item.pct}%)</span>
              </button>
            )
          })}
          {activeReasons && activeReasons.size > 0 && (
            <button onClick={() => setActiveReasons(null)}
              className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">
              Сбросить
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <ResponsiveContainer width="100%" height={72}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 60, left: 0, bottom: 0 }} barSize={36}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            {visibleItems.map((item, i) => (
              <Bar key={item.reason} dataKey={item.reason} stackId="a"
                fill={getColor(item.reason, items.indexOf(item))}
                radius={i === visibleItems.length - 1 ? [0,4,4,0] : 0}
              >
                {i === visibleItems.length - 1 && (
                  <LabelList dataKey={item.reason} position="right"
                    style={{ fontSize: 12, fontWeight: 800, fill: "hsl(var(--foreground))" }}
                    formatter={() => `${visibleTotal}д`} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>

        {/* Таблица с деталями */}
        <div className="mt-4 space-y-1.5">
          {items.map((item, i) => (
            <div key={item.reason} className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: getColor(item.reason, i) }} />
              <span className="text-xs text-muted-foreground flex-1 truncate">{item.reason}</span>
              <span className="text-xs text-muted-foreground">{item.count} блок.</span>
              <div className="w-32 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${item.pct}%`, background: getColor(item.reason, i) }} />
              </div>
              <span className="text-xs font-bold text-foreground w-12 text-right">{item.totalDays}д</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
