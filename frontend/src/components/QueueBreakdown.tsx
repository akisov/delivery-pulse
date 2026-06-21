import { Card, CardContent } from "@/components/ui/card"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"

interface QueueBreakdownProps {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

const QUEUES = ["POOLING", "DOSTAVKAPIKO", "UDOSTAVKA"]

const QUEUE_COLORS: Record<string, { bar: string; text: string; bg: string }> = {
  POOLING:      { bar: "bg-[hsl(252,87%,70%)]", text: "text-[hsl(252,87%,60%)]", bg: "bg-[hsl(252,87%,70%)/0.08]" },
  DOSTAVKAPIKO: { bar: "bg-[hsl(199,89%,55%)]", text: "text-[hsl(199,89%,45%)]", bg: "bg-[hsl(199,89%,55%)/0.08]" },
  UDOSTAVKA:    { bar: "bg-[hsl(38,92%,50%)]",  text: "text-[hsl(38,92%,40%)]",  bg: "bg-[hsl(38,92%,50%)/0.08]"  },
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 19) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

export function QueueBreakdown({ tasks, onShowTasks }: QueueBreakdownProps) {
  // Распределение пришедших в комитет по очередям
  const ent = tasks.filter(t => t.entered)
  const total = ent.length
  const maxCount = Math.max(...QUEUES.map(q => ent.filter(t => t.queue === q).length), 1)

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardContent className="p-6">
        <p className="text-sm font-bold text-foreground mb-1">По очередям</p>
        <p className="text-xs text-muted-foreground mb-5">
          Распределение {total} {plural(total, "задачи", "задач", "задач")} по очередям
        </p>

        <div className="space-y-4">
          {QUEUES.map(q => {
            const qTasks   = ent.filter(t => t.queue === q)
            const qAk      = qTasks.filter(t => t.v1n > 0).length
            const qTa      = qTasks.filter(t => t.v2n > 0).length
            const qCount   = qTasks.length
            const pct      = total > 0 ? Math.round(qCount / total * 100) : 0
            const barW     = maxCount > 0 ? Math.round(qCount / maxCount * 100) : 0
            const c        = QUEUE_COLORS[q]

            return (
              <button
                key={q}
                onClick={() => qCount > 0 && onShowTasks?.({ title: `Очередь ${q}`, subtitle: `${qCount} задач · АрхКом вернул ${qAk} · ТА вернул ${qTa}`, tasks: qTasks })}
                disabled={qCount === 0}
                className="w-full text-left group hover:bg-secondary/60 rounded-xl px-3 py-3 -mx-3 transition-colors disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-bold uppercase tracking-widest ${c.text}`}>{q}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{qAk}</span> АрхКом
                      &nbsp;·&nbsp;
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">{qTa}</span> ТА
                    </span>
                    <span className={`text-xl font-black tabular-nums ${c.text}`}>{qCount}</span>
                    <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${c.bar}`}
                    style={{ width: `${barW}%` }}
                  />
                </div>
              </button>
            )
          })}
        </div>

        {/* Pass rate summary */}
        <div className="mt-5 pt-4 border-t border-border grid grid-cols-3 gap-3 text-center">
          {[
            { label: "С первого раза", value: ent.filter(t => t.total === 0), color: "text-emerald-600 dark:text-emerald-400" },
            { label: "Вернул АрхКом",  value: tasks.filter(t => t.v1n > 0),   color: "text-[hsl(166,76%,36%)]" },
            { label: "Вернул ТА",      value: tasks.filter(t => t.v2n > 0),   color: "text-rose-600 dark:text-rose-400" },
          ].map(s => (
            <button key={s.label}
              onClick={() => s.value.length > 0 && onShowTasks?.({ title: s.label, tasks: s.value })}
              disabled={s.value.length === 0}
              className="rounded-lg py-1 transition-colors hover:bg-secondary/60 disabled:hover:bg-transparent disabled:cursor-default">
              <p className={`text-2xl font-black ${s.color}`}>{s.value.length}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{s.label}</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
