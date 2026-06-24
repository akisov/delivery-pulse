import { useEffect, useRef, useState } from "react"
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import { Activity, RefreshCw, AlertTriangle, Database } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { fetchFlowTeam, startFlowSync, fetchFlowSyncStatus } from "@/lib/api"
import type { FlowTeamData, FlowLimit } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

// Цвета статусов потока (как на доске Трекера)
const STATUS_COLOR: Record<string, string> = {
  "Протестировано": "#6C8FF5", "Тестируется": "#56CCF2", "Помещение в продуктив": "#4FB89E",
  "Разработка готово": "#A9D5C4", "Аналитическая проработка": "#E8B4A8", "В разработке": "#4CAF2E",
  "Согласование архитектуры Готово": "#0E8F7E", "Согласование архитектуры": "#F26D6D",
  "Помещение в продуктив Готово": "#F5C518", "На проверке у заказчика": "#8BD24F",
  "Backlog команды": "#B11D3E", "Аналитическая проработка готово": "#F58B7E",
  "Ревью аналитики": "#5FBE9E", "На уточнении": "#C79BE8",
}
const COLOR_FALLBACK = ["#94A3B8", "#64748B", "#A78BFA", "#F472B6", "#FB923C", "#34D399"]
const fmtDay = (d: string) => { const [, m, day] = (d || "").split("-"); return m && day ? `${day}.${m}` : d }

function LimitCard({ title, lim, hint }: { title: string; lim: FlowLimit | undefined; hint?: string }) {
  if (!lim) return null
  const over = lim.limit != null && lim.count > lim.limit
  const at = lim.limit != null && lim.count === lim.limit
  const color = over ? "#EF4444" : at ? "#F59E0B" : "#10B981"
  const pct = lim.limit ? Math.min(100, Math.round((lim.count / lim.limit) * 100)) : 0
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5"
      style={{ borderColor: over ? "#EF444455" : undefined }}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{title}</span>
        {over && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-500"><AlertTriangle className="w-3 h-3" /> превышен</span>}
        {at && <span className="text-[10px] font-bold text-amber-500">на пределе</span>}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-black tabular-nums" style={{ color }}>{lim.count}</span>
        <span className="text-sm text-muted-foreground">/ {lim.limit ?? "∞"} WIP</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-1.5">{hint}</p>}
    </div>
  )
}

