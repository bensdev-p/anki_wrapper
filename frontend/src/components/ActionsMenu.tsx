import { EyeOff, Flag, Info, MoreHorizontal, Pause, PenLine, Star, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FLAG_NAMES } from '../lib/flags'
import { isApple } from '../lib/platform'
import { Button } from './Button'
import { Kbd } from './Kbd'

export type CardAction =
  | { kind: 'flag'; flag: number }
  | { kind: 'mark' }
  | { kind: 'edit' }
  | { kind: 'info' }
  | { kind: 'replay' }
  | { kind: 'bury'; note: boolean }
  | { kind: 'suspend'; note: boolean }

// Ctrl+1–7, as Anki desktop (Ctrl avoids Safari's ⌘1–9 bookmark shortcuts).
const flagKey = (n: number) => `${isApple ? '⌃' : 'Ctrl+'}${n}`

interface Props {
  flag: number
  marked: boolean
  hasAudio: boolean
  disabled: boolean
  onAction(action: CardAction): void
}

function Item({ icon, label, shortcut, onClick }: { icon: ReactNode; label: string; shortcut: string; onClick(): void }) {
  return (
    <button role="menuitem" className="menu__item menu__item--compact" onClick={onClick}>
      <span className="menu__icon">{icon}</span>
      <span className="menu__text">{label}</span>
      <Kbd>{shortcut}</Kbd>
    </button>
  )
}

/** Everything you can do to the current card, with Anki's shortcuts shown. */
export function ActionsMenu({ flag, marked, hasAudio, disabled, onAction }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const run = (a: CardAction) => {
    setOpen(false)
    onAction(a)
  }

  return (
    <div className="menu-root" ref={root}>
      <Button
        variant="ghost"
        iconOnly
        disabled={disabled}
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Card actions"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={18} />
      </Button>
      {open && (
        <div className="menu actions-menu" role="menu" aria-label="Card actions">
          <div className="menu__label">Flag</div>
          <div className="flag-row" role="group" aria-label="Flag">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button
                key={n}
                role="menuitemcheckbox"
                aria-checked={flag === n}
                className={`flag-dot ${flag === n ? 'is-on' : ''}`}
                style={{ '--flag': `var(--flag-${n})` } as React.CSSProperties}
                title={`${FLAG_NAMES[n]} flag (${flagKey(n)})`}
                aria-label={`${FLAG_NAMES[n]} flag`}
                onClick={() => run({ kind: 'flag', flag: n })}
              >
                <Flag size={13} fill="currentColor" />
              </button>
            ))}
          </div>
          <div className="menu__sep" />
          <Item icon={<Star size={15} fill={marked ? 'currentColor' : 'none'} />} label={marked ? 'Unmark note' : 'Mark note'} shortcut="*" onClick={() => run({ kind: 'mark' })} />
          <Item icon={<PenLine size={15} />} label="Edit note" shortcut="E" onClick={() => run({ kind: 'edit' })} />
          <Item icon={<Info size={15} />} label="Card info" shortcut="I" onClick={() => run({ kind: 'info' })} />
          {hasAudio && <Item icon={<Volume2 size={15} />} label="Replay audio" shortcut="R" onClick={() => run({ kind: 'replay' })} />}
          <div className="menu__sep" />
          <Item icon={<EyeOff size={15} />} label="Bury card" shortcut="-" onClick={() => run({ kind: 'bury', note: false })} />
          <Item icon={<EyeOff size={15} />} label="Bury note" shortcut="=" onClick={() => run({ kind: 'bury', note: true })} />
          <Item icon={<Pause size={15} />} label="Suspend card" shortcut="@" onClick={() => run({ kind: 'suspend', note: false })} />
          <Item icon={<Pause size={15} />} label="Suspend note" shortcut="!" onClick={() => run({ kind: 'suspend', note: true })} />
        </div>
      )}
    </div>
  )
}
