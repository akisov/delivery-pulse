import { useState } from "react"
import { ExternalLink, Clock, CheckCircle, ChevronDown, ChevronUp } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { BlockedTask } from "@/lib/types"

function pluralDays(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m10 === 1) return "день"
  if (m10 >= 2 && m10 <= 4) return "дня"
  return "дней"
}

function TaskRow({ task }: { task: BlockedTask }) {
  const [open, setOpen] = useState(false)
  const activeCount = task.blockings.filter(b => b.isActive).length

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent/40 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={task.url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs font-bold text-primary hover:underline flex items-center gap-1 shrink-0"
            >
              {task.key} <ExternalLink className="w-3 h-3" />
            </a>
            <Badge variant="outline" className="text-[10px] shrink-0">{task.queue}</Badge>
            {activeCount > 0 && <Badge variant="destructive" className="text-[10px] shrink-0">{activeCount} активн.</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.title}</p>
        </div>
        <div className="text-right shrink-0 mr-1">
          <p className="text-base font-black text-foreground leading-none">{task.totalDays}</p>
          <p className="text-[10px] text-muted-foreground">{pluralDays(task.totalDays)}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {open && (
        <div className="px-3 pb-2.5 space-y-1.5">
          {task.blockings.map(b => (
            <div key={b.key} className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
              b.isActive ? "bg-destructive/8" : "bg-secondary/30"
            )}>
              {b.isActive
                ? <Clock className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />
                : <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
              }
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-foreground">{b.key}</span>
                  <Badge variant={b.isActive ? "destructive" : "success"} className="text-[10px]">
                    {b.isActive ? "Активна" : "Закрыта"}
                  </Badge>
                  <span className="ml-auto font-bold text-foreground">{b.days} {pluralDays(b.days)}</span>
                </div>
                <p className="text-muted-foreground mt-0.5">{b.reason}</p>
                <p className="text-muted-foreground/70 mt-0.5">
                  {b.startDate} → {b.endDate || (b.isActive ? "сегодня" : "—")}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type StatFilter = "all" | "active" | "blocked" | "avg"

interface Props {
  open: boolean
  onClose: () => void
  tasks: BlockedTask[]
  filter: StatFilter
}

const FILTER_TITLES: Record<StatFilter, string> = {
  all:     "Заблокированные задачи",
  active:  "Задачи с активными блокировками",
  blocked: "Все блокировки",
  avg:     "Задачи по длительности",
}

export function TaskListModal({ open, onClose, tasks, filter }: Props) {
  const filtered = filter === "active"
    ? tasks.filter(t => t.blockings.some(b => b.isActive))
    : tasks

  const sorted = [...filtered].sort((a, b) => b.totalDays - a.totalDays)

  return (
    <Modal open={open} onClose={onClose} title={FILTER_TITLES[filter]} subtitle={`${sorted.length} задач`} wide>
      <div className="rounded-xl border border-border overflow-hidden">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Нет задач</div>
        ) : sorted.map(task => (
          <TaskRow key={task.key} task={task} />
        ))}
      </div>
    </Modal>
  )
}
