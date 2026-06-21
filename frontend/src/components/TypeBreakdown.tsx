import { Card, CardContent } from "@/components/ui/card"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"

interface Props {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

const TYPE_META: Record<string, { label: string; icon: string; hsl: string }> = {
  story:         { label: "Story",      icon: "📖", hsl: "252,87%,65%" },
  analytics:     { label: "Аналитика",  icon: "📊", hsl: "199,89%,55%" },
  technicaldebt: { label: "ТехДолг",    icon: "🔧", hsl: "38,92%,50%" },
  improvement:   { label: "Улучшение",  icon: "⚡", hsl: "166,76%,40%" },
  elaboration:   { label: "Проработка", icon: "📝", hsl: "280,70%,60%" },
}

export function TypeBreakdown({ tasks, onShowTasks }: Props) {
  // «Качество по типам» — про задачи, пришедшие в комитет в периоде
  const entrants = tasks.filter(t => t.entered)
  const total = entrants.length
  const groups: Record<string, Task[]> = {}
  for (const t of entrants) (groups[t.issueType] ||= []).push(t)

  const rows = Object.entries(groups)
    .map(([type, list]) => {
      const ok = list.filter(t => t.total === 0).length
      return {
        type,
        meta: TYPE_META[type] ?? { label: list[0]?.issueTypeDisplay || type, icon: "◈", hsl: "215,16%,47%" },
        count: list.length,
        pctOk: list.length ? Math.round(ok / list.length * 100) : 0,
        list,
      }
    })
    .sort((a, b) => b.count - a.count)

  const maxCount = Math.max(1, ...rows.map(r => r.count))

  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-bold text-foreground mb-1">Качество по типам задач</p>
        <p className="text-xs text-muted-foreground mb-5">
          Какой тип задач лучше/хуже проходит комитет · нажмите для списка
        </p>

        <div className="space-y-4">
          {rows.map(r => {
            const barW = Math.round(r.count / maxCount * 100)
            const okTone = r.pctOk >= 70 ? "text-emerald-600 dark:text-emerald-400"
                         : r.pctOk >= 50 ? "text-amber-600 dark:text-amber-400"
                         : "text-rose-600 dark:text-rose-400"
            return (
              <button
                key={r.type}
                onClick={() => onShowTasks?.({ title: `${r.meta.label} — задачи`, subtitle: `${r.count} задач · ${r.pctOk}% с первого раза`, tasks: r.list })}
                className="w-full text-left group hover:bg-secondary/60 rounded-xl px-3 py-2.5 -mx-3 transition-colors"
              >
                <div className="flex items-center justify-between mb-2 gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: `hsl(${r.meta.hsl})` }}>
                    <span className="text-base">{r.meta.icon}</span>{r.meta.label}
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-semibold ${okTone}`}>{r.pctOk}% с 1-го раза</span>
                    <span className="text-xl font-black tabular-nums" style={{ color: `hsl(${r.meta.hsl})` }}>{r.count}</span>
                  </div>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barW}%`, background: `hsl(${r.meta.hsl})` }} />
                </div>
              </button>
            )
          })}
          {rows.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Нет задач</p>}
        </div>

        {total > 0 && (
          <p className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground">
            Чем выше «% с первого раза» — тем чище приходит аналитика по этому типу
          </p>
        )}
      </CardContent>
    </Card>
  )
}
