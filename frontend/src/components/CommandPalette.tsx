import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Command } from "cmdk"
import { Home, Lock, AlertTriangle, Landmark, Target, Workflow, Truck, RefreshCw, Search } from "lucide-react"
import type { LucideIcon } from "lucide-react"

export type Section = "home" | "blockings" | "incidents" | "arch" | "sle" | "flow" | "osp"

const ITEMS: { section: Section; label: string; icon: LucideIcon; hint: string }[] = [
  { section: "home",      label: "Главная",     icon: Home,          hint: "обзор · релиз-ноты" },
  { section: "blockings", label: "Блокировки",  icon: Lock,          hint: "время разрешения · причины" },
  { section: "incidents", label: "Инциденты",   icon: AlertTriangle, hint: "по месяцам · причины · топы" },
  { section: "arch",      label: "Арх. комитет", icon: Landmark,      hint: "возвраты · воронка · цикл" },
  { section: "sle",       label: "Анализ SLE",  icon: Target,        hint: "риски · кластеры причин" },
  { section: "flow",      label: "Поток E2E",   icon: Workflow,      hint: "WIP Age · лимиты" },
  { section: "osp",       label: "ОСП",         icon: Truck,         hint: "обзор сервиса поставки" },
]

const headingCls =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] " +
  "[&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest " +
  "[&_[cmdk-group-heading]]:text-muted-foreground"
const itemCls =
  "flex items-center gap-3 rounded-lg px-2 py-2 text-sm cursor-pointer select-none transition-colors " +
  "aria-selected:bg-primary/15 aria-selected:text-primary text-foreground"

export function CommandPalette({ open, onClose, onNavigate, onSync }: {
  open: boolean
  onClose: () => void
  onNavigate: (s: Section) => void
  onSync: () => void
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", h)
    return () => document.removeEventListener("keydown", h)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh] animate-fade-in-up" style={{ animationDuration: "0.15s" }}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <Command loop label="Командная палитра"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Command.Input autoFocus placeholder="Поиск раздела или действия…"
            className="w-full bg-transparent py-3.5 text-sm text-foreground outline-none placeholder:text-muted-foreground" />
        </div>
        <Command.List className="max-h-[340px] overflow-y-auto p-2">
          <Command.Empty className="py-8 text-center text-sm text-muted-foreground">Ничего не найдено</Command.Empty>
          <Command.Group heading="Разделы" className={headingCls}>
            {ITEMS.map(it => (
              <Command.Item key={it.section} value={`${it.label} ${it.hint}`}
                onSelect={() => onNavigate(it.section)} className={itemCls}>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/70">
                  <it.icon className="h-4 w-4" />
                </span>
                <span className="font-semibold">{it.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{it.hint}</span>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Действия" className={headingCls}>
            <Command.Item value="синк синхронизация обновить трекер" onSelect={onSync} className={itemCls}>
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/70">
                <RefreshCw className="h-4 w-4" />
              </span>
              <span className="font-semibold">Запустить синк</span>
              <span className="ml-auto text-xs text-muted-foreground">обновить данные из Трекера</span>
            </Command.Item>
          </Command.Group>
        </Command.List>
        <div className="flex gap-3 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
          <span><kbd className="font-sans">↑↓</kbd> навигация</span>
          <span><kbd className="font-sans">↵</kbd> выбрать</span>
          <span><kbd className="font-sans">esc</kbd> закрыть</span>
        </div>
      </Command>
    </div>,
    document.body
  )
}
