import { useEffect, useMemo, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { AlertTriangle, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"

const TEAM_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]
const QUEUE_COLORS: Record<string, string> = { POOLING: "#6C63FF", UDOSTAVKA: "#06B6D4", DOSTAVKAPIKO: "#10B981" }

interface IncItem { month: string; queue: string; key: string; summary: string; url: string; created: string; status: string; statusKey: string; daysInWork: number | null; assignee: string }

// цвет статуса для подсветки чипа
function statusColor(key: string, display: string) {
  const s = `${key || ""} ${display || ""}`.toLowerCase()
  if (/clos|done|resolv|закры|готов|решен|решён|заверш/.test(s)) return "#10B981"   // зелёный — закрыт/решён
  if (/test|тест|review|провер/.test(s)) return "#EAB308"                            // жёлтый — тестирование/проверка
  if (/progress|work|разработ|в работе|анализ/.test(s)) return "#3B82F6"             // синий — в работе
  if (/backlog|open|new|откры|нов|бэклог|продуктов/.test(s)) return "#94A3B8"        // серый — открыт/бэклог
  return "#F59E0B"                                                                    // прочее
}
interface Row { month: string; label: string; all: number; [q: string]: any }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  months: string[]; data: Row[]; items: IncItem[]
}

export function OSPIncidents({ queue, month, refreshKey, onOpenDashboard }: { queue?: string; month?: string; refreshKey?: number; onOpenDashboard?: () => void }) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selMonth, setSelMonth] = useState<string | null>(null)

  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/osp-incidents?months=8${refresh ? "&refresh=true" : ""}`).then(r => r.json())
      .then((d: Resp) => { if (d.ok) setResp(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (refreshKey) load(true) }, [refreshKey])

  const single = queue && queue !== "all" ? queue : null
  const teams = single ? [single] : TEAM_ORDER.filter(q => resp?.queues?.[q])
  const showStack = teams.length > 1
  const teamLabel = single ? (resp?.queues?.[single] || single) : "Все команды"

  const chartData = useMemo(() => {
    if (!resp) return []
    return resp.data.filter(row => !month || row.month <= month).map(row => {
      const o: Record<string, any> = { month: row.month, label: row.label, total: 0 }
      teams.forEach(q => { o[q] = row[q] || 0; o.total += row[q] || 0 })
      return o
    })
  }, [resp, queue, month])

  const grandTotal = chartData.reduce((s, r) => s + r.total, 0)

  const modalList = useMemo(() => {
    if (!selMonth || !resp) return []
    return resp.items
      .filter(it => it.month === selMonth && (!single || it.queue === single))
      .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
  }, [selMonth, resp, single])
  const monthLabel = resp?.data.find(r => r.month === selMonth)?.label || selMonth || ""

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-500" /> Инцидентов создано — по месяцам</CardTitle>
          {!loading && <span className="text-xs text-muted-foreground">{grandTotal} за период</span>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Новые инциденты по дате создания · {teamLabel} · клик по столбцу — список инцидентов
        </p>
      </CardHeader>
      <CardContent>
        {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}
        {loading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : grandTotal === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">Нет инцидентов за период</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 18, right: 16, left: 0, bottom: 4 }} barSize={34}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                {teams.map((q, i) => (
                  <Bar key={q} dataKey={q} stackId="a" name={resp!.queues?.[q] || q} fill={QUEUE_COLORS[q] || "#EF4444"}
                    radius={i === teams.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} style={{ cursor: "pointer" }}
                    onClick={(d: any) => d?.payload?.month && setSelMonth(d.payload.month)}>
                    {i === teams.length - 1 && (
                      <LabelList dataKey="total" position="top" style={{ fontSize: 11, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
            {showStack && (
              <div className="flex flex-wrap gap-3 mt-3 justify-center">
                {teams.map(q => (
                  <span key={q} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: QUEUE_COLORS[q] }} />{resp!.queues?.[q]}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      <Modal open={!!selMonth} onClose={() => setSelMonth(null)} title={`Инциденты — ${monthLabel}`}
        subtitle={`${teamLabel} · создано ${modalList.length}`} wide>
        {modalList.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет инцидентов</div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            {modalList.map((t, i) => (
              <div key={t.key + i} className="border-b border-border last:border-0 px-4 py-2.5 flex items-start gap-3 hover:bg-accent/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {t.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    <Badge variant="outline" className="text-[10px]">{t.queue}</Badge>
                    {t.status && (
                      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                        style={{ background: `${statusColor(t.statusKey, t.status)}1A`, color: statusColor(t.statusKey, t.status) }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor(t.statusKey, t.status) }} />{t.status}
                      </span>
                    )}
                    {t.daysInWork != null && (
                      <span className="inline-flex items-center rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                        {t.daysInWork} дн. в работе
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.summary}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">создан {t.created} · {t.assignee}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {onOpenDashboard && (
          <button onClick={() => { setSelMonth(null); onOpenDashboard() }}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
            Дашборд блокировок <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </Modal>
    </Card>
  )
}
