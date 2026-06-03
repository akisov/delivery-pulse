import { cn } from "@/lib/utils"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive"
  size?: "default" | "sm" | "lg" | "icon"
}

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold",
        "transition-all duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:pointer-events-none",
        "active:scale-[0.97]",
        {
          "bg-primary text-primary-foreground hover:brightness-110 hover:shadow-[0_4px_20px_rgba(108,99,255,0.45)] hover:-translate-y-0.5":
            variant === "default",
          "border border-border bg-transparent text-foreground hover:bg-accent hover:border-primary/50 hover:shadow-[0_2px_12px_rgba(108,99,255,0.15)] hover:-translate-y-0.5":
            variant === "outline",
          "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground":
            variant === "ghost",
          "bg-destructive/15 text-destructive hover:bg-destructive/25":
            variant === "destructive",
        },
        {
          "h-10 px-4 text-sm": size === "default",
          "h-8 px-3 text-xs": size === "sm",
          "h-12 px-6 text-base": size === "lg",
          "h-9 w-9 p-0": size === "icon",
        },
        className
      )}
      {...props}
    />
  )
}
