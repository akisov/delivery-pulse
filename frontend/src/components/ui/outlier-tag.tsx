import { cn } from "@/lib/utils"

/**
 * Единый маркер «дольше P85» — раньше был эмодзи 🔥 в разных местах,
 * теперь один чип, чтобы отображалось одинаково по всему отчёту.
 */
export function OutlierTag({ className }: { className?: string }) {
  return (
    <span
      title="Дольше P85 — кандидат на анализ"
      className={cn(
        "inline-flex items-center rounded-md border border-orange-500/40 bg-orange-500/15 px-1.5 py-px text-[10px] font-bold leading-none text-orange-500 shrink-0",
        className
      )}
    >
      P85+
    </span>
  )
}
