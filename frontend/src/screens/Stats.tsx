import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBackend } from '../backend/context'
import type { RetentionCounts, RetentionPeriod, StatsSummary } from '../backend/types'
import { ChartCard, DataTable } from '../components/charts/ChartCard'
import { ColumnChart, type DayValues, type Series } from '../components/charts/ColumnChart'
import { Heatmap } from '../components/charts/Heatmap'
import { MaturityBar, type Segment } from '../components/charts/MaturityBar'
import { compact, dayLabel, duration, fmt, longDate, pct } from '../components/charts/util'
import { flattenDecks, useDecks } from '../lib/decks'
import { navigate } from '../lib/router'

const PERIODS = [
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
]

// Maturity is ordinal (new → learning → young → mature), so one hue, light → dark.
const REVIEW_SERIES: Series[] = [
  { key: 'learning', label: 'Learning', color: 'var(--mat-2)' },
  { key: 'young', label: 'Young', color: 'var(--mat-3)' },
  { key: 'mature', label: 'Mature', color: 'var(--mat-4)' },
]
const DUE_SERIES: Series[] = [{ key: 'due', label: 'Due', color: 'var(--chart-1)' }]

function retentionRate(r: RetentionCounts | undefined): { all: number | null; young: number | null; mature: number | null } {
  if (!r) return { all: null, young: null, mature: null }
  const rate = (p: number, f: number) => (p + f ? p / (p + f) : null)
  return {
    all: rate(r.young_passed + r.mature_passed, r.young_failed + r.mature_failed),
    young: rate(r.young_passed, r.young_failed),
    mature: rate(r.mature_passed, r.mature_failed),
  }
}

/** Current streak (today or yesterday counts as unbroken) and best in window. */
function streaks(days: Set<number>, window: number): { current: number; best: number } {
  let current = 0
  for (let d = days.has(0) ? 0 : -1; days.has(d); d--) current++
  let best = 0
  let run = 0
  for (let d = -(window - 1); d <= 0; d++) {
    run = days.has(d) ? run + 1 : 0
    best = Math.max(best, run)
  }
  return { current, best }
}

function Tile({ label, value, sub, loading }: { label: string; value: ReactNode; sub?: ReactNode; loading?: boolean }) {
  return (
    <div className="tile">
      <div className="tile__label">{label}</div>
      <div className="tile__value">{loading ? <span className="skeleton skeleton--tile" /> : value}</div>
      <div className="tile__sub">{loading ? <span className="skeleton skeleton--text" style={{ width: '70%' }} /> : sub}</div>
    </div>
  )
}

