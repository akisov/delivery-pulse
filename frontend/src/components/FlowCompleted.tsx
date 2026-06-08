import { useEffect, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { RefreshCw, CheckCircle, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

interface DoneItem { month: string; key: string; summary: string; url: string; end: string; status: string; assignee: string }
interface Resp { ok: boolean; error?: string; months: string[]; data: { month: string; label: string; count: number }[]; items: DoneItem[]; total?: number; updatedAt?: string }

// больше завершено — лучше (рост зелёный)
function Trend({ cur, prev }: { cur: number; prev: number | undefined }) {
  if (prev == null) return null
  const d = cur - prev
  if (d === 0) return <span className="text-[11px] text-muted-foreground">= как в прошлом месяце</span>
  const up = d > 0
  const pct = prev > 0 ? Math.round((d / prev) * 100) : null
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-bold", up ? "text-emerald-500" : "text-rose-500")}>
      {up ? "▲" : "▼"} {up ? "+" : ""}{d} задач{pct != null ? ` (${up ? "+" : ""}${pct}%)` : ""} к прошлому месяцу
    </span>
  )
}

export function FlowCompleted() {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [selMonth, setSelMonth] = useState<string | null>(null)

  const load = (refresh = false) => {
    setLoading(true)
    fetch(`/flow-completed?months=8${refresh ? "&refresh=true" : ""}`).then(r => r.json())
      .then((d: Resp) => setResp(d.ok ? d : null))
      .catch(() => setResp(null))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const data = resp?.data ?? []
  const cur = data.length ? data[data.length - 1].count : 0
  const prev = data.length > 1 ? data[data.length - 2].count : undefined
  const monthLabel = data.find(d => d.month === selMonth)?.label || selMonth || ""
  const list = (resp?.items ?? []).filter(it => it.month === selMonth)

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Завершено задач по месяцам</CardTitle>
          <div className="flex items-center gap-2">
            {!loading && data.length > 1 && <Trend cur={cur} prev={prev} />}
            <button onClick={() => load(true)} disabled={loading} title="Пересчитать"
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Сколько задач PUTKURERA перешло в «Завершено» (по дате завершения) · клик по столбцу — список</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 rounded-xl" />
        ) : !resp ? (
          <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Нет данных</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barSize={36}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="count" name="Завершено" fill="#10B981" radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }}
                onClick={(d: any) => d?.payload?.month && setSelMonth(d.payload.month)}>
                <LabelList dataKey="count" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>

      <Modal open={!!selMonth} onClose={() => setSelMonth(null)} title={`Завершено — ${monthLabel}`}
        subtitle={`${list.length} задач PUTKURERA`} wide>
        {list.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет задач</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {list.map((t, i) => (
              <div key={t.key + i} className="border-b border-border last:border-0 px-4 py-2.5 flex items-start gap-3 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {t.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    {t.status && <span className="text-[10px] text-muted-foreground">{t.status}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.summary}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">{t.assignee} · завершено {t.end}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  )
}
