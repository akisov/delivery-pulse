import { useEffect, useState } from "react"
import { Sparkles, RefreshCw, ExternalLink } from "lucide-react"

function renderMd(s: string) {
  return s.split(/\*\*/).map((p, i) => i % 2 === 1
    ? <b key={i} className="font-bold text-foreground">{p}</b>
    : <span key={i}>{p}</span>)
}

export function ArchAiSummary({ dateFrom, dateTo, queues }: { dateFrom: string; dateTo: string; queues: string }) {
  const [summary, setSummary] = useState("")
  const [loading, setLoading] = useState(true)
  const load = (refresh = false) => {
    setLoading(true)
    fetch(`/arch-ai-summary?date_from=${dateFrom}&date_to=${dateTo}&queues=${queues}${refresh ? "&refresh=true" : ""}`)
      .then(r => r.json()).then((d: any) => setSummary(d?.summary || ""))
      .catch(() => setSummary("")).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [dateFrom, dateTo, queues])
  const lines = (summary || "").split("\n").map(s => s.trim()).filter(Boolean)
  if (!loading && !summary) return null
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-[0_0_32px_rgba(108,99,255,0.12)]">
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20"><Sparkles className="h-5 w-5 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">AI-итоги по арх. комитету</span>
            <span className="text-[10px] text-muted-foreground">· Claude + ваши данные</span>
            <button onClick={() => load(true)} disabled={loading} title="Пересобрать вывод"
              className="ml-auto text-muted-foreground/60 transition-colors hover:text-primary">
              <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </button>
          </div>
          {loading ? (
            <div className="space-y-2 py-0.5">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 text-sm leading-relaxed text-foreground animate-fade-in-up" style={{ animationDelay: `${i * 0.05}s` }}>
                  <span>{renderMd(l.replace(/^[•\-*]\s*/, ""))}</span>
                </div>
              ))}
            </div>
          )}
          {!loading && summary && (
            <a href="https://practice-radar.svc.vkusvill.ru/" target="_blank" rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
              📌 Практики — Радар практик ТехВилл <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
