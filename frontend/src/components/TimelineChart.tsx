import { Card, CardContent } from "@/components/ui/card"
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from "recharts"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"
import { useTheme } from "@/lib/theme"

interface TimelineChartProps {
  tasks: Task[]
  dateFrom: string
  dateTo: string
  onShowTasks?: (data: TaskModalData) => void
}

function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00"), day = d.getDay()
  d.setDate(d.getDate() + (day===0?-6:1-day))
  return d.toISOString().slice(0,10)
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso + "T00:00:00")
  return `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`
}

interface WeekData { date: string; wk: string; total: number; ak: number; ta: number }

export function TimelineChart({ tasks, dateFrom, dateTo, onShowTasks }: TimelineChartProps) {
  const { theme } = useTheme()
  const isDark = theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)

  // Build weeks
  const start = new Date(dateFrom+"T00:00:00"), end = new Date(dateTo+"T00:00:00")
  const sd = start.getDay(), mon = new Date(start)
  mon.setDate(start.getDate()+(sd===0?-6:1-sd))

  const weekArr: WeekData[] = []
  const weekByDate: Record<string, WeekData> = {}
  for (const cur = new Date(mon); cur<=end; cur.setDate(cur.getDate()+7)) {
    const wk = cur.toISOString().slice(0,10)
    const w: WeekData = { date: fmtDate(wk), wk, total:0, ak:0, ta:0 }
    weekArr.push(w)
    weekByDate[wk] = w
  }
  // Бакетируем события по их датам: вход / возврат АрхКома / возврат ТА
  const addEvent = (dateStr: string, kind: "entry"|"ak"|"ta") => {
    const wk = weekStart(dateStr)
    let w = weekByDate[wk]
    if (!w) { w = { date: fmtDate(wk), wk, total:0, ak:0, ta:0 }; weekByDate[wk] = w; weekArr.push(w) }
    if (kind === "entry") w.total++
    else if (kind === "ak") w.ak++
    else w.ta++
  }
  for (const t of tasks) {
    for (const d of t.entryDates) addEvent(d, "entry")
    for (const d of t.v1Dates)    addEvent(d, "ak")
    for (const d of t.v2Dates)    addEvent(d, "ta")
  }
  const data = weekArr.sort((a,b)=>a.date.localeCompare(b.date))

  const tooltipBg     = isDark ? "hsl(224,71%,6%)"  : "#ffffff"
  const tooltipBorder = isDark ? "hsl(216,34%,17%)" : "hsl(220,13%,88%)"
  const tooltipText   = isDark ? "hsl(213,31%,91%)" : "hsl(224,71%,10%)"
  const gridColor     = isDark ? "hsl(216,34%,17%)" : "hsl(220,13%,91%)"
  const axisColor     = isDark ? "hsl(215,16%,47%)" : "hsl(220,9%,55%)"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const d: WeekData = payload[0]?.payload
    return (
      <div style={{ background:tooltipBg, border:`1px solid ${tooltipBorder}`, borderRadius:12, padding:"12px 16px", fontSize:12, minWidth:200, boxShadow:"0 8px 24px rgba(0,0,0,0.15)" }}>
        <p style={{ color:tooltipText, fontWeight:700, marginBottom:8 }}>Неделя с {label}</p>
        <p style={{ color:"hsl(252,87%,70%)", marginBottom:3 }}>📋 Пришло: <b>{d.total}</b></p>
        <p style={{ color:"hsl(166,76%,40%)", marginBottom:3 }}>🔄 АрхКом: <b>{d.ak}</b></p>
        <p style={{ color:"hsl(350,89%,60%)", marginBottom:8 }}>↩️ ТА: <b>{d.ta}</b></p>
        <p style={{ color:axisColor, fontSize:10, borderTop:`1px solid ${tooltipBorder}`, paddingTop:6 }}>👆 Нажмите на точку</p>
      </div>
    )
  }

  if (!data.length) return null

  // activeDot с onClick — открывает модалку для нужной недели
  const openWeek = (w: WeekData) => {
    const inWk = (d: string) => weekStart(d) === w.wk
    const weekTasks = tasks.map(t => {
      const v1 = t.v1Dates.filter(inWk).length
      const v2 = t.v2Dates.filter(inWk).length
      const entered = t.entryDates.some(inWk)
      if (!v1 && !v2 && !entered) return null
      return { ...t, entered, v1n: v1, v2n: v2, total: v1 + v2 }
    }).filter((t): t is Task => t !== null)
    onShowTasks?.({
      title: `Неделя с ${w.date}`,
      subtitle: `Пришло ${w.total} · возвраты АрхКом ${w.ak} · ТА ${w.ta}`,
      tasks: weekTasks,
    })
  }
  const makeActiveDot = (color: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ cx, cy, payload }: any) => (
      <circle cx={cx} cy={cy} r={6} fill={color} stroke={isDark?"#0a0c14":"#fff"} strokeWidth={2}
        style={{ cursor:"pointer" }}
        onClick={() => {
          const w = weekByDate[Object.keys(weekByDate).find(k => weekByDate[k].date === payload.date) ?? ""]
          if (w) openWeek(w)
        }}/>
    )

  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
        <CardContent className="p-6">
          <p className="text-sm font-bold text-foreground mb-1">Динамика по неделям</p>
          <p className="text-xs text-muted-foreground mb-5">
            События по дате: пришло в комитет и возвраты · нажмите на точку
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data} margin={{ top:4, right:4, left:-20, bottom:0 }}>
              <defs>
                <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(252,87%,70%)" stopOpacity={isDark?.25:.15}/>
                  <stop offset="95%" stopColor="hsl(252,87%,70%)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gAk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(166,76%,40%)" stopOpacity={isDark?.2:.12}/>
                  <stop offset="95%" stopColor="hsl(166,76%,40%)" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="gTa" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(350,89%,60%)" stopOpacity={isDark?.2:.12}/>
                  <stop offset="95%" stopColor="hsl(350,89%,60%)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false}/>
              <XAxis dataKey="date" tick={{ fill:axisColor, fontSize:11 }} axisLine={false} tickLine={false}/>
              <YAxis tick={{ fill:axisColor, fontSize:11 }} axisLine={false} tickLine={false} allowDecimals={false}/>
              <Tooltip content={<CustomTooltip/>}/>
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize:12, paddingTop:12, color:axisColor }}/>
              <Area type="monotone" dataKey="total" name="Пришло"
                stroke="hsl(252,87%,70%)" strokeWidth={2.5} fill="url(#gTotal)"
                dot={{ r:3, fill:"hsl(252,87%,70%)", strokeWidth:0, cursor:"pointer" }}
                activeDot={makeActiveDot("hsl(252,87%,70%)")}/>
              <Area type="monotone" dataKey="ak" name="Возвраты АрхКом"
                stroke="hsl(166,76%,40%)" strokeWidth={1.5} fill="url(#gAk)" strokeDasharray="5 3"
                dot={false} activeDot={makeActiveDot("hsl(166,76%,40%)")}/>
              <Area type="monotone" dataKey="ta" name="Возвраты ТА"
                stroke="hsl(350,89%,60%)" strokeWidth={1.5} fill="url(#gTa)" strokeDasharray="5 3"
                dot={false} activeDot={makeActiveDot("hsl(350,89%,60%)")}/>
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
  )
}
