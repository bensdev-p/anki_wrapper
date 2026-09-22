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
  onKey(e: CardKeyEvent): void
  onTap(): void
  onPlay(ref: string): void
}

// Card scripts may not talk to the network (our API included) or navigate us.
const CSP = [
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'none'",
  "form-action 'none'",
].join('; ')

// Anki's platform classes (aqt.theme.body_class). Her devices are all Apple.
const PLATFORM_CLASS = isApple ? 'isMac' : navigator.userAgent.includes('Windows') ? 'isWin' : 'isLin'

function buildSrcDoc(mediaBaseUrl: string): string {
  const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(CSP)}">
<base href="${escapeAttr(mediaBaseUrl)}">
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
export function CardFrame({ renderKey, rendered, side, theme, mediaBaseUrl, onKey, onTap, onPlay }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const pending = useRef<object[]>([])
  const lastRendered = useRef<string | null>(null)
  const handlers = useRef({ onKey, onTap, onPlay })
  handlers.current = { onKey, onTap, onPlay }

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
      if (!msg || msg.source !== 'lacuna-card') return
      if (msg.type === 'ready') {
        ready.current = true
        const queued = pending.current
        pending.current = []
        queued.forEach((m) => frame.current?.contentWindow?.postMessage(m, '*'))
      } else if (msg.type === 'key') handlers.current.onKey(msg)
      else if (msg.type === 'tap') handlers.current.onTap()
      else if (msg.type === 'play' && typeof msg.ref === 'string') handlers.current.onPlay(msg.ref)
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
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, rendered, side])

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
