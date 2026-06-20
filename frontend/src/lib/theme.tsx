import { createContext, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light" | "system"

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    // по умолчанию — как в системе; пока пользователь явно не переключил вручную
    () => (localStorage.getItem("theme") as Theme) ?? "system"
  )

  useEffect(() => {
    const root = document.documentElement
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const apply = () => {
      root.classList.remove("light", "dark")
      const resolved = theme === "system" ? (mql.matches ? "dark" : "light") : theme
      root.classList.add(resolved)
    }
    apply()
    // в режиме «system» подхватываем смену темы ОС на лету
    if (theme === "system") {
      mql.addEventListener("change", apply)
      return () => mql.removeEventListener("change", apply)
    }
  }, [theme])

  const setTheme = (t: Theme) => {
    localStorage.setItem("theme", t)
    setThemeState(t)
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
