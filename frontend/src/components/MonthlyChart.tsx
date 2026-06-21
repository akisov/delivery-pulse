import { Card, CardContent } from "@/components/ui/card"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts"
import type { ArchReturnTask as Task } from "@/lib/types"
import type { ArchModalData as TaskModalData } from "@/components/ArchTaskListModal"
import { useTheme } from "@/lib/theme"

interface MonthlyChartProps {
  tasks: Task[]
  onShowTasks?: (data: TaskModalData) => void
}

const MONTH_NAMES = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"]

function monthKey(d: string) { return d.slice(0, 7) }
function monthLabel(d: string) {
  const [y, m] = d.split("-")
  return `${MONTH_NAMES[parseInt(m) - 1]} ${y.slice(2)}`
}

interface MonthData { key: string; label: string; entered: number; ak: number; ta: number }

export function MonthlyChart({ tasks, onShowTasks }: MonthlyChartProps) {
  const { theme } = useTheme()
  const isDark = theme==="dark"||(theme==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches)

  // Считаем события по их дате
  const map: Record<string, MonthData> = {}
  const bucket = (d: string) => {
    const k = monthKey(d)
    return (map[k] ||= { key: k, label: monthLabel(d), entered: 0, ak: 0, ta: 0 })
  }
  for (const t of tasks) {
    for (const d of t.entryDates) bucket(d).entered++
    for (const d of t.v1Dates)    bucket(d).ak++
    for (const d of t.v2Dates)    bucket(d).ta++
  }
  const data = Object.keys(map).sort().map(k => map[k])
  if (data.length === 0) return null

  const tooltipBg = isDark?"hsl(224,71%,6%)":"#fff"
  const tooltipBorder = isDark?"hsl(216,34%,17%)":"hsl(220,13%,88%)"
  const tooltipText = isDark?"hsl(213,31%,91%)":"hsl(224,71%,10%)"
  const gridColor = isDark?"hsl(216,34%,17%)":"hsl(220,13%,91%)"
  const axisColor = isDark?"hsl(215,16%,47%)":"hsl(220,9%,55%)"

  const ENTER = "hsl(252,87%,70%)"
  const AK = "hsl(166,76%,40%)"
  const TA = "hsl(350,89%,60%)"

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({active,payload,label}:any) => {
    if(!active||!payload?.length) return null
    const dd:MonthData = payload[0]?.payload
    if(!dd) return null
    return(
      <div style={{background:tooltipBg,border:`1px solid ${tooltipBorder}`,borderRadius:10,padding:"10px 14px",fontSize:12,boxShadow:"0 4px 16px rgba(0,0,0,0.12)"}}>
        <p style={{color:tooltipText,fontWeight:700,marginBottom:6}}>{label}</p>
        <p style={{color:ENTER,marginBottom:2}}>📋 Пришло: <b>{dd.entered}</b></p>
        <p style={{color:AK,marginBottom:2}}>🔄 Возвраты АрхКом: <b>{dd.ak}</b></p>
        <p style={{color:TA}}>↩️ Возвраты ТА: <b>{dd.ta}</b></p>
        <p style={{color:axisColor,fontSize:10,marginTop:6}}>👆 Нажмите для списка задач</p>
      </div>
    )
  }

  const open = (m: MonthData) => {
    // Счётчики по событиям ИМЕННО этого месяца (а не за весь период)
    const monthTasks = tasks.map(t => {
      const v1 = t.v1Dates.filter(d => monthKey(d) === m.key).length
      const v2 = t.v2Dates.filter(d => monthKey(d) === m.key).length
      const entered = t.entryDates.some(d => monthKey(d) === m.key)
      if (!v1 && !v2 && !entered) return null
      return { ...t, entered, v1n: v1, v2n: v2, total: v1 + v2 }
    }).filter((t): t is Task => t !== null)
    onShowTasks?.({
      title: `События за ${m.label}`,
      subtitle: `Пришло ${m.entered} · возвраты АрхКом ${m.ak} · ТА ${m.ta}`,
      tasks: monthTasks,
    })
  }
  const handleClick = (_: unknown, index: number) => { const m = data[index]; if (m) open(m) }

  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-bold text-foreground mb-1">По месяцам — события</p>
        <p className="text-xs text-muted-foreground mb-4">
          Считается по дате самого события · нажмите на столбец для списка задач
        </p>

        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{top:4,right:8,left:-16,bottom:0}} barCategoryGap="28%" barGap={3}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false}/>
            <XAxis dataKey="label" tick={{fill:axisColor,fontSize:11}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fill:axisColor,fontSize:11}} axisLine={false} tickLine={false} allowDecimals={false} width={28}/>
            <Tooltip content={<CustomTooltip/>} cursor={false}/>
            <Bar dataKey="entered" name="Пришло"          fill={ENTER} radius={[4,4,0,0]} cursor="pointer" onClick={handleClick}/>
            <Bar dataKey="ak"      name="Возвраты АрхКом"  fill={AK}    radius={[4,4,0,0]} cursor="pointer" onClick={handleClick}/>
            <Bar dataKey="ta"      name="Возвраты ТА"      fill={TA}    radius={[4,4,0,0]} cursor="pointer" onClick={handleClick}/>
          </BarChart>
        </ResponsiveContainer>

        <div className="flex gap-4 mt-2 flex-wrap">
          {[{c:ENTER,l:"Пришло"},{c:AK,l:"Возвраты АрхКом"},{c:TA,l:"Возвраты ТА"}].map(x=>(
            <span key={x.l} className="flex items-center gap-1.5 text-xs" style={{color:axisColor}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:x.c,display:"inline-block"}}/>
              {x.l}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
