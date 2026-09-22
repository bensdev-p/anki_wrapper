import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { load, save } from '../lib/storage'
import { SYSTEM, THEMES, resolveTheme, themeCss, type Theme, type ThemeChoice } from './themes'

interface ThemeContextValue {
  /** What the user picked: a theme id or "system". */
  choice: ThemeChoice
  /** The theme actually in effect. */
  theme: Theme
  themes: Theme[]
  setChoice(choice: ThemeChoice): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => load('theme', SYSTEM))
  const [prefersDark, setPrefersDark] = useState(media.matches)

  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(choice, prefersDark)

  useLayoutEffect(() => {
    const css = themeCss(theme)
    let style = document.getElementById('theme-vars') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'theme-vars'
      document.head.appendChild(style)
    }
    style.textContent = css
    document.documentElement.dataset.themeKind = theme.kind
    // Tints Safari's toolbar / status bar to match.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.tokens.bg)
    // index.html applies this before first paint on the next load (no flash).
    save('theme-css', css)
  }, [theme])

  const value = useMemo<ThemeContextValue>(
    () => ({
      choice,
      theme,
      themes: THEMES,
      setChoice(next) {
        setChoiceState(next)
        save('theme', next)
      },
    }),
    [choice, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme() outside <ThemeProvider>')
  return ctx
}
