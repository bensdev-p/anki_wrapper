import { Table2, BarChart3 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

export interface LegendItem {
  key: string
  label: string
  color: string
}

interface Props {
  title: string
  subtitle?: ReactNode
  /** Shown for two or more series (never for one). */
  legend?: LegendItem[]
  /** The accessible twin of the chart. */
  table: ReactNode
  stale?: boolean
  className?: string
  children: ReactNode
}

/** Figure shell: title, legend, chart ↔ table toggle, stale-while-loading. */
export function ChartCard({ title, subtitle, legend, table, stale, className = '', children }: Props) {
  const [asTable, setAsTable] = useState(false)
  const id = useId()
  return (
    <figure className={`chart-card ${stale ? 'is-stale' : ''} ${className}`} aria-labelledby={id} aria-busy={stale}>
      <header className="chart-card__head">
        <div>
          <h2 id={id} className="chart-card__title">
            {title}
          </h2>
          {subtitle && <p className="chart-card__sub">{subtitle}</p>}
        </div>
        <button
          className="chart-card__toggle"
          onClick={() => setAsTable((t) => !t)}
          aria-pressed={asTable}
          title={asTable ? 'Show chart' : 'Show as table'}
          aria-label={asTable ? 'Show chart' : 'Show as table'}
        >
          {asTable ? <BarChart3 size={16} /> : <Table2 size={16} />}
        </button>
      </header>
      {legend && legend.length > 1 && !asTable && (
        <ul className="chart-legend" aria-label="Legend">
          {legend.map((l) => (
            <li key={l.key}>
              <span className="chart-legend__swatch" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      )}
      <div className="chart-card__body">{asTable ? <div className="chart-table-wrap">{table}</div> : children}</div>
    </figure>
  )
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <table className="chart-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
