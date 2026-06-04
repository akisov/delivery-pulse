import { useState, useMemo, useCallback } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { BlockedTask } from "@/lib/types"
import { cn } from "@/lib/utils"

const REASON_COLORS: Record<string, string> = {
  "Блок другой нашей задачей":       "#7C6FF7", // фиолетовый
  "Внешний фактор":                  "#F97316", // оранжевый
  "Переключились на срочную задачу": "#EF4444", // красный
  "Ждем дату или событие":           "#EAB308", // жёлтый
  "Отпуск, больничный":              "#EC4899", // розовый
  "Ждем фун. архитекторов":          "#F472B6", // светло-розовый
  "Ждем ответа заказчика":           "#06B6D4", // циан
  "Ждем тех. архитектров":           "#3B82F6", // синий
  "Ждем тех. архитекторов":          "#3B82F6", // синий (опечатка в данных)
  "Ждем другую команду":             "#10B981", // зелёный
  "Ждем партнера":                   "#F59E0B", // янтарный
  "Мораторий":                       "#8B5CF6", // тёмно-фиолетовый
  "Ждем тестовую среду":             "#14B8A6", // бирюзовый
  "Причина не известна":             "#94A3B8", // серый
  "Не указана":                      "#64748B", // тёмно-серый
}

// Дополнительные цвета для любых других причин
const EXTRA_COLORS = [
  "hsl(85,65%,48%)",  "hsl(60,80%,48%)",  "hsl(105,60%,48%)",
  "hsl(340,75%,58%)", "hsl(270,60%,62%)", "hsl(210,75%,55%)",
]

function getReasonColor(reason: string, allReasons: string[]): string {
  if (REASON_COLORS[reason]) return REASON_COLORS[reason]
  const idx = allReasons.filter(r => !REASON_COLORS[r]).indexOf(reason)
  return EXTRA_COLORS[idx % EXTRA_COLORS.length]
}

