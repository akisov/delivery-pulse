import { Card, CardContent } from "@/components/ui/card"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"

interface FunnelChartProps {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

export function FunnelChart({ tasks, onShowTasks }: FunnelChartProps) {
  const entrants = tasks.filter(t => t.entered)
  const total = entrants.length
  const akTasks = tasks.filter(t => t.v1n > 0)
  const taTasks = tasks.filter(t => t.v2n > 0)
  const okTasks = entrants.filter(t => t.total === 0)
  const akCount = akTasks.length
  const taCount = taTasks.length

  const pctAk = total > 0 ? Math.round(akCount / total * 100) : 0
  const pctTa = total > 0 ? Math.round(taCount / total * 100) : 0

  const rows = [
    {
      label: "Пришло в АрхКом",
      count: total,
      pct: 100,
      color: "bg-[hsl(var(--chart-1))]",
      textColor: "text-[hsl(var(--chart-1))]",
      icon: "📋",
      desc: "Задач перешли в «Аналит. проработка готово»",
      modalTasks: entrants,
    },
    {
      label: "АрхКом вернул",
      count: akCount,
      pct: pctAk,
      color: "bg-[hsl(var(--chart-2))]",
      textColor: "text-[hsl(var(--chart-2))]",
      icon: "🔄",
      desc: "Отправлено на ревью аналитики арх. комитетом",
      modalTasks: akTasks,
    },
    {
      label: "ТА вернул",
      count: taCount,
      pct: pctTa,
      color: "bg-[hsl(var(--chart-3))]",
      textColor: "text-[hsl(var(--chart-3))]",
      icon: "↩️",
      desc: "Возвращено на доработку техническим архитектором",
      modalTasks: taTasks,
    },
  ]

  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-bold text-foreground mb-1">Воронка отсечек</p>
        <p className="text-xs text-muted-foreground mb-6">
          Из {total} задач, пришедших к техархам за период · нажмите на строку
        </p>

        <div className="space-y-4">
          {rows.map((row, i) => (
            <button
              key={i}
              type="button"
              onClick={() => row.count > 0 && onShowTasks?.({ title: row.label, tasks: row.modalTasks })}
              disabled={row.count === 0}
              className="w-full text-left group rounded-lg -mx-2 px-2 py-1 transition-colors hover:bg-secondary/50 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-base">{row.icon}</span>
                  <span className="text-sm font-semibold text-foreground group-hover:underline decoration-dotted underline-offset-4">{row.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold ${row.textColor}`}>{row.pct}%</span>
                  <span className={`text-lg font-black tabular-nums ${row.textColor} min-w-[2rem] text-right`}>
                    {row.count}
                  </span>
                </div>
              </div>

              {/* Bar */}
              <div className="relative h-6 rounded-lg bg-secondary overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out ${row.color} opacity-80 group-hover:opacity-100`}
                  style={{ width: `${Math.min(100, Math.max(row.pct, row.count > 0 ? 3 : 0))}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{row.desc}</p>
            </button>
          ))}
        </div>

        {/* Pass rate */}
        <button
          type="button"
          onClick={() => okTasks.length > 0 && onShowTasks?.({ title: "Прошли без замечаний", tasks: okTasks })}
          disabled={okTasks.length === 0}
          className="w-full mt-6 pt-4 border-t border-border flex items-center justify-between transition-colors hover:bg-secondary/40 disabled:hover:bg-transparent rounded-b-lg -mx-2 px-2 disabled:cursor-default group"
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Прошли без замечаний</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black text-emerald-500">{okTasks.length}</span>
            <span className="text-xs text-muted-foreground">
              ({total > 0 ? Math.round(okTasks.length / total * 100) : 0}%)
            </span>
          </div>
        </button>
      </CardContent>
    </Card>
  )
}
