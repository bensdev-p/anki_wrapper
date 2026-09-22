import type { Counts, QueueKind } from '../backend/types'

interface Props {
  counts: Counts
  /** Underline the queue the current card came from (like Anki's reviewer). */
  active?: QueueKind | null
  size?: 'sm' | 'md'
  labels?: boolean
}

const ITEMS: { key: QueueKind; label: string; title: string }[] = [
  { key: 'new', label: 'New', title: 'New cards' },
  { key: 'learning', label: 'Learn', title: 'Learning cards' },
  { key: 'review', label: 'Due', title: 'Review cards due' },
]

export function CountPills({ counts, active = null, size = 'md', labels = false }: Props) {
  return (
    <span className={`counts counts--${size}`}>
      {ITEMS.map(({ key, label, title }) => {
        const n = counts[key]
        return (
          <span
            key={key}
            title={`${title}: ${n}`}
            className={`count count--${key} ${n === 0 ? 'count--zero' : ''} ${active === key ? 'count--active' : ''}`}
          >
            <span className="tabular">{n}</span>
            {labels && <span className="count__label">{label}</span>}
          </span>
        )
      })}
    </span>
  )
}
