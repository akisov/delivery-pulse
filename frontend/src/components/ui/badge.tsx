import { cn } from "@/lib/utils"

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div className={cn(
      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
      {
        "border-transparent bg-primary/20 text-primary": variant === "default",
        "border-transparent bg-secondary text-secondary-foreground": variant === "secondary",
        "border-transparent bg-destructive/20 text-destructive": variant === "destructive",
        "border-border text-muted-foreground": variant === "outline",
        "border-transparent bg-emerald-500/20 text-emerald-400": variant === "success",
        "border-transparent bg-amber-500/20 text-amber-400": variant === "warning",
      },
      className
    )} {...props} />
  )
}
