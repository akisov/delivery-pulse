import { useState } from "react"
import { ExternalLink, ChevronDown, ChevronUp, Clock, CheckCircle, ChevronsDown, ChevronsUp } from "lucide-react"

const COLLAPSED_COUNT = 10
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { BlockedTask, Blocking } from "@/lib/types"
import { cn } from "@/lib/utils"

function pluralDays(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m10 === 1) return "день"
  if (m10 >= 2 && m10 <= 4) return "дня"
  return "дней"
}

function BlockingRow({ blocking }: { blocking: Blocking }) {
  return (
    <div className={cn(
      "flex items-start gap-3 py-2 px-3 rounded-lg text-xs",
      blocking.isActive ? "bg-destructive/8" : "bg-secondary/30"
    )}>
      <span className="mt-0.5 shrink-0">
        {blocking.isActive
          ? <Clock className="w-3.5 h-3.5 text-destructive" />
          : <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
        }
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-foreground">{blocking.key}</span>
          <Badge variant={blocking.isActive ? "destructive" : "success"} className="text-[10px]">
            {blocking.isActive ? "Активна" : "Закрыта"}
          </Badge>
          <span className="font-bold text-foreground ml-auto">
            {blocking.days} {pluralDays(blocking.days)}
          </span>
        </div>
        <p className="text-muted-foreground mt-0.5 line-clamp-1">{blocking.reason}</p>
        <p className="text-muted-foreground/70 mt-0.5">
          {blocking.startDate}
          {blocking.endDate ? ` → ${blocking.endDate}` : " → сегодня"}
        </p>
      </div>
    </div>
  )
}

interface TaskRowProps {
  task: BlockedTask
  rank: number
}

function TaskRow({ task, rank }: TaskRowProps) {
  const [expanded, setExpanded] = useState(false)
  const activeCount = task.blockings.filter(b => b.isActive).length

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
      >
        <span className="text-xs font-black text-muted-foreground w-6 shrink-0">{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 shrink-0"
            >
              {task.key}
              <ExternalLink className="w-3 h-3" />
            </a>
            <Badge variant="outline" className="text-[10px] shrink-0">{task.queue}</Badge>
            {activeCount > 0 && (
              <Badge variant="destructive" className="text-[10px] shrink-0">
                {activeCount} активн.
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.title}</p>
        </div>
        <div className="text-right shrink-0 mr-2">
          <p className="text-lg font-black text-foreground leading-none">
            {task.totalDays}
          </p>
          <p className="text-[10px] text-muted-foreground">{pluralDays(task.totalDays)}</p>
        </div>
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {task.blockings.map(b => (
            <BlockingRow key={b.key} blocking={b} />
          ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  tasks: BlockedTask[]
}

export function BlockingTable({ tasks }: Props) {
  const [sortBy, setSortBy] = useState<"days" | "active">("days")
  const [expanded, setExpanded] = useState(false)

  const sorted = [...tasks].sort((a, b) => {
    if (sortBy === "days") return b.totalDays - a.totalDays
    const aActive = a.blockings.filter(x => x.isActive).length
    const bActive = b.blockings.filter(x => x.isActive).length
    return bActive - aActive || b.totalDays - a.totalDays
  })

  const displayed = expanded ? sorted : sorted.slice(0, COLLAPSED_COUNT)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Задачи по блокировкам</CardTitle>
          <div className="flex gap-1 bg-secondary rounded-lg p-1">
            {([["days", "По длительности"], ["active", "По активным"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setSortBy(v)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-semibold transition-all",
                  sortBy === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            Нет заблокированных задач
          </div>
        ) : (
          <>
            <div>
              {displayed.map((task, i) => (
                <TaskRow key={task.key} task={task} rank={i + 1} />
              ))}
            </div>
            {sorted.length > COLLAPSED_COUNT && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground border-t border-border transition-colors"
              >
                {expanded
                  ? <><ChevronsUp className="w-3.5 h-3.5" /> Свернуть</>
                  : <><ChevronsDown className="w-3.5 h-3.5" /> Показать все {sorted.length} задач</>
                }
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
