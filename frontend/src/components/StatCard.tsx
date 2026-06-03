import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const COLOR_MAP = {
  purple: "text-primary bg-primary/10",
  rose:   "text-destructive bg-destructive/10",
  amber:  "text-amber-400 bg-amber-400/10",
  teal:   "text-emerald-400 bg-emerald-400/10",
  sky:    "text-sky-400 bg-sky-400/10",
}

interface Props {
  label: string
  value: number | string
  sub?: string
  icon: string
  color?: keyof typeof COLOR_MAP
}

export function StatCard({ label, value, sub, icon, color = "purple" }: Props) {
  return (
    <Card className="p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-base", COLOR_MAP[color])}>
          {icon}
        </span>
      </div>
      <div>
        <p className="text-3xl font-black tracking-tighter text-foreground leading-none">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </Card>
  )
}
