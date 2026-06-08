import { useEffect, useMemo, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from "recharts"
import { RefreshCw, ChevronDown, ChevronUp, ExternalLink, ListFilter, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { OSPTime } from "@/components/OSPTime"
import { OSPBlockings } from "@/components/OSPBlockings"
import { OSPIncidents } from "@/components/OSPIncidents"
import { cn } from "@/lib/utils"

const CAT_COLORS: Record<string, string> = {
  story:     "#3B82F6", // Story (Работа по ТЗ)
  techDebt:  "#F59E0B", // ТехДолг
  techImpr:  "#A78BFA", // Тех. улучшение
  analytics: "#06B6D4", // Аналитика
  incident:  "#EF4444", // Инциденты
}
interface CatCounts { total: number; [k: string]: number }
interface Row { month: string; label: string; all: CatCounts; [q: string]: any }
interface OSPItem {
  key: string; summary: string; url: string; queue: string; category: string; month: string
  type: string; resolvedAt: string; assignee: string; status: string
  parentKey: string; parentSummary: string; start: string; daysInWork: number | null
  jobCategory: string; spent: string
}
interface Resp {
  ok: boolean; error?: string
  queues: Record<string, string>
  categories: { key: string; label: string }[]
  months: string[]
  data: Row[]
  totals: Record<string, number>
  items: OSPItem[]
  seenTypes: Record<string, number>
  seenResolutions?: Record<string, number>
  catFields?: Record<string, { name: string; key: string } | null>
  updatedAt?: string
  cached?: boolean
}

// аккуратный чип
function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />{label}
    </span>
  )
}

interface Sel { category: string; month?: string }

