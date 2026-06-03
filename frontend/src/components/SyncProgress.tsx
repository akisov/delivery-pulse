import { Progress } from "@/components/ui/progress"
import { Loader2 } from "lucide-react"

interface SyncProgressProps {
  title: string
  msg: string
  pct: number
  hint?: string
}

export function SyncProgress({ title, msg, pct, hint }: SyncProgressProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <div className="flex justify-center mb-6">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-primary animate-spin" />
        </div>
      </div>
      <p className="text-lg font-bold text-foreground mb-2">{title}</p>
      <p className="text-sm text-muted-foreground mb-6 min-h-[20px]">{msg}</p>
      <div className="max-w-md mx-auto mb-4">
        <Progress value={pct} className="h-2" />
      </div>
      <p className="text-xs text-muted-foreground">{pct}%{hint ? ` · ${hint}` : ""}</p>
    </div>
  )
}
