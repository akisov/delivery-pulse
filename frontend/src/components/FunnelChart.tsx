import { Card, CardContent } from "@/components/ui/card"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"

interface FunnelChartProps {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

// Настоящая воронка: сверху вниз сужается. Этапы монотонно убывают —
// на каждом отсекаются возвраты.
export function FunnelChart({ tasks, onShowTasks }: FunnelChartProps) {
  const entrants = tasks.filter(t => t.entered)
  const total = entrants.length
  const akTasks = tasks.filter(t => t.entered && t.v1n > 0)
  const noAk = entrants.filter(t => t.v1n === 0)          // прошли ревью АрхКома
  const okTasks = entrants.filter(t => t.total === 0)     // с первого раза
  const taDropTasks = noAk.filter(t => t.total > 0)       // прошли АрхКом, но вернул ТА/прочее

  const stages = [
    { key: "in", label: "Пришло в АрхКом", val: total, color: "#7C6FF7", tasks: entrants },
    { key: "noak", label: "Прошли ревью АрхКома", val: noAk.length, color: "#06B6D4", tasks: noAk },
    { key: "ok", label: "С первого раза", val: okTasks.length, color: "#10B981", tasks: okTasks },
  ]
  const drops = [
    { after: 0, label: "АрхКом вернул", icon: "🔄", count: akTasks.length, color: "#f59e0b", tasks: akTasks },
    { after: 1, label: "Вернул ТА / прочее", icon: "↩️", count: taDropTasks.length, color: "#f43f5e", tasks: taDropTasks },
  ]

  // геометрия воронки
  const W = 300, CX = 175, PAD = 8, BAND = 74
  const maxV = Math.max(1, total)
  const wOf = (v: number) => Math.max(26, (v / maxV) * W)     // ширина на уровне значения
  const widths = stages.map(s => wOf(s.val))
  const tipW = widths[widths.length - 1] * 0.55
  const H = BAND * stages.length + PAD * 2
  const VBW = 360

  const click = (title: string, ts: Task[]) => { if (ts.length) onShowTasks?.({ title, tasks: ts }) }

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-black text-foreground">Воронка прохождения</h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-3">
          {total} задач пришло к техархам за период · на каждом этапе отсекаются возвраты · клик — список
        </p>

        {total === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Нет задач за период</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-4 items-center">
            {/* SVG-воронка */}
            <svg viewBox={`0 0 ${VBW} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
              <defs>
                {stages.map(s => (
                  <linearGradient key={s.key} id={`fn-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={s.color} stopOpacity="0.95" />
                    <stop offset="1" stopColor={s.color} stopOpacity="0.7" />
                  </linearGradient>
                ))}
              </defs>
              {stages.map((s, i) => {
                const topW = widths[i]
                const botW = i < stages.length - 1 ? widths[i + 1] : tipW
                const y0 = PAD + i * BAND, y1 = y0 + BAND - 10
                const pts = [
                  [CX - topW / 2, y0], [CX + topW / 2, y0],
                  [CX + botW / 2, y1], [CX - botW / 2, y1],
                ].map(p => p.join(",")).join(" ")
                const pct = Math.round(s.val / maxV * 100)
                return (
                  <g key={s.key} onClick={() => click(s.label, s.tasks)}
                    style={{ cursor: s.val ? "pointer" : "default" }} className="transition-opacity hover:opacity-90">
                    <polygon points={pts} fill={`url(#fn-${s.key})`} />
                    <text x={CX} y={y0 + (BAND - 10) / 2 - 6} textAnchor="middle" fill="#fff"
                      fontSize="13" fontWeight="800">{s.val}</text>
                    <text x={CX} y={y0 + (BAND - 10) / 2 + 11} textAnchor="middle" fill="#fff"
                      fontSize="10" fontWeight="600" opacity="0.9">{pct}%</text>
                  </g>
                )
              })}
            </svg>

            {/* Легенда этапов + отсев */}
            <div className="space-y-2">
              {stages.map(s => (
                <button key={s.key} onClick={() => click(s.label, s.tasks)} disabled={!s.val}
                  className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-secondary/50 transition-colors disabled:cursor-default disabled:opacity-60">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="text-[11px] text-foreground leading-tight flex-1">{s.label}</span>
                  <span className="text-xs font-black tabular-nums" style={{ color: s.color }}>{s.val}</span>
                </button>
              ))}
              <div className="pt-2 mt-1 border-t border-border space-y-1.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Отсеялось</p>
                {drops.map(d => (
                  <button key={d.after} onClick={() => click(d.label, d.tasks)} disabled={!d.count}
                    className="w-full text-left flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-secondary/50 transition-colors disabled:cursor-default disabled:opacity-50">
                    <span className="text-xs">{d.icon}</span>
                    <span className="text-[11px] text-muted-foreground leading-tight flex-1">{d.label}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: d.color }}>−{d.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
