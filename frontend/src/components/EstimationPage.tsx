import { useEffect, useMemo, useRef, useState } from "react"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList, Cell, Legend,
} from "recharts"
import { Gauge, Plus, Trash2, Lock, Unlock, RefreshCw, Pencil, Check, ChevronDown, ExternalLink } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { PageHeader } from "@/components/PageHeader"
import { ArchStatCard } from "@/components/ArchStatCard"
import { SimpleTooltip } from "@/components/ui/tooltip"
import {
  fetchSprints, createSprint, deleteSprint, addSprintTask, removeSprintTask,
  setSprintPlan, finalizeSprint, reopenSprint, fetchPlanFact,
} from "@/lib/api"
import type { Sprint, SprintPlanFact } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const PLAN_C = "#3B82F6"   // план — синий
const OK_C = "#22C55E"     // факт ≤ плана — зелёный
const OVER_C = "#EF4444"   // факт > плана — красный

const TEAMS = [
  { key: "U", label: "Курьеры U", active: true },
  { key: "X", label: "Курьеры X", active: false },
  { key: "R", label: "Курьеры R", active: false },
]

function fmtD(iso: string) {
  if (!iso) return ""
  const p = iso.slice(0, 10).split("-")
  return p.length === 3 ? `${p[2]}.${p[1]}` : iso
}
const factColor = (plan: number, fact: number) => (plan > 0 && fact > plan ? OVER_C : OK_C)

const SPRINT_DAYS = 14   // спринт по умолчанию — 2 недели
function isoAdd(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n)
  const m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}
