import { ArrowDown, ArrowUp, Check, Flag, Info, PenLine, Search, Star, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { BrowseActionKind, BrowseRow, BrowseSelection, BrowseSort, RenderedCard } from '../backend/types'
import { FLAG_NAMES } from '../components/ActionsMenu'
import { Button } from '../components/Button'
import { CardFrame } from '../components/card/CardFrame'
import { CardInfoPanel } from '../components/CardInfoPanel'
import { Dialog } from '../components/Dialog'
import { NoteEditor } from '../components/editor/NoteEditor'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { fmt } from '../components/charts/util'
import { useBrowse } from '../lib/browse'
import { flattenDecks, useDecks } from '../lib/decks'
import { modKey } from '../lib/platform'
import { navigate } from '../lib/router'
import { useTheme } from '../themes/ThemeProvider'

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'is:due', label: 'Due' },
  { key: 'is:new', label: 'New' },
  { key: 'is:learn', label: 'Learning' },
  { key: 'is:suspended', label: 'Suspended' },
  { key: '-flag:0', label: 'Flagged' },
  { key: 'tag:marked', label: 'Marked' },
  { key: 'tag:leech', label: 'Leeches' },
]

interface Column {
  key: BrowseSort
  label: string
  cell(r: BrowseRow): string
  className?: string
}

function interval(days: number): string {
  if (!days) return '—'
  if (days < 31) return `${days}d`
  if (days < 365) return `${(days / 30.4).toFixed(1)}mo`
  return `${(days / 365).toFixed(1)}y`
}

const ROW_H = 44
const ROW_H_MOBILE = 64
const OVERSCAN = 8
const CONFIRM_OVER = 50 // ask before changing more cards than this at once

