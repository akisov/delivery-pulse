import { ExternalLink } from "lucide-react"

export const ARCH_URL = "https://akisov-arch-committee.hf.space"

export function ArchEmbed() {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Арх. комитет</h1>
          <p className="text-sm text-muted-foreground mt-1">Аналитика отсечек архитектурного комитета</p>
        </div>
        <a href={ARCH_URL} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          Открыть отдельно <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <div className="rounded-2xl border border-border overflow-hidden bg-card shadow-[var(--shadow-card)]"
        style={{ height: "calc(100vh - 200px)" }}>
        <iframe
          src={ARCH_URL}
          title="Арх. комитет — Аналитика отсечек"
          className="w-full h-full border-0"
          loading="lazy"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Дашборд встроен из соседнего сервиса. Если не загрузился — откройте отдельно по кнопке выше.
      </p>
    </div>
  )
}
