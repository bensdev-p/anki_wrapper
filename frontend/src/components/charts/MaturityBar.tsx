import { useState } from 'react'
import { Tooltip } from './Tooltip'
import { fmt, pct, useWidth } from './util'

export interface Segment {
  key: string
  label: string
  color: string
  value: number
  hint?: string
}

const H = 20
const GAP = 2
const R = 4

/**
 * Part-to-whole as one horizontal bar with 2px surface gaps. The legend under
 * it carries every value (the direct labels), so nothing depends on hover.
 */
export function MaturityBar({ segments }: { segments: Segment[] }) {
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<string | null>(null)
  const total = segments.reduce((a, s) => a + s.value, 0)
  const visible = segments.filter((s) => s.value > 0)
  const usable = Math.max(0, width - GAP * (visible.length - 1))

  const widths = visible.map((s) => Math.max(2, (s.value / total) * usable))
  const rects = visible.map((s, i) => ({
    ...s,
    w: widths[i],
    x: widths.slice(0, i).reduce((a, w) => a + w + GAP, 0),
  }))
  const hovered = rects.find((r) => r.key === active)

  return (
    <div className="maturity">
      <div className="maturity__bar" ref={wrapRef} onPointerLeave={() => setActive(null)}>
        {width > 0 && total > 0 && (
          <svg width={width} height={H} role="img" aria-label="Cards by maturity; values listed below">
            <clipPath id="maturity-clip">
              <rect width={width} height={H} rx={R} />
            </clipPath>
            <g clipPath="url(#maturity-clip)">
              {rects.map((r) => (
                <rect
                  key={r.key}
                  x={r.x}
                  width={r.w}
                  height={H}
                  fill={r.color}
                  opacity={active && active !== r.key ? 0.55 : 1}
                  onPointerEnter={() => setActive(r.key)}
                  style={{ transition: 'opacity 120ms' }}
                />
              ))}
            </g>
          </svg>
        )}
        {hovered && (
          <Tooltip
            x={hovered.x + hovered.w / 2}
            y={H + 6}
            containerWidth={width}
            title={hovered.label}
            rows={[{ key: 'v', color: hovered.color, value: fmt(hovered.value), label: `cards · ${pct(hovered.value, total)}` }]}
          />
        )}
      </div>
      <ul className="maturity__legend">
        {segments.map((s) => (
          <li
            key={s.key}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive(null)}
            className={active === s.key ? 'is-active' : ''}
          >
            <span className="chart-legend__swatch" style={{ background: s.color }} />
            <span className="maturity__label">
              {s.label}
              {s.hint && <span className="maturity__hint">{s.hint}</span>}
            </span>
            <span className="maturity__value tabular">{fmt(s.value)}</span>
            <span className="maturity__pct tabular">{pct(s.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
