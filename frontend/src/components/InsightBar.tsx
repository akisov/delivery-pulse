import type { ArchReturnTask as Task } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  tasks: Task[]
  prevTasks: Task[] | null
}

type Tone = "good" | "bad" | "warn" | "neutral"

const TONE: Record<Tone, string> = {
  good:    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  bad:     "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
  warn:    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  neutral: "bg-secondary text-muted-foreground border-border",
}

function pctOf(tasks: Task[], pred: (t: Task) => boolean) {
  return tasks.length ? Math.round(tasks.filter(pred).length / tasks.length * 100) : 0
}

export function InsightBar({ tasks, prevTasks }: Props) {
  if (tasks.length === 0) return null

  const entrants = tasks.filter(t => t.entered)
  const total = entrants.length
  const v1 = tasks.filter(t => t.v1n > 0).length   // вернул АрхКом (по всем)
  const v2 = tasks.filter(t => t.v2n > 0).length   // вернул ТА (по всем)
  const pctOk = pctOf(entrants, t => t.total === 0)
  const worst = [...tasks].sort((a, b) => b.total - a.total)[0]

  const items: { icon: string; text: string; tone: Tone }[] = []

  // 1. Качество прохождения + тренд (сравниваем только при достаточной выборке)
  if (total > 0) {
    let qualityText = `${pctOk}% задач прошли с первого раза`
    let qualityTone: Tone = pctOk >= 70 ? "good" : pctOk >= 50 ? "warn" : "bad"
    const prevEntrants = prevTasks ? prevTasks.filter(t => t.entered) : []
    if (prevEntrants.length >= 5) {
      const prevPct = pctOf(prevEntrants, t => t.total === 0)
      const diff = pctOk - prevPct
      if (diff >= 3) { qualityText += ` — качество выросло (было ${prevPct}%)`; qualityTone = "good" }
      else if (diff <= -3) { qualityText += ` — качество снизилось (было ${prevPct}%)`; qualityTone = "bad" }
      else qualityText += " — на уровне прошлого периода"
    }
    items.push({ icon: "🎯", text: qualityText, tone: qualityTone })
  }

  // 2. Кто чаще возвращает
  if (v1 > 0 || v2 > 0) {
    if (v1 > v2) items.push({ icon: "🔄", text: `Чаще возвращает АрхКом — ${v1} задач (ТА — ${v2})`, tone: "neutral" })
    else if (v2 > v1) items.push({ icon: "↩️", text: `Чаще возвращает ТА — ${v2} задач (АрхКом — ${v1})`, tone: "neutral" })
    else items.push({ icon: "⚖️", text: `АрхКом и ТА возвращают поровну — по ${v1}`, tone: "neutral" })
  }

  // 3. Рекордсмен
  if (worst && worst.total >= 3) {
    items.push({ icon: "🔥", text: `Рекордсмен: ${worst.key} возвращали ${worst.total} раза`, tone: "bad" })
  } else if (v1 === 0 && v2 === 0) {
    items.push({ icon: "✅", text: "За период не было ни одного возврата", tone: "good" })
  }

  return (
    <div className="rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.06)]">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground mr-1">💡 Итоги</span>
        {items.map((it, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border", TONE[it.tone])}>
            <span>{it.icon}</span>{it.text}
          </span>
        ))}
      </div>
    </div>
  )
}
