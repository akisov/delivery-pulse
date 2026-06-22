import { useEffect, useMemo, useState } from "react"
import { Lightbulb, Sparkles, RefreshCw, ExternalLink, User, Settings, MessageSquarePlus, Clock, Hourglass } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Modal } from "@/components/ui/modal"
import { PageHeader } from "@/components/PageHeader"
import { fetchFeatureRefs, analyzeFeature, fetchFeatureSettings, saveFeatureSettings, addFeatureComment, fetchWorklogStacks } from "@/lib/api"
import type { FeatureRefs, FeatureAnalysis, FeatureCategory, WorklogStacks, StackBreakdown } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const CAT_COLOR: Record<string, string> = { S: "#22C55E", M: "#F59E0B", L: "#EF4444" }
const CAT_DESC: Record<string, string> = { S: "≤ 14 дн effort", M: "15–40 дн effort", L: "> 40 дн effort" }
const STACK_COLOR: Record<string, string> = {
  SA: "#06B6D4", GO: "#3B82F6", Front: "#A855F7", QA: "#F59E0B", "1С": "#10B981", AQA: "#EC4899", "АрхКом": "#6366F1", "Другие": "#94A3B8",
}
const STACK_ORDER = ["SA", "GO", "Front", "QA", "1С", "AQA", "АрхКом", "Другие"]
function StackChips({ bs, sub }: { bs: StackBreakdown; sub?: boolean }) {
  const entries = STACK_ORDER.filter(s => (bs[s] || 0) > 0).map(s => [s, bs[s]] as [string, number])
  if (!entries.length) return sub ? <span className="text-[10px] text-muted-foreground/50">нет логов по стекам</span> : null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {entries.map(([s, v]) => (
        <span key={s} className={cn("inline-flex items-center gap-1 rounded font-bold", sub ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]")}
          style={{ background: `${STACK_COLOR[s] || "#94A3B8"}1A`, color: STACK_COLOR[s] || "#94A3B8" }}
          title={`${s}: ${v} SP по эталону`}>
          {s} {v}
        </span>
      ))}
    </span>
  )
}

function CatBadge({ c, sle }: { c: string; sle?: number }) {
  const col = CAT_COLOR[c] || "#94A3B8"
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold"
      style={{ background: `${col}1A`, color: col }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: col }} />{c}{sle ? ` · SLE ${sle}д` : ""}
    </span>
  )
}