function isoToday() {
  const d = new Date(); const m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${m}-${day}`
}
function dmLabel(iso: string) { const p = iso.split("-"); return p.length === 3 ? `${+p[2]}.${p[1]}` : "" }

export function EstimationPage() {
  const [team] = useState("U")
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [data, setData] = useState<SprintPlanFact | null>(null)
  const [loading, setLoading] = useState(false)
  const [planMode, setPlanMode] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [sprOpen, setSprOpen] = useState(false)
  const sprRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // закрытие выпадашки спринтов по клику вне
  useEffect(() => {
    if (!sprOpen) return
    const h = (e: MouseEvent) => { if (sprRef.current && !sprRef.current.contains(e.target as Node)) setSprOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [sprOpen])

  const loadSprints = async (pick?: number) => {
    const list = await fetchSprints(team).catch(() => [])
    setSprints(list)
    setSel(prev => pick ?? (prev && list.some(s => s.id === prev) ? prev : (list[0]?.id ?? null)))
  }
  useEffect(() => { loadSprints() }, [])

  const loadPF = async (id: number, silent = false) => {
    if (!silent) setLoading(true)
    try { setData(await fetchPlanFact(id)) }
    catch (e: any) { if (!silent) toast.error("Не удалось загрузить спринт", { description: e.message }) }
    finally { if (!silent) setLoading(false) }
  }
  useEffect(() => {
    if (sel == null) { setData(null); return }
    setPlanMode(false)
    loadPF(sel)
  }, [sel])

  // Live: тихо обновляем факт раз в 60с, пока спринт не зафиксирован и не в режиме плана
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (sel == null || planMode || data?.finalized) return
    pollRef.current = setInterval(() => { if (sel != null) loadPF(sel, true) }, 60_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [sel, planMode, data?.finalized])

  const selSprint = sprints.find(s => s.id === sel) ?? null
  const roles = data?.roles ?? []
  const roleLabels = data?.roleLabels ?? {}
  const tasks = data?.tasks ?? []
  const totals = data?.totals

  // данные графиков
  const byTask = useMemo(() => tasks.map(t => ({
    label: t.key.replace(/^[A-Z]+-/, ""),          // короткий ключ — читаемо на оси
    full: `${t.key} — ${t.title}`, key: t.key, plan: t.planTotal, fact: t.factTotal,
  })), [tasks])
  const byRole = useMemo(() => roles.map(r => ({
    label: roleLabels[r] || r, plan: data?.byRole[r]?.plan ?? 0, fact: data?.byRole[r]?.fact ?? 0,
  })), [data, roles, roleLabels])

  // хайлайты
  const highlights = useMemo(() => {
    const withPlan = tasks.filter(t => t.planTotal > 0)
    const over = [...withPlan].filter(t => t.factTotal > t.planTotal).sort((a, b) => (b.factTotal / b.planTotal) - (a.factTotal / a.planTotal))[0]
    const notStarted = tasks.find(t => t.factTotal === 0 && t.planTotal > 0)
    const behind = [...withPlan].filter(t => t.factTotal <= t.planTotal).sort((a, b) => a.pct - b.pct)[0]
    return { over, notStarted, behind }
  }, [tasks])

  const empty = !loading && data && tasks.length === 0

  // ── действия ──
  const onCreate = async (name: string, df: string, dt: string) => {
    setBusy(true)
    try {
      const id = await createSprint({ team, name, date_from: df, date_to: dt })
      setShowNew(false)
      await loadSprints(id)
      setPlanMode(true)
      toast.success("Спринт создан", { description: "Добавьте задачи и проставьте план" })
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  const onAddTask = async () => {
    if (!sel || !newKey.trim()) return
    setBusy(true)
    try {
      const r = await addSprintTask(sel, newKey.trim())
      setNewKey("")
      toast.success(`Добавлена ${r.key}`, { description: r.title })
      await loadPF(sel)
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  const onRemoveTask = async (key: string) => {
    if (!sel) return
    await removeSprintTask(sel, key)
    await loadPF(sel)
  }
  const onPlan = async (key: string, role: string, sp: number) => {
    if (!sel) return
    await setSprintPlan(sel, key, role, sp).catch(() => {})
    loadPF(sel, true)
  }
  const onFinalize = async () => {
    if (!sel) return
    setBusy(true)
    try { await finalizeSprint(sel); await loadPF(sel); await loadSprints(sel); toast.success("Итог зафиксирован") }
    catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  const onReopen = async () => {
    if (!sel) return
    setBusy(true)
    try { await reopenSprint(sel); await loadPF(sel); await loadSprints(sel); toast("Спринт открыт заново — факт снова в реальном времени") }
    catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  const onDeleteSprint = async () => {
    if (!sel) return
    if (!confirm("Удалить спринт со всем планом?")) return
    await deleteSprint(sel)
    setSel(null)
    await loadSprints()
    toast("Спринт удалён")
  }

  return (
    <>
      <PageHeader icon={Gauge} title="Оценка — план-факт спринта" info="est"
        subtitle={<>Планируем SP по ролям, факт — из worklog в реальном времени · 1 SP = 8 ч{data?.sprint && <span className="ml-1">· {data.sprint.dateFrom && `${fmtD(data.sprint.dateFrom)}–${fmtD(data.sprint.dateTo)}`}</span>}</>}>
        {sel != null && data && (
          data.finalized
            ? <button onClick={onReopen} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all"><Unlock className="w-4 h-4" /> Открыть заново</button>
            : <button onClick={onFinalize} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 h-9 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-all"><Lock className="w-4 h-4" /> Зафиксировать итог</button>
        )}
        {sel != null && !data?.finalized && (
          <button onClick={() => setPlanMode(m => !m)} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-3 h-9 text-xs font-semibold transition-all", planMode ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50")}>
            {planMode ? <Check className="w-4 h-4" /> : <Pencil className="w-4 h-4" />} {planMode ? "Готово" : "План"}
          </button>
        )}
      </PageHeader>

      {/* Команда */}
      <div className="flex items-center gap-3 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
        <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
          {TEAMS.map(t => t.active ? (
            <button key={t.key} className="px-3.5 py-1.5 rounded-md text-sm font-semibold bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]">{t.label}</button>
          ) : (
            <SimpleTooltip key={t.key} label="Скоро — пока только Курьеры U">
              <button disabled className="px-3.5 py-1.5 rounded-md text-sm font-semibold text-muted-foreground/40 cursor-not-allowed">{t.label}</button>
            </SimpleTooltip>
          ))}
        </div>
      </div>

      {/* Спринты */}
      <div className="flex items-center gap-2 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">Спринт</span>
        <div ref={sprRef} className="relative">
          <button onClick={() => setSprOpen(o => !o)}
            className="inline-flex items-center justify-between gap-2 min-w-[240px] rounded-lg bg-secondary/60 border border-border px-3 h-9 text-sm font-semibold text-foreground hover:border-primary/50 transition-all">
            <span className="inline-flex items-center gap-1.5 truncate">
              {selSprint ? <>{selSprint.name}{selSprint.finalized && <Lock className="w-3 h-3 opacity-70" />}</> : <span className="text-muted-foreground">Выберите спринт</span>}
            </span>
            <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform", sprOpen && "rotate-180")} />
          </button>
          {sprOpen && (
            <div className="absolute z-30 left-0 mt-1 min-w-[280px] max-h-[340px] overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
              {sprints.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">спринтов пока нет</p>}
              {sprints.map(s => (
                <button key={s.id} onClick={() => { setSel(s.id); setSprOpen(false) }}
                  className={cn("w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                    sel === s.id ? "bg-primary/15 text-primary font-semibold" : "text-foreground hover:bg-secondary")}>
                  <span className="inline-flex items-center gap-1.5 truncate">{s.name}{s.finalized && <Lock className="w-3 h-3 opacity-70" />}</span>
                  {sel === s.id && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <Plus className="w-3.5 h-3.5" /> Новый спринт
        </button>
        {sel != null && (
          <button onClick={onDeleteSprint} title="Удалить спринт" className="inline-flex items-center justify-center rounded-lg border border-border bg-card w-9 h-9 text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-all">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {sel == null && (
        <div className="rounded-xl border border-border bg-card p-16 text-center">
          <div className="text-5xl mb-5">📋</div>
          <h2 className="text-2xl font-black tracking-tight mb-3">Нет спринтов</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto leading-relaxed">
            Создайте спринт (период), добавьте задачи по ключу и проставьте план в SP по ролям —
            факт подтянется из worklog Трекера в реальном времени.
          </p>
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-5 h-11 text-sm font-semibold hover:opacity-90 transition-all"><Plus className="w-4 h-4" /> Новый спринт</button>
        </div>
      )}

      {loading && sel != null && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      )}

      {/* Режим планирования */}
      {!loading && sel != null && (planMode || empty) && data && (
        <Card className="transition-all duration-200">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> План спринта — SP по ролям</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Добавьте задачи по ключу и проставьте оценку в SP для нужных ролей (стеков). Факт считается из worklog за период спринта.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <input value={newKey} onChange={e => setNewKey(e.target.value)} onKeyDown={e => e.key === "Enter" && onAddTask()}
                placeholder="Ключ задачи, напр. UDOSTAVKA-1460"
                className="flex-1 min-w-[220px] bg-secondary/60 border border-border rounded-lg px-3 h-9 text-sm text-foreground outline-none focus:border-primary/50" />
              <button onClick={onAddTask} disabled={busy || !newKey.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 h-9 text-sm font-semibold disabled:opacity-40 transition-all"><Plus className="w-4 h-4" /> Добавить</button>
            </div>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Пока нет задач — добавьте первую по ключу</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-separate border-spacing-0">
                  <thead>
                    <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      <th className="text-left px-2 py-2 sticky left-0 bg-card min-w-[200px]">Задача</th>
                      {roles.map(r => <th key={r} className="px-2 py-2 text-center w-16">{roleLabels[r] || r}</th>)}
                      <th className="px-2 py-2 text-center w-16">Σ план</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => (
                      <tr key={t.key} className="border-t border-border">
                        <td className="px-2 py-1.5 sticky left-0 bg-card">
                          <div className="font-mono text-xs font-bold text-primary">{t.key}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[220px]">{t.title}</div>
                        </td>
                        {roles.map(r => (
                          <td key={r} className="px-1 py-1.5 text-center">
                            <input type="number" min="0" step="0.5" defaultValue={t.plan[r] || 0}
                              onBlur={e => onPlan(t.key, r, parseFloat(e.target.value) || 0)}
                              className="w-14 bg-secondary/60 border border-border rounded-md px-1.5 py-1 text-center text-sm outline-none focus:border-primary/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-center font-black tabular-nums">{t.planTotal}</td>
                        <td className="px-1 py-1.5 text-center">
                          <button onClick={() => onRemoveTask(t.key)} className="text-muted-foreground/50 hover:text-destructive transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Дашборд план-факт */}
      {!loading && sel != null && !planMode && !empty && data && totals && (
        <>
          {/* карточки */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="animate-fade-in-up stagger-1 h-full"><ArchStatCard label="Задач в спринте" value={totals.tasks} sub="в плане" icon="📋" color="purple" /></div>
            <div className="animate-fade-in-up stagger-2 h-full"><ArchStatCard label="План" value={`${totals.plan} SP`} sub="суммарно по ролям" icon="🎯" color="sky" /></div>
            <div className="animate-fade-in-up stagger-3 h-full"><ArchStatCard label="Факт" value={`${totals.fact} SP`} sub={`Δ ${totals.delta > 0 ? "+" : ""}${totals.delta} SP`} icon="⏱" color={totals.fact > totals.plan ? "rose" : "teal"} /></div>
            <div className="animate-fade-in-up stagger-4 h-full"><ArchStatCard label="Выполнение" value={`${totals.pct}%`} sub={data.finalized ? "зафиксировано" : "в реальном времени"} icon="📊" color={totals.pct > 100 ? "rose" : "amber"} /></div>
          </div>

          {/* хайлайты */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            <HL label="↑ Перевыполнено" color="rose" task={highlights.over} note={highlights.over ? `план ${highlights.over.planTotal} → факт ${highlights.over.factTotal} SP` : "—"} />
            <HL label="○ Не начато" color="sky" task={highlights.notStarted} note={highlights.notStarted ? `план ${highlights.notStarted.planTotal} SP (факт 0)` : "—"} />
            <HL label="↓ Меньше всех готово" color="teal" task={highlights.behind} note={highlights.behind ? `факт ${highlights.behind.factTotal}/${highlights.behind.planTotal} SP (${highlights.behind.pct}%)` : "—"} />
          </div>

          {/* графики */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            <PFChart title="📋 По задачам" data={byTask}
              linkBy={Object.fromEntries(byTask.map(d => [d.label, `https://tracker.yandex.ru/${d.key}`]))} />
            <PFChart title="🧑‍💻 По ролям" data={byRole} />
          </div>

          {/* прогресс по задачам */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)] animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            <CardHeader className="pb-2"><CardTitle>Прогресс по задачам</CardTitle></CardHeader>
            <CardContent className="space-y-3.5">
              {tasks.map(t => {
                const over = t.planTotal > 0 && t.factTotal > t.planTotal
                const c = t.planTotal === 0 ? "#94A3B8" : over ? OVER_C : OK_C
                const w = t.planTotal > 0 ? Math.min(100, t.factTotal / t.planTotal * 100) : 0
                return (
                  <div key={t.key}>
                    <div className="flex items-center justify-between gap-3 text-sm mb-1">
                      <a href={`https://tracker.yandex.ru/${t.key}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-xs font-bold text-primary shrink-0">{t.key.replace(/^UDOSTAVKA-/, "")}</span>
                        <span className="text-foreground truncate">{t.title}</span>
                        <ExternalLink className="w-3 h-3 opacity-30 shrink-0" />
                      </a>
                      <span className="font-semibold tabular-nums shrink-0" style={{ color: c }}>
                        {t.planTotal === 0 ? "0 / 0 SP —" : `${t.factTotal} / ${t.planTotal} SP (${t.pct}%)`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${w}%`, background: c }} />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </>
      )}

      {/* Модалка нового спринта */}
      <NewSprintModal open={showNew} busy={busy} sprints={sprints} onClose={() => setShowNew(false)} onCreate={onCreate} />
    </>
  )
}

