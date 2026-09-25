import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { AnkiBackend } from '../backend/AnkiBackend'
import type { SyncStatus } from '../backend/types'
import { useBackend } from '../backend/context'

/**
 * Shared sync state. Syncs run on the server; this polls while one is active
 * and announces completion with a `rounds:synced` window event so screens can
 * refresh (deck counts, the current card).
 */
let status: SyncStatus | null = null
let backendRef: AnkiBackend | null = null
let pollTimer: number | null = null
const listeners = new Set<() => void>()

// Auto-sync when she comes back to the app after this long.
const RESYNC_AFTER_MS = 10 * 60 * 1000
export const SYNCED_EVENT = 'rounds:synced'

function emit() {
  listeners.forEach((l) => l())
}

function set(next: SyncStatus) {
  const prev = status
  status = next
  emit()
  const finished = prev && prev.phase !== 'idle' && next.phase === 'idle' && !next.error && !next.needs
  if (finished) window.dispatchEvent(new Event(SYNCED_EVENT))
  schedulePoll()
}

function schedulePoll() {
  if (pollTimer !== null) window.clearTimeout(pollTimer)
  pollTimer = null
  if (!status || !backendRef) return
  const busy = status.phase !== 'idle'
  if (!busy && !status.media_active) return
  pollTimer = window.setTimeout(() => void refresh(), busy ? 600 : 2500)
}

async function refresh(): Promise<void> {
  if (!backendRef) return
  try {
    set(await backendRef.syncStatus())
  } catch {
    // server unreachable; the next trigger will retry
  }
}

async function start(): Promise<void> {
  if (!backendRef || !status?.enabled || status.phase !== 'idle') return
  try {
    set(await backendRef.sync())
  } catch {
    // ignore; the status keeps the last error
  }
}

async function download(): Promise<void> {
  if (!backendRef) return
  set(await backendRef.fullDownload())
}

async function upload(): Promise<void> {
  if (!backendRef) return
  set(await backendRef.fullUpload())
}

/** Sign in, then sync straight away. Throws (BackendError) on a wrong password. */
async function login(username: string, password: string): Promise<void> {
  if (!backendRef) return
  set(await backendRef.syncLogin(username, password))
  await start()
}

async function logout(): Promise<void> {
  if (!backendRef) return
  set(await backendRef.syncLogout())
}

function staleEnough(): boolean {
  const last = status?.last_synced_at
  return !last || Date.now() - last * 1000 > RESYNC_AFTER_MS
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

let initialised = false

/** Call once near the app root: first status fetch, sync on open, sync on return. */
export function useSyncLifecycle(): void {
  const backend = useBackend()
  useEffect(() => {
    backendRef = backend
    if (initialised) return
    initialised = true
    void refresh().then(() => start())
    const onVisible = () => {
      if (document.visibilityState === 'visible' && staleEnough()) void start()
    }
    document.addEventListener('visibilitychange', onVisible)
  }, [backend])
}

export function useSync() {
  const current = useSyncExternalStore(subscribe, () => status)
  return {
    status: current,
    syncNow: useCallback(() => start(), []),
    fullDownload: useCallback(() => download(), []),
    fullUpload: useCallback(() => upload(), []),
    login: useCallback((u: string, p: string) => login(u, p), []),
    logout: useCallback(() => logout(), []),
  }
}

/** Ask for a sync after something worth syncing (e.g. a study session ended). */
export function requestSync(): void {
  void start()
}

export function relativeTime(unixSeconds: number): string {
  const s = Math.round(Date.now() / 1000 - unixSeconds)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
