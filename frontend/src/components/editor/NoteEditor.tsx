import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BackendError } from '../../backend/AnkiBackend'
import { useBackend } from '../../backend/context'
import type { NoteForEdit } from '../../backend/types'
import { useTheme } from '../../themes/ThemeProvider'
import { Button } from '../Button'
import { Kbd } from '../Kbd'
import { Sheet } from '../Sheet'
import { isApple, modKey } from '../../lib/platform'
import { useSync } from '../../lib/sync'
import editorCss from './editor.css?raw'
import runtimeJs from './editor-runtime.js?raw'
import { handleEditorUpload } from './uploads'

const CSP = "default-src * data: blob: 'unsafe-inline'; connect-src 'none'; form-action 'none'"

// eslint-disable-next-line react-refresh/only-export-components
export function srcDoc(mediaBase: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${esc(CSP)}">
<base href="${esc(mediaBase)}"><style>${editorCss}</style></head>
<body><div id="toolbar" role="toolbar" aria-label="Formatting">
<button type="button" data-cmd="bold" title="Bold (${modKey}B)"><b>B</b></button>
<button type="button" data-cmd="italic" title="Italic (${modKey}I)"><i>I</i></button>
<button type="button" data-cmd="underline" title="Underline (${modKey}U)"><u>U</u></button>
<span class="sep"></span>
<button type="button" data-cmd="superscript" title="Superscript">x²</button>
<button type="button" data-cmd="subscript" title="Subscript">x₂</button>
<span class="sep"></span>
<button type="button" data-cmd="removeFormat" title="Clear formatting">Clear</button>
<span class="sep"></span>
<button type="button" data-cmd="cloze" hidden title="Cloze deletion (${modKey}⇧C; add ${isApple ? '⌥' : 'Alt'} for the same number)">[…]</button>
</div><div id="fields"></div>
<script>${runtimeJs.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
}

interface Props {
  noteId: number | null
  open: boolean
  onClose(): void
  /** Called after a successful save, so the card can re-render. */
  onSaved(): void
}

/**
 * Edits a note's fields in a sandboxed iframe (deck HTML never runs in the app's
 * page) and saves only the fields she changed, plus tags.
 */
export function NoteEditor({ noteId, open, onClose, onSaved }: Props) {
  const backend = useBackend()
  const { theme } = useTheme()
  const { status: syncStatus } = useSync()
  const frame = useRef<HTMLIFrameElement>(null)
  const [note, setNote] = useState<NoteForEdit | null>(null)
  const [changed, setChanged] = useState<Record<string, string>>({})
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const ready = useRef(false)
  const mediaBase = useMemo(() => backend.mediaBaseUrl(), [backend])
  const doc = useMemo(() => srcDoc(mediaBase), [mediaBase])
  const latest = useRef({ note, changed, tags })
  latest.current = { note, changed, tags }

  // Load the note each time the editor opens.
  useEffect(() => {
    if (!open || noteId === null) return
    let cancelled = false
    ready.current = false
    backend.getNote(noteId).then(
      (n) => {
        if (cancelled) return
        setNote(n)
        setChanged({})
        setTags(n.tags.join(' '))
        setError(null)
        setConfirmDiscard(false)
      },
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [backend, noteId, open])

  const tagsChanged = note ? tags.trim().split(/\s+/).filter(Boolean).join(' ') !== note.tags.join(' ') : false
  const dirty = Object.keys(changed).length > 0 || tagsChanged

  const save = async () => {
    const { note: n, changed: c, tags: t } = latest.current
    if (!n || saving) return
    const hasTagChange = t.trim().split(/\s+/).filter(Boolean).join(' ') !== n.tags.join(' ')
    if (!Object.keys(c).length && !hasTagChange) return onClose()
    setSaving(true)
    setError(null)
    try {
      await backend.updateNote(n.note_id, c, hasTagChange ? t.trim().split(/\s+/).filter(Boolean) : undefined)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof BackendError ? e.message : 'Couldn’t save the note.')
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (dirty && !confirmDiscard) setConfirmDiscard(true)
    else onClose()
  }

  const sendToFrame = (msg: object) => frame.current?.contentWindow?.postMessage(msg, '*')
  const themeMsg = () => ({ type: 'theme', vars: theme.tokens, night: theme.kind === 'dark' })

  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.source !== 'rounds-editor') return
      const msg = e.data
      if (msg.type === 'ready') {
        ready.current = true
        sendToFrame(themeMsg())
        const n = latest.current.note
        if (n) {
          sendToFrame({ type: 'mode', cloze: n.is_cloze })
          sendToFrame({ type: 'load', fields: n.fields })
        }
      } else if (msg.type === 'field') {
        const original = latest.current.note?.fields.find((f) => f.name === msg.name)?.html
        // Update the ref right away: a "save" can follow before React re-renders.
        const next = { ...latest.current.changed }
        if (msg.html === original) delete next[msg.name]
        else next[msg.name] = msg.html
        latest.current = { ...latest.current, changed: next }
        setChanged(next)
      } else if (msg.type === 'upload') {
        void handleEditorUpload(backend, frame.current, msg).then((err) => err && setError(err))
      } else if (msg.type === 'save') void save()
      else if (msg.type === 'close') requestClose()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })

  // Note arrived after the frame was ready.
  useEffect(() => {
    if (note && ready.current) {
      sendToFrame({ type: 'mode', cloze: note.is_cloze })
      sendToFrame({ type: 'load', fields: note.fields })
    }
  }, [note])

  useEffect(() => {
    if (ready.current) sendToFrame(themeMsg())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      wide
      title="Edit note"
      subtitle={note ? note.notetype : ' '}
      footer={
        confirmDiscard ? (
          <div className="sheet__actions">
            <span className="sheet__warn">Discard your changes?</span>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Discard
            </Button>
          </div>
        ) : (
          <div className="sheet__actions">
            {error ? <span className="sheet__error-inline">{error}</span> : <span className="sheet__hint">{syncStatus?.enabled ? 'Changes sync to your other devices.' : ''}</span>}
            <Button variant="ghost" onClick={requestClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => sendToFrame({ type: 'flush' })} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
              <kbd className="kbd kbd--on-accent">{modKey}↵</kbd>
            </Button>
          </div>
        )
      }
    >
      <div className="editor">
        <iframe ref={frame} className="editor__frame" title="Note fields" sandbox="allow-scripts" srcDoc={doc} />
        <label className="editor__tags">
          <span>Tags</span>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendToFrame({ type: 'flush' })
            }}
            placeholder="space-separated"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <p className="editor__note">
          <Kbd>{modKey}B</Kbd> <Kbd>{modKey}I</Kbd> <Kbd>{modKey}U</Kbd> format · <strong>HTML</strong> edits a field’s source
        </p>
      </div>
    </Sheet>
  )
}
