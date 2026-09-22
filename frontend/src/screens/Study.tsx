import { ArrowLeft, Check, Flag, RotateCcw, Star } from 'lucide-react'
import { ActionsMenu, FLAG_NAMES, type CardAction } from '../components/ActionsMenu'
import { CardInfoPanel } from '../components/CardInfoPanel'
import { NoteEditor } from '../components/editor/NoteEditor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { Rating, StudyState } from '../backend/types'
import { Button } from '../components/Button'
import { CardFrame, type CardKeyEvent, type CardSide } from '../components/card/CardFrame'
import { CountPills } from '../components/CountPills'
import { Kbd } from '../components/Kbd'
import { useToast } from '../components/Toast'
import { TopBar } from '../components/TopBar'
import { useDecks } from '../lib/decks'
import { modKey } from '../lib/platform'
import { navigate } from '../lib/router'
import { requestSync, SYNCED_EVENT } from '../lib/sync'
import { whenOnline } from '../lib/connection'
import { useTheme } from '../themes/ThemeProvider'

interface Answered {
  rating: Rating
  ms: number
}

const BUTTONS: { rating: Rating; label: string; tone: string }[] = [
  { rating: 1, label: 'Again', tone: 'again' },
  { rating: 2, label: 'Hard', tone: 'hard' },
  { rating: 3, label: 'Good', tone: 'good' },
  { rating: 4, label: 'Easy', tone: 'easy' },
]


function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

/** Plays card audio from the top-level page, which holds the user's gesture. */
function useAudio() {
  const player = useMemo(() => {
    let current: HTMLAudioElement | null = null
    let queue: string[] = []
    function next() {
      const url = queue.shift()
      if (!url) return
      current = new Audio(url)
      current.addEventListener('ended', next, { once: true })
      current.play().catch(() => {
        // Autoplay can be blocked until the first interaction; the play buttons still work.
      })
    }
    function stop() {
      queue = []
      current?.pause()
      current = null
    }
    function play(urls: string[]) {
      stop()
      queue = [...urls]
      next()
    }
    return { play, stop }
  }, [])
  useEffect(() => player.stop, [player])
  return player
}

interface Props {
  deckId: number
  paused: boolean
  onOpenPalette(): void
}

