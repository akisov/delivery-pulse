import { useEffect, useMemo, useState } from "react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Star, ChevronDown, ChevronUp, Check } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]
const QUEUE_COLORS: Record<string, string> = { POOLING: "#6C63FF", UDOSTAVKA: "#06B6D4", DOSTAVKAPIKO: "#10B981" }
const RU = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
function mlabel(m: string) { const [y, mo] = m.split("-"); return `${RU[+mo - 1]} ${y.slice(2)}` }
const SCORE_COLORS: Record<number, string> = { 1: "#EF4444", 2: "#F97316", 3: "#EAB308", 4: "#84CC16", 5: "#10B981" }

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

export function OSPPulse({ queue, refreshKey }: { queue?: string; refreshKey?: number }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [fMonth, setFMonth] = useState("")
  const [fScores, setFScores] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

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

  useEffect(() => { if (!fMonth && formMonths.length) setFMonth(formMonths[0]) }, [formMonths, fMonth])
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
    return resp.months.map(m => {
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
  }, [resp, single, criteria])

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
                  <span className="text-xs font-bold text-muted-foreground">Месяц</span>
                  <select value={fMonth} onChange={e => setFMonth(e.target.value)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground capitalize">
                    {formMonths.map(m => <option key={m} value={m}>{mlabel(m)}</option>)}
                  </select>
                </div>
                {criteria.map(c => (
                  <div key={c} className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-foreground flex-1 min-w-[160px]">{c}</span>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map(n => {
                        const on = fScores[c] === n
                        return (
                          <button key={n} title={resp.scale[String(n)]}
                            onClick={() => setFScores(s => ({ ...s, [c]: n }))}
                            className={cn("w-7 h-7 rounded-md text-xs font-bold transition-all",
                              on ? "text-white shadow" : "bg-card border border-border text-muted-foreground hover:border-primary/50")}
                            style={on ? { background: SCORE_COLORS[n] } : undefined}>
                            {n}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
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
