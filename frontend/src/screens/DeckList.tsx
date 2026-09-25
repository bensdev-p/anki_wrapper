import { ArrowRight, ChevronRight, Filter, FolderPlus, LogIn, Plus, Search, Upload, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBackend } from '../backend/context'
import type { CollectionInfo, Counts, DeckNode } from '../backend/types'
import { Button } from '../components/Button'
import { DeckDialogs, type DeckDialogState } from '../components/DeckDialogs'
import { CustomStudyDialog } from '../components/CustomStudyDialog'
import { DeckMenu, type DeckAction } from '../components/DeckMenu'
import { FilteredDeckDialog, type FilteredDialogState } from '../components/FilteredDeckDialog'
import { useToast } from '../components/Toast'
import { BackendError } from '../backend/AnkiBackend'
import { Kbd } from '../components/Kbd'
import { SignInDialog } from '../components/SignInDialog'
import { openAddNote } from '../lib/addNote'
import { openImport } from '../lib/importer'
import { useDecks } from '../lib/decks'
import { navigate } from '../lib/router'
import { load, save } from '../lib/storage'
import { SYNCED_EVENT, useSync } from '../lib/sync'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Burning the midnight oil'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function sumCounts(nodes: DeckNode[]): Counts {
  return nodes.reduce(
    (acc, n) => ({ new: acc.new + n.counts.new, learning: acc.learning + n.counts.learning, review: acc.review + n.counts.review }),
    { new: 0, learning: 0, review: 0 },
  )
}

/** Keep nodes that match every term, plus their ancestors. */
function filterTree(nodes: DeckNode[], terms: string[]): DeckNode[] {
  if (terms.length === 0) return nodes
  const out: DeckNode[] = []
  for (const n of nodes) {
    const hay = n.full_name.toLowerCase()
    const self = terms.every((t) => hay.includes(t))
    const kids = filterTree(n.children, terms)
    if (self || kids.length) out.push({ ...n, children: self && kids.length === 0 ? n.children : kids })
  }
  return out
}

function firstLeafMatch(nodes: DeckNode[], terms: string[]): DeckNode | null {
  for (const n of nodes) {
    const hay = n.full_name.toLowerCase()
    if (terms.every((t) => hay.includes(t))) return n
    const kid = firstLeafMatch(n.children, terms)
    if (kid) return kid
  }
  return null
}

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text
  const lower = text.toLowerCase()
  const marks = new Array(text.length).fill(false)
  for (const t of terms) {
    let i = lower.indexOf(t)
    while (t && i !== -1) {
      for (let k = i; k < i + t.length; k++) marks[k] = true
      i = lower.indexOf(t, i + t.length)
    }
  }
  const parts: ReactNode[] = []
  let i = 0
  while (i < text.length) {
    let j = i
    while (j < text.length && marks[j] === marks[i]) j++
    const chunk = text.slice(i, j)
    parts.push(marks[i] ? <mark key={i}>{chunk}</mark> : chunk)
    i = j
  }
  return parts
}

