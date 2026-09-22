import type { ReactNode } from 'react'

export interface TooltipRow {
  key: string
  color?: string
  value: string
  label: string
}

interface Props {
  /** Anchor point in the chart container's coordinates. */
  x: number
  y: number
  containerWidth: number
  title: ReactNode
  rows: TooltipRow[]
}

const WIDTH = 200

/**
 * One tooltip listing every series at the hovered position. Values lead;
 * series keys are short line strokes, not boxes.
 */
export function Tooltip({ x, y, containerWidth, title, rows }: Props) {
  const flip = x + WIDTH + 16 > containerWidth
  const left = flip ? Math.max(0, x - WIDTH - 12) : x + 12
  return (
    <div className="chart-tooltip" style={{ left, top: Math.max(0, y), width: WIDTH }} role="presentation">
      <div className="chart-tooltip__title">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="chart-tooltip__row">
          {r.color && <span className="chart-tooltip__key" style={{ background: r.color }} />}
          <strong className="tabular">{r.value}</strong>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}
