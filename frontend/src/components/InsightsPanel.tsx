import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Cell
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"
import { OutlierTag } from "@/components/ui/outlier-tag"
import { StatusChart } from "@/components/StatusChart"
import { ExternalLink, Clock, CheckCircle } from "lucide-react"

const REASON_COLORS: Record<string, string> = {
  "Блок другой нашей задачей":       "#7C6FF7",
  "Внешний фактор":                  "#F97316",
  "Переключились на срочную задачу": "#EF4444",
  "Ждем дату или событие":           "#EAB308",
  "Отпуск, больничный":              "#EC4899",
  "Ждем фун. архитекторов":          "#F472B6",
  "Ждем ответа заказчика":           "#06B6D4",
  "Ждем тех. архитектров":           "#3B82F6",
  "Ждем тех. архитекторов":          "#3B82F6",
  "Ждем другую команду":             "#10B981",
  "Ждем партнера":                   "#F59E0B",
  "Мораторий":                       "#8B5CF6",
  "Ждем тестовую среду":             "#14B8A6",
  "Причина не известна":             "#94A3B8",
  "Не указана":                      "#64748B",
}
const EXTRA = ["#85EF47","#FB923C","#A78BFA","#34D399","#F87171","#60A5FA"]
function rc(reason: string, idx: number) { return REASON_COLORS[reason] ?? EXTRA[idx % EXTRA.length] }

const STAGE_COLORS: Record<string, string> = {
  "Аналит. проработка":     "#7C6FF7",
  "В разработке":           "#3B82F6",
  "Тестирование":           "#10B981",
  "Помещение в продуктив":  "#F97316",
  "На проверке у заказчика":"#EAB308",
}
const TYPE_COLORS = ["#7C6FF7","#3B82F6","#10B981","#F97316","#EF4444","#EAB308","#EC4899","#8B5CF6","#06B6D4","#F59E0B"]

// ── Типы ──────────────────────────────────────────────────────────────────────

interface InsightTask {
  blockingKey: string; parentKey: string; parentTitle: string
  url: string; queue: string; reason: string
  startDate: string; endDate: string; isActive: boolean; days: number; isOutlier?: boolean
}

interface StageItem    { key: string; label: string; count: number; avg: number; p70: number; p85: number; p90: number; tasks: InsightTask[] }
interface ReasonItem   { reason: string; count: number; tasks: InsightTask[] }
interface ReasonAvgItem{ reason: string; avg: number; p70: number; p85: number; p90: number; count: number; tasks: InsightTask[] }
interface TypeItem     { type: string; count: number; tasks: InsightTask[] }

interface InsightsData {
  stages: StageItem[]
  reasonsCount: ReasonItem[]
  reasonsAvg: ReasonAvgItem[]
  issueTypes: TypeItem[]
}

interface DrillDown { title: string; subtitle: string; tasks: InsightTask[] }

// ── Модал с задачами ──────────────────────────────────────────────────────────

function pluralDays(n: number) {
  const m = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m === 1) return "день"
  if (m >= 2 && m <= 4) return "дня"
  return "дней"
}

