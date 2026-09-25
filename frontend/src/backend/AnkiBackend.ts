import type {
  AddDefaults,
  AddNoteResult,
  DeckName,
  DeckOptions,
  DeckOptionsUpdate,
  DeletedDeck,
  AnswerResponse,
  BrowseActionKind,
  BrowsePage,
  BrowseSelection,
  BrowseSort,
  CardInfo,
  NoteForEdit,
  RenderedCard,
  CollectionInfo,
  DeckNode,
  Rating,
  SearchResult,
  SharingStatus,
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
  /** One page of a browser search (Anki search syntax, sorted by Anki). */
  browse(query: string, sort: BrowseSort, reverse: boolean, offset: number, limit: number): Promise<BrowsePage>
  /** Bulk action; resolves with the number of cards/notes changed. Undoable. */
  browseAction(selection: BrowseSelection, action: BrowseActionKind, value?: string | number): Promise<number>
  search(query: string, limit?: number): Promise<SearchResult>
  /** Stats for a deck (with subdecks) or, with null, the whole collection. */
  stats(deckId: number | null, days: number): Promise<StatsSummary>
  /** AnkiWeb sync state (cheap; poll while a sync runs). */
  syncStatus(): Promise<SyncStatus>
  /** Start a normal two-way sync in the background. */
  sync(): Promise<SyncStatus>
  /**
   * Replace this device's copy with AnkiWeb's. Only valid when the status
   * says `needs: 'full_download' | 'full_sync'`.
   */
  fullDownload(): Promise<SyncStatus>
  /**
   * Replace AnkiWeb's copy with this device's. Only when the status says
   * `can_upload` and `needs: 'full_sync' | 'server_empty'`.
   */
  fullUpload(): Promise<SyncStatus>
  /** Sign in to AnkiWeb (only the sync key is kept). Rejects with a 401 on a wrong password. */
  syncLogin(username: string, password: string): Promise<SyncStatus>
  /** Forget the saved sign-in; the collection on this computer stays. */
  syncLogout(): Promise<SyncStatus>
  /** Using the desktop app from a phone (only from the computer running Rounds). */
  sharingStatus(): Promise<SharingStatus>
  setSharing(enabled: boolean): Promise<SharingStatus>
  /** New pairing code; every paired device has to pair again. */
  newSharingCode(): Promise<SharingStatus>
  /** URL of a QR code that opens `url` on the phone and pairs it. */
  sharingQrUrl(url: string): string
  /** Pair this device with the code shown on the computer. */
  pair(code: string): Promise<void>
  /** Every deck by full name. */
  deckNames(): Promise<DeckName[]>
  createDeck(name: string): Promise<DeckName>
  /** Rename or move ("Parent::Child") a deck; subdecks follow. */
  renameDeck(deckId: number, name: string): Promise<DeckName>
  /** Cards in a deck and its subdecks. */
  deckCardCount(deckId: number): Promise<number>
  /** Delete a deck, its subdecks and their cards. */
  deleteDeck(deckId: number): Promise<DeletedDeck>
  /** Undo one specific step (e.g. "Delete Deck"), only if it's still the last change. */
  undoStep(label: string): Promise<void>
  deckOptions(deckId: number): Promise<DeckOptions>
  saveDeckOptions(deckId: number, update: DeckOptionsUpdate): Promise<DeckOptions>
  /** Note types, decks and Anki's starting choices for the Add screen. */
  addDefaults(deckId?: number): Promise<AddDefaults>
  addNote(notetypeId: number, deckId: number, fields: Record<string, string>, tags: string[]): Promise<AddNoteResult>
  /** Save a pasted/dropped file to the media folder; resolves with the name to use. */
  uploadMedia(name: string, data: Blob): Promise<string>
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