const useIsNarrow = () => {
  const q = '(max-width: 900px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

export function Browser({ initialQuery }: { initialQuery: string }) {
  const backend = useBackend()
  const toast = useToast()
  const { theme } = useTheme()
  const { decks } = useDecks()
  const narrow = useIsNarrow()

  // Search = deck ∧ quick filter ∧ free text (Anki search syntax).
  const [text, setText] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [filter, setFilter] = useState('')
  const [deck, setDeck] = useState('')
  const [sort, setSort] = useState<BrowseSort>('noteFld')
  const [reverse, setReverse] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(text), 250)
    return () => window.clearTimeout(id)
  }, [text])
  const query = useMemo(
    () => [deck && `"deck:${deck.replace(/"/g, '\\"')}"`, filter, debounced.trim()].filter(Boolean).join(' '),
    [deck, filter, debounced],
  )
  useEffect(() => {
    navigate({ name: 'browse', q: debounced.trim() }, { replace: true })
  }, [debounced])

  const data = useBrowse(query, sort, reverse)
  const total = data.total ?? 0

  // Selection: explicit ids, or "every card matching".
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [allMatching, setAllMatching] = useState(false)
  const [focus, setFocus] = useState<number | null>(null) // row index shown in preview
  const anchor = useRef<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  useEffect(() => {
    setSelected(new Set())
    setAllMatching(false)
    setFocus(null)
  }, [query, sort, reverse])
  const selectionCount = allMatching ? total : selected.size
  const focusRow = focus !== null ? data.rowAt(focus) : undefined

  // Virtual scrolling
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(600)
  const rowH = narrow ? ROW_H_MOBILE : ROW_H
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const first = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN)
  const last = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN)
  const { ensure } = data
  useEffect(() => {
    if (data.total !== null) ensure(first, last)
  }, [ensure, first, last, data.total])
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
    setScrollTop(0)
  }, [query, sort, reverse])

  const columns: Column[] = [
    { key: 'noteFld', label: 'Card', cell: (r) => r.text, className: 'col-text' },
    { key: 'deck', label: 'Deck', cell: (r) => r.deck.split('::').slice(-2).join(' › '), className: 'col-deck' },
    { key: 'cardDue', label: 'Due', cell: (r) => r.due ?? '—', className: 'col-num' },
    { key: 'cardIvl', label: 'Interval', cell: (r) => interval(r.interval_days), className: 'col-num' },
    data.fsrs
      ? { key: 'difficulty', label: 'Difficulty', cell: (r) => (r.difficulty === null ? '—' : `${Math.round(r.difficulty * 100)}%`), className: 'col-num' }
      : { key: 'cardEase', label: 'Ease', cell: (r) => (r.ease ? `${r.ease / 10}%` : '—'), className: 'col-num' },
    { key: 'cardReps', label: 'Reviews', cell: (r) => String(r.reviews), className: 'col-num' },
    { key: 'cardLapses', label: 'Lapses', cell: (r) => String(r.lapses), className: 'col-num' },
  ]

  const onHeader = (key: BrowseSort) => {
    if (key === sort) setReverse((r) => !r)
    else {
      setSort(key)
      setReverse(false)
    }
  }

  const onRowClick = (e: MouseEvent, i: number, row: BrowseRow | undefined) => {
    if (!row) return
    if (narrow && !selectMode) return setFocus(i) // phone: tap opens the preview
    const toggle = e.metaKey || e.ctrlKey || selectMode
    setAllMatching(false)
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      const next = new Set(selected)
      for (let k = a; k <= b; k++) {
        const r = data.rowAt(k)
        if (r) next.add(r.card_id)
      }
      setSelected(next)
    } else if (toggle) {
      const next = new Set(selected)
      if (next.has(row.card_id)) next.delete(row.card_id)
      else next.add(row.card_id)
      setSelected(next)
      anchor.current = i
    } else {
      setSelected(new Set([row.card_id]))
      anchor.current = i
    }
    if (!selectMode || !narrow) setFocus(i)
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = Math.min(total - 1, Math.max(0, (focus ?? -1) + (e.key === 'ArrowDown' ? 1 : -1)))
    const row = data.rowAt(next)
    setFocus(next)
    anchor.current = next
    if (row) setSelected(new Set([row.card_id]))
    const top = next * rowH
    const el = scroller.current
    if (el && (top < el.scrollTop || top + rowH > el.scrollTop + el.clientHeight)) el.scrollTop = top - el.clientHeight / 2
  }

  // Bulk actions
  const [pending, setPending] = useState<{ action: BrowseActionKind; value?: string | number; label: string } | null>(null)
  const [prompt, setPrompt] = useState<{ action: 'add_tags' | 'remove_tags' | 'set_due'; value: string } | null>(null)
  const selection = (): BrowseSelection =>
    allMatching ? { query, sort, reverse } : { card_ids: [...selected] }

  const run = useCallback(
    async (action: BrowseActionKind, value: string | number | undefined, label: string) => {
      try {
        const n = await backend.browseAction(selection(), action, value)
        toast(`${label} · ${fmt(n)} ${action.includes('tags') ? 'notes' : 'cards'} · ${modKey}Z to undo`)
        data.reload()
      } catch (e) {
        toast(e instanceof BackendError ? e.message : 'That didn’t work.', 'error')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, allMatching, selected, query, sort, reverse],
  )
  const act = (action: BrowseActionKind, label: string, value?: string | number) => {
    if (selectionCount > CONFIRM_OVER) setPending({ action, value, label })
    else void run(action, value, label)
  }

  // Undo (Cmd/Ctrl+Z) and select-all (Cmd/Ctrl+A) while browsing.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || document.querySelector('dialog[open]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        backend.undo().then(
          (r) => {
            toast(`Undid ${r.result.undone.toLowerCase()}`)
            data.reload()
          },
          () => toast('Nothing to undo'),
        )
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setAllMatching(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [backend, data, toast])

  // Preview
  const [preview, setPreview] = useState<RenderedCard | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [sheet, setSheet] = useState<'info' | 'edit' | null>(null)
  useEffect(() => {
    if (!focusRow) return setPreview(null)
    let cancelled = false
    backend.renderCard(focusRow.card_id).then((r) => {
      if (cancelled) return
      setPreview(r)
      setPreviewKey((k) => k + 1)
    })
    return () => {
      cancelled = true
    }
  }, [backend, focusRow?.card_id]) // eslint-disable-line react-hooks/exhaustive-deps
  const mediaBase = useMemo(() => backend.mediaBaseUrl(), [backend])
  const noop = useCallback(() => {}, [])

  const previewBody = focusRow && (
    <div className="browse-preview__body">
      <div className="browse-preview__card">
        {preview ? (
          <CardFrame
            renderKey={`p${previewKey}`}
            rendered={preview}
            side="answer"
            scrollToAnswer={false}
            theme={theme}
            mediaBaseUrl={mediaBase}
            onKey={noop}
            onTap={noop}
            onPlay={noop}
          />
        ) : (
          <div className="chart-skeleton" style={{ height: '100%' }} />
        )}
      </div>
      <div className="browse-preview__meta">
        <span>{focusRow.deck}</span>
        <span>
          {focusRow.template} · {focusRow.state}
        </span>
        {focusRow.tags.length > 0 && <span className="browse-preview__tags">{focusRow.tags.join('  ')}</span>}
      </div>
      <div className="browse-preview__actions">
        <Button size="sm" onClick={() => setSheet('edit')}>
          <PenLine size={14} /> Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSheet('info')}>
          <Info size={14} /> Info
        </Button>
      </div>
    </div>
  )

  const allDecks = decks ? flattenDecks(decks) : []
  const bodyH = total * rowH

  return (
    <main className={`page page--browse ${selectionCount > 0 ? 'has-bulk' : ''}`}>
      <header className="browse-head">
        <div className="browse-search">
          <Search size={16} className="filter__icon" aria-hidden="true" />
          <input
            className="filter__input"
            type="search"
            value={text}
            placeholder="Search with Anki syntax: heart failure, tag:#AK_Step1, prop:ivl>30"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setDebounced(text)}
            aria-label="Search cards"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {text && (
            <button className="filter__clear" onClick={() => setText('')} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="browse-filters">
          <div className="chips" role="radiogroup" aria-label="Quick filter">
            {FILTERS.map((f) => (
              <button key={f.key} role="radio" aria-checked={filter === f.key} className="chip" onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="select">
            <span className="visually-hidden">Deck</span>
            <select value={deck} onChange={(e) => setDeck(e.target.value)}>
              <option value="">All decks</option>
              {allDecks.map((d) => (
                <option key={d.id} value={d.full_name}>
                  {' '.repeat(d.level - 1)}
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="browse-status" aria-live="polite">
          {data.error ? (
            <span className="browse-status__error">{data.error}</span>
          ) : data.total === null ? (
            <span className="skeleton skeleton--text" style={{ width: 90 }} />
          ) : (
            <span>
              <strong>{fmt(total)}</strong> {total === 1 ? 'card' : 'cards'}
            </span>
          )}
          {narrow && (
            <button className="link" onClick={() => setSelectMode((m) => !m)}>
              {selectMode ? 'Done' : 'Select'}
            </button>
          )}
        </div>
      </header>

      <div className={`browse ${focusRow && !narrow ? 'has-preview' : ''}`}>
        <div className={`browse-table ${data.loading && data.total !== null ? 'is-stale' : ''}`}>
          {!narrow && (
            <div className="browse-row browse-row--head" role="row">
              <span className="col-check" />
              {columns.map((c) => (
                <button
                  key={c.key}
                  className={`${c.className ?? ''} browse-sort ${sort === c.key ? 'is-active' : ''}`}
                  onClick={() => onHeader(c.key)}
                  aria-sort={sort === c.key ? (reverse ? 'descending' : 'ascending') : 'none'}
                >
                  {c.label}
                  {sort === c.key && (reverse ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
                </button>
              ))}
            </div>
          )}
          <div
            className="browse-scroll"
            ref={scroller}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            tabIndex={0}
            role="grid"
            aria-rowcount={total}
            aria-label="Cards"
            onKeyDown={onListKey}
          >
            {data.total === 0 ? (
              <div className="empty">
                <p>No cards match this search.</p>
              </div>
            ) : (
              <div style={{ height: bodyH, position: 'relative' }}>
                {Array.from({ length: Math.max(0, last - first) }, (_, k) => {
                  const i = first + k
                  const row = data.rowAt(i)
                  const isSel = !!row && (allMatching || selected.has(row.card_id))
                  return (
                    <div
                      key={i}
                      role="row"
                      aria-rowindex={i + 1}
                      aria-selected={isSel}
                      className={`browse-row ${isSel ? 'is-selected' : ''} ${focus === i ? 'is-focus' : ''} ${row ? `state-${row.state}` : ''}`}
                      style={{ top: i * rowH, height: rowH }}
                      onClick={(e) => onRowClick(e, i, row)}
                    >
                      {!row ? (
                        <span className="skeleton skeleton--text browse-row__skeleton" />
                      ) : narrow ? (
                        <>
                          {selectMode && <span className={`check ${isSel ? 'is-on' : ''}`}>{isSel && <Check size={12} />}</span>}
                          <span className="browse-item">
                            <span className="browse-item__text">
                              {row.flag > 0 && <Flag size={12} fill={`var(--flag-${row.flag})`} color={`var(--flag-${row.flag})`} />}
                              {row.marked && <Star size={12} className="browse-star" fill="currentColor" />}
                              {row.text}
                            </span>
                            <span className="browse-item__meta">
                              {row.deck.split('::').slice(-1)[0]} · {row.state === 'suspended' ? 'Suspended' : row.due} · {interval(row.interval_days)}
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="col-check">
                            <span className={`check ${isSel ? 'is-on' : ''}`}>{isSel && <Check size={12} />}</span>
                          </span>
                          {columns.map((c) => (
                            <span key={c.key} className={c.className}>
                              {c.key === 'noteFld' && (
                                <>
                                  {row.flag > 0 && (
                                    <Flag size={12} fill={`var(--flag-${row.flag})`} color={`var(--flag-${row.flag})`} aria-label={`${FLAG_NAMES[row.flag]} flag`} />
                                  )}
                                  {row.marked && <Star size={12} className="browse-star" fill="currentColor" aria-label="Marked" />}
                                  {row.state === 'suspended' && <span className="state-badge">Suspended</span>}
                                  {row.state === 'buried' && <span className="state-badge">Buried</span>}
                                </>
                              )}
                              <span className="cell-text">{c.cell(row)}</span>
                            </span>
                          ))}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {!narrow && focusRow && (
          <aside className="browse-preview" aria-label="Preview">
            {previewBody}
          </aside>
        )}
      </div>

      {selectionCount > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected cards">
          <span className="bulk-bar__count">
            <strong>{fmt(selectionCount)}</strong> selected
            {!allMatching && total > selected.size && selected.size > 0 && (
              <button className="link" onClick={() => setAllMatching(true)}>
                Select all {fmt(total)}
              </button>
            )}
          </span>
          <div className="bulk-bar__actions">
            <Button size="sm" onClick={() => act('suspend', 'Suspended')}>
              Suspend
            </Button>
            <Button size="sm" onClick={() => act('unsuspend', 'Unsuspended')}>
              Unsuspend
            </Button>
            <Button size="sm" onClick={() => setPrompt({ action: 'add_tags', value: '' })}>
              Add tags
            </Button>
            <Button size="sm" onClick={() => setPrompt({ action: 'remove_tags', value: '' })}>
              Remove tags
            </Button>
            <Button size="sm" onClick={() => setPrompt({ action: 'set_due', value: '0' })}>
              Set due…
            </Button>
            <span className="bulk-flags" role="group" aria-label="Flag">
              {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <button
                  key={n}
                  className="flag-dot"
                  style={{ '--flag': `var(--flag-${n})` } as React.CSSProperties}
                  title={`${FLAG_NAMES[n]} flag`}
                  aria-label={`${FLAG_NAMES[n]} flag`}
                  onClick={() => act('flag', `${FLAG_NAMES[n]} flag`, n)}
                >
                  <Flag size={13} fill="currentColor" />
                </button>
              ))}
              <button className="flag-dot" title="Remove flag" aria-label="Remove flag" onClick={() => act('flag', 'Flag removed', 0)}>
                <X size={13} />
              </button>
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected(new Set())
              setAllMatching(false)
            }}
          >
            Clear
          </Button>
        </div>
      )}

      {narrow && (
        <Sheet open={!!focusRow && !sheet} onClose={() => setFocus(null)} title="Preview" subtitle={focusRow?.deck}>
          {previewBody}
        </Sheet>
      )}

      <Dialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={`${pending?.label ?? ''}: ${fmt(selectionCount)} cards?`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const p = pending
                setPending(null)
                if (p) void run(p.action, p.value, p.label)
              }}
            >
              Apply to {fmt(selectionCount)}
            </Button>
          </>
        }
      >
        <p>This changes {fmt(selectionCount)} cards. You can undo it right after with {modKey}Z.</p>
      </Dialog>

      <Dialog
        open={!!prompt}
        onClose={() => setPrompt(null)}
        title={prompt?.action === 'set_due' ? 'Set due date' : prompt?.action === 'add_tags' ? 'Add tags' : 'Remove tags'}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!prompt?.value.trim()}
              onClick={() => {
                const p = prompt
                setPrompt(null)
                if (!p) return
                const label = p.action === 'set_due' ? 'Due date set' : p.action === 'add_tags' ? 'Tags added' : 'Tags removed'
                act(p.action, label, p.value.trim())
              }}
            >
              Apply
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ;(e.currentTarget.closest('dialog')?.querySelector('.dialog__actions .btn--primary') as HTMLButtonElement | null)?.click()
          }}
        >
          <input
            className="dialog-input"
            autoFocus
            value={prompt?.value ?? ''}
            onChange={(e) => setPrompt((p) => (p ? { ...p, value: e.target.value } : p))}
            placeholder={prompt?.action === 'set_due' ? '0 = today, 1-7 = within a week' : 'space-separated tags'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </form>
        <p className="dialog-hint">
          {prompt?.action === 'set_due'
            ? 'Anki’s Set Due Date: a number of days, or a range like 1-7. Add ! to also set the interval.'
            : `Applies to the notes of the ${fmt(selectionCount)} selected cards.`}
        </p>
      </Dialog>

      <CardInfoPanel cardId={focusRow?.card_id ?? null} open={sheet === 'info'} onClose={() => setSheet(null)} />
      <NoteEditor
        noteId={focusRow?.note_id ?? null}
        open={sheet === 'edit'}
        onClose={() => setSheet(null)}
        onSaved={() => {
          toast('Note saved')
          data.reload()
          if (focusRow) backend.renderCard(focusRow.card_id).then((r) => (setPreview(r), setPreviewKey((k) => k + 1)))
        }}
      />
    </main>
  )
}

