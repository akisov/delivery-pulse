import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

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
function rc(reason: string, idx: number) {
  return REASON_COLORS[reason] ?? EXTRA[idx % EXTRA.length]
}

const STAGE_COLORS: Record<string, string> = {
  "Аналит. проработка":     "#7C6FF7",
  "В разработке":           "#3B82F6",
  "Тестирование":           "#10B981",
  "Помещение в продуктив":  "#F97316",
  "На проверке у заказчика":"#EAB308",
}
const TYPE_COLORS = ["#7C6FF7","#3B82F6","#10B981","#F97316","#EF4444","#EAB308","#EC4899","#8B5CF6","#06B6D4","#F59E0B"]

function MiniTooltip({ active, payload, valueLabel = "кол-во" }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-2xl text-xs space-y-0.5">
      <p className="font-bold text-foreground">{d.payload?.reason ?? d.payload?.label ?? d.name}</p>
      <p className="text-muted-foreground">{valueLabel}: <span className="font-semibold text-foreground">{d.value}</span></p>
    </div>
  )
}

interface InsightsData {
  stages: { key: string; label: string; count: number }[]
  reasonsCount: { reason: string; count: number }[]
  reasonsAvg: { reason: string; avg: number; count: number }[]
  issueTypes: { type: string; count: number }[]
}

interface Props { dateFrom?: string; dateTo?: string; queue: string }

const CHART_H = 220

export function InsightsPanel({ dateFrom, dateTo, queue }: Props) {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (queue && queue !== "ALL") p.set("queues", queue)
    if (dateFrom) p.set("date_from", dateFrom)
    if (dateTo)   p.set("date_to", dateTo)
    fetch(`/insights?${p}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, queue])

  if (loading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
    </div>
  )
  if (!data) return null

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black tracking-tight text-foreground">Аналитика блокировок</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 1. На каких этапах чаще блокируются */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>На каких этапах чаще блокируются</CardTitle>
            <p className="text-xs text-muted-foreground">Кол-во блокировок по рабочим статусам задачи</p>
          </CardHeader>
          <CardContent>
            {!data.stages.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={data.stages} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={140}
                    tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MiniTooltip valueLabel="блокировок" />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]}>
                    {data.stages.map((s) => (
                      <Cell key={s.key} fill={STAGE_COLORS[s.label] ?? "#7C6FF7"} />
                    ))}
                    <LabelList dataKey="count" position="right"
                      style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 2. По каким причинам чаще блокируются */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>По каким причинам чаще блокируются</CardTitle>
            <p className="text-xs text-muted-foreground">Топ причин по количеству блокировок</p>
          </CardHeader>
          <CardContent>
            {!data.reasonsCount.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={data.reasonsCount} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="reason" width={160}
                    tick={{ fontSize: 10, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false}
                    tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + "…" : v} />
                  <Tooltip content={<MiniTooltip valueLabel="блокировок" />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]}>
                    {data.reasonsCount.map((r, i) => <Cell key={r.reason} fill={rc(r.reason, i)} />)}
                    <LabelList dataKey="count" position="right"
                      style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 3. Среднее время на разблокировку по причине */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Среднее время разблокировки по причине</CardTitle>
            <p className="text-xs text-muted-foreground">Сколько дней в среднем занимает каждая причина</p>
          </CardHeader>
          <CardContent>
            {!data.reasonsAvg.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={data.reasonsAvg} layout="vertical" margin={{ top: 4, right: 52, left: 4, bottom: 4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="reason" width={160}
                    tick={{ fontSize: 10, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false}
                    tickFormatter={(v: string) => v.length > 22 ? v.slice(0, 22) + "…" : v} />
                  <Tooltip content={<MiniTooltip valueLabel="дней (среднее)" />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
                  <Bar dataKey="avg" radius={[0,4,4,0]}>
                    {data.reasonsAvg.map((r, i) => <Cell key={r.reason} fill={rc(r.reason, i)} />)}
                    <LabelList dataKey="avg" position="right"
                      style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }}
                      formatter={(v: number) => `${v}д`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 4. Типы задач */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Какие типы задач чаще блокируются</CardTitle>
            <p className="text-xs text-muted-foreground">Уникальных задач с блокировками по типу</p>
          </CardHeader>
          <CardContent>
            {!data.issueTypes.length ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground text-center px-4">
                Нет данных о типах — запустите синк для обновления
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={CHART_H}>
                <BarChart data={data.issueTypes} layout="vertical" margin={{ top: 4, right: 48, left: 4, bottom: 4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="type" width={140}
                    tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MiniTooltip valueLabel="задач" />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]}>
                    {data.issueTypes.map((t, i) => <Cell key={t.type} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                    <LabelList dataKey="count" position="right"
                      style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  )
}

function Empty() {
  return <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Нет данных</div>
}
