import { Card, CardContent } from "@/components/ui/card"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"
import { useTheme } from "@/lib/theme"

const COLORS = [
  "hsl(252,87%,70%)", "hsl(166,76%,40%)", "hsl(350,89%,60%)",
  "hsl(38,92%,50%)", "hsl(199,89%,60%)", "hsl(280,87%,70%)", "hsl(25,90%,60%)"
]

function returnsWord(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "возвратов"
  if (m10 === 1) return "возврат"
  if (m10 >= 2 && m10 <= 4) return "возврата"
  return "возвратов"
}

interface DonutChartProps {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

export function DonutChart({ tasks, onShowTasks }: DonutChartProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)

  // Only tasks WITH cuts for the donut
  const withCuts   = tasks.filter(t => t.total > 0)
  const withoutCuts = tasks.filter(t => t.total === 0)

  const groups: Record<number, Task[]> = {}
  for (const t of withCuts) {
    if (!groups[t.total]) groups[t.total] = []
    groups[t.total].push(t)
  }
  const keys = Object.keys(groups).map(Number).sort((a, b) => a - b)
  const show = (k: number) => onShowTasks?.({
    title: `${k} ${returnsWord(k)} на задачу`,
    subtitle: `${groups[k].length} задач с ${k} ${returnsWord(k)}`,
    tasks: groups[k],
  })
  const data = keys.map((k, i) => ({
    name: `${k} ${returnsWord(k)}`,
    value: groups[k].length,
    pct: withCuts.length > 0 ? Math.round(groups[k].length / tasks.length * 100) : 0,
    color: COLORS[i % COLORS.length],
    cuts: k,
  }))

  const tooltipBg     = isDark ? "hsl(224,71%,6%)"  : "#ffffff"
  const tooltipBorder = isDark ? "hsl(216,34%,17%)" : "hsl(220,13%,88%)"
  const tooltipText   = isDark ? "hsl(213,31%,91%)" : "hsl(224,71%,10%)"

  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-bold text-foreground mb-1">Сколько раз возвращали задачу</p>
        <p className="text-xs text-muted-foreground mb-6">
          Распределение по числу возвратов · {withCuts.length} из {tasks.length} задач возвращали хотя бы раз
        </p>

        {withCuts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <span className="text-4xl mb-3">✅</span>
            <p className="text-sm font-semibold">Все задачи прошли без возвратов</p>
          </div>
        ) : (
          <div className="flex items-center gap-6 flex-wrap">
            <div className="relative shrink-0">
              <ResponsiveContainer width={190} height={190}>
                <PieChart>
                  <Pie data={data} cx={90} cy={90} innerRadius={54} outerRadius={85}
                    dataKey="value" strokeWidth={2} cursor="pointer"
                    stroke={isDark ? "hsl(224,71%,4%)" : "#f8f9fa"}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) => show(entry.cuts)}>
                    {data.map((entry, i) => <Cell key={i} fill={entry.color}/>)}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: tooltipBg,
                      border: `1px solid ${tooltipBorder}`,
                      borderRadius: 10,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: tooltipText, fontWeight: 700 }}
                    formatter={(value) => [`${value} задач`]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-black text-foreground">{withCuts.length}</span>
                <span className="text-[10px] text-muted-foreground">с возвратами</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 flex-1 min-w-[160px]">
              {data.map(d => (
                <button key={d.cuts} onClick={() => show(d.cuts)}
                  className="flex items-center gap-2.5 text-left px-3 py-2 rounded-lg hover:bg-secondary transition-colors group">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold group-hover:opacity-80 transition-opacity" style={{ color: d.color }}>
                      {d.name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-base font-black" style={{ color: d.color }}>{d.value}</p>
                    <p className="text-[10px] text-muted-foreground">{d.pct}%</p>
                  </div>
                </button>
              ))}

              {/* Pass rate row */}
              <button onClick={() => onShowTasks?.({ title: "Прошли с первого раза", subtitle: `${withoutCuts.length} задач без возвратов`, tasks: withoutCuts })}
                className="flex items-center gap-2.5 text-left px-3 py-2 rounded-lg hover:bg-secondary transition-colors mt-1 border-t border-border pt-3">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500"/>
                <p className="text-sm font-semibold text-emerald-500 flex-1">С первого раза</p>
                <div className="text-right shrink-0">
                  <p className="text-base font-black text-emerald-500">{withoutCuts.length}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {tasks.length > 0 ? Math.round(withoutCuts.length / tasks.length * 100) : 0}%
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
