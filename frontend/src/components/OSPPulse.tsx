import { useEffect, useMemo, useRef, useState } from "react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Star, ChevronDown, ChevronUp, Check, Calendar } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]
const QUEUE_COLORS: Record<string, string> = { POOLING: "#6C63FF", UDOSTAVKA: "#06B6D4", DOSTAVKAPIKO: "#10B981" }
const RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
function mlabel(m: string) { const [y, mo] = m.split("-"); return `${RU[+mo - 1]} ${y.slice(2)}` }
const SCORE_COLORS: Record<number, string> = { 1: "#EF4444", 2: "#F97316", 3: "#EAB308", 4: "#84CC16", 5: "#10B981" }
const SCORE_EMOJI: Record<number, string> = { 1: "💀", 2: "🩸", 3: "😐", 4: "⭐", 5: "🌟" }
// частицы, разлетающиеся при выборе оценки
const PARTICLES: Record<number, { e: string; x: number; d: number; s: string }[]> = {
  1: [{ e: "💀", x: 30, d: 0, s: "1.2rem" }, { e: "💀", x: 62, d: .1, s: "1rem" }, { e: "🩸", x: 46, d: .05, s: "1.1rem" }],
  2: [{ e: "🩸", x: 32, d: 0, s: "1.1rem" }, { e: "🩸", x: 64, d: .12, s: "1rem" }, { e: "😬", x: 48, d: .05, s: "1.1rem" }],
  3: [{ e: "😐", x: 50, d: 0, s: "1.4rem" }],
  4: [{ e: "⭐", x: 26, d: 0, s: "1.1rem" }, { e: "✨", x: 54, d: .08, s: "1rem" }, { e: "⭐", x: 76, d: .04, s: "1.2rem" }],
  5: [{ e: "🌟", x: 18, d: 0, s: "1.2rem" }, { e: "✨", x: 44, d: .06, s: "1rem" }, { e: "⭐", x: 64, d: .03, s: "1.2rem" }, { e: "🌟", x: 86, d: .1, s: "1rem" }],
}

