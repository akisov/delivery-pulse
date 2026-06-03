import { Database } from "lucide-react"
import type { SyncInfo } from "@/lib/types"

interface SyncBarProps {
  info: SyncInfo | null
  loading: boolean
}

export function SyncBar({ info, loading }: SyncBarProps) {
  if (loading || !info) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-xs text-muted-foreground">
        <Database className="w-3.5 h-3.5" />
        <span>Проверяем базу данных…</span>
      </div>
    )
  }

  const dates = Object.values(info).filter(Boolean) as string[]
  const hasAny = dates.length > 0

  // Самая старая дата синка
  const oldest = hasAny ? [...dates].sort()[0] : null

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card text-xs text-muted-foreground">
      <Database className="w-3.5 h-3.5 shrink-0" />
      {!hasAny ? (
        <span className="text-destructive font-semibold">Данных нет — запустите синк</span>
      ) : (
        <>
          <span>База данных:</span>
          <span className="font-semibold text-foreground">{oldest} МСК</span>
        </>
      )}
    </div>
  )
}