export function FlowTeamsPage() {
  const [team, setTeam] = useState("U")
  const [sel, setSel] = useState<Set<string>>(new Set())   // выбранные статусы CFD (пусто = все)
  const [data, setData] = useState<FlowTeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState("")
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = (t: string) => {
    setLoading(true)
    fetchFlowTeam(t).then(d => setData(d.ok ? d : null)).catch(() => setData(null)).finally(() => setLoading(false))
  }
  useEffect(() => { load(team) }, [team])
  // если синк уже идёт (запущен в другой вкладке) — подхватываем прогресс
  useEffect(() => {
    fetchFlowSyncStatus().then(s => { if (s.running) { setSyncing(true); setSyncMsg(s.msg); poll() } }).catch(() => {})
    return () => { if (pollRef.current) clearTimeout(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const poll = () => {
    pollRef.current = setTimeout(async () => {
      try {
        const s = await fetchFlowSyncStatus()
        setSyncMsg(s.msg || "")
        if (s.running) { poll() }
        else {
          setSyncing(false)
          if (s.error) toast.error("Синк потока: " + s.error)
          else { toast.success("Синк потока завершён"); load(team) }
        }
      } catch { poll() }
    }, 4000)
  }
  const onSync = async () => {
    setSyncing(true); setSyncMsg("Запуск…")
    const r = await startFlowSync()
    if (!r.ok) { setSyncing(false); toast.error(r.error || "Не удалось запустить"); return }
    toast("Синк потока запущен — это займёт время (инкрементально)")
    poll()
  }

  const teams = data?.teams ?? ["U", "X", "R"]
  const teamLabels = data?.teamLabels ?? { U: "Курьеры U", X: "Курьеры X", R: "Курьеры R" }
  const statuses = data?.statuses ?? []
  const maxWip = data ? Math.max(0, ...data.wipAge.map(w => w.p90)) : 0

  return (
    <>
      <PageHeader icon={Activity} title="Поток по командам" info="flowt"
        subtitle="CFD по статусам и динамика WIP Age (P90 дней в работе) по командам курьеров">
        <button onClick={onSync} disabled={syncing} title="Пересобрать историю из Трекера"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-60">
          <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} /> {syncing ? "Синк…" : "Синк потока"}
        </button>
      </PageHeader>

      {syncing && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 animate-spin text-primary" /> {syncMsg || "Синхронизация истории статусов…"}
        </div>
      )}

      {/* Выбор команды */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
        <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
          {teams.map(t => (
            <button key={t} onClick={() => setTeam(t)}
              className={cn("px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap",
                team === t ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
              {teamLabels[t] || t}
            </button>
          ))}
        </div>
        {data?.updatedAt && <span className="text-[11px] text-muted-foreground/60 ml-auto inline-flex items-center gap-1"><Database className="w-3 h-3" /> данные на {data.updatedAt.replace("T", " ").slice(0, 16)}</span>}
      </div>

      {loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !data ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          Нет данных. Нажми «Синк потока» — первая сборка истории статусов из Трекера займёт время.
        </CardContent></Card>
      ) : (
        <>
          {/* WIP-лимиты */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <LimitCard title="Обычные (WIP)" lim={data.limits.regular} hint="обычные приоритеты, без 1С" />
            {data.limits.onec && <LimitCard title="1С-задачи (WIP)" lim={data.limits.onec} hint="стек 1С" />}
            <LimitCard title="Критичные + блокеры (WIP)" lim={data.limits.crit} hint="приоритеты Блокер + Критичный" />
          </div>

          {/* CFD по статусам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> CFD — задачи по статусам</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Накопительная диаграмма потока (обычные задачи) с {fmtDay(data.cfd[0]?.day as string)} по дням. Реконструкция из истории статусов Трекера.</p>
            </CardHeader>
            <CardContent>
              {/* Кликабельные чипы статусов: выбери несколько — на графике останутся только они */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                {statuses.map((s, i) => {
                  const col = STATUS_COLOR[s] || COLOR_FALLBACK[i % COLOR_FALLBACK.length]
                  const on = sel.size === 0 || sel.has(s)
                  return (
                    <button key={s} onClick={() => setSel(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n })}
                      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all",
                        on ? "border-transparent text-foreground" : "border-border text-muted-foreground/50 hover:text-muted-foreground")}
                      style={on ? { background: `${col}22` } : undefined}>
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col, opacity: on ? 1 : 0.35 }} />
                      {s}
                    </button>
                  )
                })}
                {sel.size > 0 && (
                  <button onClick={() => setSel(new Set())} className="text-[11px] text-primary hover:underline ml-1">сбросить ({sel.size})</button>
                )}
              </div>
              <ResponsiveContainer width="100%" height={360}>
                <AreaChart data={data.cfd} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={28} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
                    labelFormatter={(d) => fmtDay(d as string)} />
                  {statuses.map((s, i) => (
                    <Area key={s} type="monotone" dataKey={s} stackId="1"
                      hide={sel.size > 0 && !sel.has(s)}
                      stroke={STATUS_COLOR[s] || COLOR_FALLBACK[i % COLOR_FALLBACK.length]}
                      fill={STATUS_COLOR[s] || COLOR_FALLBACK[i % COLOR_FALLBACK.length]} fillOpacity={0.55} strokeWidth={0.5} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Динамика WIP Age P90 */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2"><Activity className="w-4 h-4 text-amber-500" /> WIP Age — динамика P90</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">90-й перцентиль «дней в работе» по незавершённым задачам (Story / ТехДолг / Инцидент, все приоритеты и стеки). Чем ниже — тем быстрее проходят задачи.</p>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.wipAge} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickFormatter={fmtDay} minTickGap={28} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, Math.ceil(maxWip * 1.1) || 10]} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 11 }}
                    labelFormatter={(d) => fmtDay(d as string)}
                    formatter={(v: any, n: any) => [v, n === "p90" ? "P90, дн" : n === "count" ? "задач в WIP" : n]} />
                  <Line type="monotone" dataKey="p90" stroke="#F59E0B" strokeWidth={2.5} dot={false} name="p90" />
                  <Line type="monotone" dataKey="count" stroke="#6C63FF" strokeWidth={1.5} dot={false} strokeDasharray="4 3" name="count" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}