export function FeatureEstPage() {
  const [refs, setRefs] = useState<FeatureRefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [team, setTeam] = useState("ALL")
  const [cat, setCat] = useState("ALL")

  const [text, setText] = useState("")
  const [keyInput, setKeyInput] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<FeatureAnalysis | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [commenting, setCommenting] = useState(false)
  const [stacks, setStacks] = useState<WorklogStacks | null>(null)

  const load = (refresh = false) => {
    setLoading(true)
    fetchFeatureRefs(refresh).then(setRefs).catch(() => toast.error("Не удалось загрузить эталоны")).finally(() => setLoading(false))
    fetchWorklogStacks(refresh).then(setStacks).catch(() => {})   // разбивка по стекам (кэш)
  }
  useEffect(() => { load() }, [])

  const stacksByKey = useMemo(
    () => Object.fromEntries((stacks?.perTask ?? []).map(t => [t.key, t.byStack] as [string, StackBreakdown])),
    [stacks])
  // ключ из поля (принимаем и ссылку https://tracker.yandex.ru/PUTKURERA-1218)
  const taskKey = useMemo(() => { const m = keyInput.match(/[A-Z][A-Z0-9]*-\d+/i); return m ? m[0].toUpperCase() : "" }, [keyInput])

  const teamLabels = refs?.teamLabels ?? { R: "Курьеры R", X: "Курьеры X", U: "Курьеры U" }
  const cats = refs?.categories ?? [{ key: "S", sle: 55 }, { key: "M", sle: 88 }, { key: "L", sle: 108 }]
  const sleByCat = Object.fromEntries(cats.map(c => [c.key, c.sle]))

  const items = refs?.items ?? []
  const view = items.filter(i => (team === "ALL" || i.team === team) && (cat === "ALL" || i.category === cat))
  // сводка команда×категория
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const t of (refs?.teams ?? [])) m[t] = { S: 0, M: 0, L: 0 }
    for (const it of items) if (m[it.team]) m[it.team][it.category]++
    return m
  }, [items, refs])

  const onAnalyze = async () => {
    if (!text.trim() && !keyInput.trim()) { toast("Введите описание или ключ задачи"); return }
    setAnalyzing(true); setResult(null)
    try {
      setResult(await analyzeFeature({ text: text.trim() || undefined, key: taskKey || undefined }))
    } catch (e: any) { toast.error(e.message) }
    finally { setAnalyzing(false) }
  }

  // Собираем текст анализа для комментария в задачу
  const buildComment = (r: FeatureAnalysis) => {
    const lines = [`Оценка НВ (AI): категория ${r.category}` + (r.sle ? ` · SLE ${r.sle}д` : "") + (r.effortDays != null ? ` · ~${r.effortDays} дн effort` : "")]
    if (r.rationale) lines.push("", r.rationale)
    if (r.mmf) {
      lines.push("", `Проверка MMF: ${r.mmf.score}/${r.mmf.total}`)
      r.mmf.criteria.forEach((c, i) => lines.push(`${c.ok ? "✅" : "❌"} ${i + 1}. ${c.name}: ${c.note}`))
      if (r.mmf.recommendations?.length) { lines.push("", "Рекомендации:"); r.mmf.recommendations.forEach(x => lines.push(`— ${x}`)) }
    }
    return lines.join("\n")
  }
  const onComment = async () => {
    if (!result || !taskKey) return
    setCommenting(true)
    try {
      const url = await addFeatureComment(taskKey, buildComment(result))
      toast.success("Комментарий добавлен в задачу", { description: url })
    } catch (e: any) { toast.error(e.message) }
    finally { setCommenting(false) }
  }

  return (
    <>
      <PageHeader icon={Lightbulb} title="Оценка НВ" info="feat"
        subtitle="Новые возможности: AI-категория и effort + MMF-проверка, эталоны по командам (PUTKURERA · S/M/L)">
        <button onClick={() => setShowSettings(true)} title="Категории и SLE"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <Settings className="w-4 h-4" /> Настройки
        </button>
        <button onClick={() => load(true)} disabled={loading} title="Обновить эталоны из Трекера"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Обновить
        </button>
      </PageHeader>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} onSaved={() => load(true)} />

      {/* AI-анализ */}
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-[0_0_32px_rgba(108,99,255,0.12)]">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20"><Sparkles className="h-4 w-4 text-primary" /></span>
          <span className="text-sm font-bold text-foreground">AI-оценка задачи</span>
          <span className="text-[11px] text-muted-foreground">· категория и effort по описанию или ключу</span>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          placeholder="Опишите новую задачу/возможность…"
          className="w-full bg-secondary/60 border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 resize-y" />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="…или ключ/ссылка: PUTKURERA-1234 или https://tracker.yandex.ru/PUTKURERA-1234"
            className="flex-1 min-w-[200px] bg-secondary/60 border border-border rounded-lg px-3 h-9 text-sm text-foreground outline-none focus:border-primary/50" />
          <button onClick={onAnalyze} disabled={analyzing}
            className="inline-flex items-center gap-2 rounded-lg px-4 h-9 text-sm font-bold text-white disabled:opacity-50 transition-all"
            style={{ background: "linear-gradient(90deg,#6C63FF,#A855F7,#EC4899)" }}>
            {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Анализировать
          </button>
        </div>

        {result && result.category && (
          <div className="mt-4 rounded-xl border border-border bg-card p-4 animate-fade-in-up">
            <div className="flex items-center gap-3 flex-wrap">
              <CatBadge c={result.category} sle={result.sle ?? undefined} />
              {result.effortDays != null && (
                <span className="text-sm"><b className="text-foreground">~{result.effortDays}</b> <span className="text-muted-foreground">дн effort</span></span>
              )}
              <span className="text-[11px] text-muted-foreground">{CAT_DESC[result.category]}</span>
            </div>
            {result.rationale && <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{result.rationale}</p>}
            {result.similar?.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[11px] text-muted-foreground">Похожие эталоны:</span>
                {result.similar.map(k => (
                  <a key={k} href={`https://tracker.yandex.ru/${k}`} target="_blank" rel="noreferrer"
                    className="font-mono text-xs font-bold text-primary hover:underline inline-flex items-center gap-1">{k}<ExternalLink className="w-3 h-3 opacity-40" /></a>
                ))}
              </div>
            )}

            {/* MMF-проверка */}
            {result.mmf && (
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Проверка MMF</span>
                  <span className={cn("text-xs font-black tabular-nums", result.mmf.score >= 4 ? "text-emerald-500" : result.mmf.score >= 3 ? "text-amber-500" : "text-rose-500")}>{result.mmf.score}/{result.mmf.total}</span>
                </div>
                <div className="space-y-1">
                  {result.mmf.criteria.map((c, i) => (
                    <div key={i} className="flex gap-2 text-sm">
                      <span className="shrink-0">{c.ok ? "✅" : "❌"}</span>
                      <span><b className="text-foreground">{c.name}.</b> <span className="text-muted-foreground">{c.note}</span></span>
                    </div>
                  ))}
                </div>
                {result.mmf.recommendations?.length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    <span className="font-semibold">Рекомендации:</span>
                    <ul className="mt-0.5 space-y-0.5">{result.mmf.recommendations.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-primary shrink-0">•</span>{r}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            {/* Добавить коммент к задаче (если введён ключ) */}
            {taskKey && (
              <div className="mt-3 pt-3 border-t border-border">
                <button onClick={onComment} disabled={commenting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary px-3 h-9 text-xs font-semibold hover:bg-primary/15 disabled:opacity-50 transition-all">
                  {commenting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <MessageSquarePlus className="w-3.5 h-3.5" />} Добавить коммент в {taskKey}
                </button>
              </div>
            )}
          </div>
        )}
        {result && !result.category && result.rationale && (
          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">{result.rationale}</p>
        )}
      </div>

      {/* Сводка команда × категория */}
      {!loading && refs && (
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
          <CardHeader className="pb-2">
            <CardTitle>Эталоны — по командам и категориям</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Завершённые задачи PUTKURERA (с янв 2026). Категория — по Effort факт. Клик по фильтрам ниже.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="text-sm border-separate border-spacing-0">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-3 py-1.5">Команда</th>
                    {cats.map(c => <th key={c.key} className="px-3 py-1.5 text-center"><CatBadge c={c.key} sle={c.sle} /></th>)}
                    <th className="px-3 py-1.5 text-center">Всего</th>
                  </tr>
                </thead>
                <tbody>
                  {(refs.teams ?? []).map(t => {
                    const row = matrix[t] || { S: 0, M: 0, L: 0 }
                    const tot = row.S + row.M + row.L
                    return (
                      <tr key={t} className="border-t border-border">
                        <td className="px-3 py-1.5 font-semibold text-foreground">{teamLabels[t] || t}</td>
                        {cats.map(c => <td key={c.key} className={cn("px-3 py-1.5 text-center tabular-nums font-semibold", row[c.key] ? "text-foreground" : "text-muted-foreground/40")}>{row[c.key]}</td>)}
                        <td className="px-3 py-1.5 text-center tabular-nums font-black">{tot}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {stacks && Object.keys(stacks.byStack).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mb-1.5">Суммарный effort эталонов по стекам (SP)</p>
                <StackChips bs={stacks.byStack} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Фильтры */}
      <div className="flex items-center gap-4 flex-wrap rounded-xl border border-primary/20 bg-card px-4 py-3 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="w-24 shrink-0 text-xs font-bold uppercase tracking-widest text-muted-foreground">Команда</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {["ALL", ...(refs?.teams ?? ["R", "X", "U"])].map(t => (
              <button key={t} onClick={() => setTeam(t)}
                className={cn("px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all whitespace-nowrap",
                  team === t ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {t === "ALL" ? "Все" : (teamLabels[t] || t)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Категория</span>
          <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 flex-wrap">
            {["ALL", "S", "M", "L"].map(c => (
              <button key={c} onClick={() => setCat(c)}
                className={cn("px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all",
                  cat === c ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground hover:bg-card")}>
                {c === "ALL" ? "Все" : c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Список эталонов */}
      {loading ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_8px_30px_rgba(108,99,255,0.12)]">
          <CardHeader className="pb-2">
            <CardTitle>Эталонные задачи <span className="text-xs font-normal text-muted-foreground">· {view.length}</span></CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">Под каждой задачей — распределение её effort по стекам (из worklog подзадач в очередях курьеров). Помогает прикинуть, сколько SP на какой стек заложить.</p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {view.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Нет эталонов под фильтры. Нужны завершённые задачи PUTKURERA с заполненным Effort факт у Светлякова/Иванова/Бесковой/Беляева/Петровской.</p>
            ) : view.map(it => (
              <div key={it.key} className="px-3 py-2 rounded-lg border border-border hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-3 flex-wrap">
                  <a href={it.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 shrink-0">{it.key}<ExternalLink className="w-3 h-3 opacity-40" /></a>
                  <CatBadge c={it.category} sle={sleByCat[it.category]} />
                  <span className="flex-1 min-w-[160px] text-sm text-foreground truncate">{it.title}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0"><User className="w-3 h-3" />{it.assignee}</span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-black text-primary shrink-0 tabular-nums" title="effort (человеко-дни)"><Hourglass className="w-3 h-3" />{it.effort}</span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-black text-amber-600 dark:text-amber-400 shrink-0 tabular-nums" title="дней в работе"><Clock className="w-3 h-3" />{it.days}д</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 shrink-0">по стекам:</span>
                  <StackChips bs={stacksByKey[it.key] || {}} sub />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}

function SettingsModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [cats, setCats] = useState<FeatureCategory[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) fetchFeatureSettings().then(setCats).catch(() => {}) }, [open])
  const upd = (i: number, field: "maxEff" | "sle", v: string) =>
    setCats(cs => cs.map((c, j) => j === i ? { ...c, [field]: v === "" ? (field === "maxEff" ? null : 0) : parseFloat(v.replace(",", ".")) || 0 } : c))
  const save = async () => {
    setBusy(true)
    try { await saveFeatureSettings(cats); onClose(); onSaved(); toast.success("Настройки сохранены", { description: "Категории и SLE обновлены" }) }
    catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }
  const inp = "w-20 bg-secondary/60 border border-border rounded-md px-2 py-1 text-center text-sm text-foreground outline-none focus:border-primary/50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
  return (
    <Modal open={open} onClose={onClose} title="Категории и SLE" subtitle="Порог Effort факт (верхняя граница, дн) и SLE (ожидаемый срок, дн) по категориям">
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          <span>Категория</span><span className="text-center">Effort ≤</span><span className="text-center">SLE, дн</span>
        </div>
        {cats.map((c, i) => (
          <div key={c.key} className="grid grid-cols-[1fr_auto_auto] gap-3 items-center">
            <span className="inline-flex items-center gap-1.5 text-sm font-bold">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: CAT_COLOR[c.key] || "#94A3B8" }} />{c.key}
            </span>
            <input type="number" min="0" step="1" placeholder="∞" value={c.maxEff ?? ""} onChange={e => upd(i, "maxEff", e.target.value)}
              className={inp} title={c.maxEff == null ? "без верхней границы (L)" : ""} />
            <input type="number" min="0" step="1" value={c.sle} onChange={e => upd(i, "sle", e.target.value)} className={inp} />
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">Пустой «Effort ≤» = без верхней границы (старшая категория). Категория эталонов и AI пересчитываются по этим порогам.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-lg border border-border bg-card px-4 h-10 text-sm font-semibold text-muted-foreground hover:text-foreground transition-all">Отмена</button>
          <button onClick={save} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground px-4 h-10 text-sm font-semibold disabled:opacity-40 transition-all">
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : null} Сохранить
          </button>
        </div>
      </div>
    </Modal>
  )
}