function fmtDate(iso: string) {
  if (!iso) return "—"
  const p = iso.slice(0, 10).split("-")
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0].slice(2)}` : iso
}

// сокращаем длинные категории работы (чтобы чип не переносился)
function shortCat(s: string) {
  return (s || "")
    .replace(/User\s*Stor(?:y|ies)/gi, "US")
    .replace(/Маленьки[ехй]/gi, "Мал.")
    .trim()
}

// Модалка «Что конкретно мы сделали» — таблица задач выбранного типа (по клику на столбец)
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
  const sub = `Что конкретно сделали · ${cat?.label} · ${teamLabel} · ${sel.month ? (monthLabels[sel.month] || sel.month) : "за период"} · ${list.length} задач`
  const COLS = ["Ключ", "Задача", "Исполнитель", "Статус", "Дней в работе", "Дата начала", "Категория работы", "Затрачено времени"]
  return (
    <Modal open={!!sel} onClose={onClose} title={cat?.label || "Задачи"} subtitle={sub} xl>
      {list.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">Нет задач</div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {COLS.map((c, i) => (
                  <th key={c} className={cn("sticky top-0 bg-card border-b border-border px-2.5 py-2 whitespace-nowrap",
                    (i === 4 || i === 6 || i === 7) && "text-right")}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(it => (
                <tr key={it.key} className="hover:bg-accent/30 transition-colors align-top">
                  <td className="border-b border-border/50 px-2.5 py-2 whitespace-nowrap">
                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline inline-flex items-center gap-1">
                      {it.key} <ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                  <td className="border-b border-border/50 px-2.5 py-2 min-w-[260px] max-w-[360px]">
                    {it.parentKey && <div className="text-[10px] text-muted-foreground truncate">{it.parentKey}: {it.parentSummary}</div>}
                    <div className="text-foreground leading-snug">{it.summary}</div>
                  </td>
                  <td className="border-b border-border/50 px-2.5 py-2 whitespace-nowrap text-muted-foreground">{it.assignee}</td>
                  <td className="border-b border-border/50 px-2.5 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{it.status || "—"}
                    </span>
                  </td>
                  <td className="border-b border-border/50 px-2.5 py-2 text-right font-bold text-foreground">{it.daysInWork ?? "—"}</td>
                  <td className="border-b border-border/50 px-2.5 py-2 whitespace-nowrap text-muted-foreground">{fmtDate(it.start)}</td>
                  <td className="border-b border-border/50 px-2.5 py-2 whitespace-nowrap">
                    {it.jobCategory
                      ? <span title={it.jobCategory}><Chip label={shortCat(it.jobCategory)} color={color} /></span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="border-b border-border/50 px-2.5 py-2 text-right whitespace-nowrap text-muted-foreground">{it.spent || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

export function OSPPage({ onGo }: { onGo?: (s: "blockings" | "sle" | "flow" | "osp") => void }) {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<string>("all")  // по умолчанию — все команды
  const [showTypes, setShowTypes] = useState(false)
  const [sel, setSel] = useState<Sel | null>(null)  // выбранный тип/месяц для модалки
  const [catFilter, setCatFilter] = useState<string | null>(null)  // оставить на графике только один тип

  // период фиксирован — пол года; refresh форсит пересчёт мимо кэша
  const load = (refresh = false) => {
    setLoading(true); setError(null)
    fetch(`/osp-delivery${refresh ? "?refresh=true" : ""}`).then(r => r.json())
      .then((d: Resp) => { if (d.ok) setData(d); else setError(d.error || "Ошибка") })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // данные графика для выбранной очереди (или сумма по всем) — ключи категорий динамические
  const chartData = useMemo(() => {
    if (!data) return []
    const keys = data.categories.map(c => c.key)
    return data.data.map(row => {
      const c: CatCounts = queue === "all" ? row.all : row[queue]
      const o: Record<string, any> = { month: row.month, label: row.label, total: c.total }
      keys.forEach(k => { o[k] = c[k] || 0 })
      return o
    })
  }, [data, queue])

  const monthLabels = useMemo(
    () => Object.fromEntries((data?.data ?? []).map(r => [r.month, r.label])),
    [data]
  )

  // суммы по выбранной очереди за весь период
  const totals = useMemo(() => {
    const keys = data?.categories.map(c => c.key) ?? []
    const t: Record<string, number> = { total: 0 }
    keys.forEach(k => { t[k] = 0 })
    chartData.forEach(r => { keys.forEach(k => { t[k] += r[k] || 0 }); t.total += r.total })
    return t
  }, [chartData, data])

  const cats = data?.categories ?? []
  const shownCats = catFilter ? cats.filter(c => c.key === catFilter) : cats
  // команды (очереди курьеров) — «Все команды» первым (по умолчанию), затем X/U/R
  const queueTabs: [string, string][] = [["all", "Все команды"], ...Object.entries(data?.queues ?? {})]

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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
              <p className="text-xs text-muted-foreground mt-0.5">Сделано по дате завершения · только резолюции «Решён»/«Отменено с часами» · нажми на тип — оставить только его · клик по столбцу — список задач</p>
            </CardHeader>
            <CardContent>
              {totals.total === 0 ? (
                <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Нет завершённых задач за период</div>
              ) : (
                <>
                  {/* Кликабельные чипы-категории — фильтр графика по типу */}
                  <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
                    {cats.map(c => {
                      const color = CAT_COLORS[c.key]
                      const active = catFilter === c.key
                      const dim = catFilter != null && !active
                      return (
                        <button key={c.key} onClick={() => setCatFilter(f => f === c.key ? null : c.key)}
                          className={cn("group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-0.5",
                            dim && "opacity-40")}
                          style={{
                            borderColor: active ? color : `${color}55`,
                            background: active ? `${color}26` : `${color}14`,
                            color,
                            boxShadow: active ? `0 4px 14px ${color}55` : undefined,
                          }}
                          title={active ? `${c.label}: показать все типы` : `${c.label}: оставить только этот тип`}>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                          {c.label}
                          <span className="rounded-full px-1.5 py-px text-[11px] font-black" style={{ background: `${color}26` }}>
                            {(totals as any)[c.key]}
                          </span>
                          {active ? <X className="w-3 h-3 opacity-80" /> : <ListFilter className="w-3 h-3 opacity-40 group-hover:opacity-90 transition-opacity" />}
                        </button>
                      )
                    })}
                  </div>

                  <ResponsiveContainer width="100%" height={340}>
                    <BarChart data={chartData} margin={{ top: 16, right: 16, left: 0, bottom: 4 }} barSize={28}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
                      {shownCats.map((c, i) => (
                        <Bar key={c.key} dataKey={c.key} stackId="a" name={c.label} fill={CAT_COLORS[c.key]}
                          radius={i === shownCats.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                          style={{ cursor: "pointer" }}
                          onClick={(d: any) => setSel({ category: c.key, month: d?.payload?.month })}>
                          {i === shownCats.length - 1 && (
                            <LabelList dataKey={catFilter ? c.key : "total"} position="top"
                              style={{ fontSize: 10, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
                          )}
                        </Bar>
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
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
                <div className="mt-1.5 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(data.seenTypes).map(([t, n]) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
                        {t} <span className="font-bold text-foreground">{n}</span>
                      </span>
                    ))}
                  </div>
                  {data.seenResolutions && Object.keys(data.seenResolutions).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70">резолюции:</span>
                      {Object.entries(data.seenResolutions).map(([t, n]) => (
                        <span key={t} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
                          {t} <span className="font-bold text-foreground">{n}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {data.catFields && (
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70">поле «категория работы»:</span>
                      {Object.entries(data.catFields).map(([q, f]) => (
                        <span key={q} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
                          {data.queues[q] || q}: <span className="font-bold text-foreground">{f ? `${f.name} (${f.key})` : "не найдено"}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Модалка со списком задач выбранного типа */}
          <OSPTasksModal sel={sel} items={data.items} queues={data.queues} cats={cats}
            queue={queue} monthLabels={monthLabels} onClose={() => setSel(null)} />
        </>
      )}

      {/* Распределение времени (worklog) — управляется общим фильтром команды */}
      <OSPTime queue={queue} />

      {/* Инцидентов создано — по месяцам */}
      <OSPIncidents queue={queue} onOpenDashboard={onGo ? () => onGo("blockings") : undefined} />

      {/* Блокировки — динамика по месяцам + ссылка на дашборд */}
      <OSPBlockings queue={queue} onOpenDashboard={onGo ? () => onGo("blockings") : undefined} />
    </div>
  )
}
