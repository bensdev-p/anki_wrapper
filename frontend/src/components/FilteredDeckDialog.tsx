import { useEffect, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { FilteredDeckForm, FilteredDeckSpec } from '../backend/types'
import { navigate } from '../lib/router'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { Switch } from './Switch'

export interface FilteredDialogState {
  /** 0 for a new filtered deck. */
  deckId: number
  /** Start a new one from this search (e.g. from the browser). */
  search?: string
}

/** Anki's filtered deck dialog: a search, a limit and an order; Build studies it. */
export function FilteredDeckDialog({ state, onClose, onSaved }: { state: FilteredDialogState | null; onClose(): void; onSaved(): void }) {
  const backend = useBackend()
  const [form, setForm] = useState<FilteredDeckForm | null>(null)
  const [spec, setSpec] = useState<FilteredDeckSpec | null>(null)
  const [second, setSecond] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!state) return
    let cancelled = false
    backend.filteredDeck(state.deckId, state.search).then(
      (f) => {
        if (cancelled) return
        setForm(f)
        setSpec(f.deck)
        setSecond(!!f.deck.search2)
        setError(null)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [backend, state])

  const close = () => {
    setForm(null)
    setSpec(null)
    setError(null)
    onClose()
  }
  const set = <K extends keyof FilteredDeckSpec>(k: K, v: FilteredDeckSpec[K]) => setSpec((s) => (s ? { ...s, [k]: v } : s))

  const build = async () => {
    if (!spec) return
    setBusy(true)
    setError(null)
    try {
      const id = await backend.saveFilteredDeck({
        ...spec,
        search2: second ? spec.search2 || '' : null,
        limit2: second ? spec.limit2 || 20 : 0,
      })
      onSaved()
      close()
      navigate({ name: 'study', deckId: id })
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'Couldn’t build the deck.')
    } finally {
      setBusy(false)
    }
  }

  const orderSelect = (value: number, onChange: (v: number) => void, label: string) => (
    <span className="select">
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
        {form?.order_labels.map((l, i) => (
          <option key={i} value={i}>
            {l}
          </option>
        ))}
      </select>
    </span>
  )

  return (
    <Dialog
      open={state !== null}
      onClose={() => !busy && close()}
      title={state?.deckId ? 'Edit filtered deck' : 'New filtered deck'}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void build()} disabled={busy || !spec}>
            {busy ? 'Building…' : state?.deckId ? 'Rebuild' : 'Build'}
          </Button>
        </>
      }
    >
      {spec ? (
        <div className="fd">
          <label className="fd__field">
            <span>Name</span>
            <input className="dialog-input" value={spec.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label className="fd__field">
            <span>Search</span>
            <input
              className="dialog-input"
              value={spec.search}
              onChange={(e) => set('search', e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              placeholder='deck:"Step 1" is:due'
            />
          </label>
          <div className="fd__row">
            <label className="fd__field fd__field--inline">
              <span>Limit to</span>
              <input
                className="num__input"
                inputMode="numeric"
                value={spec.limit}
                onChange={(e) => set('limit', Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
              <span>cards</span>
            </label>
            {orderSelect(spec.order, (v) => set('order', v), 'Order')}
          </div>
          <label className="fd__switch">
            <Switch checked={second} onChange={setSecond} label="Second filter" />
            <span>Add a second filter</span>
          </label>
          {second && (
            <>
              <input
                className="dialog-input"
                value={spec.search2 ?? ''}
                onChange={(e) => set('search2', e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                aria-label="Second search"
                placeholder="is:new"
              />
              <div className="fd__row">
                <label className="fd__field fd__field--inline">
                  <span>Limit to</span>
                  <input
                    className="num__input"
                    inputMode="numeric"
                    value={spec.limit2 || 20}
                    onChange={(e) => set('limit2', Number(e.target.value.replace(/\D/g, '')) || 0)}
                  />
                  <span>cards</span>
                </label>
                {orderSelect(spec.order2, (v) => set('order2', v), 'Second order')}
              </div>
            </>
          )}
          <label className="fd__switch">
            <Switch checked={spec.reschedule} onChange={(v) => set('reschedule', v)} label="Reschedule" />
            <span>Reschedule cards based on my answers in this deck</span>
          </label>
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : error ? (
        <p className="dialog-error">{error}</p>
      ) : (
        <p>Loading…</p>
      )}
    </Dialog>
  )
}
