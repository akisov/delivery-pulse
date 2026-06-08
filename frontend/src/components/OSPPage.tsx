import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts"
import { RefreshCw, ChevronDown, ChevronUp, ExternalLink, ListFilter } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

const CAT_COLORS: Record<string, string> = {
  story:    "#3B82F6", // Story (Работа по ТЗ)
  tech:     "#F59E0B", // Тех. долг (+ Тех. улучшение)
  incident: "#EF4444", // Инциденты
}
// цвета команд для чипов
const QUEUE_COLORS: Record<string, string> = {
  POOLING: "#6C63FF", UDOSTAVKA: "#06B6D4", DOSTAVKAPIKO: "#10B981",
}

interface CatCounts { story: number; tech: number; incident: number; total: number }
interface Row { month: string; label: string; all: CatCounts; [q: string]: any }
interface OSPItem { key: string; summary: string; url: string; queue: string; category: string; month: string; type: string; resolvedAt: string; assignee: string }
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  categories: { key: string; label: string }[]
  months: string[]
  data: Row[]
  totals: Record<string, number>
  items: OSPItem[]
  seenTypes: Record<string, number>
  updatedAt?: string
  cached?: boolean
}

// аккуратный чип
function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: `${color}1A`, color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{label}
    </span>
  )
}

interface Sel { category: string; month?: string }