// Кастомный тик по оси Y — ключ задачи как badge-ссылка
function YAxisTick({ x, y, payload, tasksMap }: any) {
  const key = payload?.value
  const task = tasksMap[key]
  if (!key) return null

  // Цвет по очереди
  const queueColor: Record<string, string> = {
    POOLING:      "rgba(108,99,255,0.15)",
    DOSTAVKAPIKO: "rgba(52,211,153,0.15)",
    UDOSTAVKA:    "rgba(56,189,248,0.15)",
  }
  const queueBorder: Record<string, string> = {
    POOLING:      "rgba(108,99,255,0.5)",
    DOSTAVKAPIKO: "rgba(52,211,153,0.5)",
    UDOSTAVKA:    "rgba(56,189,248,0.5)",
  }
  const queueText: Record<string, string> = {
    POOLING:      "hsl(252,87%,65%)",
    DOSTAVKAPIKO: "hsl(166,76%,40%)",
    UDOSTAVKA:    "hsl(199,89%,55%)",
  }
  const queue = task?.queue ?? ""
  const bg     = queueColor[queue]  ?? "rgba(108,99,255,0.1)"
  const border = queueBorder[queue] ?? "rgba(108,99,255,0.4)"
  const color  = queueText[queue]   ?? "hsl(252,87%,65%)"

  return (
    <foreignObject x={x - 154} y={y - 11} width={152} height={22}>
      <a
        href={task?.url ?? `https://tracker.yandex.ru/${key}`}
        target="_blank"
        rel="noopener noreferrer"
        title={task?.title ?? key}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          height: "22px",
        }}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 6,
          padding: "1px 6px",
          whiteSpace: "nowrap",
          textDecoration: "none",
          letterSpacing: "0.01em",
        }}>
          {key}
        </span>
      </a>
    </foreignObject>
  )
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null
  const task = payload[0]?.payload
  if (!task) return null
  const allReasons = payload.map((p: any) => p.name)

  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl max-w-xs">
      <p className="text-xs font-bold text-foreground mb-0.5">{task.key}</p>
      <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{task.title}</p>
      <div className="space-y-1">
        {task.blockings?.map((b: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full shrink-0"
              style={{ background: getReasonColor(b.reason, allReasons) }} />
            <span className="text-muted-foreground truncate">{b.reason}</span>
            <span className="font-semibold text-foreground ml-auto shrink-0">{b.days}д</span>
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

// Кастомный shape — скругляет правый край только если этот бар последний ненулевой для задачи
function RoundedBar(props: any) {
  const { x, y, width, height, fill, isLast } = props
  if (!width || width <= 0 || !height || height <= 0) return null
  const r = isLast ? 4 : 0
  return (
    <path
      d={`M${x},${y} h${width - r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 -${r},${r} H${x} Z`}
      fill={fill}
    />
  )
}

const COLLAPSED_COUNT = 10

interface Props {
  tasks: BlockedTask[]
  onTaskClick: (task: BlockedTask) => void
  activeReasons: Set<string> | null
  onToggleReason: (reason: string) => void
}

export function BlockingChart({ tasks, onTaskClick, activeReasons, onToggleReason }: Props) {
  const [expanded, setExpanded] = useState(false)

  const allReasons = useMemo(() => {
    const set = new Set<string>()
    tasks.forEach(t => t.blockings.forEach(b => set.add(b.reason)))
    return Array.from(set)
  }, [tasks])

  // tasksMap для YAxisTick
  const tasksMap = useMemo(() => {
    const m: Record<string, BlockedTask> = {}
    tasks.forEach(t => { m[t.key] = t })
    return m
  }, [tasks])

  // Фильтруем по активным причинам
  const filteredTasks = useMemo(() => {
    if (!activeReasons || activeReasons.size === 0) return tasks
    return tasks
      .map(t => ({
        ...t,
        blockings: t.blockings.filter(b => activeReasons.has(b.reason)),
        totalDays: t.blockings.filter(b => activeReasons.has(b.reason)).reduce((s, b) => s + b.days, 0),
      }))
      .filter(t => t.totalDays > 0)
      .sort((a, b) => b.totalDays - a.totalDays)
  }, [tasks, activeReasons])

  const displayedTasks = expanded ? filteredTasks : filteredTasks.slice(0, COLLAPSED_COUNT)

  const chartData = useMemo(() => {
    return displayedTasks.map(task => {
      const byReason: Record<string, number> = {}
      task.blockings.forEach(b => { byReason[b.reason] = (byReason[b.reason] ?? 0) + b.days })
      return { key: task.key, title: task.title, totalDays: task.totalDays, blockings: task.blockings, url: task.url, ...byReason }
    })
  }, [filteredTasks])

  const visibleReasons = activeReasons && activeReasons.size > 0
    ? allReasons.filter(r => activeReasons.has(r))
    : allReasons

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

  const chartHeight = Math.max(300, displayedTasks.length * 32 + 60)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Время разрешения блокировок</CardTitle>
          <span className="text-xs text-muted-foreground">{filteredTasks.length} задач</span>
        </div>

        {/* Кликабельная легенда */}
        <div className="flex flex-wrap gap-2 mt-2">
          {allReasons.map(r => {
            const isActive = !activeReasons || activeReasons.size === 0 || activeReasons.has(r)
            return (
              <button
                key={r}
                onClick={() => onToggleReason(r)}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all",
                  isActive
                    ? "text-foreground bg-secondary"
                    : "text-muted-foreground/40 bg-secondary/30 line-through"
                )}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0 transition-opacity"
                  style={{ background: getReasonColor(r, allReasons), opacity: isActive ? 1 : 0.3 }}
                />
                {r}
              </button>
            )
          })}
          {activeReasons && activeReasons.size > 0 && (
            <button
              onClick={() => onToggleReason("__clear__")}
              className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Сбросить
            </button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0 pr-4">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 8, right: 60, left: 8, bottom: 8 }}
            barSize={20}
          >
            <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="key"
              width={155}
              axisLine={false}
              tickLine={false}
              tick={<YAxisTick tasksMap={tasksMap} />}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
            {visibleReasons.map((reason, ri) => (
              <Bar
                key={reason}
                dataKey={reason}
                stackId="a"
                fill={getReasonColor(reason, allReasons)}
                shape={(props: any) => {
                  // isLast = нет ненулевых причин после этой для данной задачи
                  const entry = props.root?.props?.data?.find((d: any) => d.key === props.key) ?? props
                  const isLast = visibleReasons.slice(ri + 1).every(r => !entry[r] || entry[r] <= 0)
                  return <RoundedBar {...props} isLast={isLast} />
                }}
                onClick={(data) => {
                  const task = tasks.find(t => t.key === data.key)
                  if (task) onTaskClick(task)
                }}
                style={{ cursor: "pointer" }}
              >
                {ri === visibleReasons.length - 1 && (
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

        {/* Кнопка развернуть/свернуть */}
        {filteredTasks.length > COLLAPSED_COUNT && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground border-t border-border transition-colors"
          >
            {expanded ? (
              <><ChevronUp className="w-3.5 h-3.5" /> Свернуть</>
            ) : (
              <><ChevronDown className="w-3.5 h-3.5" /> Показать все {filteredTasks.length} задач</>
            )}
          </button>
        )}
      </CardContent>
    </Card>
  )
}
