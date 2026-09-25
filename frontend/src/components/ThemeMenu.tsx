import { Check, Monitor, Palette } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../themes/ThemeProvider'
import { CORE_THEME_IDS, SYSTEM, type Theme } from '../themes/themes'
import { Button } from './Button'

export function ThemeSwatch({ theme }: { theme: Theme }) {
  const t = theme.tokens
  return (
    <span className="swatch" style={{ background: t.bg, borderColor: t['border-strong'] }} aria-hidden="true">
      <span style={{ background: t.surface }} />
      <span style={{ background: t.accent }} />
    </span>
  )
}

export function ThemeMenu() {
  const { choice, themes, setChoice } = useTheme()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (id: string) => {
    setChoice(id)
    setOpen(false)
  }

  return (
    <div className="menu-root" ref={root}>
      <Button
        variant="ghost"
        iconOnly
        aria-label="Theme"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Theme"
        onClick={() => setOpen((o) => !o)}
      >
        <Palette size={18} strokeWidth={1.8} />
      </Button>
      {open && (
        <div className="menu theme-menu" role="menu" aria-label="Theme">
          <button role="menuitemradio" aria-checked={choice === SYSTEM} className="menu__item" onClick={() => pick(SYSTEM)}>
            <span className="swatch swatch--icon">
              <Monitor size={14} />
            </span>
            <span className="menu__text">
              <span>System</span>
              <span className="menu__hint">Match light / dark setting</span>
            </span>
            {choice === SYSTEM && <Check size={16} className="menu__check" />}
          </button>
          {[
            ['Rounds', themes.filter((t) => CORE_THEME_IDS.includes(t.id))],
            ['Editor themes', themes.filter((t) => !CORE_THEME_IDS.includes(t.id))],
          ].map(([label, list]) => (
            <div key={label as string} role="group" aria-label={label as string}>
              <div className="menu__label">{label as string}</div>
              {(list as Theme[]).map((t) => (
                <button
                  key={t.id}
                  role="menuitemradio"
                  aria-checked={choice === t.id}
                  className="menu__item"
                  onClick={() => pick(t.id)}
                >
                  <ThemeSwatch theme={t} />
                  <span className="menu__text">
                    <span>{t.name}</span>
                    <span className="menu__hint">{t.description}</span>
                  </span>
                  {choice === t.id && <Check size={16} className="menu__check" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
