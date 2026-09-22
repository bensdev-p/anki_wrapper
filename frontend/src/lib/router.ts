import { useEffect, useState } from 'react'

/** Tiny hash router: works with any static server and survives reloads. */
export type Route = { name: 'home' } | { name: 'study'; deckId: number }

function parse(hash: string): Route {
  const m = hash.match(/^#\/study\/(\d+)/)
  return m ? { name: 'study', deckId: Number(m[1]) } : { name: 'home' }
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

export function navigate(route: Route): void {
  window.location.hash = route.name === 'study' ? `#/study/${route.deckId}` : '#/'
}
