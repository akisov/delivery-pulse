import { useEffect, useState } from "react"
import { Sparkles, RefreshCw } from "lucide-react"

interface Resp { ok: boolean; error?: string; summary?: string; updatedAt?: string }

// простой рендер **жирного**
function renderMd(s: string) {
  return s.split(/\*\*/).map((p, i) => i % 2 === 1
    ? <strong key={i} className="font-bold text-foreground">{p}</strong>
    : <span key={i}>{p}</span>)
}

export function OSPAiSummary({ queue, month, monthLabel, refreshKey }: {
  queue?: string; month: string; monthLabel?: string; refreshKey?: number
}) {
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const single = queue && queue !== "all" ? queue : null

  const load = (refresh = false) => {
    if (!single || !month) return
    setLoading(true)
    fetch(`/osp-ai-summary?team=${single}&month=${month}${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json()).then((d: Resp) => setResp(d))
      .catch(() => setResp({ ok: false, error: "Ошибка" }))
      .finally(() => setLoading(false))
  }
  // перезагружаем при смене команды/месяца и по общему рефрешу
  useEffect(() => { setResp(null); load() }, [single, month])
  useEffect(() => { if (refreshKey) load(true) }, [refreshKey])

  // блок только когда выбрана конкретная команда
  if (!single) return null

  const lines = (resp?.summary || "").split("\n").map(s => s.trim()).filter(Boolean)

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-[0_0_32px_rgba(108,99,255,0.12)]">
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">AI-вывод по месяцу</span>
            {monthLabel && <span className="text-[10px] font-semibold uppercase text-primary/70">· {monthLabel}</span>}
            <span className="text-[10px] text-muted-foreground">· Claude + ваши данные</span>
            <button onClick={() => load(true)} disabled={loading} title="Пересобрать вывод"
              className="ml-auto text-muted-foreground/60 transition-colors hover:text-primary">
              <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mb-2">Узкие места и тревожные тренды относительно прошлого месяца — по числам дашборда</p>

          {loading ? (
            <div className="space-y-2 py-0.5">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : !resp?.summary ? (
            <p className="text-sm text-muted-foreground py-1">
              {resp && !resp.ok ? `⚠️ ${resp.error}` : "Нет данных для вывода (или ИИ-ключ не задан)."}
            </p>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 text-sm leading-relaxed text-foreground animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                  <span>{renderMd(l.replace(/^[•\-*]\s*/, ""))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
