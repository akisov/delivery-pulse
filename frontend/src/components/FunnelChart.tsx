import { Card, CardContent } from "@/components/ui/card"
import { ArrowRight, ChevronRight, ListFilter } from "lucide-react"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"

interface FunnelChartProps {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

// Единая воронка прохождения арх. комитета: конус слева + этапы/возвраты справа.
export function FunnelChart({ tasks, onShowTasks }: FunnelChartProps) {
  const entrants = tasks.filter(t => t.entered)
  const total = entrants.length
  const akTasks = entrants.filter(t => t.v1n > 0)
  const taTasks = entrants.filter(t => t.v2n > 0)
  const noAk = entrants.filter(t => t.v1n === 0)
  const okTasks = entrants.filter(t => t.total === 0)
  const akTrans = akTasks.reduce((s, t) => s + t.v1n, 0)
  const taTrans = taTasks.reduce((s, t) => s + t.v2n, 0)
  const pct = (n: number) => (total ? Math.round(n / total * 100) : 0)
  const click = (title: string, ts: Task[], subtitle?: string) => { if (ts.length) onShowTasks?.({ title, subtitle, tasks: ts }) }

  const stages = [
    { key: "in", label: "Пришло в АрхКом", short: "Пришло", val: total, color: "#6C63FF", tasks: entrants },
    { key: "noak", label: "Прошли ревью АрхКома", short: "Прошли ревью", val: noAk.length, color: "#06B6D4", tasks: noAk },
    { key: "ok", label: "С первого раза", short: "С первого раза", val: okTasks.length, color: "#10B981", tasks: okTasks },
  ]

  // геометрия конуса
  const W = 300, CX = 175, PADY = 10, BAND = 82, VBW = 350
  const maxV = Math.max(1, total)
  const wOf = (v: number) => Math.max(30, (v / maxV) * W)
  const widths = stages.map(s => wOf(s.val))
  const tipW = widths[widths.length - 1] * 0.5
  const H = BAND * stages.length + PADY * 2

  const returns = [
    { key: "ak", title: "АрхКом вернул на доработку", short: "АрхКом вернул", from: "Аналит. проработка готово",
      to: "Ревью аналитики", color: "#0d9488", n: akTasks.length, trans: akTrans, tasks: akTasks, fIcon: "📊", tIcon: "🔍" },
    { key: "ta", title: "ТА вернул на уточнение", short: "ТА вернул", from: "Согласование архитектуры",
      to: "Доработка", color: "#f43f5e", n: taTasks.length, trans: taTrans, tasks: taTasks, fIcon: "🏛", tIcon: "🔧" },
  ]

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-black text-foreground">Воронка прохождения арх. комитета</h3>
        <p className="text-xs text-muted-foreground mt-0.5 mb-4">
          {total} задач пришло к техархам за период · сужается к «с первого раза» · клик — список
        </p>

        {total === 0 ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Нет задач за период</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6 items-center">
            {/* Конус */}
            <svg viewBox={`0 0 ${VBW} ${H}`} className="w-full" style={{ maxHeight: 320 }}>
              <defs>
                {stages.map(s => (
                  <linearGradient key={s.key} id={`fn-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={s.color} stopOpacity="1" />
                    <stop offset="1" stopColor={s.color} stopOpacity="0.72" />
                  </linearGradient>
                ))}
              </defs>
              {stages.map((s, i) => {
                const topW = widths[i]
                const botW = i < stages.length - 1 ? widths[i + 1] : tipW
                const y0 = PADY + i * BAND, y1 = y0 + BAND - 8
                const pts = [[CX - topW / 2, y0], [CX + topW / 2, y0], [CX + botW / 2, y1], [CX - botW / 2, y1]]
                  .map(p => p.join(",")).join(" ")
                const cy = y0 + (BAND - 8) / 2
                return (
                  <g key={s.key} onClick={() => click(s.label, s.tasks)}
                    style={{ cursor: s.val ? "pointer" : "default" }} className="transition-opacity hover:opacity-90">
                    <polygon points={pts} fill={`url(#fn-${s.key})`} />
                    <text x={CX} y={cy - 8} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" opacity="0.95">{s.short}</text>
                    <text x={CX} y={cy + 13} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="900">{s.val}</text>
                  </g>
                )
              })}
            </svg>

            {/* Правая колонка: этапы + возвраты */}
            <div className="space-y-3">
              {/* этапы */}
              <div className="space-y-1">
                {stages.map(s => (
                  <button key={s.key} onClick={() => click(s.label, s.tasks)} disabled={!s.val} title={s.val ? "Показать задачи" : undefined}
                    className="group w-full flex items-center gap-2 rounded-lg px-2 py-1 cursor-pointer hover:bg-secondary/60 transition-colors disabled:cursor-default disabled:opacity-60 text-left">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="text-xs text-foreground flex-1 group-hover:underline decoration-dotted underline-offset-4">{s.label}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{pct(s.val)}%</span>
                    <span className="text-sm font-black tabular-nums w-7 text-right" style={{ color: s.color }}>{s.val}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
                  </button>
                ))}
                <div className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500" />
                  <span className="text-xs text-muted-foreground flex-1">Прошли без замечаний</span>
                  <span className="text-sm font-black text-emerald-500 tabular-nums">{okTasks.length}</span>
                  <span className="text-xs text-muted-foreground">({pct(okTasks.length)}%)</span>
                </div>
              </div>

              {/* возвраты */}
              <div className="pt-3 border-t border-border">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Возвраты на доработку · клик — задачи</p>
                <div className="space-y-2.5">
                  {returns.map(r => (
                    <button key={r.key} onClick={() => click(r.title, r.tasks, `${r.n} задач · ${r.trans} возвратов суммарно`)}
                      disabled={!r.n} title={r.n ? "Показать задачи" : undefined}
                      className="group w-full text-left rounded-lg border border-transparent p-2 cursor-pointer hover:bg-secondary/40 hover:border-border transition-colors disabled:cursor-default disabled:opacity-60">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-bold group-hover:underline decoration-dotted underline-offset-4" style={{ color: r.color }}>{r.short}</span>
                        <span className="ml-auto text-lg font-black tabular-nums" style={{ color: r.color }}>{r.n}</span>
                        <span className="text-[11px] text-muted-foreground">{pct(r.n)}%</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                        <span className="rounded-md px-1.5 py-0.5 border" style={{ background: `${r.color}14`, borderColor: `${r.color}44`, color: r.color }}>{r.fIcon} {r.from}</span>
                        <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: r.color }} />
                        <span className="rounded-md px-1.5 py-0.5 border" style={{ background: `${r.color}14`, borderColor: `${r.color}44`, color: r.color }}>{r.tIcon} {r.to}</span>
                        {r.trans > r.n && <span className="ml-auto text-muted-foreground">{r.trans} переходов</span>}
                      </div>
                      {r.n > 0 && (
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: r.color }}>
                          <ListFilter className="w-3 h-3" /> смотреть {r.n} задач
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
