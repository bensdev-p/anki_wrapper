import { navigate } from './router'
import { load, save } from './storage'

/** The first-run walkthrough of the deck list. Replayed from Settings or the command palette. */
export const TOUR_EVENT = 'rounds:tour'

export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_EVENT))
}

export const tourDone = (): boolean => load('tour-done', false)
export const markTourDone = (): void => save('tour-done', true)

/** One-time tips on the study screen (reveal, then grade). */
export const studyTipsSeen = (): boolean => load('study-tips-seen', false)
export const markStudyTipsSeen = (): void => save('study-tips-seen', true)
export const resetTips = (): void => {
  save('tour-done', false)
  save('study-tips-seen', false)
}

/** From Settings or the command palette: go to the deck list and show the tour (and the study tips) again. */
export function replayTour(): void {
  resetTips()
  navigate({ name: 'home' })
  window.setTimeout(startTour, 400)
}
