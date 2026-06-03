import { ExternalLink, Clock, CheckCircle } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"
import type { BlockedTask } from "@/lib/types"
import { cn } from "@/lib/utils"

function pluralDays(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m10 === 1) return "день"
  if (m10 >= 2 && m10 <= 4) return "дня"
  return "дней"
}

interface Props {
  task: BlockedTask | null
  onClose: () => void
}

export function TaskDetailModal({ task, onClose }: Props) {
  if (!task) return null

  const activeBlockings = task.blockings.filter(b => b.isActive)
  const closedBlockings = task.blockings.filter(b => !b.isActive)

  return (
    <Modal
      open={!!task}
      onClose={onClose}
      title={task.key}
      subtitle={task.title}
      wide
    >
      {/* Header stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-secondary p-3 text-center">
          <p className="text-2xl font-black text-foreground">{task.totalDays}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{pluralDays(task.totalDays)} суммарно</p>
        </div>
        <div className="rounded-lg bg-destructive/10 p-3 text-center">
          <p className="text-2xl font-black text-destructive">{activeBlockings.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">активных</p>
        </div>
        <div className="rounded-lg bg-emerald-500/10 p-3 text-center">
          <p className="text-2xl font-black text-emerald-400">{closedBlockings.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">закрытых</p>
        </div>
      </div>

      {/* Link */}
      <a
        href={task.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-primary hover:underline mb-4"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Открыть в Яндекс Трекере
      </a>

      {/* Blockings list */}
      <div className="space-y-3">
        {task.blockings.map(b => (
          <div key={b.key} className={cn(
            "rounded-xl border p-4",
            b.isActive
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-secondary/20"
          )}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {b.isActive
                  ? <Clock className="w-4 h-4 text-destructive" />
                  : <CheckCircle className="w-4 h-4 text-emerald-400" />
                }
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-foreground">{b.key}</span>
                  <Badge variant={b.isActive ? "destructive" : "success"}>
                    {b.isActive ? "Активна" : "Закрыта"}
                  </Badge>
                  <span className="ml-auto text-lg font-black text-foreground">
                    {b.days} {pluralDays(b.days)}
                  </span>
                </div>
                <p className="text-sm text-foreground mt-1">{b.title}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>Причина: <span className="text-foreground font-semibold">{b.reason}</span></span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span>Начало: <span className="text-foreground">{b.startDate || "—"}</span></span>
                  <span>Конец: <span className="text-foreground">{b.endDate || (b.isActive ? "сегодня" : "—")}</span></span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
