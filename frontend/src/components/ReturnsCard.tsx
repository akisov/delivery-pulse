import { Card, CardContent } from "@/components/ui/card"
import { ArrowRight, ListFilter } from "lucide-react"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"
import { cn } from "@/lib/utils"

interface ReturnsCardProps {
  tasks: Task[]
  totalTasks: number
  onShowTasks?: (data: TaskModalData) => void
}

const ROWS = [
  {
    type: "ak" as const,
    title: "АрхКом вернул на доработку",
    fromIcon: "📊", fromLabel: "Аналит. проработка готово",
    toIcon: "🔍", toLabel: "Ревью аналитики",
    accent: "166,76%,40%",
    bar: "bg-[hsl(166,76%,40%)]",
    text: "text-emerald-600 dark:text-emerald-400",
    filter: (t: Task) => t.v1n > 0,
    count: (t: Task) => t.v1n,
  },
  {
    type: "ta" as const,
    title: "ТА вернул на уточнение",
    fromIcon: "🏛", fromLabel: "Согласование архитектуры",
    toIcon: "🔧", toLabel: "Доработка",
    accent: "350,89%,60%",
    bar: "bg-[hsl(350,89%,60%)]",
    text: "text-rose-600 dark:text-rose-400",
    filter: (t: Task) => t.v2n > 0,
    count: (t: Task) => t.v2n,
  },
]

function StagePill({ icon, label, accent }: { icon: string; label: string; accent: string }) {
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 border"
      style={{
        background: `hsl(${accent} / 0.10)`,
        borderColor: `hsl(${accent} / 0.30)`,
      }}
    >
      <span className="text-sm leading-none">{icon}</span>
      <span className="text-xs font-semibold" style={{ color: `hsl(${accent})` }}>{label}</span>
    </div>
  )
}

export function ReturnsCard({ tasks, totalTasks, onShowTasks }: ReturnsCardProps) {
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardContent className="p-0">
        <div className="px-6 pt-6 pb-2">
          <p className="text-sm font-bold text-foreground">Возвраты на доработку</p>
          <p className="text-xs text-muted-foreground mt-0.5">Куда и сколько раз отправляли задачи · нажмите, чтобы увидеть список</p>
        </div>

        <div className="divide-y divide-border">
          {ROWS.map(r => {
            const matched = tasks.filter(r.filter)
            const pct = totalTasks > 0 ? Math.round(matched.length / totalTasks * 100) : 0
            const totalCuts = matched.reduce((s, t) => s + r.count(t), 0)
            return (
              <button
                key={r.type}
                type="button"
                onClick={() => matched.length > 0 && onShowTasks?.({
                  title: r.title,
                  subtitle: `${matched.length} задач · ${totalCuts} возвратов суммарно`,
                  tasks: matched,
                })}
                disabled={matched.length === 0}
                className="w-full text-left px-6 py-4 transition-colors hover:bg-secondary/40 disabled:hover:bg-transparent disabled:cursor-default group"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <p className="text-sm font-bold text-foreground">{r.title}</p>
                  <div className="text-right shrink-0">
                    <span className={cn("text-3xl font-black tracking-tighter leading-none", r.text)}>{matched.length}</span>
                    <span className="text-xs text-muted-foreground ml-1">{pct}%</span>
                  </div>
                </div>

                {/* Цветной поток статусов */}
                <div className="flex items-center gap-2 flex-wrap mb-3">
                  <StagePill icon={r.fromIcon} label={r.fromLabel} accent={r.accent} />
                  <ArrowRight className="w-4 h-4 shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: `hsl(${r.accent})` }} />
                  <StagePill icon={r.toIcon} label={r.toLabel} accent={r.accent} />
                  {totalCuts > matched.length && (
                    <span className="ml-auto text-xs text-muted-foreground">{totalCuts} переходов</span>
                  )}
                </div>

                {/* Прогресс-бар */}
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all duration-700", r.bar)} style={{ width: `${Math.min(100, Math.max(pct, matched.length > 0 ? 2 : 0))}%` }} />
                </div>

                {matched.length > 0 && (
                  <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold mt-2 opacity-0 group-hover:opacity-100 transition-opacity", r.text)}>
                    <ListFilter className="w-3 h-3" /> Показать {matched.length} задач
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
