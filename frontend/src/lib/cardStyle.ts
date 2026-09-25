import { useSyncExternalStore } from 'react'
import { load, save } from './storage'

/**
 * How cards are colored:
 * - "theme": the card sits on the theme's surface and uses its text colors
 *   (the deck's background and base text color are set aside);
 * - "deck": exactly as the note type's CSS paints it, as in Anki.
 */
export type CardStyle = 'theme' | 'deck'

let current: CardStyle = load<CardStyle>('card-style', 'theme')
const listeners = new Set<() => void>()

export function setCardStyle(next: CardStyle): void {
  current = next
  save('card-style', next)
  listeners.forEach((l) => l())
}

export function useCardStyle(): CardStyle {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}