// Модалка со списком завершённых задач выбранного типа (по клику на столбец/чип)
function OSPTasksModal({ sel, items, queues, cats, queue, monthLabels, onClose }: {
  sel: Sel | null; items: OSPItem[]; queues: Record<string, string>
  cats: { key: string; label: string }[]; queue: string
  monthLabels: Record<string, string>; onClose: () => void
}) {
  if (!sel) return null
  const cat = cats.find(c => c.key === sel.category)
  const color = CAT_COLORS[sel.category] || "#94A3B8"
  const list = items
    .filter(it => it.category === sel.category
      && (queue === "all" || it.queue === queue)
      && (!sel.month || it.month === sel.month))
    .sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""))
  const teamLabel = queue === "all" ? "все команды" : (queues[queue] || queue)
  const sub = `${list.length} задач · ${teamLabel} · ${sel.month ? (monthLabels[sel.month] || sel.month) : "за период"}`
  return (
    <Modal open={!!sel} onClose={onClose} title={cat?.label || "Задачи"} subtitle={sub} wide>
      {list.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет задач</div>
      ) : (
        <div className="space-y-2">
          {list.map(it => (
            <div key={it.key} className="rounded-lg border border-border bg-card px-3 py-2.5 hover:bg-accent/30 transition-colors">
              <div className="flex items-start gap-2.5">
                <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                      {it.key} <ExternalLink className="w-3 h-3" />
                    </a>
                    <Chip label={queues[it.queue] || it.queue} color={QUEUE_COLORS[it.queue] || "#94A3B8"} />
                    {monthLabels[it.month] && <Chip label={monthLabels[it.month]} color={color} />}
                    <span className="text-[10px] text-muted-foreground">{it.type}</span>
                  </div>
                  <p className="text-sm text-foreground mt-1 leading-snug">{it.summary}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{it.assignee} · завершено {it.resolvedAt}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

export function OSPPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<string>("POOLING")  // отчёт показываем по одной команде
  const [showTypes, setShowTypes] = useState(false)
  const [sel, setSel] = useState<Sel | null>(null)  // выбранный тип/месяц для модалки

  // период фиксирован — пол года; refresh форсит пересчёт мимо кэша
  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/osp-delivery${refresh ? "?refresh=true" : ""}`).then(r => r.json())
      .then((d: Resp) => { if (d.ok) setData(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // данные графика для выбранной очереди (или сумма по всем)
  const chartData = useMemo(() => {
    if (!data) return []
    return data.data.map(row => {
      const c: CatCounts = queue === "all" ? row.all : row[queue]
      return { month: row.month, label: row.label, story: c.story, tech: c.tech, incident: c.incident, total: c.total }
    })
  }, [data, queue])

  const monthLabels = useMemo(
    () => Object.fromEntries((data?.data ?? []).map(r => [r.month, r.label])),
    [data]
  )

  // суммы по выбранной очереди за весь период
  const totals = useMemo(() => {
    const t = { story: 0, tech: 0, incident: 0, total: 0 }
    chartData.forEach(r => { t.story += r.story; t.tech += r.tech; t.incident += r.incident; t.total += r.total })
    return t
  }, [chartData])

  const cats = data?.categories ?? []
  // команды (очереди курьеров) — выбираем одну; «Все» в конце как опция
  const queueTabs: [string, string][] = [...Object.entries(data?.queues ?? {}), ["all", "Все команды"]]

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">ОСП — обзор сервиса поставки</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Сколько сделали по месяцам (пол года) · Story · Тех. долг · Инциденты · по командам курьеров (X / U / R)
            {data?.updatedAt && <span className="ml-1">· обновлено: {data.updatedAt}</span>}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={loading} title="Пересчитать заново (мимо кэша)"
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">⚠️ {error}</div>}

      {/* Выбор команды — отчёт показываем по одной команде за месяц */}
      {data && (
        <div className="flex items-center gap-3 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {queueTabs.map(([v, label]) => (
              <button key={v} onClick={() => setQueue(v)}
                className={cn("px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap",
                  queue === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : data && (
        <>
          {/* Сводка по категориям */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Всего сделано</p>
              <p className="text-2xl font-black tracking-tight leading-none mt-1 text-foreground">{totals.total}</p>
            </div>
            {cats.map(c => (
              <div key={c.key} className="rounded-xl border border-border bg-card px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-sm" style={{ background: CAT_COLORS[c.key] }} /> {c.label}
                </p>
                <p className="text-2xl font-black tracking-tight leading-none mt-1" style={{ color: CAT_COLORS[c.key] }}>
                  {(totals as any)[c.key]}
                </p>
              </div>
            ))}
          </div>

          {/* График по месяцам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between">
                <CardTitle>📦 Сколько мы сделали — по месяцам</CardTitle>
                <span className="text-xs text-muted-foreground">{queueTabs.find(([v]) => v === queue)?.[1]}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Завершённые задачи (по дате завершения), с накоплением по категориям · нажми на столбец или тип — покажем задачи</p>
            </CardHeader>
            <CardContent>
              {totals.total === 0 ? (
                <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Нет завершённых задач за период</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barSize={28}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                      {cats.map((c, i) => (
                        <Bar key={c.key} dataKey={c.key} stackId="a" name={c.label} fill={CAT_COLORS[c.key]}
                          radius={i === cats.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                          style={{ cursor: "pointer" }}
                          onClick={(d: any) => setSel({ category: c.key, month: d?.payload?.month })}>
                          {i === cats.length - 1 && (
                            <LabelList dataKey="total" position="top"
                              style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                          )}
                        </Bar>
                      ))}
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Кликабельные чипы-категории (легенда + переход к списку за весь период) */}
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                    {cats.map(c => {
                      const color = CAT_COLORS[c.key]
                      return (
                        <button key={c.key} onClick={() => setSel({ category: c.key })}
                          className="group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_14px_rgba(0,0,0,0.12)]"
                          style={{ borderColor: `${color}55`, background: `${color}14`, color }}
                          title={`${c.label}: показать задачи за период`}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          {c.label}
                          <span className="rounded-full px-1.5 py-px text-[11px] font-black" style={{ background: `${color}26` }}>
                            {(totals as any)[c.key]}
                          </span>
                          <ListFilter className="w-3 h-3 opacity-40 group-hover:opacity-90 transition-opacity" />
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Диагностика: какие типы задач реально встретились (для проверки маппинга) */}
          {data.seenTypes && Object.keys(data.seenTypes).length > 0 && (
            <div>
              <button onClick={() => setShowTypes(s => !s)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                {showTypes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                типы задач в выборке ({Object.keys(data.seenTypes).length})
              </button>
              {showTypes && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(data.seenTypes).map(([t, n]) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
                      {t} <span className="font-bold text-foreground">{n}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Модалка со списком задач выбранного типа */}
          <OSPTasksModal sel={sel} items={data.items} queues={data.queues} cats={cats}
            queue={queue} monthLabels={monthLabels} onClose={() => setSel(null)} />
        </>
      )}
    </div>
  )
}
