import { Sun, Moon, Monitor, type LucideIcon } from "lucide-react"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

type Mode = "system" | "light" | "dark"
const MODES: [Mode, LucideIcon, string][] = [
  ["system", Monitor, "Как в системе"],
  ["light", Sun, "Светлая"],
  ["dark", Moon, "Тёмная"],
]

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const mql = window.matchMedia("(prefers-color-scheme: dark)")
  const resolve = (m: Mode) => (m === "system" ? (mql.matches ? "dark" : "light") : m)

  const pick = (e: React.MouseEvent<HTMLButtonElement>, m: Mode) => {
    if (m === theme) return
    const apply = () => {
      const r = resolve(m)
      const root = document.documentElement
      root.classList.remove("light", "dark")
      root.classList.add(r)
      setTheme(m)
    }
    const startVT = (document as any).startViewTransition?.bind(document)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    // анимируем «наплыв» только когда реально меняется цвет (light↔dark)
    if (!startVT || reduce || resolve(theme as Mode) === resolve(m)) { apply(); return }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    const t = startVT(apply)
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 550, easing: "cubic-bezier(.4,0,.2,1)", pseudoElement: "::view-transition-new(root)" }
      )
    }).catch(() => {})
  }

  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary p-0.5", className)}>
      {MODES.map(([m, Icon, label]) => {
        const active = theme === m
        return (
          <button key={m} onClick={e => pick(e, m)} title={label} aria-label={label}
            className={cn(
              "flex items-center justify-center w-7 h-7 rounded-full transition-all active:scale-95",
              active
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}>
            <Icon className="w-3.5 h-3.5" />
          </button>
        )
      })}
    </div>
  )
}
