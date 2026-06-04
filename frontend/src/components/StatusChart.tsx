import { useEffect, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, Legend
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { Badge } from "@/components/ui/badge"
import { OutlierTag } from "@/components/ui/outlier-tag"
import { ExternalLink, Clock, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface StatusTask {
  blockingKey: string
  parentKey: string
  parentTitle: string
  url: string
  queue: string
  reason: string
  startDate: string
  endDate: string
  isActive: boolean
  days: number
  isOutlier?: boolean
}

interface StatusData {
  statusKey: string
  statusDisplay: string
  count: number
  avg: number
  p70: number
  p85: number
  p90: number
  tasks: StatusTask[]
}

function pluralDays(n: number) {
  const m = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "дней"
  if (m === 1) return "день"
  if (m >= 2 && m <= 4) return "дня"
  return "дней"
}

function StatusTaskModal({ status, onClose }: { status: StatusData | null; onClose: () => void }) {
  if (!status) return null
  return (
    <Modal open={!!status} onClose={onClose} title={status.statusDisplay}
      subtitle={`${status.tasks.length} блокировок · avg ${status.avg}д · P90 ${status.p90}д`} wide>
      <div className="rounded-xl border border-border overflow-hidden">
        {status.tasks.map(t => (
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
              <p className="text-xs text-muted-foreground/70 mt-0.5">{t.reason} · {t.startDate}{t.endDate ? ` → ${t.endDate}` : " → сегодня"}</p>
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

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as StatusData
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-2xl text-xs space-y-1.5">
      <p className="font-bold text-foreground">{d.statusDisplay}</p>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#7C6FF7" }} />
        <span className="text-muted-foreground">Среднее:</span>
        <span className="font-semibold text-foreground">{d.avg} дн.</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#EAB308" }} />
        <span className="text-muted-foreground">P70:</span>
        <span className="font-semibold text-amber-400">{d.p70} дн.</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#F97316" }} />
        <span className="text-muted-foreground">P85:</span>
        <span className="font-semibold text-orange-400">{d.p85} дн.</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#EF4444" }} />
        <span className="text-muted-foreground">P90:</span>
        <span className="font-semibold text-red-400">{d.p90} дн.</span>
      </div>
      <div className="pt-1 border-t border-border text-muted-foreground">
        {d.count} блокировок · нажми для списка
      </div>
    </div>
  )
}

interface Props {
  dateFrom?: string
  dateTo?: string
  queue: string
}

export function StatusChart({ dateFrom, dateTo, queue }: Props) {
  const [data, setData] = useState<StatusData[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [empty, setEmpty] = useState(false)
  const [selected, setSelected] = useState<StatusData | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (queue && queue !== "ALL") params.set("queues", queue)
    if (dateFrom) params.set("date_from", dateFrom)
    if (dateTo)   params.set("date_to", dateTo)
    fetch(`/status-analysis?${params}`)
      .then(r => r.json())
      .then(d => {
        const statuses = (d.statuses as StatusData[]).filter(s => s.count > 0)
        setData(statuses); setEmpty(statuses.length === 0)
      })
      .catch(() => setEmpty(true))
      .finally(() => setLoading(false))
  }, [dateFrom, dateTo, queue])

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle>Блокировки по этапам работы</CardTitle>
            {data && <span className="text-xs text-muted-foreground">среднее и P90 · нажми на столбец</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            На каком рабочем статусе задачи чаще всего блокируются и насколько долго
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 w-full rounded-xl" />
          ) : empty ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
              Нет данных — запустите загрузку changelog
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data!} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}
                barCategoryGap="30%" barGap={4}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                <XAxis dataKey="statusDisplay"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--accent))", opacity: 0.4 }} />
                <Legend formatter={(v) => v === "avg" ? "Среднее" : "P90"} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="avg" name="avg" fill="#7C6FF7" radius={[4,4,0,0]}
                  style={{ cursor: "pointer" }} onClick={(d) => setSelected(d as StatusData)}>
                  <LabelList dataKey="avg" position="top"
                    style={{ fontSize: 10, fontWeight: 700, fill: "#7C6FF7" }}
                    formatter={(v: number) => v > 0 ? `${v}д` : ""} />
                </Bar>
                <Bar dataKey="p90" name="p90" fill="#F97316" radius={[4,4,0,0]}
                  style={{ cursor: "pointer" }} onClick={(d) => setSelected(d as StatusData)}>
                  <LabelList dataKey="p90" position="top"
                    style={{ fontSize: 10, fontWeight: 700, fill: "#F97316" }}
                    formatter={(v: number) => v > 0 ? `${v}д` : ""} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <StatusTaskModal status={selected} onClose={() => setSelected(null)} />
    </>
  )
}
