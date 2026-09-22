import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { AnkiBackend } from '../backend/AnkiBackend'
import type { DeckNode } from '../backend/types'
import { useBackend } from '../backend/context'

// Shared deck-tree cache: the deck list and command palette render instantly
// from the last result while a fresh copy loads in the background.
let cache: DeckNode[] | null = null
let error: Error | null = null
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function refresh(backend: AnkiBackend): Promise<void> {
  inflight ??= backend
    .deckTree()
    .then((tree) => {
      cache = tree
      error = null
    })
    .catch((e: Error) => {
      error = e
    })
    .finally(() => {
      inflight = null
      emit()
    })
  return inflight
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useDecks(): { decks: DeckNode[] | null; error: Error | null; reload(): Promise<void> } {
  const backend = useBackend()
  const decks = useSyncExternalStore(subscribe, () => cache)
  const err = useSyncExternalStore(subscribe, () => error)
  const reload = useCallback(() => refresh(backend), [backend])
  useEffect(() => {
    void reload()
  }, [reload])
  return { decks, error: err, reload }
}

export function flattenDecks(nodes: DeckNode[]): DeckNode[] {
  const out: DeckNode[] = []
  const walk = (list: DeckNode[]) =>
    list.forEach((n) => {
      out.push(n)
      walk(n.children)
    })
  walk(nodes)
  return out
}
