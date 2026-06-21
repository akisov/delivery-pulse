import { useEffect, useState } from "react"
import { ExternalLink } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"
import type { ArchReturnTask as Task } from "@/lib/types"
import { cn } from "@/lib/utils"

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso + "T00:00:00")
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`
}

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "задач"
  if (m10 === 1) return "задача"
  if (m10 >= 2 && m10 <= 4) return "задачи"
  return "задач"
}

function badge(t: Task) {
  if (t.v1n > 0 && t.v2n > 0) return <Badge variant="default">АрхКом + ТА</Badge>
  if (t.v1n > 0) return <Badge variant="success">АрхКом</Badge>
  if (t.v2n > 0) return <Badge variant="destructive">ТА</Badge>
  return <Badge variant="secondary">✓ Ок</Badge>
}

export interface ArchModalData {
  title: string
  subtitle?: string
  tasks: Task[]
}

interface Props {
  open: boolean
  onClose: () => void
  data: TaskModalData | null
}

export function ArchTaskListModal({ open, onClose, data }: Props) {
  const [filter, setFilter] = useState<"all" | "ak" | "ta">("all")

  // Сбрасываем фильтр при каждом открытии
  useEffect(() => { if (open) setFilter("all") }, [open, data?.title])

  if (!open || !data) return null

  const { title, tasks } = data
  const akCount = tasks.filter(t => t.v1n > 0).length
  const taCount = tasks.filter(t => t.v2n > 0).length
  const shown = filter === "ak" ? tasks.filter(t => t.v1n > 0)
              : filter === "ta" ? tasks.filter(t => t.v2n > 0)
              : tasks
  const sorted = [...shown].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
  const subtitle = data.subtitle ?? `${tasks.length} ${plural(tasks.length)} · АрхКом вернул ${akCount} · ТА вернул ${taCount}`

  return (
    <Modal open={open} onClose={onClose} wide title={title} subtitle={subtitle}>
      <div className="flex gap-2 mb-4 flex-wrap">
        {([["all", `Все (${tasks.length})`], ["ak", `АрхКом (${akCount})`], ["ta", `ТА (${taCount})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
              filter === k
                ? "bg-primary border-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40 bg-transparent"
            )}>
            {l}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">Нет задач</p>
        ) : sorted.map(t => (
          <div key={t.key} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:bg-secondary/40 hover:border-primary/30 transition-colors">
            <a href={t.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary font-mono text-xs font-bold hover:underline whitespace-nowrap shrink-0">
              {t.key}<ExternalLink className="w-3 h-3 opacity-40" />
            </a>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">{t.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.issueTypeDisplay} · {t.queue} · {fmtDate(t.entryDate)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {badge(t)}
              {t.total > 0 && (
                <span className="w-6 h-6 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-black flex items-center justify-center">
                  {t.total}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
