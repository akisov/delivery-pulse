import { useEffect, useMemo, useState } from "react"
import { Lightbulb, Sparkles, RefreshCw, ExternalLink, User } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/PageHeader"
import { fetchFeatureRefs, analyzeFeature } from "@/lib/api"
import type { FeatureRefs, FeatureAnalysis } from "@/lib/types"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

const CAT_COLOR: Record<string, string> = { S: "#22C55E", M: "#F59E0B", L: "#EF4444" }
const CAT_DESC: Record<string, string> = { S: "≤ 14 дн effort", M: "15–40 дн effort", L: "> 40 дн effort" }

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

  const load = (refresh = false) => {
    setLoading(true)
    fetchFeatureRefs(refresh).then(setRefs).catch(() => toast.error("Не удалось загрузить эталоны")).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

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
      setResult(await analyzeFeature({ text: text.trim() || undefined, key: keyInput.trim() || undefined }))
    } catch (e: any) { toast.error(e.message) }
    finally { setAnalyzing(false) }
  }

  return (
    <>
      <PageHeader icon={Lightbulb} title="Оценка новых возможностей" info="feat"
        subtitle="AI подскажет категорию и effort, эталонные задачи помогут откалибровать план (PUTKURERA · S/M/L)">
        <button onClick={() => load(true)} disabled={loading} title="Обновить эталоны из Трекера"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Обновить
        </button>
      </PageHeader>

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
          <input value={keyInput} onChange={e => setKeyInput(e.target.value)} placeholder="…или ключ: PUTKURERA-1234"
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
          <CardHeader className="pb-2"><CardTitle>Эталонные задачи <span className="text-xs font-normal text-muted-foreground">· {view.length}</span></CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {view.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Нет эталонов под фильтры. Нужны завершённые задачи PUTKURERA с заполненным Effort факт у Светлякова/Иванова/Бесковой/Беляева/Петровской.</p>
            ) : view.map(it => (
              <div key={it.key} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border hover:bg-accent/30 transition-colors flex-wrap">
                <a href={it.url} target="_blank" rel="noreferrer" className="font-mono text-xs font-bold text-primary hover:underline inline-flex items-center gap-1 shrink-0">{it.key}<ExternalLink className="w-3 h-3 opacity-40" /></a>
                <CatBadge c={it.category} sle={sleByCat[it.category]} />
                <span className="flex-1 min-w-[160px] text-sm text-foreground truncate">{it.title}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0"><User className="w-3 h-3" />{it.assignee}</span>
                <span className="text-xs shrink-0"><b className="text-foreground tabular-nums">{it.effort}</b> <span className="text-muted-foreground">effort</span></span>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{it.days}д</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  )
}