function DrillModal({ data, onClose }: { data: DrillDown | null; onClose: () => void }) {
  if (!data) return null
  return (
    <Modal open={!!data} onClose={onClose} title={data.title} subtitle={data.subtitle} wide>
      <div className="rounded-xl border border-border overflow-hidden">
        {data.tasks.map(t => (
          <div key={t.blockingKey} className="border-b border-border last:border-0 px-4 py-3 flex items-start gap-3 hover:bg-accent/30 transition-colors">
            <span className="mt-0.5 shrink-0">
              {t.isActive
                ? <Clock className="w-4 h-4 text-destructive" />
                : <CheckCircle className="w-4 h-4 text-emerald-400" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <a href={t.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                  {t.parentKey} <ExternalLink className="w-3 h-3" />
                </a>
                <Badge variant="outline" className="text-[10px]">{t.queue}</Badge>
                <Badge variant={t.isActive ? "destructive" : "success"} className="text-[10px]">
                  {t.isActive ? "Активна" : "Закрыта"}
                </Badge>
                {t.isOutlier && <OutlierTag />}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.parentTitle}</p>
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {t.reason} · {t.startDate}{t.endDate ? ` → ${t.endDate}` : " → сегодня"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-black text-foreground">{t.days}</p>
              <p className="text-[10px] text-muted-foreground">{pluralDays(t.days)}</p>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ── Тултип ────────────────────────────────────────────────────────────────────

function MiniTooltip({ active, payload, valueLabel = "кол-во" }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]
  const item = d.payload as any
  const name = item?.reason ?? item?.label ?? item?.type ?? d.name
  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2 shadow-2xl text-xs space-y-0.5">
      <p className="font-bold text-foreground max-w-[200px] whitespace-normal">{name}</p>
      <p className="text-muted-foreground">{valueLabel}: <span className="font-semibold text-foreground">{d.value}</span></p>
      {item?.p70 > 0 && <p className="text-muted-foreground">P70: <span className="font-semibold text-amber-400">{item.p70}д</span></p>}
      {item?.p85 > 0 && <p className="text-muted-foreground">P85: <span className="font-semibold text-red-400">{item.p85}д</span></p>}
      <p className="text-muted-foreground/70 pt-0.5">нажми для деталей</p>
    </div>
  )
}

// ── Компонент ─────────────────────────────────────────────────────────────────

interface Props { dateFrom?: string; dateTo?: string; queue: string }

function chartH(count: number) { return Math.max(180, count * 34 + 40) }

export function InsightsPanel({ dateFrom, dateTo, queue }: Props) {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [drill, setDrill] = useState<DrillDown | null>(null)

  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (queue && queue !== "ALL") p.set("queues", queue)
    if (dateFrom) p.set("date_from", dateFrom)
    if (dateTo)   p.set("date_to", dateTo)
    fetch(`/insights?${p}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, queue])

  const open = (title: string, subtitle: string, tasks: InsightTask[]) =>
    setDrill({ title, subtitle, tasks })

  if (loading) return (
    <div className="space-y-4">
      <div className="h-6 w-48 bg-muted animate-pulse rounded" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-72 rounded-xl md:col-span-2" />
        {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-64 rounded-xl" />)}
      </div>
    </div>
  )
  if (!data) return null

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-black tracking-tight text-foreground">Аналитика блокировок</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* 0. Этапы работы — время (avg / P90), во всю ширину */}
        <div className="md:col-span-2">
          <StatusChart dateFrom={dateFrom} dateTo={dateTo} queue={queue} />
        </div>

        {/* 1. Этапы */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>На каких этапах чаще блокируются</CardTitle>
            <p className="text-xs text-muted-foreground">Кол-во блокировок по рабочим статусам</p>
          </CardHeader>
          <CardContent>
            {!data.stages.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={chartH(data.stages.length)}>
                <BarChart data={data.stages} layout="vertical" margin={{ top:4, right:48, left:4, bottom:4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize:10, fill:"hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="label" width={140}
                    tick={{ fontSize:11, fill:"hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MiniTooltip valueLabel="блокировок" />} cursor={{ fill:"hsl(var(--accent))", opacity:0.4 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]} style={{ cursor:"pointer" }}
                    onClick={(d: StageItem) => open(d.label, `${d.count} блокировок`, d.tasks)}>
                    {data.stages.map(s => <Cell key={s.key} fill={STAGE_COLORS[s.label] ?? "#7C6FF7"} />)}
                    <LabelList dataKey="count" position="right" style={{ fontSize:11, fontWeight:700, fill:"hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 2. Типы задач — рядом с этапами (похожая высота) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Какие типы задач чаще блокируются</CardTitle>
            <p className="text-xs text-muted-foreground">Уникальных задач с блокировками по типу</p>
          </CardHeader>
          <CardContent>
            {!data.issueTypes.length ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground text-center px-4">
                Нет данных — запустите синк для обновления типов задач
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={chartH(data.issueTypes.length)}>
                <BarChart data={data.issueTypes} layout="vertical" margin={{ top:4, right:48, left:4, bottom:4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize:10, fill:"hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="type" width={140}
                    tick={{ fontSize:11, fill:"hsl(var(--foreground))" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<MiniTooltip valueLabel="задач" />} cursor={{ fill:"hsl(var(--accent))", opacity:0.4 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]} style={{ cursor:"pointer" }}
                    onClick={(d: TypeItem) => open(d.type, `${d.count} задач`, d.tasks)}>
                    {data.issueTypes.map((t,i) => <Cell key={t.type} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                    <LabelList dataKey="count" position="right" style={{ fontSize:11, fontWeight:700, fill:"hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 3. Причины — количество */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>По каким причинам чаще блокируются</CardTitle>
            <p className="text-xs text-muted-foreground">Топ причин по количеству блокировок</p>
          </CardHeader>
          <CardContent>
            {!data.reasonsCount.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={chartH(data.reasonsCount.length)}>
                <BarChart data={data.reasonsCount} layout="vertical" margin={{ top:4, right:48, left:4, bottom:4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize:10, fill:"hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="reason" width={160}
                    tick={{ fontSize:10, fill:"hsl(var(--foreground))" }} axisLine={false} tickLine={false}
                    />
                  <Tooltip content={<MiniTooltip valueLabel="блокировок" />} cursor={{ fill:"hsl(var(--accent))", opacity:0.4 }} />
                  <Bar dataKey="count" radius={[0,4,4,0]} style={{ cursor:"pointer" }}
                    onClick={(d: ReasonItem) => open(d.reason, `${d.count} блокировок`, d.tasks)}>
                    {data.reasonsCount.map((r,i) => <Cell key={r.reason} fill={rc(r.reason,i)} />)}
                    <LabelList dataKey="count" position="right" style={{ fontSize:11, fontWeight:700, fill:"hsl(var(--foreground))" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* 4. Причины — среднее время */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Среднее время разблокировки по причине</CardTitle>
            <p className="text-xs text-muted-foreground">Сколько дней в среднем занимает каждая причина</p>
          </CardHeader>
          <CardContent>
            {!data.reasonsAvg.length ? <Empty /> : (
              <ResponsiveContainer width="100%" height={chartH(data.reasonsAvg.length)}>
                <BarChart data={data.reasonsAvg} layout="vertical" margin={{ top:4, right:52, left:4, bottom:4 }} barSize={18}>
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize:10, fill:"hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="reason" width={160}
                    tick={{ fontSize:10, fill:"hsl(var(--foreground))" }} axisLine={false} tickLine={false}
                    />
                  <Tooltip content={<MiniTooltip valueLabel="дней (среднее)" />} cursor={{ fill:"hsl(var(--accent))", opacity:0.4 }} />
                  <Bar dataKey="avg" radius={[0,4,4,0]} style={{ cursor:"pointer" }}
                    onClick={(d: ReasonAvgItem) => open(d.reason, `avg ${d.avg}д · ${d.count} блокировок`, d.tasks)}>
                    {data.reasonsAvg.map((r,i) => <Cell key={r.reason} fill={rc(r.reason,i)} />)}
                    <LabelList dataKey="avg" position="right"
                      style={{ fontSize:11, fontWeight:700, fill:"hsl(var(--foreground))" }}
                      formatter={(v:number) => `${v}д`} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

      </div>

      <DrillModal data={drill} onClose={() => setDrill(null)} />
    </div>
  )
}

function Empty() {
  return <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Нет данных</div>
}
