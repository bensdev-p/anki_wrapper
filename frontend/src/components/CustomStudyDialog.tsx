import { useEffect, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { CramKind, CustomStudyInfo, CustomStudyKind, DeckNode } from '../backend/types'
import { navigate } from '../lib/router'
import { Button } from './Button'
import { Dialog } from './Dialog'

const OPTIONS: { kind: CustomStudyKind; label: string; unit: string; help: (i: CustomStudyInfo) => string }[] = [
  {
    kind: 'new',
    label: 'Increase today’s new card limit',
    unit: 'more new cards',
    help: (i) => `${i.available_new + i.available_new_in_children} new cards available.`,
  },
  {
    kind: 'review',
    label: 'Increase today’s review limit',
    unit: 'more reviews',
    help: (i) => `${i.available_review + i.available_review_in_children} more reviews available.`,
  },
  { kind: 'forgot', label: 'Review forgotten cards', unit: 'days back', help: () => 'Cards you pressed Again on recently.' },
  { kind: 'ahead', label: 'Review ahead', unit: 'days ahead', help: () => 'Cards due in the next few days.' },
  { kind: 'preview', label: 'Preview new cards', unit: 'days back', help: () => 'Cards added recently, without scheduling them.' },
  { kind: 'cram', label: 'Study by card state or tag', unit: 'cards', help: () => 'Pick cards to cram; reviews here don’t count.' },
]

const CRAM: { kind: CramKind; label: string }[] = [
  { kind: 'all', label: 'All cards in random order (don’t reschedule)' },
  { kind: 'new', label: 'New cards only' },
  { kind: 'due', label: 'Due cards only' },
  { kind: 'review', label: 'All review cards in random order' },
]

/** Anki's Custom Study window: one option, one number, then off to study. */
export function CustomStudyDialog({ deck, onClose }: { deck: DeckNode | null; onClose(): void }) {
  const backend = useBackend()
  const [info, setInfo] = useState<CustomStudyInfo | null>(null)
  const [kind, setKind] = useState<CustomStudyKind>('new')
  const [amount, setAmount] = useState('10')
  const [cram, setCram] = useState<CramKind>('all')
  const [tags, setTags] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!deck) return
    let cancelled = false
    backend.customStudyInfo(deck.id).then(
      (i) => {
        if (cancelled) return
        setInfo(i)
        setError(null)
        setAmount(String(i.extend_new || 10))
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [backend, deck])

  const choose = (k: CustomStudyKind) => {
    setKind(k)
    if (!info) return
    const defaults: Record<CustomStudyKind, number> = {
      new: info.extend_new || 10,
      review: info.extend_review || 50,
      forgot: 1,
      ahead: 1,
      preview: 1,
      cram: 100,
    }
    setAmount(String(defaults[k]))
  }

  const close = () => {
    setInfo(null)
    setTags([])
    setError(null)
    onClose()
  }

  const start = async () => {
    if (!deck) return
    const n = Number(amount)
    if (!Number.isInteger(n) || n < 1 || n > 9999) {
      setError('Enter a number between 1 and 9999.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const target = await backend.customStudy(deck.id, {
        kind,
        amount: n,
        cram_kind: cram,
        tags_include: kind === 'cram' ? tags : [],
      })
      close()
      navigate({ name: 'study', deckId: target })
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'Couldn’t start custom study.')
    } finally {
      setBusy(false)
    }
  }

  const current = OPTIONS.find((o) => o.kind === kind)!

  return (
    <Dialog
      open={deck !== null}
      onClose={() => !busy && close()}
      title={`Custom study: ${deck?.name ?? ''}`}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void start()} disabled={busy || !info}>
            {busy ? 'Starting…' : 'Study'}
          </Button>
        </>
      }
    >
      <div className="cs" role="radiogroup" aria-label="Custom study option">
        {OPTIONS.map((o) => (
          <label key={o.kind} className={`cs__option ${kind === o.kind ? 'is-selected' : ''}`}>
            <input type="radio" name="cs" checked={kind === o.kind} onChange={() => choose(o.kind)} />
            <span>
              <span className="cs__label">{o.label}</span>
              {info && <span className="cs__help">{o.help(info)}</span>}
            </span>
          </label>
        ))}
      </div>
      <label className="cs__amount">
        <input
          className="num__input"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          aria-label={current.unit}
        />
        <span>{current.unit}</span>
      </label>
      {kind === 'cram' && info && (
        <div className="cs__cram">
          <span className="select">
            <select value={cram} onChange={(e) => setCram(e.target.value as CramKind)} aria-label="Which cards">
              {CRAM.map((c) => (
                <option key={c.kind} value={c.kind}>
                  {c.label}
                </option>
              ))}
            </select>
          </span>
          {info.tags.length > 0 && (
            <div className="cs__tags" role="group" aria-label="Only cards with these tags">
              <span className="cs__help">Only cards tagged (optional):</span>
              <div className="chips">
                {info.tags.slice(0, 60).map((t) => (
                  <button
                    key={t}
                    className="chip"
                    role="checkbox"
                    aria-checked={tags.includes(t)}
                    onClick={() => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
      {kind !== 'new' && kind !== 'review' && (
        <p className="dialog-hint">This builds a “Custom Study Session” deck. Its cards go back when you’re done or delete it.</p>
      )}
    </Dialog>
  )
}
