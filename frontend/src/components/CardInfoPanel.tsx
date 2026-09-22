import { useEffect, useState } from 'react'
import { useBackend } from '../backend/context'
import type { CardInfo, RevlogEntry } from '../backend/types'
import { DataTable } from './charts/ChartCard'
import { Sheet } from './Sheet'

const BUTTON = ['', 'Again', 'Hard', 'Good', 'Easy']
const KIND: Record<RevlogEntry['kind'], string> = {
  learning: 'Learn',
  review: 'Review',
  relearning: 'Relearn',
  filtered: 'Filtered',
  manual: 'Manual',
  rescheduled: 'Rescheduled',
}

const date = (unix: number | null) =>
  unix ? new Date(unix * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

function interval(secs: number): string {
  if (secs <= 0) return '—'
  if (secs < 3600) return `${Math.round(secs / 60)}m`
  if (secs < 86400) return `${Math.round(secs / 3600)}h`
  const d = secs / 86400
  if (d < 31) return `${Math.round(d)}d`
  if (d < 365) return `${(d / 30.4).toFixed(1)}mo`
  return `${(d / 365).toFixed(1)}y`
}

function days(n: number | null): string {
  if (n === null) return '—'
  return interval(n * 86400)
}

function dueLabel(due: string | null): string {
  if (!due) return '—'
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(due)
  return iso ? new Date(`${due}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : due
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {hint && <span className="fact__hint">{hint}</span>}
    </div>
  )
}

/** Anki's Card Info, as a panel: key facts, FSRS memory state, review history. */
export function CardInfoPanel({ cardId, open, onClose }: { cardId: number | null; open: boolean; onClose(): void }) {
  const backend = useBackend()
  const [info, setInfo] = useState<CardInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || cardId === null) return
    let cancelled = false
    backend.cardInfo(cardId).then(
      (i) => !cancelled && (setInfo(i), setError(null)),
      (e: Error) => !cancelled && setError(e.message),
    )
    return () => {
      cancelled = true
    }
  }, [backend, cardId, open])

  const current = info && info.card_id === cardId ? info : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Card info"
      subtitle={current ? `${current.deck} · ${current.notetype} · ${current.card_type}` : ' '}
    >
      {error && !current ? (
        <p className="sheet__error">{error}</p>
      ) : !current ? (
        <div className="facts facts--loading" />
      ) : (
        <>
          <dl className="facts">
            <Fact label="Added" value={date(current.added)} />
            <Fact label="First review" value={date(current.first_review)} />
            <Fact label="Latest review" value={date(current.latest_review)} />
            <Fact label="Due" value={dueLabel(current.due)} />
            <Fact label="Interval" value={days(current.interval_days || null)} />
            <Fact label="Reviews" value={String(current.reviews)} />
            <Fact label="Lapses" value={String(current.lapses)} />
            <Fact label="Average time" value={`${current.average_secs}s`} />
            {current.fsrs ? (
              <>
                <Fact label="Stability" value={days(current.stability_days)} hint="Time until recall drops to 90%" />
                <Fact label="Difficulty" value={current.difficulty === null ? '—' : `${current.difficulty.toFixed(1)} / 10`} />
                <Fact
                  label="Retrievability"
                  value={current.retrievability === null ? '—' : `${(current.retrievability * 100).toFixed(0)}%`}
                  hint="Chance of recalling it now"
                />
                <Fact label="Preset" value={current.preset} />
              </>
            ) : (
              <>
                <Fact label="Ease" value={current.ease ? `${current.ease / 10}%` : '—'} />
                <Fact label="Preset" value={current.preset} />
              </>
            )}
          </dl>
          {current.tags.length > 0 && (
            <ul className="tag-list" aria-label="Tags">
              {current.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
          <h3 className="sheet__section">Review history</h3>
          {current.revlog.length === 0 ? (
            <p className="sheet__muted">Not reviewed yet.</p>
          ) : (
            <div className="chart-table-wrap">
              <DataTable
                columns={['Date', 'Type', 'Rating', 'Interval', ...(current.fsrs ? ['Stability'] : []), 'Time']}
                rows={current.revlog.map((r) => [
                  date(r.time),
                  KIND[r.kind],
                  BUTTON[r.button] ?? '—',
                  interval(r.interval_secs),
                  ...(current.fsrs ? [days(r.stability_days)] : []),
                  `${r.taken_secs}s`,
                ])}
              />
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}
