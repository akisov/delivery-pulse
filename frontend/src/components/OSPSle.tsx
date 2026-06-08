import { useEffect, useMemo, useState } from "react"
import { Target, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]

interface CatSle { ltThr: number | null; hoursThr: number | null; ltBase: number; ltPct: number | null; hrsBase: number; hrsPct: number | null }
interface SleItem { queue: string; cat: string; key: string; summary: string; url: string; days: number | null; hours: number | null; resolved: string; assignee: string }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  cats: { key: string; label: string }[]
  target: number
  sle: Record<string, Record<string, CatSle>>
  items?: SleItem[]
  updatedAt?: string
}

function Pct({ pct, base, target }: { pct: number | null; base: number; target: number }) {
  if (pct == null || base === 0) return <span className="text-muted-foreground/50">—</span>
  const ok = pct >= target
  const color = ok ? "#10B981" : "#EF4444"
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-black" style={{ background: `${color}1A`, color }}>{pct}%</span>
      <span className="text-[10px] text-muted-foreground">/ {base}</span>
    </span>
  )
}

interface Sel { q: string; cat: string; metric: "lt" | "hours"; thr: number | null }

export function OSPSle({ queue, month, refreshKey }: { queue?: string; month?: string; refreshKey?: number }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Sel | null>(null)

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

  // попадание в SLE с учётом отчётного месяца (всё позже — обрезаем, считаем из items)
  const sleData = useMemo(() => {
    if (!resp) return {} as Record<string, Record<string, CatSle>>
    if (!month) return resp.sle
    const pctOf = (vals: number[], t: number | null | undefined) =>
      (vals.length && t != null) ? Math.round(vals.filter(v => v <= t).length / vals.length * 100) : null
    const out: Record<string, Record<string, CatSle>> = {}
    for (const q of Object.keys(resp.sle || {})) {
      out[q] = {}
      for (const c of cats) {
        const thr = resp.sle[q]?.[c.key] || ({} as CatSle)
        const its = (resp.items ?? []).filter(it => it.queue === q && it.cat === c.key && (it.resolved || "").slice(0, 7) <= month)
        const lt = its.map(i => i.days).filter(v => v != null) as number[]
        const hrs = its.map(i => i.hours).filter(v => v != null) as number[]
        out[q][c.key] = { ltThr: thr.ltThr, hoursThr: thr.hoursThr, ltBase: lt.length, ltPct: pctOf(lt, thr.ltThr), hrsBase: hrs.length, hrsPct: pctOf(hrs, thr.hoursThr) }
      }
    }
    return out
  }, [resp, month, cats])

  // задачи, не попавшие в SLE по выбранной метрике
  const missList = useMemo(() => {
    if (!sel || !resp?.items || sel.thr == null) return []
    return resp.items
      .filter(it => it.queue === sel.q && it.cat === sel.cat && (!month || (it.resolved || "").slice(0, 7) <= month))
      .filter(it => sel.metric === "lt" ? (it.days != null && it.days > sel.thr!) : (it.hours != null && it.hours > sel.thr!))
      .sort((a, b) => (sel.metric === "lt" ? (b.days! - a.days!) : (b.hours! - a.hours!)))
  }, [sel, resp, month])

  const catLabel = (k: string) => cats.find(c => c.key === k)?.label || k
  const open = (q: string, cat: string, metric: "lt" | "hours", thr: number | null) => {
    if (thr == null) return
    setSel({ q, cat, metric, thr })
  }

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Target className="w-4 h-4 text-emerald-500" /> Попадание в SLE</CardTitle>
          {resp?.updatedAt && <span className="text-[11px] text-muted-foreground">обновлено: {resp.updatedAt}</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Доля завершённых задач (за полгода) в пределах порога SLE по LT (дни в работе) и трудозатратам (часы) · цель — {target}% · клик по % — задачи вне SLE
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}
        {loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : !resp ? null : (
          <div className="space-y-5">
            {teams.map(q => {
              const teamSle = sleData?.[q] || {}
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
                              <td className="px-2.5 py-2 border-b border-border/50 text-right">
                                <button onClick={() => open(q, c.key, "lt", s.ltThr ?? null)} className="hover:opacity-80 transition-opacity cursor-pointer" title="Показать задачи вне SLE">
                                  <Pct pct={s.ltPct ?? null} base={s.ltBase ?? 0} target={target} />
                                </button>
                              </td>
                              <td className="px-2.5 py-2 border-b border-border/50 text-right text-muted-foreground tabular-nums">{s.hoursThr != null ? `≤ ${s.hoursThr} ч` : "—"}</td>
                              <td className="px-2.5 py-2 border-b border-border/50 text-right">
                                <button onClick={() => open(q, c.key, "hours", s.hoursThr ?? null)} className="hover:opacity-80 transition-opacity cursor-pointer" title="Показать задачи вне SLE">
                                  <Pct pct={s.hrsPct ?? null} base={s.hrsBase ?? 0} target={target} />
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}
            <p className="text-[10px] text-muted-foreground">«/ N» — число завершённых задач с метрикой · нажми на % чтобы увидеть тех, кто вне SLE</p>
          </div>
        )}
      </CardContent>

      <Modal open={!!sel} onClose={() => setSel(null)}
        title={sel ? `Вне SLE — ${catLabel(sel.cat)}` : ""}
        subtitle={sel ? `${resp?.queues?.[sel.q] || sel.q} · ${sel.metric === "lt" ? `дни в работе > ${sel.thr}` : `часы > ${sel.thr}`} · ${missList.length} задач` : ""} wide>
        {missList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Все задачи в SLE 🎉</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {missList.map((t, i) => (
              <div key={t.key + i} className="border-b border-border last:border-0 px-4 py-2.5 flex items-start gap-3 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {t.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    <Badge variant="outline" className="text-[10px]">{t.queue}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.summary}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t.assignee} · завершено {t.resolved}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-black text-destructive">{sel?.metric === "lt" ? t.days : t.hours}</p>
                  <p className="text-[10px] text-muted-foreground">{sel?.metric === "lt" ? `дн (порог ${sel?.thr})` : `ч (порог ${sel?.thr})`}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  )
}
