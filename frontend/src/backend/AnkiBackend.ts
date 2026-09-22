import type {
  AnswerResponse,
  CardInfo,
  NoteForEdit,
  RenderedCard,
  CollectionInfo,
  DeckNode,
  Rating,
  SearchResult,
  StatsSummary,
  SyncStatus,
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
  /** Set flag 1–7; the card's current flag again clears it. Resolves with the new flag. */
  setFlag(cardId: number, flag: number): Promise<number>
  /** Toggle the "marked" tag. Resolves with the new state. */
  toggleMark(noteId: number): Promise<boolean>
  suspend(cardId: number, wholeNote: boolean): Promise<StudyState>
  bury(cardId: number, wholeNote: boolean): Promise<StudyState>
  /** Typed-answer comparison HTML (Anki's compare_answer). */
  compareAnswer(cardId: number, typed: string): Promise<string>
  cardInfo(cardId: number): Promise<CardInfo>
  renderCard(cardId: number): Promise<RenderedCard>
  getNote(noteId: number): Promise<NoteForEdit>
  /** Save changed fields only (by name), and optionally tags. */
  updateNote(noteId: number, fields: Record<string, string>, tags?: string[]): Promise<NoteForEdit>
  search(query: string, limit?: number): Promise<SearchResult>
  /** Stats for a deck (with subdecks) or, with null, the whole collection. */
  stats(deckId: number | null, days: number): Promise<StatsSummary>
  /** AnkiWeb sync state (cheap; poll while a sync runs). */
  syncStatus(): Promise<SyncStatus>
  /** Start a normal two-way sync in the background. */
  sync(): Promise<SyncStatus>
  /**
   * Replace this device's copy with AnkiWeb's. Only valid when the status
   * says `needs: 'full_download' | 'full_sync'`. There is no upload counterpart.
   */
  fullDownload(): Promise<SyncStatus>
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
