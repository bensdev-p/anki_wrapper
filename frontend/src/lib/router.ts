import { useEffect, useState } from 'react'

/** Tiny hash router: works with any static server and survives reloads. */
export type Route =
  | { name: 'home' }
  | { name: 'study'; deckId: number }
  | { name: 'stats'; deckId: number | null; days: number }
  | { name: 'browse'; q: string }
  | { name: 'settings' }

export const STATS_DEFAULT_DAYS = 90

function parse(hash: string): Route {
  if (hash.startsWith('#/settings')) return { name: 'settings' }
  const study = hash.match(/^#\/study\/(\d+)/)
  if (study) return { name: 'study', deckId: Number(study[1]) }
  if (hash.startsWith('#/browse')) {
    const q = new URLSearchParams(hash.split('?')[1] ?? '')
    return { name: 'browse', q: q.get('q') ?? '' }
  }
  if (hash.startsWith('#/stats')) {
    const q = new URLSearchParams(hash.split('?')[1] ?? '')
    const deck = q.get('deck')
    const days = Number(q.get('days'))
    return { name: 'stats', deckId: deck ? Number(deck) : null, days: days > 0 ? days : STATS_DEFAULT_DAYS }
  }
  return { name: 'home' }
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case 'study':
      return `#/study/${route.deckId}`
    case 'stats': {
      const q = new URLSearchParams()
      if (route.deckId !== null) q.set('deck', String(route.deckId))
      if (route.days !== STATS_DEFAULT_DAYS) q.set('days', String(route.days))
      const qs = q.toString()
      return `#/stats${qs ? `?${qs}` : ''}`
    }
    case 'browse':
      return route.q ? `#/browse?${new URLSearchParams({ q: route.q })}` : '#/browse'
    case 'settings':
      return '#/settings'
    default:
      return '#/'
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** Navigate. `replace` updates the URL without a new history entry (filters). */
export function navigate(route: Route, { replace = false } = {}): void {
  const hash = routeHash(route)
  if (replace) {
    history.replaceState(null, '', hash)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = hash
  }
}
