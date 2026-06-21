import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className, sideOffset = 6, ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-[70] max-w-xs rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-foreground shadow-[0_8px_30px_rgba(0,0,0,0.35)]",
          "data-[state=delayed-open]:animate-fade-in-up data-[side=bottom]:data-[state=delayed-open]:animate-fade-in-up",
          className
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  )
}

// Удобная обёртка: <SimpleTooltip label="...">{trigger}</SimpleTooltip>
export function SimpleTooltip({ label, children, side = "bottom" }: {
  label: React.ReactNode
  children: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