export function Stats({ deckId, days }: { deckId: number | null; days: number }) {
  const backend = useBackend()
  const { decks } = useDecks()
  const [data, setData] = useState<StatsSummary | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const request = useRef(0)
  const key = `${deckId}:${days}`

  useEffect(() => {
    const id = ++request.current
    backend.stats(deckId, days).then(
      (s) => id === request.current && setData(s),
      (e: Error) => id === request.current && setFailure({ key: `${deckId}:${days}`, message: e.message }),
    )
  }, [backend, deckId, days])

  // Derived, so no state juggling: loading until data for these filters arrives.
  const error = failure?.key === key ? failure.message : null
  const loading = !error && (!data || data.days !== days || data.deck_id !== deckId)

  const setFilter = (next: { deckId?: number | null; days?: number }) =>
    navigate({ name: 'stats', deckId: next.deckId !== undefined ? next.deckId : deckId, days: next.days ?? days }, { replace: true })

  // While new filters load, keep showing the previous result (dimmed).
  const view = data
  const from = -((view?.days ?? days) - 1)

  const derived = useMemo(() => {
    if (!view) return null
    const reviewDays: DayValues[] = view.reviews.map((r) => ({
      day: r.day,
      values: { learning: r.learn + r.relearn + r.filtered, young: r.young, mature: r.mature },
    }))
    const perDay = new Map(view.reviews.map((r) => [r.day, r.learn + r.relearn + r.young + r.mature + r.filtered]))
    const total = [...perDay.values()].reduce((a, b) => a + b, 0)
    const seconds = view.reviews.reduce((a, r) => a + r.seconds, 0)
    const active = new Set([...perDay.entries()].filter(([, n]) => n > 0).map(([d]) => d))
    const forecastTo = view.days - 1
    const forecast: DayValues[] = view.forecast
      .filter((f) => f.day <= forecastTo)
      .map((f) => ({ day: f.day, values: { due: f.count } }))
    const dueTotal = forecast.reduce((a, f) => a + f.values.due, 0)
    return { reviewDays, perDay, total, seconds, active, forecast, forecastTo, dueTotal }
  }, [view])

  const retentionKey: RetentionPeriod = (view?.days ?? days) >= 365 ? 'year' : 'month'
  const retention = retentionRate(view?.retention[retentionKey])
  const streak = derived ? streaks(derived.active, view!.days) : null
  const dueTomorrow = view?.forecast.find((f) => f.day === 1)?.count ?? 0
  const dueToday = view?.forecast.find((f) => f.day === 0)?.count ?? 0

  const segments: Segment[] = view
    ? [
        { key: 'new', label: 'New', color: 'var(--mat-1)', value: view.cards.new },
        { key: 'learning', label: 'Learning', color: 'var(--mat-2)', value: view.cards.learning },
        { key: 'young', label: 'Young', color: 'var(--mat-3)', value: view.cards.young, hint: 'interval < 21 days' },
        { key: 'mature', label: 'Mature', color: 'var(--mat-4)', value: view.cards.mature, hint: 'interval ≥ 21 days' },
        {
          key: 'inactive',
          label: 'Suspended & buried',
          color: 'var(--chart-other)',
          value: view.cards.suspended + view.cards.buried,
        },
      ]
    : []
  const totalCards = segments.reduce((a, s) => a + s.value, 0)
  const stale = loading && !!data
  const allDecks = decks ? flattenDecks(decks) : []

  return (
    <main className="page page--stats">
      <header className="stats-head">
        <div>
          <h1 className="stats-head__title">Statistics</h1>
          <p className="stats-head__sub">
            {view ? (view.deck_name ?? 'All decks') : ' '}
            {view && ` · ${compact(totalCards)} cards`}
          </p>
        </div>
      </header>

      {/* One filter row, above everything it scopes. */}
      <div className="filters" role="group" aria-label="Filters">
        <label className="select">
          <span className="visually-hidden">Deck</span>
          <select
            value={deckId ?? ''}
            onChange={(e) => setFilter({ deckId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">All decks</option>
            {allDecks.map((d) => (
              <option key={d.id} value={d.id}>
                {' '.repeat(d.level - 1)}
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="segmented" role="radiogroup" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              role="radio"
              aria-checked={days === p.days}
              className="segmented__item"
              onClick={() => setFilter({ days: p.days })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && !data ? (
        <div className="empty">
          <p>Couldn’t load statistics: {error}</p>
        </div>
      ) : (
        <div className={`stats-grid ${stale ? 'is-stale' : ''}`}>
          <section className="tiles" aria-label="Summary">
            <Tile
              loading={!view}
              label="Studied today"
              value={view && fmt(view.today.answered)}
              sub={
                view &&
                (view.today.answered
                  ? `${duration(view.today.seconds)} · ${pct(view.today.correct, view.today.answered)} correct`
                  : 'Nothing yet today')
              }
            />
            <Tile
              loading={!view}
              label="Streak"
              value={streak && `${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}
              sub={streak && `Best ${streak.best} in this period`}
            />
            <Tile
              loading={!view}
              label={`True retention · ${retentionKey === 'year' ? '1 year' : '30 days'}`}
              value={retention.all === null ? '—' : pct(retention.all, 1, 1)}
              sub={
                view &&
                `Young ${retention.young === null ? '—' : pct(retention.young, 1)} · Mature ${
                  retention.mature === null ? '—' : pct(retention.mature, 1)
                }`
              }
            />
            <Tile
              loading={!view}
              label="Due tomorrow"
              value={view && fmt(dueTomorrow)}
              sub={view && `About ${fmt(view.daily_load)} a day ahead`}
            />
            {(!view || view.average_retrievability !== null) && (
              <Tile
                loading={!view}
                label="Recall right now"
                value={view?.average_retrievability != null && pct(view.average_retrievability, 1, 1)}
                sub="Average FSRS retrievability"
              />
            )}
          </section>

          <ChartCard
            title="Review activity"
            subtitle={
              derived ? `${fmt(derived.active.size)} of ${fmt(view!.days)} days studied` : ' '
            }
            stale={stale}
            className="span-2"
            table={
              derived && (
                <DataTable
                  columns={['Day', 'Reviews']}
                  rows={[...derived.perDay.entries()].reverse().map(([d, n]) => [longDate(d), fmt(n)])}
                />
              )
            }
          >
            {derived ? <Heatmap counts={derived.perDay} from={from} unit="reviews" /> : <div className="chart-skeleton" style={{ height: 160 }} />}
          </ChartCard>

          <ChartCard
            title="Reviews"
            subtitle={
              derived
                ? `${fmt(derived.total)} reviews · ${fmt(derived.total / view!.days)} a day · ${duration(derived.seconds)}`
                : ' '
            }
            legend={REVIEW_SERIES}
            stale={stale}
            className="span-2"
            table={
              derived && (
                <DataTable
                  columns={['Day', 'Learning', 'Young', 'Mature', 'Total']}
                  rows={[...derived.reviewDays].reverse().map((d) => [
                    longDate(d.day),
                    fmt(d.values.learning),
                    fmt(d.values.young),
                    fmt(d.values.mature),
                    fmt(d.values.learning + d.values.young + d.values.mature),
                  ])}
                />
              )
            }
          >
            {derived ? (
              <ColumnChart series={REVIEW_SERIES} data={derived.reviewDays} from={from} to={0} unit="reviews" ariaLabel="Reviews per day by card maturity" />
            ) : (
              <div className="chart-skeleton" style={{ height: 200 }} />
            )}
          </ChartCard>

          <ChartCard
            title="Upcoming reviews"
            subtitle={
              view && derived
                ? `${fmt(dueToday)} due today${view.overdue ? ` (${fmt(view.overdue)} overdue)` : ''} · ${fmt(derived.dueTotal)} in the next ${fmt(view.days)} days`
                : ' '
            }
            stale={stale}
            table={
              derived && (
                <DataTable
                  columns={['Day', 'Due']}
                  rows={derived.forecast.map((f) => [dayLabel(f.day), fmt(f.values.due)])}
                />
              )
            }
          >
            {derived ? (
              <ColumnChart series={DUE_SERIES} data={derived.forecast} from={0} to={derived.forecastTo} unit="cards due" height={180} ariaLabel="Cards due per day" />
            ) : (
              <div className="chart-skeleton" style={{ height: 180 }} />
            )}
          </ChartCard>

          <ChartCard
            title="Card maturity"
            subtitle={view ? `${fmt(totalCards)} cards` : ' '}
            stale={stale}
            table={<DataTable columns={['Status', 'Cards', 'Share']} rows={segments.map((s) => [s.label, fmt(s.value), pct(s.value, totalCards)])} />}
          >
            {view ? <MaturityBar segments={segments} /> : <div className="chart-skeleton" style={{ height: 180 }} />}
          </ChartCard>
        </div>
      )}
    </main>
  )
}
