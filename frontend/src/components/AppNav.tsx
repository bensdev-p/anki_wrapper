import { BarChart3, Layers } from 'lucide-react'
import { routeHash, STATS_DEFAULT_DAYS, type Route } from '../lib/router'

/** Top-level sections, as a segmented control in the top bar. */
export function AppNav({ route }: { route: Route }) {
  const items = [
    { key: 'home', label: 'Decks', icon: Layers, href: routeHash({ name: 'home' }) },
    {
      key: 'stats',
      label: 'Stats',
      icon: BarChart3,
      href: routeHash({ name: 'stats', deckId: null, days: STATS_DEFAULT_DAYS }),
    },
  ]
  return (
    <nav className="app-nav" aria-label="Sections">
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
          className="app-nav__item"
          aria-current={route.name === it.key ? 'page' : undefined}
        >
          <it.icon size={15} strokeWidth={2} aria-hidden="true" />
          <span>{it.label}</span>
        </a>
      ))}
    </nav>
  )
}
