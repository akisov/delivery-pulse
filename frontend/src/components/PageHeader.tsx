import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { SectionInfo } from "@/components/SectionInfo"

// Единая шапка раздела: иконка + заголовок + подзаголовок слева, действия + «Как считается» справа.
export function PageHeader({ icon: Icon, title, subtitle, info, children }: {
  icon?: LucideIcon
  title: string
  subtitle?: ReactNode
  info?: string          // ключ раздела для информера «Как считается»
  children?: ReactNode   // действия раздела (вкладки, «Обновить», «Настройки» и т.п.)
}) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-foreground flex items-center gap-2.5">
          {Icon && <Icon className="w-7 h-7 text-primary shrink-0" />}{title}
        </h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {(children || info) && (
        <div className="flex items-center gap-2 flex-wrap">
          {children}
          {info && <SectionInfo section={info} />}
        </div>
      )}
    </div>
  )
}
