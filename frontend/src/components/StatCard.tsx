import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

const COLOR_MAP = {
  purple: { text: "text-primary",     bg: "bg-primary/10",     glow: "rgba(108,99,255,0.4)",  border: "rgba(108,99,255,0.6)" },
  rose:   { text: "text-destructive", bg: "bg-destructive/10", glow: "rgba(255,77,109,0.4)",  border: "rgba(255,77,109,0.6)" },
  amber:  { text: "text-amber-400",   bg: "bg-amber-400/10",   glow: "rgba(251,191,36,0.4)",  border: "rgba(251,191,36,0.6)" },
  teal:   { text: "text-emerald-400", bg: "bg-emerald-400/10", glow: "rgba(52,211,153,0.4)",  border: "rgba(52,211,153,0.6)" },
  sky:    { text: "text-sky-400",     bg: "bg-sky-400/10",     glow: "rgba(56,189,248,0.4)",  border: "rgba(56,189,248,0.6)" },
}

// Анимированный счётчик
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

interface Props {
  label: string
  value: number | string
  sub?: string
  icon: string
  color?: keyof typeof COLOR_MAP
}

export function StatCard({ label, value, sub, icon, color = "purple" }: Props) {
  const c = COLOR_MAP[color]
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transition: "transform 0.2s ease, box-shadow 0.2s ease",
        transform: hovered ? "translateY(-3px) scale(1.01)" : "translateY(0) scale(1)",
        boxShadow: hovered ? "0 4px 12px rgba(0,0,0,0.08)" : "none",
      }}
      className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 cursor-default overflow-hidden relative shadow-none"
    >

      <div className="flex items-center justify-between relative">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <span
          className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-base transition-transform duration-200", c.text, c.bg)}
          style={{ transform: hovered ? "rotate(10deg) scale(1.15)" : "rotate(0) scale(1)" }}
        >
          {icon}
        </span>
      </div>

      <div className="relative">
        <p className="text-3xl font-black tracking-tighter leading-none text-foreground">
          <AnimatedNumber value={value} />
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  )
}
