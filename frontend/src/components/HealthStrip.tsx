import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"

interface Props {
  tasks: Task[]
  stuck: number   // задач сейчас в комитете дольше 7 дней
  onShowTasks?: (data: TaskModalData) => void
}

function daysWord(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m10 === 1) return "день"
  if (m10 >= 2 && m10 <= 4) return "дня"
  return "дней"
}

export function HealthStrip({ tasks, stuck, onShowTasks }: Props) {
  const total = tasks.length
  const finished = tasks.filter(t => t.cycleDays != null) as (Task & { cycleDays: number })[]
  const avgCycle = finished.length
    ? Math.round(finished.reduce((s, t) => s + t.cycleDays, 0) / finished.length)
    : null
  const cuts = tasks.reduce((s, t) => s + t.total, 0)
  const avgReturns = total ? (cuts / total) : 0
  const withReturns = tasks.filter(t => t.total > 0)

  const items = [
    avgCycle != null && {
      icon: "⏱",
      value: `${avgCycle} ${daysWord(avgCycle)}`,
      label: `среднее прохождение комитета · по ${finished.length} завершённым`,
      color: "text-[hsl(252,87%,60%)]",
      onClick: () => onShowTasks?.({ title: "Завершившие прохождение комитета", subtitle: `${finished.length} задач · среднее ${avgCycle} ${daysWord(avgCycle)}`, tasks: finished }),
    },
    {
      icon: "🔁",
      value: avgReturns.toFixed(1),
      label: "возвратов на задачу в среднем",
      color: "text-amber-600 dark:text-amber-400",
      onClick: withReturns.length ? () => onShowTasks?.({ title: "Задачи с возвратами", tasks: withReturns }) : undefined,
    },
    stuck > 0 && {
      icon: "🔥",
      value: String(stuck),
      label: "сейчас засиделись (≥7 дней)",
      color: "text-rose-600 dark:text-rose-400",
      onClick: undefined,
    },
  ].filter(Boolean) as { icon: string; value: string; label: string; color: string; onClick?: () => void }[]

  if (items.length === 0) return null

  return (
    <div className="flex items-stretch gap-2 flex-wrap rounded-xl border border-border bg-card px-4 py-3">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-3">
          {i > 0 && <div className="h-8 w-px bg-border mr-1 hidden sm:block" />}
          <button
            type="button"
            onClick={it.onClick}
            disabled={!it.onClick}
            className="flex items-center gap-3 rounded-lg px-2 py-1 -mx-1 transition-colors enabled:hover:bg-secondary/60 disabled:cursor-default text-left"
          >
            <span className="text-lg leading-none">{it.icon}</span>
            <div className="leading-tight">
              <span className={`text-lg font-black tabular-nums ${it.color}`}>{it.value}</span>
              <p className="text-[11px] text-muted-foreground">{it.label}</p>
            </div>
          </button>
        </div>
      ))}
    </div>
  )
}
