import { useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Tooltip } from './Tooltip'
import { fmt, niceTicks, rangeLabel, shortDate, useWidth } from './util'

export interface Series {
  key: string
  label: string
  /** A CSS color, normally a chart token: 'var(--mat-2)'. */
  color: string
}

export interface DayValues {
  day: number
  values: Record<string, number>
}

interface Props {
  series: Series[]
  /** One entry per day from `from` to `to` inclusive (missing days = zero). */
  data: DayValues[]
  from: number
  to: number
  /** Unit for the tooltip total, e.g. "reviews". */
  unit: string
  height?: number
  ariaLabel: string
}

const M = { top: 8, right: 4, bottom: 24, left: 40 }
const MIN_SLOT = 6 // px per column: ≥4px bar + 2px surface gap
const MAX_BAR = 24
const GAP = 2 // surface gap between stacked segments
const RADIUS = 4 // rounded data end; square at the baseline

interface Bucket {
  from: number
  to: number
  values: Record<string, number>
  total: number
}

/** Stacked (or single-series) columns over days, bucketed to fit the width. */
export function ColumnChart({ series, data, from, to, unit, height = 200, ariaLabel }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const plotW = Math.max(0, width - M.left - M.right)
  const plotH = height - M.top - M.bottom
  const days = to - from + 1

  const buckets = useMemo<Bucket[]>(() => {
    const perBucket = Math.max(1, Math.ceil(days / Math.max(1, Math.floor(plotW / MIN_SLOT))))
    const byDay = new Map(data.map((d) => [d.day, d.values]))
    const out: Bucket[] = []
    // Align buckets to end on `to`, so the latest bucket is always complete.
    for (let end = to; end >= from; end -= perBucket) {
      const start = Math.max(from, end - perBucket + 1)
      const values: Record<string, number> = {}
      for (const s of series) values[s.key] = 0
      for (let d = start; d <= end; d++) {
        const v = byDay.get(d)
        if (v) for (const s of series) values[s.key] += v[s.key] ?? 0
      }
      out.unshift({ from: start, to: end, values, total: series.reduce((a, s) => a + values[s.key], 0) })
    }
    return out
  }, [data, days, from, to, plotW, series])

  const max = Math.max(1, ...buckets.map((b) => b.total))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]
  const y = (v: number) => M.top + plotH - (v / top) * plotH
  const slot = buckets.length ? plotW / buckets.length : 0
  const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP))

  // A handful of x labels at evenly spaced buckets.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotW / 72))))
  const xLabels = buckets
    .map((b, i) => ({ i, b }))
    .filter(({ i }) => (buckets.length - 1 - i) % labelEvery === 0)

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - rect.left - M.left) / slot)
    setActive(i >= 0 && i < buckets.length ? i : null)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    setActive((a) => {
      const last = buckets.length - 1
      if (e.key === 'Home') return 0
      if (e.key === 'End') return last
      const cur = a ?? last
      return Math.min(last, Math.max(0, cur + (e.key === 'ArrowLeft' ? -1 : 1)))
    })
  }

  const hovered = active !== null ? buckets[active] : null

  return (
    <div className="chart" ref={wrapRef} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${ariaLabel}. Use arrow keys to read values.`}
          tabIndex={0}
          onPointerMove={onPointer}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          className="chart__svg"
        >
          {/* grid + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={M.left}
                x2={width - M.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="chart__tick">
                {fmt(t)}
              </text>
            </g>
          ))}

          {/* hover wash */}
          {active !== null && (
            <rect x={M.left + active * slot} y={M.top} width={slot} height={plotH} fill="var(--surface-hover)" />
          )}

          {/* columns */}
          {buckets.map((b, i) => {
            const x = M.left + i * slot + (slot - barW) / 2
            let base = y(0)
            const nonZero = series.filter((s) => b.values[s.key] > 0)
            return (
              <g key={b.from}>
                {nonZero.map((s, k) => {
                  const h = (b.values[s.key] / top) * plotH
                  const isTop = k === nonZero.length - 1
                  const segTop = base - h
                  // 2px surface gap above every segment that has another on top of it
                  const drawnTop = isTop ? segTop : segTop + GAP
                  const hh = base - drawnTop
                  base = segTop
                  if (hh <= 0.5) return null
                  const r = isTop ? Math.min(RADIUS, barW / 2, hh) : 0
                  return (
                    <path
                      key={s.key}
                      d={`M${x},${drawnTop + hh} V${drawnTop + r} Q${x},${drawnTop} ${x + r},${drawnTop} H${x + barW - r} Q${x + barW},${drawnTop} ${x + barW},${drawnTop + r} V${drawnTop + hh} Z`}
                      fill={s.color}
                    />
                  )
                })}
              </g>
            )
          })}

          {/* x labels */}
          {xLabels.map(({ i, b }) => (
            <text key={i} x={M.left + i * slot + slot / 2} y={height - 6} textAnchor="middle" className="chart__tick">
              {shortDate(b.from)}
            </text>
          ))}
        </svg>
      )}
      {hovered && active !== null && (
        <Tooltip
          x={M.left + (active + 0.5) * slot}
          y={M.top}
          containerWidth={width}
          title={rangeLabel(hovered.from, hovered.to)}
          rows={[
            ...(series.length > 1 ? [{ key: '_total', value: fmt(hovered.total), label: `${unit} total` }] : []),
            ...[...series].reverse().map((s) => ({
              key: s.key,
              color: s.color,
              value: fmt(hovered.values[s.key]),
              label: series.length > 1 ? s.label : unit,
            })),
          ]}
        />
      )}
    </div>
  )
}
