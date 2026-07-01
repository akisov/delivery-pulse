import { useEffect, useRef, useState } from "react"
import { Clock4, RefreshCw, Clock, ExternalLink, CheckCircle2, Palmtree, Thermometer, Undo2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { SimpleTooltip } from "@/components/ui/tooltip"
import { fetchSlackers, fetchSlackersStatus, setSlackerLeave } from "@/lib/api"
import type { SlackersData, Slacker } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const fmtDay = (d: string) => { const [, m, day] = (d || "").split("-"); return m && day ? `${day}.${m}` : d }
const isSick = (k?: string) => (k || "").toLowerCase().includes("больнич")

export function SlackersPage() {
  const [data, setData] = useState<SlackersData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startPoll = () => {
    if (pollRef.current) return
    pollRef.current = setInterval(async () => {
      const s = await fetchSlackersStatus().catch(() => null)
      setData(prev => prev ? { ...prev, status: s || prev.status } : prev)
      if (s && !s.running) {
        clearInterval(pollRef.current!); pollRef.current = null
        fetchSlackers(false).then(setData).catch(() => {})
      }
    }, 2500)
  }

  const load = (refresh = false) => {
    setLoading(true)
    fetchSlackers(refresh).then(d => { setData(d); if (d.building) startPoll() })
      .catch(() => toast.error("Не удалось загрузить")).finally(() => setLoading(false))
  }
  useEffect(() => { load(); return () => { if (pollRef.current) clearInterval(pollRef.current) } }, [])

  const toggleLeave = async (p: Slacker, on: boolean, kind = "отпуск") => {
    setBusy(p.id)
    try {
      await setSlackerLeave({ id: p.id, on, name: p.name, team: p.team, label: p.label, kind })
      // оптимистично перекладываем без полного пересчёта
      setData(prev => {
        if (!prev) return prev
        if (on) return { ...prev, slackers: prev.slackers.filter(s => s.id !== p.id), onLeave: [...prev.onLeave, { ...p, kind }].sort((a, b) => a.name.localeCompare(b.name)) }
        const back = { ...p }; delete back.since; delete back.kind
        const slackers = back.last2 < 8 ? [...prev.slackers, back].sort((a, b) => a.last2 - b.last2 || (b.daysSince ?? 0) - (a.daysSince ?? 0)) : prev.slackers
        return { ...prev, onLeave: prev.onLeave.filter(s => s.id !== p.id), slackers }
      })
      toast.success(on ? `${p.name} — отмечен(а): ${kind}` : `${p.name} — снова в строю`)
    } catch {
      toast.error("Не удалось сохранить")
    } finally { setBusy(null) }
  }

  const slackers = data?.slackers ?? []
  const onLeave = data?.onLeave ?? []
  const days = data?.days ?? []
  const refreshing = !!data?.building            // идёт фоновая пересборка
  const building = refreshing && !data?.computedAt   // первый сбор, кэша ещё нет

  return (
    <>
      <PageHeader icon={Clock4} title="Учёт часов" info="slackers"
        subtitle="Кто за 2 прошлых рабочих дня внёс меньше 8 ч (или не вносил вовсе)">
        <button onClick={() => load(true)} disabled={loading || refreshing} title="Пересобрать (тянет worklog по всем очередям)"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-60">
          <RefreshCw className={cn("w-4 h-4", (loading || refreshing) && "animate-spin")} /> {refreshing ? "Собираем…" : "Обновить"}
        </button>
      </PageHeader>

      {/* справка */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Часы и распределение времени — в&nbsp;
        <a href={data?.timesheet || "https://timesheet.svc.vkusvill.ru/"} target="_blank" rel="noreferrer"
          className="font-semibold text-primary hover:underline inline-flex items-center gap-1">
          timesheet <ExternalLink className="w-3.5 h-3.5" />
        </a>. Считаются списания во <b>всех</b> очередях, не только курьерских. Порог: &lt; 8&nbsp;ч за 2 предыдущих рабочих дня{days.length === 2 ? ` (${fmtDay(days[1])} и ${fmtDay(days[0])})` : ""}; выходные не учитываются, сегодня не входит.
        Если человек в отпуске <Palmtree className="inline w-3.5 h-3.5 text-emerald-500" /> или на больничном <Thermometer className="inline w-3.5 h-3.5 text-sky-500" /> — отметь, он выпадет из списка.
        {data?.computedAt && <span className="ml-1 text-muted-foreground/60">· данные на {data.computedAt}</span>}
      </div>

      {loading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : building ? (
        <Card><CardContent className="py-12 text-center">
          <RefreshCw className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
          <p className="text-sm font-semibold text-foreground">Собираем списания по всем очередям…</p>
          <p className="text-xs text-muted-foreground mt-1">{data?.status?.msg || "Это занимает до минуты"} {data?.status?.pct ? `· ${data.status.pct}%` : ""}</p>
        </CardContent></Card>
      ) : slackers.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Все списали часы — красавцы 🎉</p>
          <p className="text-xs text-muted-foreground mt-1">Все из {data?.rosterSize ?? 0} человек внесли ≥ 8 ч за 2 рабочих дня (или в отпуске).</p>
        </CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-border text-xs text-muted-foreground">
              <b className="text-rose-500">{slackers.length}</b> из {data?.rosterSize ?? 0} недосписали · отсортированы по часам (хуже сверху)
            </div>
            <div>
              {slackers.map(s => (
                <div key={s.id} className="border-b border-border last:border-0 px-4 py-2.5 flex items-center gap-3 hover:bg-accent/30 transition-colors">
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
                  <div className="shrink-0 flex items-center gap-1.5">
                    <SimpleTooltip label="Отпуск — убрать из учёта">
                      <button onClick={() => toggleLeave(s, true, "отпуск")} disabled={busy === s.id} aria-label="Отпуск"
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-card w-8 h-8 text-muted-foreground hover:text-emerald-600 hover:border-emerald-500/50 transition-all disabled:opacity-50">
                        <Palmtree className="w-4 h-4" />
                      </button>
                    </SimpleTooltip>
                    <SimpleTooltip label="Больничный — убрать из учёта">
                      <button onClick={() => toggleLeave(s, true, "больничный")} disabled={busy === s.id} aria-label="Больничный"
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-card w-8 h-8 text-muted-foreground hover:text-sky-600 hover:border-sky-500/50 transition-all disabled:opacity-50">
                        <Thermometer className="w-4 h-4" />
                      </button>
                    </SimpleTooltip>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* На отпуске / больничном */}
      {!loading && onLeave.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b border-border text-xs font-semibold text-emerald-600 inline-flex items-center gap-1.5">
              <Palmtree className="w-4 h-4" /> На отпуске / больничном · {onLeave.length}
            </div>
            <div>
              {onLeave.map(s => (
                <div key={s.id} className="border-b border-border last:border-0 px-4 py-2 flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity">
                  {isSick(s.kind)
                    ? <Thermometer className="w-4 h-4 text-sky-500 shrink-0" />
                    : <Palmtree className="w-4 h-4 text-emerald-500 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-foreground">{s.name}</span>
                    <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-secondary text-muted-foreground">{s.label}</span>
                    {s.kind && <span className="ml-2 text-[11px] capitalize text-muted-foreground">{s.kind}</span>}
                  </div>
                  <button onClick={() => toggleLeave(s, false)} disabled={busy === s.id} title="Вернуть в общий учёт"
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 h-8 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-50">
                    <Undo2 className="w-3.5 h-3.5" /> Вернуть
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