export function Study({ deckId, paused, onOpenPalette }: Props) {
  const backend = useBackend()
  const toast = useToast()
  const { theme } = useTheme()
  const { reload: reloadDecks } = useDecks()
  const audio = useAudio()

  const [state, setState] = useState<StudyState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [side, setSide] = useState<CardSide>('question')
  const [seq, setSeq] = useState(0)
  const [answered, setAnswered] = useState<Answered[]>([])
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const busy = useRef(false)
  const shownAt = useRef(performance.now())
  const typed = useRef('')
  const [typeAnswerHtml, setTypeAnswerHtml] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'info' | 'edit' | null>(null)
  const [sending, setSending] = useState(false)
  const inputPaused = paused || sheet !== null

  const card = state?.card ?? null
  const mediaBase = useMemo(() => backend.mediaBaseUrl(), [backend])

  const showState = useCallback((next: StudyState) => {
    setState(next)
    setSide('question')
    setSeq((s) => s + 1)
    shownAt.current = performance.now()
    typed.current = ''
    setTypeAnswerHtml(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    backend.selectDeck(deckId).then(
      (s) => !cancelled && showState(s),
      (e: Error) => !cancelled && setLoadError(e.message),
    )
    return () => {
      cancelled = true
      // Leaving the screen: deck counts have changed, and the session is worth syncing.
      void reloadDecks()
      requestSync()
    }
  }, [backend, deckId, showState, reloadDecks])

  // A sync may have brought reviews from another device: refresh the queue,
  // unless she's looking at an answer (it'll refresh on the next card anyway).
  useEffect(() => {
    const onSynced = () => {
      if (busy.current || side === 'answer') return
      backend.studyState().then(showState, () => {})
    }
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [backend, showState, side])

  // Clock for the session timer.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const audioUrls = useCallback(
    (s: 'q' | 'a') =>
      (card?.rendered.audio ?? []).filter((a) => a.side === s).map((a) => mediaBase + encodeURIComponent(a.filename)),
    [card, mediaBase],
  )

  // Autoplay, as configured in the deck's options.
  useEffect(() => {
    if (!card?.rendered.autoplay) return audio.stop()
    audio.play(audioUrls(side === 'question' ? 'q' : 'a'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, side])

  const flip = useCallback(() => {
    if (!card || side !== 'question') return
    setSide('answer')
    if (card.rendered.type_answer) {
      // Grade what she typed exactly as Anki does (col.compare_answer).
      backend.compareAnswer(card.card_id, typed.current).then(setTypeAnswerHtml, () => {})
    }
  }, [backend, card, side])

  const handleError = useCallback(
    async (e: unknown) => {
      if (e instanceof BackendError && e.kind === 'StaleCard') {
        toast('That card was already answered. Refreshed.', 'info')
        showState(await backend.studyState())
      } else {
        toast(e instanceof Error ? e.message : 'Something went wrong', 'error')
      }
    },
    [backend, showState, toast],
  )

  const answer = useCallback(
    async (rating: Rating) => {
      if (!card || side !== 'answer' || busy.current) return
      busy.current = true
      const ms = performance.now() - shownAt.current
      setSending(true)
      try {
        // If the Wi-Fi drops, keep the answer and send it when the Pi is back.
        // Retrying is safe: if the first attempt did arrive, the server rejects
        // the repeat as a stale card and we just refresh.
        for (;;) {
          try {
            const res = await backend.answer(card.card_id, rating, ms)
            setAnswered((a) => [...a, { rating, ms }])
            if (res.result.leech) toast('Card marked as a leech', 'info')
            showState(res.state)
            break
          } catch (e) {
            if (e instanceof BackendError && e.kind === 'Network') {
              await whenOnline()
              continue
            }
            throw e
          }
        }
      } catch (e) {
        await handleError(e)
      } finally {
        busy.current = false
        setSending(false)
      }
    },
    [backend, card, handleError, showState, side, toast],
  )

  const undo = useCallback(async () => {
    if (!state?.can_undo || busy.current) return
    busy.current = true
    try {
      const res = await backend.undo()
      if (res.result.was_answer) setAnswered((a) => a.slice(0, -1))
      showState(res.state)
      toast(`Undid ${res.result.undone.toLowerCase()}`)
    } catch (e) {
      await handleError(e)
    } finally {
      busy.current = false
    }
  }, [backend, handleError, showState, state, toast])

  const performAction = useCallback(
    async (action: CardAction) => {
      if (!card || busy.current) return
      if (action.kind === 'info') return setSheet('info')
      if (action.kind === 'edit') return setSheet('edit')
      if (action.kind === 'replay') return audio.play(audioUrls(side === 'question' ? 'q' : 'a'))
      busy.current = true
      try {
        if (action.kind === 'flag') {
          const flag = await backend.setFlag(card.card_id, action.flag)
          setState((st) => (st?.card ? { ...st, card: { ...st.card, flag }, can_undo: true, undo_label: 'Set Flag' } : st))
          toast(flag ? `${FLAG_NAMES[flag]} flag` : 'Flag removed')
        } else if (action.kind === 'mark') {
          const marked = await backend.toggleMark(card.note_id)
          setState((st) => (st?.card ? { ...st, card: { ...st.card, marked }, can_undo: true } : st))
          toast(marked ? 'Note marked' : 'Note unmarked')
        } else {
          const next = action.kind === 'bury' ? await backend.bury(card.card_id, action.note) : await backend.suspend(card.card_id, action.note)
          showState(next)
          const what = action.note ? 'Note' : 'Card'
          toast(`${what} ${action.kind === 'bury' ? 'buried' : 'suspended'} · ${modKey}Z to undo`)
        }
      } catch (e) {
        await handleError(e)
      } finally {
        busy.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, card, handleError, showState, side, toast],
  )

  const reloadCard = useCallback(async () => {
    if (!card) return
    const rendered = await backend.renderCard(card.card_id)
    // The typed-answer comparison depends on the (possibly edited) answer field.
    if (rendered.type_answer && side === 'answer') {
      setTypeAnswerHtml(await backend.compareAnswer(card.card_id, typed.current))
    }
    setState((st) => (st?.card ? { ...st, card: { ...st.card, rendered }, can_undo: true, undo_label: 'Update Note' } : st))
    setSeq((n) => n + 1) // re-render at the current side
    toast('Note saved')
  }, [backend, card, side, toast])

  const handleKey = useCallback(
    (e: CardKeyEvent & { repeat?: boolean }) => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'k') return onOpenPalette()
      if (mod && key === 'z') return void undo()
      if (card && e.ctrlKey && /^[1-7]$/.test(e.key)) return void performAction({ kind: 'flag', flag: Number(e.key) })
      if (mod || e.altKey || e.repeat) return
      if (!card) {
        // Finished screen: Enter goes back; Space does nothing so a fast
        // double-press after the last card doesn't skip the summary.
        if (e.key === 'Enter') navigate({ name: 'home' })
        return
      }
      if (e.key === ' ' || e.key === 'Enter') {
        if (side === 'question') flip()
        else void answer(3)
      } else if (/^[1-4]$/.test(e.key) && side === 'answer') {
        void answer(Number(e.key) as Rating)
      } else {
        // Anki desktop's reviewer shortcuts
        const action: CardAction | undefined = {
          '*': { kind: 'mark' },
          '-': { kind: 'bury', note: false },
          '=': { kind: 'bury', note: true },
          '@': { kind: 'suspend', note: false },
          '!': { kind: 'suspend', note: true },
          r: { kind: 'replay' },
          e: { kind: 'edit' },
          i: { kind: 'info' },
        }[key] as CardAction | undefined
        if (action) void performAction(action)
      }
    },
    [answer, card, flip, onOpenPalette, performAction, side, undo],
  )

  useEffect(() => {
    if (inputPaused) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      const mod = e.metaKey || e.ctrlKey
      const handled = mod
        ? e.key.toLowerCase() === 'z' || (e.ctrlKey && /^[1-7]$/.test(e.key))
        : e.key === ' ' || e.key === 'Enter' || /^[1-4]$/.test(e.key) || '*-=@!rReEiI'.includes(e.key)
      if (!handled) return
      // Let Enter/Space activate a focused button on the finished screen.
      if ((e.key === ' ' || e.key === 'Enter') && t.tagName === 'BUTTON' && !card) return
      e.preventDefault()
      handleKey(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, handleKey, inputPaused])

  const onCardKey = useCallback((e: CardKeyEvent) => !inputPaused && handleKey(e), [handleKey, inputPaused])

  const onPlay = useCallback(
    (ref: string) => {
      const [, s, idx] = ref.split(':')
      const hit = card?.rendered.audio.find((a) => a.side === s && a.index === Number(idx))
      if (hit) audio.play([mediaBase + encodeURIComponent(hit.filename)])
    },
    [audio, card, mediaBase],
  )

  // Session numbers
  const done = answered.length
  const remaining = state ? state.counts.new + state.counts.learning + state.counts.review : 0
  const progress = done + remaining === 0 ? 0 : done / (done + remaining)
  const correct = answered.filter((a) => a.rating > 1).length
  const avgMs = done ? answered.reduce((s, a) => s + a.ms, 0) / done : 0
  const elapsed = now - startedAt

  const deckTitle = state?.deck_name.split('::') ?? []

  return (
    <div className="study">
      <TopBar
        onOpenPalette={onOpenPalette}
        left={
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'home' })} className="back-btn">
            <ArrowLeft size={16} strokeWidth={2} />
            <span className="back-btn__text">Decks</span>
          </Button>
        }
        center={
          state && (
            <div className="study-title">
              <span className="study-title__deck" title={state.deck_name}>
                {deckTitle.length > 1 && <span className="study-title__parent">{deckTitle.slice(0, -1).join(' / ')} / </span>}
                <span className="study-title__leaf">{deckTitle[deckTitle.length - 1]}</span>
              </span>
              <CountPills counts={state.counts} active={card?.queue ?? null} size="sm" />
            </div>
          )
        }
        right={
          <>
            <Button
              variant="ghost"
              iconOnly
              onClick={() => void undo()}
              disabled={!state?.can_undo}
              aria-label={state?.undo_label ? `Undo ${state.undo_label}` : 'Undo'}
              title={`Undo${state?.undo_label ? ` ${state.undo_label}` : ''} (${modKey}Z)`}
            >
              <RotateCcw size={17} strokeWidth={1.9} />
            </Button>
            <ActionsMenu
              flag={card?.flag ?? 0}
              marked={card?.marked ?? false}
              hasAudio={(card?.rendered.audio.length ?? 0) > 0}
              disabled={!card}
              onAction={(a) => void performAction(a)}
            />
          </>
        }
      />
      <div
        className="progress"
        role="progressbar"
        aria-label="Session progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div className="progress__bar" style={{ transform: `scaleX(${progress})` }} />
      </div>

      {loadError ? (
        <div className="study__message">
          <p>Couldn’t open this deck: {loadError}</p>
          <Button onClick={() => navigate({ name: 'home' })}>Back to decks</Button>
        </div>
      ) : state && !card ? (
        <Finished deckName={deckTitle[deckTitle.length - 1] ?? ''} answered={answered} elapsed={elapsed} avgMs={avgMs} canUndo={state.can_undo} onUndo={() => void undo()} />
      ) : (
        <>
          <div className="stage">
            <div className={`card-surface ${state ? '' : 'is-loading'}`}>
              <CardFrame
                renderKey={`${seq}:${side}`}
                rendered={card?.rendered ?? null}
                side={side}
                theme={theme}
                mediaBaseUrl={mediaBase}
                typeAnswerHtml={typeAnswerHtml}
                onKey={onCardKey}
                onTap={flip}
                onPlay={onPlay}
                onTyped={(v) => (typed.current = v)}
              />
              {card && (card.flag > 0 || card.marked) && (
                <div className="card-badges">
                  {card.flag > 0 && (
                    <Flag size={14} fill={`var(--flag-${card.flag})`} color={`var(--flag-${card.flag})`} aria-label={`${FLAG_NAMES[card.flag]} flag`} />
                  )}
                  {card.marked && <Star size={14} fill="currentColor" aria-label="Marked" />}
                </div>
              )}
            </div>
          </div>

          <footer className="answer-bar">
            <div className="answer-bar__stats tabular" aria-label="Session stats">
              <span>
                <strong>{done}</strong> reviewed
              </span>
              <span>
                <strong>{done ? Math.round((correct / done) * 100) : 0}%</strong> correct
              </span>
              <span>
                <strong>{formatDuration(elapsed)}</strong>
              </span>
            </div>
            <div className="answer-bar__actions">
              {side === 'question' ? (
                <button className="show-answer" onClick={flip} disabled={!card}>
                  Show answer
                  <Kbd className="show-answer__kbd">Space</Kbd>
                </button>
              ) : (
                <div className={`ease-buttons ${sending ? 'is-sending' : ''}`} role="group" aria-label="Rate your recall">
                  {BUTTONS.map((b, i) => (
                    <button key={b.rating} className={`ease ease--${b.tone}`} onClick={() => void answer(b.rating)}>
                      <span className="ease__ivl tabular">{card?.button_labels[i]}</span>
                      <span className="ease__label">{b.label}</span>
                      <Kbd className="ease__kbd">{b.rating}</Kbd>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="answer-bar__meta">
              {card && (
                <span className="queue-tag" data-queue={card.queue}>
                  {card.queue === 'new' ? 'New' : card.queue === 'learning' ? 'Learning' : 'Review'}
                </span>
              )}
            </div>
          </footer>
        </>
      )}
      <CardInfoPanel cardId={card?.card_id ?? null} open={sheet === 'info'} onClose={() => setSheet(null)} />
      <NoteEditor
        noteId={card?.note_id ?? null}
        open={sheet === 'edit'}
        onClose={() => setSheet(null)}
        onSaved={() => void reloadCard()}
      />
    </div>
  )
}

function Finished({
  deckName,
  answered,
  elapsed,
  avgMs,
  canUndo,
  onUndo,
}: {
  deckName: string
  answered: Answered[]
  elapsed: number
  avgMs: number
  canUndo: boolean
  onUndo(): void
}) {
  const n = answered.length
  const byRating = [1, 2, 3, 4].map((r) => answered.filter((a) => a.rating === r).length)
  const correct = n ? Math.round(((n - byRating[0]) / n) * 100) : 0
  return (
    <div className="finished">
      <div className="finished__icon">
        <Check size={28} strokeWidth={2.4} />
      </div>
      <h1 className="finished__title">{n ? 'Nice work.' : 'Nothing due here'}</h1>
      <p className="finished__sub">
        {n ? `You’re done with ${deckName} for now.` : `${deckName} has no cards due right now. Check back later.`}
      </p>
      {n > 0 && (
        <>
          <dl className="finished__stats tabular">
            <div>
              <dt>Reviewed</dt>
              <dd>{n}</dd>
            </div>
            <div>
              <dt>Correct</dt>
              <dd>{correct}%</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatDuration(elapsed)}</dd>
            </div>
            <div>
              <dt>Per card</dt>
              <dd>{(avgMs / 1000).toFixed(1)}s</dd>
            </div>
          </dl>
          <div className="dist" aria-label="Answers by button">
            {BUTTONS.map((b, i) =>
              byRating[i] ? (
                <div key={b.rating} className={`dist__seg dist__seg--${b.tone}`} style={{ flexGrow: byRating[i] }} title={`${b.label}: ${byRating[i]}`}>
                  <span>{byRating[i]}</span>
                </div>
              ) : null,
            )}
          </div>
          <div className="dist__legend">
            {BUTTONS.map((b, i) => (
              <span key={b.rating} className={`dist__key dist__key--${b.tone}`}>
                {b.label} {byRating[i]}
              </span>
            ))}
          </div>
        </>
      )}
      <div className="finished__actions">
        <Button variant="primary" size="lg" onClick={() => navigate({ name: 'home' })}>
          Back to decks
          <kbd className="kbd kbd--on-accent">↵</kbd>
        </Button>
        {canUndo && (
          <Button variant="ghost" size="lg" onClick={onUndo}>
            <RotateCcw size={16} /> Undo last
          </Button>
        )}
      </div>
    </div>
  )
}
