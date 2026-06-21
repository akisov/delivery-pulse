import { Card } from "@/components/ui/card"
import { ExternalLink, RefreshCw, Users } from "lucide-react"
import type { ArchTask } from "@/lib/types"
import { cn } from "@/lib/utils"

// Цвет статуса по его id
const STATUS_STYLE: Record<string, { dot: string; text: string; bg: string }> = {
  "180": { dot: "bg-[hsl(38,92%,50%)]",  text: "text-[hsl(38,92%,45%)]  dark:text-[hsl(38,92%,60%)]",  bg: "bg-[hsl(38,92%,50%)]/10" },   // Аналит. проработка готово
  "151": { dot: "bg-[hsl(166,76%,40%)]", text: "text-[hsl(166,76%,32%)] dark:text-[hsl(166,76%,45%)]", bg: "bg-[hsl(166,76%,40%)]/10" },  // Ревью аналитики
  "145": { dot: "bg-[hsl(252,87%,65%)]", text: "text-[hsl(252,80%,58%)] dark:text-[hsl(252,87%,72%)]", bg: "bg-[hsl(252,87%,65%)]/10" },  // Согласование архитектуры
  "175": { dot: "bg-[hsl(199,89%,55%)]", text: "text-[hsl(199,89%,42%)] dark:text-[hsl(199,89%,60%)]", bg: "bg-[hsl(199,89%,55%)]/10" },  // Доработка
}
const STATUS_FALLBACK = { dot: "bg-muted-foreground", text: "text-muted-foreground", bg: "bg-secondary" }

const TYPE_ICON: Record<string, string> = {
  story: "📖", analytics: "📊", technicaldebt: "🔧", improvement: "⚡", elaboration: "📝",
}

const AVATAR_COLORS = [
  "bg-[hsl(252,87%,65%)]", "bg-[hsl(166,76%,40%)]", "bg-[hsl(350,89%,60%)]",
  "bg-[hsl(38,92%,50%)]", "bg-[hsl(199,89%,55%)]", "bg-[hsl(280,70%,60%)]",
]

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "задач"
  if (m10 === 1) return "задача"
  if (m10 >= 2 && m10 <= 4) return "задачи"
  return "задач"
}

function daysWord(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m10 === 1) return "день"
  if (m10 >= 2 && m10 <= 4) return "дня"
  return "дней"
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return "—"
  // Фамилия Имя → первые буквы двух первых слов
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase()
}

function avatarColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

interface Props {
  tasks: ArchTask[]
  loading?: boolean
}

export function ArchCommitteeReport({ tasks, loading }: Props) {
  const th = "py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
  const td = "py-3 text-sm"
  const avgDays = tasks.length ? Math.round(tasks.reduce((s, t) => s + t.daysInStatus, 0) / tasks.length) : 0
  const stuck = tasks.filter(t => t.daysInStatus >= 7).length

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center text-sm">🏛</span>
          <div>
            <span className="text-sm font-bold text-foreground">Сейчас в Арх. комитете</span>
            <span className="ml-2 text-xs text-muted-foreground">{tasks.length} {plural(tasks.length)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tasks.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ср. {avgDays}д на статусе
            </span>
          )}
          {stuck > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400">
              🔥 {stuck} засиделись (≥7д)
            </span>
          )}
          {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      <div className="overflow-x-auto">
        {tasks.length === 0 ? (
          <div className="py-14 text-center text-muted-foreground text-sm flex flex-col items-center gap-2">
            <Users className="w-7 h-7 opacity-30" />
            Сейчас в Арх. комитете нет задач
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-secondary/50 border-b border-border">
                <th className={cn(th, "text-left pl-5 pr-2 w-[150px]")}>Ключ</th>
                <th className={cn(th, "text-left px-2")}>Задача</th>
                <th className={cn(th, "text-left px-2 w-[210px]")}>Статус</th>
                <th className={cn(th, "text-center px-2 w-[120px]")}>Возвраты</th>
                <th className={cn(th, "text-center px-2 w-[110px]")}>Дней на статусе</th>
                <th className={cn(th, "text-left px-2 w-[220px]")}>Исполнитель</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tasks.map(t => {
                const s = STATUS_STYLE[t.statusKey] ?? STATUS_FALLBACK
                const dayColor = t.daysInStatus >= 10
                  ? "text-rose-600 dark:text-rose-400"
                  : t.daysInStatus >= 4
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-foreground"
                return (
                  <tr key={t.key} className="hover:bg-secondary/30 transition-colors group">
                    <td className={cn(td, "pl-5 pr-2")}>
                      <a href={t.url} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary font-mono text-xs font-bold hover:underline whitespace-nowrap">
                        {t.key}
                        <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-70 transition-opacity shrink-0" />
                      </a>
                    </td>
                    <td className={cn(td, "px-2 max-w-[320px]")}>
                      <span className="flex items-center gap-1.5 leading-snug text-foreground">
                        <span className="shrink-0 text-sm">{TYPE_ICON[t.issueType] ?? "◈"}</span>
                        <span className="line-clamp-1">{t.title}</span>
                      </span>
                    </td>
                    <td className={cn(td, "px-2")}>
                      <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap", s.bg, s.text)}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />
                        {t.status}
                      </span>
                    </td>
                    <td className={cn(td, "px-2")}>
                      <div className="flex items-center justify-center gap-1.5">
                        <span title="Возвраты ТА (на доработку)"
                          className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-bold tabular-nums",
                            t.v2n > 0 ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-secondary text-muted-foreground/50")}>
                          ↩️ {t.v2n}
                        </span>
                        <span title="Возвраты АрхКом (на ревью аналитики)"
                          className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-bold tabular-nums",
                            t.v1n > 0 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-secondary text-muted-foreground/50")}>
                          🔄 {t.v1n}
                        </span>
                      </div>
                    </td>
                    <td className={cn(td, "px-2 text-center")}>
                      <span className={cn("font-black tabular-nums text-base", dayColor)}>{t.daysInStatus}</span>
                      <span className="text-muted-foreground text-xs ml-1">{daysWord(t.daysInStatus)}</span>
                    </td>
                    <td className={cn(td, "px-2")}>
                      {t.assignee ? (
                        <span className="inline-flex items-center gap-2">
                          <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0", avatarColor(t.assignee))}>
                            {initials(t.assignee)}
                          </span>
                          <span className="text-foreground text-xs truncate max-w-[170px]">{t.assignee}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}
