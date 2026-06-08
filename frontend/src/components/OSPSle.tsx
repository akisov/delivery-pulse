import { useEffect, useState } from "react"
import { Target } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]

interface CatSle { ltThr: number | null; hoursThr: number | null; ltBase: number; ltPct: number | null; hrsBase: number; hrsPct: number | null }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  cats: { key: string; label: string }[]
  target: number
  sle: Record<string, Record<string, CatSle>>
  updatedAt?: string
}

function Pct({ pct, base, target }: { pct: number | null; base: number; target: number }) {
  if (pct == null || base === 0) return <span className="text-muted-foreground/50">—</span>
  const ok = pct >= target
  const color = ok ? "#10B981" : "#EF4444"
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-black" style={{ background: `${color}1A`, color }}>
        {pct}%
      </span>
      <span className="text-[10px] text-muted-foreground">/ {base}</span>
    </span>
  )
}

export function OSPSle({ queue, refreshKey }: { queue?: string; refreshKey?: number }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/osp-sle?months=6${refresh ? "&refresh=true" : ""}`).then(r => r.json())
      .then((d: Resp) => { if (d.ok) setResp(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (refreshKey) load(true) }, [refreshKey])

  const single = queue && queue !== "all" ? queue : null
  const teams = single ? [single] : TEAM_ORDER.filter(q => resp?.queues?.[q])
  const cats = resp?.cats ?? []
  const target = resp?.target ?? 85

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Target className="w-4 h-4 text-emerald-500" /> Попадание в SLE</CardTitle>
          {resp?.updatedAt && <span className="text-[11px] text-muted-foreground">обновлено: {resp.updatedAt}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Доля завершённых задач (за полгода) в пределах порога SLE по LT (дни в работе) и трудозатратам (часы) · цель — {target}% (зелёный ≥ {target}%)
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}
        {loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : !resp ? null : (
          <div className="space-y-5">
            {teams.map(q => {
              const teamSle = resp.sle?.[q] || {}
              return (
                <div key={q}>
                  {teams.length > 1 && (
                    <h4 className="text-xs font-black uppercase tracking-wide text-foreground mb-2">{resp.queues?.[q] || q}</h4>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-separate border-spacing-0">
                      <thead>
                        <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          <th className="text-left px-2.5 py-2 border-b border-border">Тип</th>
                          <th className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">SLE LT</th>
                          <th className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">Попадание LT</th>
                          <th className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">SLE часы</th>
                          <th className="text-right px-2.5 py-2 border-b border-border whitespace-nowrap">Попадание (часы)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cats.map(c => {
                          const s = teamSle[c.key] || {} as CatSle
                          return (
                            <tr key={c.key} className="hover:bg-accent/30 transition-colors">
                              <td className="px-2.5 py-2 border-b border-border/50 whitespace-nowrap text-foreground">{c.label}</td>
                              <td className="px-2.5 py-2 border-b border-border/50 text-right text-muted-foreground tabular-nums">{s.ltThr != null ? `≤ ${s.ltThr} дн` : "—"}</td>
                              <td className="px-2.5 py-2 border-b border-border/50 text-right"><Pct pct={s.ltPct ?? null} base={s.ltBase ?? 0} target={target} /></td>
                              <td className="px-2.5 py-2 border-b border-border/50 text-right text-muted-foreground tabular-nums">{s.hoursThr != null ? `≤ ${s.hoursThr} ч` : "—"}</td>
                              <td className="px-2.5 py-2 border-b border-border/50 text-right"><Pct pct={s.hrsPct ?? null} base={s.hrsBase ?? 0} target={target} /></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
            <p className="text-[10px] text-muted-foreground">«/ N» — число завершённых задач с заполненной метрикой, по которым считали попадание</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
