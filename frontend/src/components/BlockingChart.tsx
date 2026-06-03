import { useState, useMemo } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { BlockedTask } from "@/lib/types"

// Цветовая палитра по причинам блокировки
const REASON_COLORS: Record<string, string> = {
  "Блок другой нашей задачей": "hsl(252,87%,70%)",
  "Ждем дату или событие":     "hsl(38,92%,50%)",
  "Внешняя зависимость":       "hsl(199,89%,60%)",
  "Ждем ответа":               "hsl(166,76%,40%)",
  "Технический блок":          "hsl(350,89%,60%)",
  "Не указана":                "hsl(215,16%,47%)",
}

const FALLBACK_COLORS = [
  "hsl(280,70%,65%)", "hsl(320,70%,60%)", "hsl(60,80%,55%)",
  "hsl(180,60%,50%)", "hsl(30,90%,55%)",  "hsl(240,60%,65%)",
]

function getReasonColor(reason: string, allReasons: string[]): string {
  if (REASON_COLORS[reason]) return REASON_COLORS[reason]
  const idx = allReasons.indexOf(reason)
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

interface CustomTooltipProps {
  active?: boolean
  payload?: any[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const task = payload[0]?.payload
  if (!task) return null

  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl max-w-xs">
      <p className="text-xs font-bold text-foreground mb-1">{task.key}</p>
      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{task.title}</p>
      <div className="space-y-1">
        {task.blockings?.map((b: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0"
              style={{ background: getReasonColor(b.reason, []) }} />
            <span className="text-muted-foreground">{b.reason}</span>
            <span className="font-semibold text-foreground ml-auto">{b.days}д</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-border flex justify-between text-xs">
        <span className="text-muted-foreground">Итого</span>
        <span className="font-black text-primary">{task.totalDays} дн.</span>
      </div>
    </div>
  )
}

interface Props {
  tasks: BlockedTask[]
  onTaskClick: (task: BlockedTask) => void
}

export function BlockingChart({ tasks, onTaskClick }: Props) {
  // Собираем все уникальные причины для легенды
  const allReasons = useMemo(() => {
    const set = new Set<string>()
    tasks.forEach(t => t.blockings.forEach(b => set.add(b.reason)))
    return Array.from(set)
  }, [tasks])

  // Данные для графика: каждая задача — стек из сегментов по причинам
  const chartData = useMemo(() => {
    return tasks.map(task => {
      const byReason: Record<string, number> = {}
      task.blockings.forEach(b => {
        byReason[b.reason] = (byReason[b.reason] ?? 0) + b.days
      })
      return {
        key: task.key,
        title: task.title,
        totalDays: task.totalDays,
        blockings: task.blockings,
        queue: task.queue,
        url: task.url,
        ...byReason,
      }
    })
  }, [tasks])

  if (!tasks.length) {
    return (
      <Card>
        <CardHeader><CardTitle>Время разрешения блокировок</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
            Нет данных о блокировках
          </div>
        </CardContent>
      </Card>
    )
  }

  // Адаптивная высота
  const barHeight = 32
  const chartHeight = Math.max(300, tasks.length * barHeight + 60)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Время разрешения блокировок</CardTitle>
          <span className="text-xs text-muted-foreground">{tasks.length} задач</span>
        </div>
        {/* Легенда */}
        <div className="flex flex-wrap gap-3 mt-2">
          {allReasons.map(r => (
            <span key={r} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ background: getReasonColor(r, allReasons) }} />
              {r}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-4 pr-4">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 60, left: 0, bottom: 8 }}
            barSize={20}
          >
            <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
              label={{ value: "дней", position: "insideRight", offset: -4, fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            />
            <YAxis
              type="category"
              dataKey="key"
              width={120}
              tick={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => v}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.5 }} />
            {allReasons.map((reason, ri) => (
              <Bar
                key={reason}
                dataKey={reason}
                stackId="a"
                fill={getReasonColor(reason, allReasons)}
                radius={ri === allReasons.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                onClick={(data) => {
                  const task = tasks.find(t => t.key === data.key)
                  if (task) onTaskClick(task)
                }}
                style={{ cursor: "pointer" }}
              >
                {ri === allReasons.length - 1 && (
                  <LabelList
                    dataKey="totalDays"
                    position="right"
                    style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }}
                    formatter={(v: number) => `${v}д`}
                  />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
