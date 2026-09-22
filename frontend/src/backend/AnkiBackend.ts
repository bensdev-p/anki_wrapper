import type {
  AnswerResponse,
  CollectionInfo,
  DeckNode,
  Rating,
  SearchResult,
  StudyState,
  UndoResponse,
} from './types'

/**
 * Everything the UI needs from Anki. The UI talks only to this interface.
 *
 * HttpBackend implements it over the FastAPI server. A desktop add-on could
 * provide a second implementation that bridges to `mw.col` via pycmd.
 */
export interface AnkiBackend {
  info(): Promise<CollectionInfo>
  deckTree(): Promise<DeckNode[]>
  /** Current deck and the card at the front of its queue. */
  studyState(): Promise<StudyState>
  /** Make `deckId` the current deck and return its study state. */
  selectDeck(deckId: number): Promise<StudyState>
  /** Answer the front card; resolves with the next study state. */
  answer(cardId: number, rating: Rating, msTaken: number): Promise<AnswerResponse>
  /** Undo the last answer; resolves with the restored study state. */
  undo(): Promise<UndoResponse>
  search(query: string, limit?: number): Promise<SearchResult>
  /** Absolute base URL that card HTML media references resolve against. */
  mediaBaseUrl(): string
}

export class BackendError extends Error {
  readonly status: number
  readonly kind: string

  constructor(status: number, kind: string, message: string) {
    super(message)
    this.status = status
    this.kind = kind
  }
}
