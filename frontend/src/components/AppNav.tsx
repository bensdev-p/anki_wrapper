import { BarChart3, Layers, Search, Settings } from 'lucide-react'
import { routeHash, STATS_DEFAULT_DAYS, type Route } from '../lib/router'

/** Top-level sections, as a segmented control in the top bar. */
export function AppNav({ route, variant = 'top' }: { route: Route; variant?: 'top' | 'tabs' }) {
  const items = [
    { key: 'home', label: 'Decks', icon: Layers, href: routeHash({ name: 'home' }) },
    { key: 'browse', label: 'Browse', icon: Search, href: routeHash({ name: 'browse', q: '' }) },
    {
      key: 'stats',
      label: 'Stats',
      icon: BarChart3,
      href: routeHash({ name: 'stats', deckId: null, days: STATS_DEFAULT_DAYS }),
    },
    { key: 'settings', label: 'Settings', icon: Settings, href: routeHash({ name: 'settings' }) },
  ]
  return (
    <nav className={variant === 'tabs' ? 'tab-bar' : 'app-nav'} aria-label="Sections">
      {items.map((it) => (
        <a
          key={it.key}
          href={it.href}
          className={variant === 'tabs' ? 'tab-bar__item' : 'app-nav__item'}
          aria-current={route.name === it.key ? 'page' : undefined}
        >
          <it.icon size={variant === 'tabs' ? 20 : 15} strokeWidth={2} aria-hidden="true" />
          <span>{it.label}</span>
        </a>
      ))}
    </nav>
  )
}