const HL_COLOR: Record<string, string> = { rose: "#EF4444", sky: "#38BDF8", teal: "#22C55E" }
function HL({ label, color, task, note }: { label: string; color: string; task?: { key: string; title: string }; note: string }) {
  const c = HL_COLOR[color]
  return (
    <div className="rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.1)]">
      <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: c }}>{label}</p>
      {task ? (
        <>
          <p className="text-sm font-black text-foreground mt-1 truncate">{task.key.replace(/^UDOSTAVKA-/, "")} — {task.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{note}</p>
        </>
      ) : <p className="text-sm text-muted-foreground mt-1">—</p>}
    </div>
  )
}

function TaskTick(props: any) {
  const { x, y, payload, linkBy } = props
  const url = linkBy?.[payload?.value]
  return (
    <text x={x} y={y} dy="0.71em" textAnchor="middle" fontSize={11} fontWeight={600}
      fill={url ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
      style={url ? { cursor: "pointer", textDecoration: "underline" } : undefined}
      onClick={url ? () => window.open(url, "_blank", "noopener") : undefined}>
      {payload?.value}
    </text>
  )
}

function PFChart({ title, data, linkBy }: { title: string; data: { label: string; plan: number; fact: number }[]; linkBy?: Record<string, string> }) {
  return (
    <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
      <CardHeader className="pb-1"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground mb-2">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PLAN_C }} /> План</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: OK_C }} /> Факт ≤ плана</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: OVER_C }} /> Факт &gt; плана</span>
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} margin={{ top: 16, right: 8, left: -10, bottom: 4 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={(p: any) => <TaskTick {...p} linkBy={linkBy} />} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} unit=" SP" width={48} />
            <Tooltip cursor={{ fill: "hsl(var(--accent))", opacity: 0.3 }} formatter={(v: any) => `${v} SP`}
              labelFormatter={(label: any, p: any) => p?.[0]?.payload?.full || label}
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }} />
            <Legend wrapperStyle={{ display: "none" }} />
            <Bar dataKey="plan" name="План" fill={PLAN_C} radius={[3, 3, 0, 0]}>
              <LabelList dataKey="plan" position="top" style={{ fontSize: 9, fontWeight: 700, fill: PLAN_C }} />
            </Bar>
            <Bar dataKey="fact" name="Факт" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={factColor(d.plan, d.fact)} />)}
              <LabelList dataKey="fact" position="top" style={{ fontSize: 9, fontWeight: 700, fill: "hsl(var(--foreground))" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function NewSprintModal({ open, busy, sprints, onClose, onCreate }: {
  open: boolean; busy: boolean; sprints: Sprint[]; onClose: () => void; onCreate: (name: string, df: string, dt: string) => void
}) {
  const [name, setName] = useState("")
  const [df, setDf] = useState("")
  const [dt, setDt] = useState("")
  const [nameTouched, setNameTouched] = useState(false)

  // Подставляем следующий спринт: старт = на след. день после последнего, 2 недели
  useEffect(() => {
    if (!open) return
    const lastEnd = sprints.map(s => s.date_to).filter(Boolean).sort().slice(-1)[0]
    const start = lastEnd ? isoAdd(lastEnd, 1) : isoToday()
    const end = isoAdd(start, SPRINT_DAYS - 1)
    const nums = sprints.map(s => { const m = /Sprint\s+(\d+)/i.exec(s.name); return m ? +m[1] : 0 })
    const next = (nums.length ? Math.max(...nums) : 0) + 1
    setDf(start); setDt(end); setNameTouched(false)
    setName(`Sprint ${next} (${dmLabel(start)}-${dmLabel(end)})`)
  }, [open, sprints])

  // Смена старта → конец = старт + 2 недели; имя пересобираем, если его не правили вручную
  const onStart = (v: string) => {
    setDf(v)
    if (v) {
      const end = isoAdd(v, SPRINT_DAYS - 1)
      setDt(end)
      if (!nameTouched) {
        const m = /Sprint\s+(\d+)/i.exec(name)
        setName(`Sprint ${m ? m[1] : ""} (${dmLabel(v)}-${dmLabel(end)})`.replace("Sprint  ", "Sprint "))
      }
    }
  }
  const inp = "w-full bg-secondary/60 border border-border rounded-lg px-3 h-10 text-sm text-foreground outline-none focus:border-primary/50 [color-scheme:light] dark:[color-scheme:dark]"
  return (
    <Modal open={open} onClose={onClose} title="Новый спринт" subtitle="По умолчанию 2 недели · период задаёт окно расчёта факта (worklog)">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Название</label>
          <input value={name} onChange={e => { setName(e.target.value); setNameTouched(true) }} placeholder="Sprint 32 (22.06-05.07)" className={cn(inp, "mt-1")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Начало</label>
            <input type="date" value={df} onChange={e => onStart(e.target.value)} className={cn(inp, "mt-1")} />
          </div>
          <div>
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Конец <span className="text-muted-foreground/60 normal-case font-normal">(2 недели)</span></label>
            <input type="date" value={dt} onChange={e => setDt(e.target.value)} className={cn(inp, "mt-1")} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 h-10 text-sm font-semibold text-muted-foreground hover:text-foreground transition-all">Отмена</button>
          <button onClick={() => onCreate(name.trim(), df, dt)} disabled={busy || !name.trim() || !df || !dt}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 h-10 text-sm font-semibold disabled:opacity-40 transition-all">
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Создать
          </button>
        </div>
      </div>
    </Modal>
  )
}
