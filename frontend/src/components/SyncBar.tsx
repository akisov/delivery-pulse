import { Database, Circle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SyncInfo } from "@/lib/types"

interface SyncBarProps {
  info: SyncInfo | null
  loading: boolean
}

export function SyncBar({ info, loading }: SyncBarProps) {
  const queues = ["POOLING", "DOSTAVKAPIKO", "UDOSTAVKA"]
  const today = new Date().toISOString().slice(0, 10)

  if (loading || !info) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-xs text-muted-foreground">
        <Database className="w-3.5 h-3.5" />
        <span>Проверяем базу данных…</span>
      </div>
    )
  }

  const hasAny = queues.some(q => info[q])

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 rounded-xl border border-border bg-card flex-wrap">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Database className="w-3.5 h-3.5" />
        <span className="font-medium">База данных:</span>
      </div>
      {!hasAny ? (
        <span className="text-xs text-destructive font-semibold flex items-center gap-1.5">
          <Circle className="w-2 h-2 fill-destructive text-destructive" />
          Данных нет — запустите Полный синк
        </span>
      ) : (
        queues.map(q => {
          const d = info[q]
          const stale = d && d < today
          return (
            <span key={q} className="flex items-center gap-1.5 text-xs">
              <Circle className={cn("w-2 h-2", d
                ? (stale ? "fill-amber-400 text-amber-400" : "fill-emerald-400 text-emerald-400")
                : "fill-destructive text-destructive"
              )} />
              <span className="text-muted-foreground">{q}:</span>
              <span className="font-semibold text-foreground">{d || "—"}</span>
            </span>
          )
        })
      )}
    </div>
  )
}
