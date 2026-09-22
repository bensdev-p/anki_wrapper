import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { RenderedCard } from '../../backend/types'
import type { Theme } from '../../themes/themes'
import { isApple, isTouch } from '../../lib/platform'
import baseCss from './card-base.css?raw'
import runtimeJs from './runtime.js?raw'

export type CardSide = 'question' | 'answer'

export interface CardKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

interface Props {
  /** Changes whenever new content should be shown (new card, flip, undo). */
  renderKey: string
  rendered: RenderedCard | null
  side: CardSide
  theme: Theme
  mediaBaseUrl: string
  /** Scroll a long answer into view on flip (the review screen). Off for previews. */
  scrollToAnswer?: boolean
  /** Typed-answer comparison HTML for the answer side's #typeans-result slot. */
  typeAnswerHtml?: string | null
  onKey(e: CardKeyEvent): void
  onTap(): void
  onPlay(ref: string): void
  onTyped?(value: string): void
  /** Deck scripts called pycmd("ans") or pycmd("easeN"), as on Anki desktop. */
  onCommand?(cmd: string): void
  /** An image on the card couldn't be loaded (e.g. media not synced yet). */
  onMissingMedia?(src: string): void
}

// Deck scripts' localStorage (preferences), kept by the app between sessions.
const CARD_STORAGE_KEY = 'rounds.cardLocalStorage'
function loadCardStorage(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CARD_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}
function saveCardStorage(data: unknown) {
  try {
    const json = JSON.stringify(data)
    if (json.length < 200_000) localStorage.setItem(CARD_STORAGE_KEY, json)
  } catch {
    // storage full or unavailable: deck preferences just won't persist
  }
}

// Card scripts may not talk to the network (our API included) or navigate us.
// One exception: AnKing's note type looks up word summaries on Wikipedia.
const CSP = [
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  'connect-src https://en.wikipedia.org',
  "form-action 'none'",
].join('; ')

// Anki's platform classes (aqt.theme.body_class). Her devices are all Apple.
const PLATFORM_CLASS = isApple ? 'isMac' : navigator.userAgent.includes('Windows') ? 'isWin' : 'isLin'

// Cards render as on AnkiMobile: <html class="mobile">. Rounds has no desktop
// add-ons, and popular note types show add-on-free alternatives on mobile. E.g.
// AnKing's tag-based "First Aid Links" / "Boards and Beyond Links" buttons
// (which the AnkiHub add-on replaces on desktop) only appear with .mobile.
const isIPad = /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const HTML_CLASS = ['mobile', /iPhone|iPod/.test(navigator.userAgent) ? 'iphone' : isIPad ? 'ipad' : ''].join(' ').trim()

function buildSrcDoc(mediaBaseUrl: string): string {
  const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html class="${HTML_CLASS}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(CSP)}">
<base href="${escapeAttr(mediaBaseUrl)}">
<script>window.__roundsLocal = ${JSON.stringify(loadCardStorage()).replace(/</g, '\\u003c')}</script>
<style>${baseCss}</style>
<style id="notetype-css"></style>
</head><body><div id="qa"></div>
<script>${runtimeJs.replace(/<\/script/gi, '<\\/script')}</script>
</body></html>`
}

/**
 * Renders card HTML + notetype CSS in a sandboxed iframe (`allow-scripts`
 * only: opaque origin, so deck JS can't reach the app or its storage).
 * One document persists for the whole session, like Anki's reviewer webview.
 */
export function CardFrame({ renderKey, rendered, side, theme, mediaBaseUrl, scrollToAnswer = true, typeAnswerHtml, onKey, onTap, onPlay, onTyped, onCommand, onMissingMedia }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const pending = useRef<object[]>([])
  const lastRendered = useRef<string | null>(null)
  const handlers = useRef({ onKey, onTap, onPlay, onTyped, onCommand, onMissingMedia })
  handlers.current = { onKey, onTap, onPlay, onTyped, onCommand, onMissingMedia }

  const srcDoc = useMemo(() => buildSrcDoc(mediaBaseUrl), [mediaBaseUrl])

  const send = (msg: object) => {
    const win = frame.current?.contentWindow
    if (ready.current && win) win.postMessage(msg, '*')
    else pending.current.push(msg)
  }

  // Layout effect: listen before the srcdoc document can post "ready".
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return
      const msg = e.data
      if (!msg || msg.source !== 'rounds-card') return
      if (msg.type === 'ready') {
        ready.current = true
        const queued = pending.current
        pending.current = []
        queued.forEach((m) => frame.current?.contentWindow?.postMessage(m, '*'))
      } else if (msg.type === 'key') handlers.current.onKey(msg)
      else if (msg.type === 'tap') handlers.current.onTap()
      else if (msg.type === 'play' && typeof msg.ref === 'string') handlers.current.onPlay(msg.ref)
      else if (msg.type === 'typed' && typeof msg.value === 'string') handlers.current.onTyped?.(msg.value)
      else if (msg.type === 'pycmd' && typeof msg.cmd === 'string') handlers.current.onCommand?.(msg.cmd)
      else if (msg.type === 'missing' && typeof msg.src === 'string') handlers.current.onMissingMedia?.(msg.src)
      else if (msg.type === 'storage' && msg.data && typeof msg.data === 'object') saveCardStorage(msg.data)
      else if (msg.type === 'open' && typeof msg.url === 'string' && /^https?:\/\//i.test(msg.url)) {
        window.open(msg.url, '_blank', 'noopener,noreferrer')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Theme: Anki's night-mode classes + the --canvas/--fg its CSS uses.
  useEffect(() => {
    const night = theme.kind === 'dark'
    send({
      type: 'theme',
      night,
      bodyClass: [PLATFORM_CLASS, night ? 'nightMode night_mode' : ''].join(' ').trim(),
      canvas: theme.tokens['card-canvas'],
      fg: theme.tokens['card-fg'],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme])

  useEffect(() => {
    if (!rendered) return
    if (lastRendered.current === renderKey) return
    lastRendered.current = renderKey
    send({
      type: 'render',
      side,
      html: side === 'question' ? rendered.question_html : rendered.answer_html,
      css: rendered.css,
      bodyClass: rendered.body_class,
      animate: true,
      touch: isTouch,
      scrollToAnswer,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, rendered, side])

  useEffect(() => {
    if (side === 'answer' && typeAnswerHtml != null) send({ type: 'typeans-result', html: typeAnswerHtml })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeAnswerHtml, side, renderKey])

  return (
    <iframe
      ref={frame}
      className="card-frame"
      title="Card"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
    />
  )
}