// красивый выбор месяца
function MonthSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-8 text-xs font-semibold text-foreground capitalize hover:border-primary/50 transition-colors">
        <Calendar className="w-3.5 h-3.5 text-muted-foreground" /> {mlabel(value)} <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-60 w-36 overflow-auto rounded-xl border border-border bg-card p-1 shadow-2xl">
            {options.map(m => (
              <button key={m} onClick={() => { onChange(m); setOpen(false) }}
                className={cn("w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs capitalize hover:bg-secondary transition-colors",
                  value === m ? "text-primary font-bold" : "text-foreground")}>
                {mlabel(m)} {value === m && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// тултип: для команды — средняя + разбивка по критериям; для всех — средняя по командам
function PulseTip({ active, payload, label, single, criteria, queues, teams }: any) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-2xl text-xs space-y-0.5">
      <p className="font-bold text-foreground">{label}</p>
      {single ? (
        <>
          {row.avg != null && <p className="font-semibold" style={{ color: "#8B5CF6" }}>Средняя: {row.avg}</p>}
          {criteria.map((c: string) => row.byCrit?.[c] != null && (
            <p key={c} className="text-muted-foreground">{c}: <b className="text-foreground">{row.byCrit[c]}</b></p>
          ))}
        </>
      ) : teams.map((q: string) => row[q] != null && (
        <p key={q} className="text-muted-foreground">{queues?.[q]}: <b className="text-foreground">{row[q]}</b></p>
      ))}
    </div>
  )
}

interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  criteria: string[]
  scale: Record<string, string>
  months: string[]
  data: Record<string, Record<string, Record<string, number>>>  // team -> month -> crit -> score
}

export function OSPPulse({ queue, month: upTo, refreshKey }: { queue?: string; month?: string; refreshKey?: number }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [fMonth, setFMonth] = useState("")
  const [fScores, setFScores] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [burst, setBurst] = useState<{ crit: string; n: number; id: number } | null>(null)
  const burstId = useRef(0)
  const pick = (c: string, n: number) => {
    setFScores(s => ({ ...s, [c]: n }))
    burstId.current += 1
    setBurst({ crit: c, n, id: burstId.current })
  }

  const load = () => {
    setLoading(true); setError(null)
    fetch("/osp-pulse").then(r => r.json())
      .then((d: Resp) => { if (d.ok) setResp(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (refreshKey) load() }, [refreshKey])

  const single = queue && queue !== "all" ? queue : null
  const criteria = resp?.criteria ?? []

  // месяцы для формы: последние 12 + уже имеющиеся
  const formMonths = useMemo(() => {
    const set = new Set<string>(resp?.months ?? [])
    const now = new Date()
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
    }
    return Array.from(set).sort().reverse()
  }, [resp])

  useEffect(() => { if (upTo) setFMonth(upTo); else if (!fMonth && formMonths.length) setFMonth(formMonths[0]) }, [upTo, formMonths])
  // подставляем уже сохранённые оценки за выбранный месяц
  useEffect(() => {
    if (single && fMonth) setFScores({ ...(resp?.data?.[single]?.[fMonth] || {}) })
  }, [single, fMonth, resp])

  const teamsAll = TEAM_ORDER.filter(q => resp?.queues?.[q])
  const avgOf = (q: string, m: string): number | null => {
    const obj = resp?.data?.[q]?.[m]
    if (!obj) return null
    const vals = criteria.map(c => obj[c]).filter(v => v != null) as number[]
    return vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null
  }
  const chartData = useMemo(() => {
    if (!resp) return []
    return resp.months.filter(m => !upTo || m <= upTo).map(m => {
      const row: Record<string, any> = { label: mlabel(m), month: m }
      if (single) {
        const a = avgOf(single, m); if (a != null) row.avg = a
        const bc: Record<string, number> = {}
        criteria.forEach(c => { const v = resp.data?.[single]?.[m]?.[c]; if (v != null) bc[c] = v })
        row.byCrit = bc
      } else {
        teamsAll.forEach(q => { const a = avgOf(q, m); if (a != null) row[q] = a })
      }
      return row
    })
  }, [resp, single, criteria, upTo])

  const hasChart = chartData.some(r => single ? r.avg != null : teamsAll.some(q => r[q] != null))

  const submit = async () => {
    if (!single || !fMonth) return
    setSaving(true)
    await fetch(`/osp-pulse/submit?team=${single}&month=${fMonth}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fScores),
    }).catch(() => {})
    setSaving(false); setFormOpen(false); load()
  }

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Star className="w-4 h-4 text-amber-500" /> Оценка продакта</CardTitle>
          {single && (
            <button onClick={() => setFormOpen(o => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-8 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
              {formOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <Star className="w-3.5 h-3.5" />} Оценить
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Насколько продакт доволен результатом (1–5) по месяцам · {single ? (resp?.queues?.[single] || single) : "выберите команду для графика и оценки"}
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}
        {loading ? (
          <Skeleton className="h-56 rounded-xl" />
        ) : !resp ? null : (
          <>
            {/* форма оценки */}
            {single && formOpen && (
              <div className="rounded-xl border border-border bg-secondary/30 p-4 mb-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Месяц</span>
                  <MonthSelect value={fMonth} options={formMonths} onChange={setFMonth} />
                </div>
                {criteria.map(c => {
                  const cur = fScores[c]
                  return (
                    <div key={c} className="flex items-center justify-between gap-3 flex-wrap py-0.5">
                      <span className="text-sm text-foreground flex-1 min-w-[160px] flex items-center gap-1.5">
                        {c} {cur ? <span className="text-base leading-none">{SCORE_EMOJI[cur]}</span> : null}
                      </span>
                      <div className="relative flex gap-1.5">
                        {[1, 2, 3, 4, 5].map(n => {
                          const on = cur === n
                          return (
                            <button key={n} title={`${n} — ${resp.scale[String(n)]}`} onClick={() => pick(c, n)}
                              className={cn("w-10 h-11 rounded-xl flex flex-col items-center justify-center gap-0 border transition-all duration-150 hover:-translate-y-0.5 hover:scale-110",
                                on ? "border-transparent shadow-lg animate-score-pop" : "border-border bg-card opacity-65 hover:opacity-100")}
                              style={on ? { background: `${SCORE_COLORS[n]}26`, boxShadow: `0 6px 18px ${SCORE_COLORS[n]}55` } : undefined}>
                              <span className={cn("text-lg leading-none", !on && "grayscale", on && (n <= 2) && "animate-shake", on && n === 3 && "animate-wobble")}>{SCORE_EMOJI[n]}</span>
                              <span className="text-[10px] font-black leading-none mt-0.5" style={{ color: on ? SCORE_COLORS[n] : "hsl(var(--muted-foreground))" }}>{n}</span>
                            </button>
                          )
                        })}
                        {burst?.crit === c && (
                          <div key={burst.id} className="absolute inset-x-0 bottom-2 h-0 pointer-events-none">
                            {PARTICLES[burst.n].map((p, i) => (
                              <span key={i} className="particle go" style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, fontSize: p.s }}>{p.e}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="text-[10px] text-muted-foreground">1 — ожидания не оправданы · 5 — превзошли ожидания</div>
                  <button onClick={submit} disabled={saving || Object.keys(fScores).length === 0}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 h-8 text-xs font-semibold disabled:opacity-50">
                    <Check className="w-3.5 h-3.5" /> {saving ? "Сохраняю…" : "Сохранить"}
                  </button>
                </div>
              </div>
            )}

            {!hasChart ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                {single ? "Нет оценок — нажми «Оценить», чтобы добавить" : "Оценок пока нет"}
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: -10, bottom: 4 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <Tooltip content={(p: any) => <PulseTip {...p} single={single} criteria={criteria} queues={resp.queues} teams={teamsAll} />} />
                    {single ? (
                      <Line type="monotone" dataKey="avg" name="Средняя оценка" stroke="#8B5CF6" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                    ) : teamsAll.map(q => (
                      <Line key={q} type="monotone" dataKey={q} name={resp.queues?.[q] || q} stroke={QUEUE_COLORS[q] || "#8B5CF6"}
                        strokeWidth={2.5} dot={{ r: 2.5 }} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 justify-center">
                  {single ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="w-3 h-0.5 rounded-full" style={{ background: "#8B5CF6" }} />Средняя оценка (наведи — разбивка по критериям)
                    </span>
                  ) : teamsAll.map(q => (
                    <span key={q} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="w-3 h-0.5 rounded-full" style={{ background: QUEUE_COLORS[q] }} />{resp.queues?.[q]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
