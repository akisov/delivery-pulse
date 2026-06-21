import { Card, CardContent } from "@/components/ui/card"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Dot
} from "recharts"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"
import { useTheme } from "@/lib/theme"

interface Props {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

const MONTH_NAMES = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"]

interface MonthData { key: string; label: string; avg: number; n: number; tasks: Task[] }

function daysWord(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m10 === 1) return "день"
  if (m10 >= 2 && m10 <= 4) return "дня"
  return "дней"
}

export function CycleTrendChart({ tasks, onShowTasks }: Props) {
  const { theme } = useTheme()
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)

  // Только завершённые прохождения (cycleDays задан)
  const map: Record<string, { sum: number; n: number; label: string; tasks: Task[] }> = {}
  for (const t of tasks) {
    if (!t.entryDate || t.cycleDays == null) continue
    const dt = new Date(t.entryDate + "T00:00:00")
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
    const label = `${MONTH_NAMES[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`
    if (!map[key]) map[key] = { sum: 0, n: 0, label, tasks: [] }
    map[key].sum += t.cycleDays
    map[key].n++
    map[key].tasks.push(t)
  }
  const data: MonthData[] = Object.keys(map).sort().map(k => ({
    key: k, label: map[k].label, avg: Math.round(map[k].sum / map[k].n), n: map[k].n, tasks: map[k].tasks,
  }))

  if (data.length < 2) return null

  const overallAvg = Math.round(data.reduce((s, m) => s + m.avg * m.n, 0) / data.reduce((s, m) => s + m.n, 0))
  const trend = data[data.length - 1].avg - data[0].avg  // + = замедлились, - = ускорились

  const gridColor = isDark ? "hsl(216,34%,17%)" : "hsl(220,13%,91%)"
  const axisColor = isDark ? "hsl(215,16%,47%)" : "hsl(220,9%,55%)"
  const tooltipBg = isDark ? "hsl(224,71%,6%)" : "#fff"
  const tooltipBorder = isDark ? "hsl(216,34%,17%)" : "hsl(220,13%,88%)"
  const tooltipText = isDark ? "hsl(213,31%,91%)" : "hsl(224,71%,10%)"
  const LINE = "hsl(252,87%,70%)"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const d: MonthData = payload[0]?.payload
    if (!d) return null
    return (
      <div style={{ background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
        <p style={{ color: tooltipText, fontWeight: 700, marginBottom: 4 }}>{label}</p>
        <p style={{ color: LINE }}>⏱ Среднее: <b>{d.avg} {daysWord(d.avg)}</b></p>
        <p style={{ color: axisColor, marginTop: 2 }}>по {d.n} завершённым</p>
        <p style={{ color: axisColor, fontSize: 10, marginTop: 6 }}>👆 Нажмите для списка</p>
      </div>
    )
  }

  const openMonth = (d: MonthData) => onShowTasks?.({
    title: `Прохождение комитета · ${d.label}`,
    subtitle: `${d.n} завершённых · среднее ${d.avg} ${daysWord(d.avg)}`,
    tasks: d.tasks,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDot = (props: any) => {
    const { cx, cy, payload } = props
    return (
      <Dot cx={cx} cy={cy} r={4} fill={LINE} stroke={isDark ? "#0a0c14" : "#fff"} strokeWidth={2}
        style={{ cursor: "pointer" }} onClick={() => openMonth(payload)} />
    )
  }

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
          <div>
            <p className="text-sm font-bold text-foreground">Время прохождения комитета по месяцам</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Сколько в среднем дней от входа до выхода · нажмите на точку
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-2xl font-black tracking-tighter" style={{ color: LINE }}>{overallAvg}</span>
            <span className="text-xs text-muted-foreground ml-1">{daysWord(overallAvg)} в среднем</span>
            {trend !== 0 && (
              <p className={`text-xs font-semibold mt-0.5 ${trend < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {trend < 0 ? "▼ ускорились" : "▲ замедлились"} на {Math.abs(trend)} {daysWord(Math.abs(trend))}
              </p>
            )}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} width={28}
              tickFormatter={v => `${v}д`} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: LINE, strokeDasharray: "3 3" }} />
            <Line type="monotone" dataKey="avg" stroke={LINE} strokeWidth={2.5}
              dot={renderDot} activeDot={renderDot} />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
