import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

interface StatusData {
  statusKey: string
  statusDisplay: string
  count: number
  avg: number
  p90: number
  values: number[]
}

interface Props {
  dateFrom?: string
  dateTo?: string
  queue: string
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as StatusData
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs space-y-1.5">
      <p className="font-bold text-foreground">{d.statusDisplay}</p>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#7C6FF7" }} />
        <span className="text-muted-foreground">Среднее:</span>
        <span className="font-semibold text-foreground">{d.avg} дн.</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#F97316" }} />
        <span className="text-muted-foreground">P90:</span>
        <span className="font-semibold text-foreground">{d.p90} дн.</span>
      </div>
      <div className="pt-1 border-t border-border text-muted-foreground">
        {d.count} блокировок
      </div>
    </div>
  )
}

export function StatusChart({ dateFrom, dateTo, queue }: Props) {
  const [data, setData] = useState<StatusData[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (queue && queue !== "ALL") params.set("queues", queue)
    if (dateFrom) params.set("date_from", dateFrom)
    if (dateTo)   params.set("date_to", dateTo)

    fetch(`/status-analysis?${params}`)
      .then(r => r.json())
      .then(d => {
        const statuses = (d.statuses as StatusData[]).filter(s => s.count > 0)
        setData(statuses)
        setEmpty(statuses.length === 0)
      })
      .catch(() => setEmpty(true))
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, queue])

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Блокировки по этапам работы</CardTitle>
          {data && <span className="text-xs text-muted-foreground">среднее и P90 в днях</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          На каком рабочем статусе задачи чаще всего блокируются и насколько долго
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-56 w-full rounded-xl" />
        ) : empty ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
            Нет данных — запустите загрузку changelog
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={data!}
              margin={{ top: 16, right: 24, left: 0, bottom: 0 }}
              barCategoryGap="30%"
              barGap={4}
            >
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis
                dataKey="statusDisplay"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                label={{ value: "дней", angle: -90, position: "insideLeft", offset: 10, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
              <Legend
                formatter={(value) => value === "avg" ? "Среднее" : "P90"}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="avg" name="avg" fill="#7C6FF7" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="avg" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#7C6FF7" }} formatter={(v: number) => v > 0 ? `${v}д` : ""} />
              </Bar>
              <Bar dataKey="p90" name="p90" fill="#F97316" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="p90" position="top" style={{ fontSize: 10, fontWeight: 700, fill: "#F97316" }} formatter={(v: number) => v > 0 ? `${v}д` : ""} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
