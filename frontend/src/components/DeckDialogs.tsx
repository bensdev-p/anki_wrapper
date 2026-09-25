import { useEffect, useRef, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { DeckName, DeckNode } from '../backend/types'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { useToast } from './Toast'

export type DeckDialogState =
  | { kind: 'create'; prefix: string }
  | { kind: 'rename'; deck: DeckNode }
  | { kind: 'delete'; deck: DeckNode }
  | null

/** New deck / rename / delete, with Anki's rules checked on the server. */
export function DeckDialogs({
  state,
  onClose,
  onChanged,
}: {
  state: DeckDialogState
  onClose(): void
  /** Decks changed: reload the list. */
  onChanged(created?: DeckName): void
}) {
  return (
    <>
      <NameDialog state={state?.kind === 'create' || state?.kind === 'rename' ? state : null} onClose={onClose} onChanged={onChanged} />
      <DeleteDialog deck={state?.kind === 'delete' ? state.deck : null} onClose={onClose} onChanged={onChanged} />
    </>
  )
}

function NameDialog({
  state,
  onClose,
  onChanged,
}: {
  state: { kind: 'create'; prefix: string } | { kind: 'rename'; deck: DeckNode } | null
  onClose(): void
  onChanged(created?: DeckName): void
}) {
  const backend = useBackend()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const open = state !== null
  const initial = state?.kind === 'rename' ? state.deck.full_name : (state?.prefix ?? '')

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => {
      input.current?.focus()
      input.current?.setSelectionRange(input.current.value.length, input.current.value.length)
    }, 30)
  }, [open])

  const close = () => {
    setName('')
    setError(null)
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = (name || initial).trim()
    if (!value || !state || busy) return
    setBusy(true)
    setError(null)
    try {
      if (state.kind === 'create') onChanged(await backend.createDeck(value))
      else {
        await backend.renameDeck(state.deck.id, value)
        onChanged()
      }
      close()
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && close()}
      title={state?.kind === 'rename' ? 'Rename deck' : 'New deck'}
      actions={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="deck-name-form" disabled={busy || !(name || initial).trim()}>
            {state?.kind === 'rename' ? 'Rename' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="deck-name-form" onSubmit={submit}>
        <input
          ref={input}
          className="dialog-input"
          aria-label="Deck name"
          defaultValue={initial}
          key={`${state?.kind}-${initial}`}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
        />
        {error ? (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="dialog-hint">Use “::” to put a deck inside another, e.g. Step 1::Cardio.</p>
        )}
      </form>
    </Dialog>
  )
}

function DeleteDialog({ deck, onClose, onChanged }: { deck: DeckNode | null; onClose(): void; onChanged(): void }) {
  const backend = useBackend()
  const toast = useToast()
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!deck) return
    let cancelled = false
    backend.deckCardCount(deck.id).then(
      (n) => !cancelled && setCount(n),
      () => !cancelled && setCount(null),
    )
    return () => {
      cancelled = true
      setCount(null)
    }
  }, [backend, deck])

  const remove = async () => {
    if (!deck) return
    setBusy(true)
    try {
      const out = await backend.deleteDeck(deck.id)
      onClose()
      onChanged()
      toast(`Deleted “${out.name}”${out.cards ? ` and ${out.cards.toLocaleString()} cards` : ''}.`, 'info', {
        label: 'Undo',
        run: () =>
          void backend.undoStep(out.undo_label).then(
            () => {
              onChanged()
              toast(`Restored “${out.name}”.`, 'info')
            },
            (err) => toast(err instanceof BackendError ? err.message : 'Couldn’t undo.', 'error'),
          ),
      })
    } catch (err) {
      toast(err instanceof BackendError ? err.message : 'Couldn’t delete the deck.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={deck !== null}
      onClose={() => !busy && onClose()}
      title={`Delete “${deck?.name ?? ''}”?`}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={busy || count === null}>
            Delete
          </Button>
        </>
      }
    >
      {deck?.filtered ? (
        <p>It’s a filtered deck: its cards aren’t deleted, they go back to their own decks.</p>
      ) : (
        <>
          <p>
            {count === null
              ? 'Counting cards…'
              : count === 0
                ? 'This deck is empty.'
                : `This deletes ${count.toLocaleString()} card${count === 1 ? '' : 's'}${deck?.children.length ? ', including its subdecks' : ''}, and their review history.`}
          </p>
          <p>You can undo it right after. Deleting syncs to your other devices.</p>
        </>
      )}
    </Dialog>
  )
}
