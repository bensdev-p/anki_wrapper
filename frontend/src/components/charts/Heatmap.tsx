import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Tooltip } from './Tooltip'
import { dayLabel, dayToDate, fmt, useWidth } from './util'

interface Props {
  /** Review count per day offset (0 = today). Missing = 0. */
  counts: Map<number, number>
  /** First day shown (negative), through today. */
  from: number
  unit: string
}

const GAP = 3
const MIN_CELL = 10
const MAX_CELL = 16
const MAX_CELL_FEW_WEEKS = 26 // a month is only ~5 columns; let it breathe
const LEFT = 30 // weekday labels
const TOP = 18 // month labels
const LEVELS = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)']

/** Quartile thresholds over active days, so the scale adapts to her volume. */
function thresholds(values: number[]): number[] {
  const v = values.filter((n) => n > 0).sort((a, b) => a - b)
  if (!v.length) return [1, 2, 3]
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
  return [q(0.25), q(0.5), q(0.75)]
}

function level(n: number, t: number[]): number {
  if (n <= 0) return 0
  if (n <= t[0]) return 1
  if (n <= t[1]) return 2
  if (n <= t[2]) return 3
  return 4
}

/** GitHub-style calendar: one column per week, one row per weekday. */
export function Heatmap({ counts, from, unit }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const scroller = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [scrollLeft, setScrollLeft] = useState(0)

  // Column/row for every day; weeks start on the locale's usual Sunday.
  const layout = useMemo(() => {
    const startDow = dayToDate(from).getDay()
    const cells: { day: number; col: number; row: number }[] = []
    for (let day = from; day <= 0; day++) {
      const idx = day - from + startDow
      cells.push({ day, col: Math.floor(idx / 7), row: idx % 7 })
    }
    const cols = cells[cells.length - 1].col + 1
    return { cells, cols }
  }, [from])

  const t = useMemo(() => thresholds([...counts.values()]), [counts])
  const maxCell = layout.cols <= 16 ? MAX_CELL_FEW_WEEKS : MAX_CELL
  const cell = Math.max(MIN_CELL, Math.min(maxCell, Math.floor((width - LEFT) / layout.cols) - GAP))
  const step = cell + GAP
  const svgW = LEFT + layout.cols * step
  const svgH = TOP + 7 * step

  // Newest weeks matter most: start scrolled to the right on narrow screens.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [svgW])

  const months = layout.cells.filter((c) => dayToDate(c.day).getDate() === 1 || c.day === from)
  const firstMonthLabelTooClose = months.length > 1 && months[1].col - months[0].col < 3

  const at = (col: number, row: number) => layout.cells.find((c) => c.col === col && c.row === row)

  const onPointer = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const col = Math.floor((e.clientX - rect.left - LEFT) / step)
    const row = Math.floor((e.clientY - rect.top - TOP) / step)
    setActive(at(col, row)?.day ?? null)
  }
  const onKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }
    if (!(e.key in moves)) return
    e.preventDefault()
    setActive((a) => Math.min(0, Math.max(from, (a ?? 0) + moves[e.key])))
  }

  const hovered = active !== null ? layout.cells.find((c) => c.day === active) : null

  return (
    <div className="heatmap" ref={wrapRef}>
      <div className="heatmap__scroll" ref={scroller} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
        {width > 0 && (
          <svg
            width={svgW}
            height={svgH}
            role="img"
            aria-label={`Calendar of ${unit} per day. Use arrow keys to read values.`}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            className="chart__svg"
          >
            {['Mon', 'Wed', 'Fri'].map((d, i) => (
              <text key={d} x={0} y={TOP + (1 + i * 2) * step + cell / 2} dy="0.32em" className="chart__tick">
                {d}
              </text>
            ))}
            {months.map((m, i) =>
              i === 0 && firstMonthLabelTooClose ? null : (
                <text key={m.day} x={LEFT + m.col * step} y={11} className="chart__tick">
                  {dayToDate(m.day).toLocaleDateString(undefined, { month: 'short' })}
                </text>
              ),
            )}
            {layout.cells.map((c) => {
              const n = counts.get(c.day) ?? 0
              return (
                <rect
                  key={c.day}
                  x={LEFT + c.col * step}
                  y={TOP + c.row * step}
                  width={cell}
                  height={cell}
                  rx={3}
                  fill={LEVELS[level(n, t)]}
                  stroke={c.day === active ? 'var(--text)' : 'none'}
                  strokeWidth={1.5}
                />
              )
            })}
          </svg>
        )}
      </div>
      <div className="heatmap__legend" aria-hidden="true" style={{ maxWidth: svgW }}>
        <span>Less</span>
        {LEVELS.map((c) => (
          <span key={c} className="heatmap__swatch" style={{ background: c }} />
        ))}
        <span>More</span>
      </div>
      {hovered && (
        <Tooltip
          x={LEFT + hovered.col * step + cell - scrollLeft}
          y={TOP + hovered.row * step - 8}
          containerWidth={width}
          title={dayLabel(hovered.day)}
          rows={[{ key: 'n', value: fmt(counts.get(hovered.day) ?? 0), label: unit }]}
        />
      )}
    </div>
  )
}
