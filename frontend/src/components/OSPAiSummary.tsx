import { useEffect, useState } from "react"
import { Sparkles, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Resp { ok: boolean; error?: string; summary?: string; updatedAt?: string }

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
    <Card className="border-primary/30 bg-primary/[0.04] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(108,99,255,0.15)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> AI-вывод по месяцу{monthLabel ? ` · ${monthLabel}` : ""}
          </CardTitle>
          <button onClick={() => load(true)} disabled={loading} title="Пересобрать вывод"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Узкие места и тревожные тренды относительно прошлого месяца — по числам дашборда</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <RefreshCw className="w-4 h-4 animate-spin text-primary" /> ИИ анализирует тренды…
          </div>
        ) : !resp?.summary ? (
          <div className="text-sm text-muted-foreground py-2">
            {resp && !resp.ok ? `⚠️ ${resp.error}` : "Нет данных для вывода (или ИИ-ключ не задан)."}
          </div>
        ) : (
          <div className="space-y-1.5">
            {lines.map((l, i) => (
              <p key={i} className="text-sm text-foreground leading-relaxed flex gap-2">
                <span className="text-primary shrink-0">•</span>
                <span>{l.replace(/^[•\-*]\s*/, "")}</span>
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
