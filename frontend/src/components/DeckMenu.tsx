import { FolderPlus, MoreHorizontal, PenLine, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DeckNode } from '../backend/types'

export type DeckAction = 'add' | 'options' | 'rename' | 'subdeck' | 'delete'

function Item({ icon, label, danger, onClick }: { icon: ReactNode; label: string; danger?: boolean; onClick(): void }) {
  return (
    <button role="menuitem" className={`menu__item menu__item--compact ${danger ? 'menu__item--danger' : ''}`} onClick={onClick}>
      <span className="menu__icon">{icon}</span>
      <span className="menu__text">{label}</span>
    </button>
  )
}

/** The "⋯" button on each deck row. Always visible (no hover-only actions). */
export function DeckMenu({ deck, onAction }: { deck: DeckNode; onAction(action: DeckAction, deck: DeckNode): void }) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
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

  const run = (a: DeckAction) => {
    setOpen(false)
    onAction(a, deck)
  }

  return (
    <div className={`menu-root deck__menu ${open ? 'is-open' : ''}`} ref={root}>
      <button
        className="deck__more"
        aria-label={`${deck.name} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          // Open upwards when there isn't room below (e.g. above the phone's tab bar).
          const rect = e.currentTarget.getBoundingClientRect()
          setUp(window.innerHeight - rect.bottom < 300)
          setOpen((o) => !o)
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className={`menu deck-menu ${up ? 'deck-menu--up' : ''}`} role="menu" aria-label={deck.name}>
          {!deck.filtered && <Item icon={<Plus size={15} />} label="Add cards" onClick={() => run('add')} />}
          {!deck.filtered && <Item icon={<SlidersHorizontal size={15} />} label="Options" onClick={() => run('options')} />}
          <Item icon={<PenLine size={15} />} label="Rename or move…" onClick={() => run('rename')} />
          {!deck.filtered && <Item icon={<FolderPlus size={15} />} label="New subdeck…" onClick={() => run('subdeck')} />}
          <div className="menu__sep" />
          <Item icon={<Trash2 size={15} />} label="Delete…" danger onClick={() => run('delete')} />
        </div>
      )}
    </div>
  )
}
