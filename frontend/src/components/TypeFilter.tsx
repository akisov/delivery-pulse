import { cn } from "@/lib/utils"

export const ISSUE_TYPES = [
  { key: "all",           label: "Все типы",      icon: "◈", color: "text-muted-foreground" },
  { key: "story",         label: "Story",          icon: "📖", color: "text-[hsl(252,87%,65%)]" },
  { key: "analytics",     label: "Аналитика",      icon: "📊", color: "text-[hsl(199,89%,55%)]" },
  { key: "technicaldebt", label: "ТехДолг",        icon: "🔧", color: "text-[hsl(38,92%,50%)]" },
  { key: "improvement",   label: "Улучшение",      icon: "⚡", color: "text-[hsl(166,76%,40%)]" },
  { key: "elaboration",   label: "Проработка",     icon: "📝", color: "text-[hsl(280,70%,65%)]" },
]

interface TypeFilterProps {
  active: string
  counts: Record<string, number>
  onChange: (type: string) => void
}

export function TypeFilter({ active, counts, onChange }: TypeFilterProps) {
  const total = counts["all"] ?? 0

  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground mr-1 shrink-0">Тип</span>
      <div className="flex gap-1.5 flex-wrap">
        {ISSUE_TYPES.map(t => {
          const count = t.key === "all" ? total : (counts[t.key] ?? 0)
          const isActive = active === t.key
          if (t.key !== "all" && count === 0) return null
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold",
                "border transition-all duration-150 hover:-translate-y-0.5",
                isActive
                  ? "bg-primary border-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]"
                  : "border-border bg-secondary/60 hover:border-primary/50 hover:shadow-[0_2px_12px_rgba(108,99,255,0.15)] text-foreground"
              )}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              <span className={cn(
                "ml-0.5 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full",
                isActive ? "bg-white/20 text-white" : "bg-card text-muted-foreground"
              )}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
