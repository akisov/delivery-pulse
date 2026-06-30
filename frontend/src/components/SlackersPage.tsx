import { useEffect, useState } from "react"
import { AlertOctagon, RefreshCw, Clock, ExternalLink, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { fetchSlackers } from "@/lib/api"
import type { SlackersData } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const fmtDay = (d: string) => { const [, m, day] = (d || "").split("-"); return m && day ? `${day}.${m}` : d }

export function SlackersPage() {
  const [data, setData] = useState<SlackersData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = (refresh = false) => {
    setLoading(true)
    fetchSlackers(refresh).then(setData).catch(() => toast.error("Не удалось загрузить")).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const slackers = data?.slackers ?? []
  const days = data?.days ?? []

  return (
    <>
      <PageHeader icon={AlertOctagon} title="Негодяи" info="slackers"
        subtitle="Кто за 2 прошлых рабочих дня внёс меньше 8 ч (или не вносил вовсе)">
        <button onClick={() => load(true)} disabled={loading} title="Пересчитать вживую"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Обновить
        </button>
      </PageHeader>

      {/* справка */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Часы и распределение времени — в&nbsp;
        <a href={data?.timesheet || "https://timesheet.svc.vkusvill.ru/"} target="_blank" rel="noreferrer"
          className="font-semibold text-primary hover:underline inline-flex items-center gap-1">
          timesheet <ExternalLink className="w-3.5 h-3.5" />
        </a>. Порог: &lt; 8&nbsp;ч за 2 предыдущих рабочих дня{days.length === 2 ? ` (${fmtDay(days[1])} и ${fmtDay(days[0])})` : ""}; выходные не учитываются, сегодня не входит.
        {data?.computedAt && <span className="ml-1 text-muted-foreground/60">· данные на {data.computedAt}</span>}
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : slackers.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Негодяев нет — все молодцы 🎉</p>
          <p className="text-xs text-muted-foreground mt-1">Все из {data?.rosterSize ?? 0} человек внесли ≥ 8 ч за 2 рабочих дня.</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
              <b className="text-rose-500">{slackers.length}</b> негодяев из {data?.rosterSize ?? 0} · отсортированы по часам (хуже сверху)
            </div>
            <div>
              {slackers.map((s, i) => (
                <div key={s.name + i} className="border-b border-border last:border-0 px-4 py-2.5 flex items-center gap-3 hover:bg-accent/30 transition-colors">
                  <span className="inline-flex items-center justify-center min-w-[3.2rem] rounded-md bg-rose-500/15 px-2 py-1 text-sm font-black text-rose-500 tabular-nums">
                    {s.last2} ч
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{s.name}</span>
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-secondary text-muted-foreground">{s.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {s.lastLog
                        ? `последнее списание ${fmtDay(s.lastLog)}${s.daysSince != null && s.daysSince > 2 ? ` · ${s.daysSince} дн. назад` : ""}`
                        : "нет списаний за 14 дней"}
                    </p>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {days.map(d => (
                      <div key={d}>{fmtDay(d)}: <b className={cn(s.perDay[d] ? "text-foreground" : "text-rose-400")}>{s.perDay[d] || 0} ч</b></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