export function DeckList() {
  const backend = useBackend()
  const { decks, error, reload } = useDecks()
  const [info, setInfo] = useState<CollectionInfo | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>(() => load('collapsed', {}))
  const [signInOpen, setSignInOpen] = useState(false)
  const [dialog, setDialog] = useState<DeckDialogState>(null)
  const [customFor, setCustomFor] = useState<DeckNode | null>(null)
  const [filtered, setFiltered] = useState<FilteredDialogState | null>(null)
  const toast = useToast()
  const { status: sync } = useSync()
  const filterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const refresh = () => void backend.info().then(setInfo, () => {})
    refresh()
    window.addEventListener(SYNCED_EVENT, refresh)
    return () => window.removeEventListener(SYNCED_EVENT, refresh)
  }, [backend])

  // A brand-new desktop collection: point the way to her cards.
  const firstRun = !!info && info.card_count === 0 && !info.is_sample

  // "/" focuses the filter, like many web apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault()
        filterRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query])
  const visible = useMemo(() => (decks ? filterTree(decks, terms) : null), [decks, terms])
  const totals = decks ? sumCounts(decks) : null

  const isCollapsed = (n: DeckNode) => (terms.length ? false : (collapsed[n.id] ?? n.collapsed))
  const toggle = (n: DeckNode) => {
    const next = { ...collapsed, [n.id]: !isCollapsed(n) }
    setCollapsed(next)
    save('collapsed', next)
  }
  const study = (n: DeckNode) => navigate({ name: 'study', deckId: n.id })

  const onDeckAction = (action: DeckAction, deck: DeckNode) => {
    if (action === 'add') openAddNote(deck.id)
    else if (action === 'options') navigate({ name: 'options', deckId: deck.id })
    else if (action === 'rename') setDialog({ kind: 'rename', deck })
    else if (action === 'subdeck') setDialog({ kind: 'create', prefix: `${deck.full_name}::` })
    else if (action === 'custom') setCustomFor(deck)
    else if (action === 'edit-filtered') setFiltered({ deckId: deck.id })
    else if (action === 'rebuild' || action === 'empty') {
      const op = action === 'rebuild' ? backend.rebuildFilteredDeck(deck.id) : backend.emptyFilteredDeck(deck.id).then(() => 0)
      op.then(
        (n) => {
          toast(action === 'rebuild' ? `Rebuilt “${deck.name}”: ${n} cards.` : `Emptied “${deck.name}”. Its cards are back in their decks.`, 'info')
          void reload()
        },
        (err) => toast(err instanceof BackendError ? err.message : 'Something went wrong.', 'error'),
      )
    } else setDialog({ kind: 'delete', deck })
  }

  // "A" adds a card, as in Anki's main window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() === 'a' && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        openAddNote()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const renderNodes = (nodes: DeckNode[], depth: number): ReactNode =>
    nodes.map((n) => {
      const hasKids = n.children.length > 0
      const open = hasKids && !isCollapsed(n)
      return (
        <li key={n.id} role="treeitem" aria-expanded={hasKids ? open : undefined} className="deck">
          <div className="deck__row" style={{ '--depth': depth } as React.CSSProperties}>
            {hasKids ? (
              <button
                className={`deck__toggle ${open ? 'is-open' : ''}`}
                onClick={() => toggle(n)}
                aria-label={open ? `Collapse ${n.name}` : `Expand ${n.name}`}
              >
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            ) : (
              <span className="deck__toggle deck__toggle--leaf" />
            )}
            <button className="deck__main" onClick={() => study(n)} title={`Study ${n.full_name}`}>
              <span className="deck__name">{highlight(n.name, terms)}</span>
              <ArrowRight size={15} className="deck__go" aria-hidden="true" />
            </button>
            <span className={`deck__count count--new ${n.counts.new ? '' : 'count--zero'}`}>{n.counts.new}</span>
            <span className={`deck__count count--learning ${n.counts.learning ? '' : 'count--zero'}`}>{n.counts.learning}</span>
            <span className={`deck__count count--review ${n.counts.review ? '' : 'count--zero'}`}>{n.counts.review}</span>
            <DeckMenu deck={n} onAction={onDeckAction} />
          </div>
          {open && (
            <ul role="group" className="deck__children">
              {renderNodes(n.children, depth + 1)}
            </ul>
          )}
        </li>
      )
    })

  const dueNow = totals ? totals.review + totals.learning : 0

  return (
    <main className="page page--decks">
      <section className="hero">
        <div className="hero__text">
          <p className="eyebrow">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {info?.is_sample && <span className="badge">Sample collection</span>}
          </p>
          <h1 className="hero__title">{greeting()}</h1>
          <p className="hero__sub">
            {totals === null ? (
              <span className="skeleton skeleton--text" style={{ width: 220 }} />
            ) : dueNow + totals.new === 0 ? (
              'All caught up. Nothing due right now.'
            ) : (
              <>
                <strong className="tabular">{dueNow}</strong> due and <strong className="tabular">{totals.new}</strong> new
                cards waiting.
              </>
            )}
          </p>
        </div>
        <dl className="stats">
          {(
            [
              ['New', 'new'],
              ['Learning', 'learning'],
              ['Review', 'review'],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className={`stat stat--${key}`}>
              <dt>{label}</dt>
              <dd className="tabular">{totals ? totals[key] : <span className="skeleton skeleton--num" />}</dd>
            </div>
          ))}
        </dl>
      </section>

      {firstRun && (
        <section className="welcome" aria-label="Get started">
          <h2>Welcome to Rounds</h2>
          {sync?.enabled ? (
            <p>
              You’re signed in to AnkiWeb as <strong>{sync.username}</strong>. Your cards appear here after the next
              sync.
            </p>
          ) : sync?.can_sign_in ? (
            <>
              <p>
                Sign in with your AnkiWeb account to bring over your decks and reviews. Rounds keeps them in sync with
                Anki on your other devices.
              </p>
              <div className="settings-card__actions">
                <Button variant="primary" onClick={() => setSignInOpen(true)}>
                  <LogIn size={16} /> Sign in to AnkiWeb
                </Button>
                <Button variant="secondary" onClick={openImport}>
                  <Upload size={16} /> Import a deck file
                </Button>
              </div>
              <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
            </>
          ) : (
            <p>This collection has no cards yet.</p>
          )}
        </section>
      )}

      <section className="panel" aria-label="Decks">
        <div className="panel__toolbar panel__toolbar--decks">
          <label className="filter">
            <Search size={16} className="filter__icon" aria-hidden="true" />
            <input
              ref={filterRef}
              className="filter__input"
              type="search"
              placeholder="Filter decks"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && decks) {
                  const hit = firstLeafMatch(decks, terms)
                  if (hit) study(hit)
                } else if (e.key === 'Escape') {
                  setQuery('')
                  e.currentTarget.blur()
                }
              }}
              aria-label="Filter decks"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button className="filter__clear" onClick={() => setQuery('')} aria-label="Clear filter">
                <X size={14} />
              </button>
            ) : (
              <Kbd className="filter__kbd">/</Kbd>
            )}
          </label>
          <Button variant="secondary" onClick={() => setFiltered({ deckId: 0 })} title="New filtered deck (study cards matching a search)">
            <Filter size={15} />
            <span className="btn__label btn__label--wide">Filtered deck</span>
          </Button>
          <Button variant="secondary" onClick={() => setDialog({ kind: 'create', prefix: '' })} title="New deck">
            <FolderPlus size={15} />
            <span className="btn__label">New deck</span>
          </Button>
          <Button variant="primary" onClick={() => openAddNote()} title="Add a card (A)">
            <Plus size={15} />
            <span className="btn__label">Add card</span>
          </Button>
        </div>

        <div className="deck-head" aria-hidden="true">
          <span>Deck</span>
          <span className="count--new">New</span>
          <span className="count--learning">Learn</span>
          <span className="count--review">Due</span>
          <span />
        </div>

        {error && !decks ? (
          <div className="empty">
            <p>Couldn’t load decks. Is the backend running?</p>
            <button className="link" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        ) : !visible ? (
          <ul className="deck-tree" aria-busy="true">
            {Array.from({ length: 7 }, (_, i) => (
              <li key={i} className="deck">
                <div className="deck__row deck__row--skeleton" style={{ '--depth': i % 3 === 0 ? 0 : 1 } as React.CSSProperties}>
                  <span className="skeleton skeleton--text" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p>No decks match “{query}”.</p>
          </div>
        ) : (
          <ul className="deck-tree" role="tree" aria-label="Decks">
            {renderNodes(visible, 0)}
          </ul>
        )}
      </section>
      <DeckDialogs
        state={dialog}
        onClose={() => setDialog(null)}
        onChanged={() => void reload()}
      />
      <CustomStudyDialog deck={customFor} onClose={() => setCustomFor(null)} />
      <FilteredDeckDialog state={filtered} onClose={() => setFiltered(null)} onSaved={() => void reload()} />
    </main>
  )
}
