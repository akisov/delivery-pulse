import { useEffect, useState } from "react"
import { Sparkles, RefreshCw } from "lucide-react"

interface Facts {
  totalBlockings: number
  [k: string]: any
}
interface Summary {
  facts: Facts
  template: string
  ai: string | null
  hasAI: boolean
}

interface Props {
  dateFrom?: string
  dateTo?: string
  queue: string
}

// Рендер **жирного** из текста шаблона
function renderBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-bold text-foreground">{part}</strong>
      : <span key={i}>{part}</span>
  )
}

export function InsightInformer({ dateFrom, dateTo, queue }: Props) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const buildUrl = (refresh = false) => {
    const p = new URLSearchParams()
    if (queue && queue !== "ALL") p.set("queues", queue)
    if (dateFrom) p.set("date_from", dateFrom)
    if (dateTo)   p.set("date_to", dateTo)
    if (refresh)  p.set("refresh", "true")
    return `/insight-summary?${p}`
  }

  const fetchSummary = (refresh = false) => {
    setLoading(true)
    fetch(buildUrl(refresh))
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchSummary() }, [dateFrom, dateTo, queue])

  // Нет блокировок за период — не показываем информер
  if (!loading && (!data || !data.facts?.totalBlockings)) return null

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-[0_0_32px_rgba(108,99,255,0.12)]">
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">AI-сводка</span>
            {!loading && data && (
              <span className="text-[10px] text-muted-foreground">
                {data.hasAI ? "· Mistral + ваши данные" : "· по вашим данным"}
              </span>
            )}
            {!loading && (
              <button
                onClick={() => fetchSummary(true)}
                title="Пересчитать"
                className="ml-auto text-muted-foreground/60 transition-colors hover:text-primary"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {loading ? (
            <div className="space-y-2 py-0.5">
              <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ) : data ? (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">{renderBold(data.template)}</p>
              {data.ai && (
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground">{data.ai}</p>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
