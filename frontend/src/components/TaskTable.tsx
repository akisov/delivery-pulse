import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, ArrowUpDown, Download, Flame } from "lucide-react"
import type { ArchReturnTask as Task } from "@/lib/types"
import { cn } from "@/lib/utils"

type Filter = "all" | "v1" | "v2" | "both" | "none" | "multi" | "hot" | string

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",   label: "Все" },
  { key: "v1",    label: "АрхКом" },
  { key: "v2",    label: "ТА" },
  { key: "both",  label: "Оба" },
  { key: "none",  label: "С первого раза" },
  { key: "multi", label: "2+ возврата" },
  { key: "hot",   label: "🔥 3+ возврата" },
]

function downloadCsv(tasks: Task[]) {
  const headers = ["Ключ", "Название", "Тип", "Очередь", "Дата входа", "Возвраты АрхКом", "Возвраты ТА", "Всего возвратов", "Время прохождения, дней"]
  const esc = (v: unknown) => {
    const s = String(v ?? "")
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers, ...tasks.map(t => [
    t.key, t.title, t.issueTypeDisplay, t.queue, t.entryDate ?? "",
    t.v1n, t.v2n, t.total, t.cycleDays ?? "",
  ])].map(r => r.map(esc).join(";")).join("\r\n")
  const blob = new Blob(["﻿" + lines], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `arch-tasks-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso + "T00:00:00")
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`
}

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100
  if (m100 >= 11 && m100 <= 19) return "задач"
  if (m10 === 1) return "задача"
  if (m10 >= 2 && m10 <= 4) return "задачи"
  return "задач"
}

interface TaskTableProps {
  tasks: Task[]
  activeFilter: string
  onFilter: (f: string) => void
}

export function TaskTable({ tasks, activeFilter, onFilter }: TaskTableProps) {
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  let filtered = tasks
  if      (activeFilter === "v1")    filtered = tasks.filter(t => t.v1n > 0 && t.v2n === 0)
  else if (activeFilter === "v2")    filtered = tasks.filter(t => t.v2n > 0 && t.v1n === 0)
  else if (activeFilter === "both")  filtered = tasks.filter(t => t.v1n > 0 && t.v2n > 0)
  else if (activeFilter === "none")  filtered = tasks.filter(t => t.total === 0)
  else if (activeFilter === "multi") filtered = tasks.filter(t => t.total >= 2)
  else if (activeFilter === "hot")   filtered = tasks.filter(t => t.total >= 3)
  else if (activeFilter.startsWith("cuts")) {
    const n = parseInt(activeFilter.slice(4))
    filtered = tasks.filter(t => t.total === n)
  }

  const sorted = [...filtered].sort((a, b) =>
    sortDir === "desc"
      ? b.total - a.total || a.key.localeCompare(b.key)
      : a.total - b.total || a.key.localeCompare(b.key)
  )

  const badge = (t: Task) => {
    if (t.v1n > 0 && t.v2n > 0) return <Badge variant="default">АрхКом + ТА</Badge>
    if (t.v1n > 0) return <Badge variant="success">АрхКом</Badge>
    if (t.v2n > 0) return <Badge variant="destructive">ТА</Badge>
    return <Badge variant="secondary">✓ Ок</Badge>
  }

  const th = "py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap"
  const td = "py-3 text-sm"

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border flex-wrap">
        <div>
          <span className="text-sm font-bold text-foreground">Задачи</span>
          <span className="ml-2 text-xs text-muted-foreground">{sorted.length} {plural(sorted.length)}</span>
        </div>
        <div className="flex gap-1.5 flex-wrap items-center">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => onFilter(f.key)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-semibold border transition-all",
                activeFilter === f.key
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-transparent"
              )}>
              {f.label}
            </button>
          ))}
          <button
            onClick={() => downloadCsv(sorted)}
            disabled={sorted.length === 0}
            title="Скачать текущий список в CSV"
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all disabled:opacity-40 disabled:cursor-default">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {sorted.length === 0 ? (
          <div className="py-14 text-center text-muted-foreground text-sm">Нет задач для выбранного фильтра</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-secondary/50 border-b border-border">
                <th className={cn(th, "text-left pl-5 pr-2 w-[130px]")}>Ключ</th>
                <th className={cn(th, "text-left px-2")}>Название</th>
                <th className={cn(th, "text-left px-2 w-[80px]")}>Дата</th>
                <th className={cn(th, "text-left px-2 w-[120px]")}>Тип</th>
                <th className={cn(th, "text-center px-2 w-[70px]")}>АрхКом</th>
                <th className={cn(th, "text-center px-2 w-[50px]")}>ТА</th>
                <th
                  className={cn(th, "text-center px-2 cursor-pointer select-none w-[80px]")}
                  style={{ paddingRight: 20 }}
                  onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
                >
                  <span className="inline-flex items-center gap-1">Итого <ArrowUpDown className="w-3 h-3" /></span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map(t => {
                const hot = t.total >= 3
                return (
                <tr key={t.key} className={cn("transition-colors group", hot ? "bg-rose-500/[0.06] hover:bg-rose-500/[0.12]" : "hover:bg-secondary/30")}>
                  <td className={cn(td, "pl-5 pr-2")}>
                    <a href={t.url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary font-mono text-xs font-bold hover:underline whitespace-nowrap">
                      {t.key}
                      <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-70 transition-opacity shrink-0" />
                    </a>
                  </td>
                  <td className={cn(td, "px-2 max-w-[200px]")}>
                    <span className="line-clamp-2 leading-snug text-foreground">{t.title}</span>
                  </td>
                  <td className={cn(td, "px-2 text-muted-foreground tabular-nums text-xs whitespace-nowrap")}>
                    {fmtDate(t.entryDate)}
                  </td>
                  <td className={cn(td, "px-2")}>{badge(t)}</td>
                  <td className={cn(td, "px-2 text-center font-black tabular-nums text-base text-emerald-600 dark:text-emerald-400")}>
                    {t.v1n || <span className="text-muted-foreground/30 font-normal text-sm">—</span>}
                  </td>
                  <td className={cn(td, "px-2 text-center font-black tabular-nums text-base text-rose-600 dark:text-rose-400")}>
                    {t.v2n || <span className="text-muted-foreground/30 font-normal text-sm">—</span>}
                  </td>
                  <td className={cn(td, "px-2 text-center")} style={{ paddingRight: 20 }}>
                    {t.total > 0
                      ? <span className={cn(
                          "inline-flex items-center justify-center gap-0.5 min-w-7 h-7 px-1.5 rounded-full text-sm font-black",
                          hot ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        )}>
                          {hot && <Flame className="w-3 h-3" />}{t.total}
                        </span>
                      : <span className="text-muted-foreground/30 text-sm">—</span>
                    }
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  )
}
