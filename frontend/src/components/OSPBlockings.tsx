import { useEffect, useMemo, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { Lock, ExternalLink, Clock, CheckCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const REASON_COLORS: Record<string, string> = {
  "Блок другой нашей задачей": "#7C6FF7",
  "Внешний фактор": "#F97316",
  "Переключились на срочную задачу": "#EF4444",
  "Ждем дату или событие": "#EAB308",
  "Отпуск, больничный": "#EC4899",
  "Ждем фун. архитекторов": "#F472B6",
  "Ждем ответа заказчика": "#06B6D4",
  "Ждем тех. архитектров": "#3B82F6",
  "Ждем тех. архитекторов": "#3B82F6",
  "Ждем другую команду": "#10B981",
  "Ждем партнера": "#F59E0B",
  "Мораторий": "#8B5CF6",
  "Ждем тестовую среду": "#14B8A6",
  "Причина не известна": "#94A3B8",
  "Не указана": "#64748B",
}
const EXTRA = ["#85EF47", "#FB923C", "#A78BFA", "#34D399", "#F87171", "#60A5FA"]

interface BlockItem { month: string; queue: string; reason: string; key: string; title: string; url: string; start: string; end: string; days: number; active: boolean }
interface Row { month: string; label: string; all: Record<string, number>; [q: string]: any }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  months: string[]; reasons: string[]
  data: Row[]; items: BlockItem[]
}

function pluralDays(n: number) {
  const m = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m === 1) return "день"
  if (m >= 2 && m <= 4) return "дня"
  return "дней"
}

export function OSPBlockings({ queue, refreshKey, onOpenDashboard }: { queue?: string; refreshKey?: number; onOpenDashboard?: () => void }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<Set<string> | null>(null)  // выбранные причины
  const [sel, setSel] = useState<{ month: string; reason: string } | null>(null)

  const load = () => {
    setLoading(true); setError(null)
    fetch("/osp-blockings?months=6").then(r => r.json())
      .then((d: Resp) => { if (d.ok) setResp(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (refreshKey) load() }, [refreshKey])

  const teamLabel = !queue || queue === "all" ? "Все команды" : (resp?.queues?.[queue] || queue)
  const rColor = (r: string) => REASON_COLORS[r] ?? EXTRA[(resp?.reasons.indexOf(r) ?? 0) % EXTRA.length]

  const chartData = useMemo(() => {
    if (!resp) return []
    return resp.data.map(row => {
      const src: Record<string, number> = (queue && queue !== "all") ? (row[queue] || {}) : row.all
      const o: Record<string, any> = { month: row.month, label: row.label, total: 0 }
      resp.reasons.forEach(rs => { o[rs] = src[rs] || 0; o.total += src[rs] || 0 })
      return o
    })
  }, [resp, queue])

  // причины с ненулевыми данными в выборке
  const reasonsAll = useMemo(
    () => (resp?.reasons ?? []).filter(rs => chartData.some(r => r[rs] > 0)),
    [resp, chartData]
  )
  // что реально рисуем (фильтр по выбранным причинам)
  const shown = active && active.size > 0 ? reasonsAll.filter(r => active.has(r)) : reasonsAll
  const toggle = (r: string) => setActive(prev => {
    const next = new Set(prev ?? [])
    if (next.size === 0) return new Set([r])
    if (next.has(r)) { next.delete(r); return next.size === 0 ? null : next }
    next.add(r); return next
  })

  const grandTotal = chartData.reduce((s, r) => s + r.total, 0)

  // данные модалки
  const modalList = useMemo(() => {
    if (!sel || !resp) return []
    return resp.items
      .filter(it => it.month === sel.month && it.reason === sel.reason && (!queue || queue === "all" || it.queue === queue))
      .sort((a, b) => b.days - a.days)
  }, [sel, resp, queue])
  const monthLabel = resp?.data.find(r => r.month === sel?.month)?.label || sel?.month || ""

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><Lock className="w-4 h-4" /> Блокировки — динамика по месяцам</CardTitle>
          <div className="flex items-center gap-2">
            {onOpenDashboard && (
              <button onClick={onOpenDashboard}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-8 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                Дашборд блокировок <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Дни блокировки по месяцам (с обрезкой по границам) · {teamLabel} · нажми на причину — фильтр · клик по столбцу — список задач
        </p>
        {/* кликабельные причины */}
        {!loading && grandTotal > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {reasonsAll.map(rs => {
              const on = !active || active.size === 0 || active.has(rs)
              return (
                <button key={rs} onClick={() => toggle(rs)}
                  className={cn("flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-all",
                    on ? "text-foreground bg-secondary" : "text-muted-foreground/40 bg-secondary/30 line-through")}>
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: rColor(rs), opacity: on ? 1 : 0.3 }} />
                  {rs}
                </button>
              )
            })}
            {active && active.size > 0 && (
              <button onClick={() => setActive(null)} className="px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors">Сбросить</button>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}
        {loading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : grandTotal === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Нет блокировок за период</div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barSize={36}>
              <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit=" д" />
              <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
              {shown.map((rs, i) => (
                <Bar key={rs} dataKey={rs} stackId="a" name={rs} fill={rColor(rs)}
                  radius={i === shown.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} style={{ cursor: "pointer" }}
                  onClick={(d: any) => d?.payload?.month && setSel({ month: d.payload.month, reason: rs })}>
                  {i === shown.length - 1 && (
                    <LabelList dataKey="total" position="top"
                      style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} formatter={(v: number) => `${v}д`} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>

      {/* модалка: список блокировок выбранной причины за месяц */}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel?.reason || ""}
        subtitle={`${monthLabel} · ${teamLabel} · ${modalList.length} блок. · ${modalList.reduce((s, t) => s + t.days, 0)} дн. в месяце`} wide>
        {modalList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет задач</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {modalList.map((t, i) => (
              <div key={t.key + i} className="border-b border-border last:border-0 px-4 py-2.5 flex items-start gap-3 hover:bg-accent/30 transition-colors">
                <span className="mt-0.5 shrink-0">
                  {t.active ? <Clock className="w-4 h-4 text-destructive" /> : <CheckCircle className="w-4 h-4 text-emerald-400" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {t.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    <Badge variant="outline" className="text-[10px]">{t.queue}</Badge>
                    <Badge variant={t.active ? "destructive" : "success"} className="text-[10px]">{t.active ? "Активна" : "Закрыта"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.title}</p>
                  <p className="text-xs text-muted-foreground/70 mt-0.5">{t.start} → {t.active ? "сейчас" : t.end}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-black text-foreground">{t.days}</p>
                  <p className="text-[10px] text-muted-foreground">{pluralDays(t.days)} в месяце</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {onOpenDashboard && (
          <button onClick={() => { setSel(null); onOpenDashboard() }}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
            Более детальный отчёт — дашборд блокировок <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </Modal>
    </Card>
  )
}
