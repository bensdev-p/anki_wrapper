import { useSyncExternalStore } from 'react'

/**
 * Whether the Pi is reachable. HttpBackend reports every request's outcome;
 * while offline, a light health check runs until the server answers again.
 */
let online = true
const listeners = new Set<() => void>()
let timer: number | null = null
const waiters: (() => void)[] = []

function set(next: boolean) {
  if (online === next) return
  online = next
  listeners.forEach((l) => l())
  if (next) {
    waiters.splice(0).forEach((w) => w())
    if (timer !== null) window.clearTimeout(timer)
    timer = null
  } else {
    poll()
  }
}

function poll() {
  if (timer !== null) return
  timer = window.setTimeout(async () => {
    timer = null
    try {
      const r = await fetch('/api/info', { cache: 'no-store' })
      if (r.ok) return set(true)
    } catch {
      // still offline
    }
    if (!online) poll()
  }, 2500)
}

export function reportOnline(ok: boolean): void {
  set(ok)
}

/** Resolves once the server is reachable again (immediately if it is). */
export function whenOnline(): Promise<void> {
  return online ? Promise.resolve() : new Promise((r) => waiters.push(r))
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => online,
  )
}
