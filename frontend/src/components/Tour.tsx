import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { markTourDone, TOUR_EVENT } from '../lib/tour'
import { Button } from './Button'

export interface TourStep {
  /** `data-tour` names to point at; the first one that's on screen wins (desktop vs phone layouts). */
  targets?: string[]
  title: string
  body: string
}

export const HOME_TOUR: TourStep[] = [
  {
    title: 'Welcome to Rounds',
    body: 'A calmer way to study your Anki cards. This quick tour shows where everything is. It takes about a minute, and you can replay it any time from Settings.',
  },
  {
    targets: ['up-next'],
    title: 'Start here',
    body: 'Your decks with cards waiting today. Press Study and Rounds picks the right cards in the right order. That’s all you need most days.',
  },
  {
    targets: ['deck-tree'],
    title: 'All your decks',
    body: 'Big decks like AnKing are folded into sections. Press the arrow to open a section, or a name to study just that part.',
  },
  {
    targets: ['deck-counts'],
    title: 'What the numbers mean',
    body: 'New: cards you haven’t seen yet. Learn: cards you’re still learning today. Due: cards to review so you don’t forget them.',
  },
  {
    targets: ['due-only'],
    title: 'Too much to look at?',
    body: 'Show only the decks that have cards waiting. Everything else stays tucked away.',
  },
  {
    targets: ['deck-filter'],
    title: 'Find a deck fast',
    body: 'Type part of a name, like “cardio”, and press Enter to start studying it.',
  },
  {
    targets: ['sync'],
    title: 'Stay in sync',
    body: 'Sync keeps Rounds, Anki and AnkiMobile on your other devices in step through your AnkiWeb account.',
  },
  {
    targets: ['nav', 'nav-tabs'],
    title: 'Everything else',
    body: 'Browse and edit cards, see your progress in Stats, and change the look or your account in Settings.',
  },
]

const PAD = 8

function findTarget(names: string[] | undefined): HTMLElement | null {
  for (const name of names ?? []) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return el
    }
  }
  return null
}

/**
 * A spotlight walkthrough: dims the page, outlines one element at a time and
 * explains it. Steps whose element isn't on screen are skipped.
 */
export function Tour({ steps, autoStart }: { steps: TourStep[]; autoStart: boolean }) {
  const [index, setIndex] = useState<number | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const card = useRef<HTMLDivElement>(null)

  const available = useCallback((i: number) => !steps[i].targets || !!findTarget(steps[i].targets), [steps])
  const open = useCallback(() => setIndex(0), [])

  useEffect(() => {
    window.addEventListener(TOUR_EVENT, open)
    return () => window.removeEventListener(TOUR_EVENT, open)
  }, [open])

  useEffect(() => {
    if (autoStart) {
      const t = window.setTimeout(open, 600)
      return () => window.clearTimeout(t)
    }
  }, [autoStart, open])

  const close = useCallback(() => {
    markTourDone()
    setIndex(null)
  }, [])

  const go = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => {
        if (i === null) return null
        let next = i + dir
        while (next >= 0 && next < steps.length && !available(next)) next += dir
        if (next >= steps.length) {
          markTourDone()
          return null
        }
        return next < 0 ? i : next
      })
    },
    [steps, available],
  )

  // Follow the highlighted element (scrolling, resizing, the deck list loading).
  useLayoutEffect(() => {
    if (index === null) return
    const target = findTarget(steps[index].targets)
    if (target) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    }
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setRect(findTarget(steps[index].targets)?.getBoundingClientRect() ?? null))
    }
    measure()
    const settle = window.setTimeout(measure, 350)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [index, steps])

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement))) go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, close, go])

  if (index === null) return null
  const step = steps[index]
  const spot = step.targets ? rect : null
  const shown = steps.map((_, i) => i).filter(available)
  const position = shown.indexOf(index) + 1
  const last = position === shown.length

  // Put the card below the spotlight if there's room, else above; centred when there's nothing to point at.
  const style: React.CSSProperties = {}
  if (spot) {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(360, vw - 32)
    style.width = width
    style.left = Math.min(Math.max(16, spot.left + spot.width / 2 - width / 2), vw - width - 16)
    if (vh - spot.bottom > 240) style.top = spot.bottom + PAD + 12
    else if (spot.top > 240) style.bottom = vh - spot.top + PAD + 12
    else style.bottom = 16
  }

  return (
    <div className="tour" role="presentation">
      {spot ? (
        <div
          className="tour__spot"
          style={{ top: spot.top - PAD, left: spot.left - PAD, width: spot.width + PAD * 2, height: spot.height + PAD * 2 }}
        />
      ) : (
        <div className="tour__dim" />
      )}
      <div
        ref={card}
        className={`tour__card ${spot ? '' : 'tour__card--center'}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
      >
        <button className="tour__close" onClick={close} aria-label="Close the tour">
          <X size={16} />
        </button>
        <p className="tour__step tabular">
          {position} of {shown.length}
        </p>
        <h2 id="tour-title" className="tour__title">
          {step.title}
        </h2>
        <p id="tour-body" className="tour__body">
          {step.body}
        </p>
        <div className="tour__actions">
          {position === 1 ? (
            <Button variant="ghost" onClick={close}>
              Skip
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => go(-1)}>
              Back
            </Button>
          )}
          <Button variant="primary" onClick={() => go(1)} autoFocus>
            {position === 1 ? 'Show me around' : last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
