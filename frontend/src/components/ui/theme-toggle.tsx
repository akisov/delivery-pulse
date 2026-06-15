import { Sun, Moon } from "lucide-react"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    const next = isDark ? "light" : "dark"
    const apply = () => {
      // меняем класс синхронно (чтобы снимок «новой» темы был сразу верным) + сохраняем в состояние
      const root = document.documentElement
      root.classList.remove("light", "dark")
      root.classList.add(next)
      setTheme(next)
    }
    const startVT = (document as any).startViewTransition?.bind(document)
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!startVT || reduce) { apply(); return }

    // круг раскрытия из центра кнопки до самого дальнего угла экрана
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
    <button
      onClick={toggle}
      title={isDark ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
      className={cn(
        "relative h-9 w-16 rounded-full border border-border bg-secondary",
        "transition-all duration-300 ease-out",
        "hover:border-primary/50 hover:shadow-[0_2px_12px_rgba(108,99,255,0.2)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "active:scale-[0.96]",
        className
      )}
    >
      <span className={cn(
        "absolute inset-[3px] rounded-full transition-all duration-300",
        isDark ? "bg-primary/10" : "bg-amber-400/15"
      )} />
      <span className={cn(
        "absolute top-[3px] h-[26px] w-[26px] rounded-full flex items-center justify-center",
        "shadow-sm transition-all duration-300 ease-out",
        isDark
          ? "left-[3px] bg-secondary border border-border"
          : "left-[calc(100%-29px)] bg-amber-400/90 border border-amber-300"
      )}>
        {isDark
          ? <Moon className="w-3.5 h-3.5 text-primary" />
          : <Sun className="w-3.5 h-3.5 text-amber-900" />
        }
      </span>
    </button>
  )
}
