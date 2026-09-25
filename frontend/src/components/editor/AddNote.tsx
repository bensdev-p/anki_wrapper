import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BackendError } from '../../backend/AnkiBackend'
import { useBackend } from '../../backend/context'
import type { AddDefaults, NotetypeInfo } from '../../backend/types'
import { ADD_NOTE_EVENT } from '../../lib/addNote'
import { useDecks } from '../../lib/decks'
import { modKey } from '../../lib/platform'
import { useTheme } from '../../themes/ThemeProvider'
import { Button } from '../Button'
import { Kbd } from '../Kbd'
import { Sheet } from '../Sheet'
import { useToast } from '../Toast'
import { srcDoc } from './NoteEditor'
import { handleEditorUpload } from './uploads'

type Fields = Record<string, string>

const blank = (nt: NotetypeInfo | undefined): Fields => Object.fromEntries((nt?.fields ?? []).map((f) => [f, '']))
const isEmpty = (html: string) => !html.replace(/<br\s*\/?>|&nbsp;|\s/gi, '')

/**
 * Anki's Add window: pick a note type and deck, fill the fields, Add.
 * The note type, deck and tags stay put for the next card, as in Anki.
 * Opened with openAddNote() from anywhere; lives at the app root.
 */
export function AddNote() {
  const backend = useBackend()
  const toast = useToast()
  const { theme } = useTheme()
  const { reload: reloadDecks } = useDecks()
  const [open, setOpen] = useState(false)
  const [defaults, setDefaults] = useState<AddDefaults | null>(null)
  const [notetypeId, setNotetypeId] = useState<number | null>(null)
  const [deckId, setDeckId] = useState<number | null>(null)
  const [fields, setFieldState] = useState<Fields>({})
  // Updated the moment the frame reports a field, so an Add right after typing
  // never reads a stale copy (state only catches up on the next render).
  const fieldsRef = useRef<Fields>({})
  const setFields = (next: Fields) => {
    fieldsRef.current = next
    setFieldState(next)
  }
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  // The field frame is created when the sheet opens; it says when it's ready.
  const [frameReady, setFrameReady] = useState(false)
  const [loadKey, setLoadKey] = useState(0)
  const doc = useMemo(() => srcDoc(backend.mediaBaseUrl()), [backend])

  const notetype = defaults?.notetypes.find((n) => n.id === notetypeId)
  const latest = useRef({ notetype, deckId, tags })
  latest.current = { notetype, deckId, tags }
  const dirty = Object.values(fields).some((v) => !isEmpty(v))

  const send = (msg: object) => frame.current?.contentWindow?.postMessage(msg, '*')

  // (Re)load the fields once both the frame and the note type are there, on a
  // note type change, and after each add. Loading from an effect avoids racing
  // the frame's "ready" against the defaults arriving.
  useEffect(() => {
    const nt = latest.current.notetype
    if (!frameReady || !nt) return
    send({ type: 'mode', cloze: nt.is_cloze })
    send({ type: 'load', fields: nt.fields.map((name) => ({ name, html: fieldsRef.current[name] ?? '' })) })
  }, [frameReady, notetypeId, loadKey, defaults])

  // Opened from a deck's menu, the Add button, "A" or the command palette.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const wanted = (e as CustomEvent<{ deckId?: number }>).detail?.deckId
      setOpen(true)
      setError(null)
      setConfirmDiscard(false)
      backend.addDefaults(wanted).then(
        (d) => {
          setDefaults(d)
          const nt = d.notetypes.find((n) => n.id === d.notetype_id) ?? d.notetypes[0]
          setNotetypeId(nt?.id ?? null)
          setDeckId(d.deck_id)
          setFields(blank(nt))
          setLoadKey((k) => k + 1)
        },
        (err: Error) => setError(err.message),
      )
    }
    window.addEventListener(ADD_NOTE_EVENT, onOpen)
    return () => window.removeEventListener(ADD_NOTE_EVENT, onOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend])

  const close = () => {
    setOpen(false)
    setFrameReady(false)
    setConfirmDiscard(false)
  }
  const requestClose = () => (dirty && !confirmDiscard ? setConfirmDiscard(true) : close())

  const changeNotetype = (id: number) => {
    const nt = defaults?.notetypes.find((n) => n.id === id)
    // Keep what's typed in fields with the same name (as Anki does).
    const next = Object.fromEntries((nt?.fields ?? []).map((f) => [f, fieldsRef.current[f] ?? '']))
    setNotetypeId(id)
    setFields(next)
  }

  const add = async () => {
    const { notetype: nt, deckId: deck, tags: t } = latest.current
    const values = fieldsRef.current
    if (!nt || deck === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await backend.addNote(nt.id, deck, values, t.split(/\s+/).filter(Boolean))
      const deckName = defaults?.decks.find((d) => d.id === deck)?.name ?? 'the deck'
      toast(
        res.duplicate
          ? `Added. Another note already starts with the same ${nt.fields[0]}.`
          : `Added ${res.cards} card${res.cards === 1 ? '' : 's'} to ${deckName}.`,
        'info',
      )
      setFields(blank(nt))
      setLoadKey((k) => k + 1)
      void reloadDecks()
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'Couldn’t add the card.')
    } finally {
      setBusy(false)
    }
  }

  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.source !== 'rounds-editor') return
      const msg = e.data
      if (msg.type === 'ready') {
        send({ type: 'theme', vars: theme.tokens, night: theme.kind === 'dark' })
        setFrameReady(true)
      } else if (msg.type === 'field') setFields({ ...fieldsRef.current, [msg.name]: msg.html })
      else if (msg.type === 'upload') void handleEditorUpload(backend, frame.current, msg).then((err) => err && setError(err))
      else if (msg.type === 'save') void add()
      else if (msg.type === 'close') requestClose()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })

  useEffect(() => {
    if (frameReady) send({ type: 'theme', vars: theme.tokens, night: theme.kind === 'dark' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      wide
      title="Add card"
      subtitle={notetype?.is_cloze ? `Cloze: select text and press ${modKey}⇧C` : ' '}
      footer={
        confirmDiscard ? (
          <div className="sheet__actions">
            <span className="sheet__warn">Discard what you typed?</span>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="secondary" onClick={close}>
              Discard
            </Button>
          </div>
        ) : (
          <div className="sheet__actions">
            {error ? <span className="sheet__error-inline">{error}</span> : <span className="sheet__hint" />}
            <Button variant="ghost" onClick={requestClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => send({ type: 'flush' })} disabled={!dirty || busy || !notetype}>
              {busy ? 'Adding…' : 'Add'}
              <kbd className="kbd kbd--on-accent">{modKey}↵</kbd>
            </Button>
          </div>
        )
      }
    >
      <div className="editor">
        <div className="add__pickers">
          <label className="add__picker">
            <span>Type</span>
            <span className="select">
              <select value={notetypeId ?? ''} onChange={(e) => changeNotetype(Number(e.target.value))} disabled={!defaults}>
                {defaults?.notetypes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="add__picker">
            <span>Deck</span>
            <span className="select">
              <select value={deckId ?? ''} onChange={(e) => setDeckId(Number(e.target.value))} disabled={!defaults}>
                {defaults?.decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
        <iframe ref={frame} className="editor__frame" title="Note fields" sandbox="allow-scripts" srcDoc={doc} />
        <label className="editor__tags">
          <span>Tags</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send({ type: 'flush' })
            }}
            placeholder="space-separated (kept for the next card)"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <p className="editor__note">
          <Kbd>{modKey}↵</Kbd> add · paste or drop images into a field · <strong>HTML</strong> edits a field’s source
        </p>
      </div>
    </Sheet>
  )
}
