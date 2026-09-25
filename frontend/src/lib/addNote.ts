/** Open the Add card sheet from anywhere (it lives at the app root). */
export const ADD_NOTE_EVENT = 'rounds:add-note'

export function openAddNote(deckId?: number): void {
  window.dispatchEvent(new CustomEvent(ADD_NOTE_EVENT, { detail: { deckId } }))
}
