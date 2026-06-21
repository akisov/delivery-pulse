import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const COLOR_MAP = {
  purple: { bar: "bg-[hsl(var(--chart-1))]", text: "text-[hsl(var(--chart-1))]", bg: "bg-[hsl(var(--chart-1))]/10", glow: "rgba(108,99,255,0.35)",  border: "rgba(108,99,255,0.5)",  tint: "rgba(108,99,255,0.07)" },
  teal:   { bar: "bg-[hsl(var(--chart-2))]", text: "text-[hsl(var(--chart-2))]", bg: "bg-[hsl(var(--chart-2))]/10", glow: "rgba(16,185,129,0.35)",  border: "rgba(16,185,129,0.5)",  tint: "rgba(16,185,129,0.07)" },
  rose:   { bar: "bg-[hsl(var(--chart-3))]", text: "text-[hsl(var(--chart-3))]", bg: "bg-[hsl(var(--chart-3))]/10", glow: "rgba(255,77,109,0.35)",  border: "rgba(255,77,109,0.5)",  tint: "rgba(255,77,109,0.07)" },
  amber:  { bar: "bg-[hsl(var(--chart-4))]", text: "text-[hsl(var(--chart-4))]", bg: "bg-[hsl(var(--chart-4))]/10", glow: "rgba(251,191,36,0.35)",  border: "rgba(251,191,36,0.5)",  tint: "rgba(251,191,36,0.07)" },
  sky:    { bar: "bg-[hsl(var(--chart-5))]", text: "text-[hsl(var(--chart-5))]", bg: "bg-[hsl(var(--chart-5))]/10", glow: "rgba(56,189,248,0.35)",  border: "rgba(56,189,248,0.5)",  tint: "rgba(56,189,248,0.07)" },
}

function AnimatedNumber({ value }: { value: number | string }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    if (typeof value !== "number" || typeof prev.current !== "number") {
      setDisplay(value); prev.current = value; return
    }
    const from = prev.current as number
    const to = value as number
    prev.current = value
    if (from === to) return
    const duration = 600
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (to - from) * ease))
      if (t < 1) requestAnimationFrame(tick)
      else setDisplay(to)
    }
    requestAnimationFrame(tick)
  }, [value])

  return <>{display}</>
}

interface StatCardProps {
  label: string
  value: number | string
  sub: string
  icon: string
  color: keyof typeof COLOR_MAP
  onClick?: () => void
  delta?: number          // изменение к прошлому периоду
  deltaSuffix?: string    // "" | "%" | "пп"
  invert?: boolean        // true — рост это плохо (для возвратов)
}

export function ArchStatCard({ label, value, sub, icon, color, onClick, delta, deltaSuffix = "", invert = false }: StatCardProps) {
  const c = COLOR_MAP[color]
  const [hovered, setHovered] = useState(false)

  const hasDelta = delta !== undefined && delta !== 0
  const up = (delta ?? 0) > 0
  const good = invert ? !up : up
  const deltaColor = good ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" : "text-rose-600 dark:text-rose-400 bg-rose-500/10"

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
        transform: hovered ? "translateY(-3px) scale(1.01)" : "translateY(0) scale(1)",
        boxShadow: hovered ? `0 8px 28px ${c.glow}, 0 0 0 1px ${c.border}` : "none",
      }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card flex flex-col gap-3 p-5 h-full",
        onClick && "cursor-pointer"
      )}
    >
      {/* Верхняя акцентная полоса */}
      <div className={cn("absolute top-0 left-0 right-0 h-0.5", c.bar)} />

      {/* Фоновый градиент при ховере */}
      <div style={{
        position: "absolute", inset: 0, opacity: hovered ? 1 : 0,
        transition: "opacity 0.3s ease",
        background: `radial-gradient(ellipse at top right, ${c.tint} 0%, transparent 70%)`,
        pointerEvents: "none",
      }} />

      <div className="flex items-center justify-between relative">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span
          className={cn("w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-transform duration-200", c.text, c.bg)}
          style={{ transform: hovered ? "rotate(10deg) scale(1.15)" : "rotate(0) scale(1)" }}
        >
          {icon}
        </span>
      </div>

      <div className="relative">
        <div className="flex items-end gap-2 flex-wrap">
          <p className={cn("text-4xl font-black tracking-tighter leading-none transition-colors duration-200", hovered ? c.text : "text-foreground")}>
            <AnimatedNumber value={value} />
          </p>
          {hasDelta && (
            <span className={cn("inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-bold tabular-nums", deltaColor)}>
              {up ? "▲" : "▼"}{Math.abs(delta!)}{deltaSuffix}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>
      </div>
    </div>
  )
}
