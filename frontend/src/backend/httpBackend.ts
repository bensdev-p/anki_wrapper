import { BackendError, type AnkiBackend } from './AnkiBackend'
import { reportOnline } from '../lib/connection'
import type {
  BackupInfo,
  UpdateInfo,
  CustomStudyInfo,
  CustomStudyRequest,
  FilteredDeckForm,
  FilteredDeckSpec,
  ImportStatus,
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

/** Fired when the server says this device must pair (e.g. the code was changed). */
export const PAIRING_REQUIRED_EVENT = 'rounds:pairing-required'

/** AnkiBackend over the FastAPI server (same origin; Vite proxies /api in dev). */
export class HttpBackend implements AnkiBackend {
  private readonly base: string
  /** Paired phones get media under a token path; see info(). */
  private mediaPath: string

  constructor(base = '/api') {
    this.base = base
    this.mediaPath = `${base}/media/`
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
      res = await fetch(this.base + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init?.headers },
      })
    } catch {
      reportOnline(false)
      throw new BackendError(0, 'Network', 'Can’t reach the study server.')
    }
    // A proxy (Vite) answers 502/504 when the API itself is down.
    reportOnline(res.status !== 502 && res.status !== 504)
    if (res.status === 502 || res.status === 504) throw new BackendError(0, 'Network', 'Can’t reach the study server.')
    if (!res.ok) {
      let kind = 'HttpError'
      let detail = res.statusText
      try {
        const body = await res.json()
        kind = body.error ?? kind
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      } catch {
        // non-JSON error body
      }
      if (kind === 'PairingRequired') window.dispatchEvent(new Event(PAIRING_REQUIRED_EVENT))
      throw new BackendError(res.status, kind, detail)
    }
    return res.json() as Promise<T>
  }

  info = async () => {
    const info = await this.request<CollectionInfo>('/info')
    this.mediaPath = info.media_path
    return info
  }
  deckTree = () => this.request<DeckNode[]>('/decks')
  studyState = () => this.request<StudyState>('/study')
  selectDeck = (deckId: number) =>
    this.request<StudyState>(`/study/deck/${deckId}`, { method: 'POST' })
  answer = (cardId: number, rating: Rating, msTaken: number) =>
    this.request<AnswerResponse>('/study/answer', {
      method: 'POST',
      body: JSON.stringify({ card_id: cardId, rating, ms_taken: Math.round(msTaken) }),
    })
  undo = () => this.request<UndoResponse>('/study/undo', { method: 'POST' })
  setFlag = async (cardId: number, flag: number) =>
    (await this.request<{ flag: number }>(`/cards/${cardId}/flag`, { method: 'POST', body: JSON.stringify({ flag }) })).flag
  toggleMark = async (noteId: number) =>
    (await this.request<{ marked: boolean }>(`/notes/${noteId}/mark`, { method: 'POST' })).marked
  suspend = (cardId: number, wholeNote: boolean) =>
    this.request<StudyState>('/study/suspend', { method: 'POST', body: JSON.stringify({ card_id: cardId, whole_note: wholeNote }) })
  bury = (cardId: number, wholeNote: boolean) =>
    this.request<StudyState>('/study/bury', { method: 'POST', body: JSON.stringify({ card_id: cardId, whole_note: wholeNote }) })
  compareAnswer = async (cardId: number, typed: string) =>
    (await this.request<{ html: string }>(`/cards/${cardId}/compare`, { method: 'POST', body: JSON.stringify({ typed }) })).html
  cardInfo = (cardId: number) => this.request<CardInfo>(`/cards/${cardId}/info`)
  renderCard = (cardId: number) => this.request<RenderedCard>(`/cards/${cardId}/render`)
  getNote = (noteId: number) => this.request<NoteForEdit>(`/notes/${noteId}`)
  updateNote = (noteId: number, fields: Record<string, string>, tags?: string[]) =>
    this.request<NoteForEdit>(`/notes/${noteId}`, { method: 'PUT', body: JSON.stringify({ fields, tags }) })
  browse = (query: string, sort: BrowseSort, reverse: boolean, offset: number, limit: number) =>
    this.request<BrowsePage>(
      `/browse?${new URLSearchParams({ q: query, sort, reverse: String(reverse), offset: String(offset), limit: String(limit) })}`,
    )
  browseAction = async (selection: BrowseSelection, action: BrowseActionKind, value?: string | number) =>
    (
      await this.request<{ count: number }>('/browse/action', {
        method: 'POST',
        body: JSON.stringify({ selection, action, value }),
      })
    ).count
  search = (query: string, limit = 50) =>
    this.request<SearchResult>(
      `/search?${new URLSearchParams({ q: query, limit: String(limit) })}`,
    )
  stats = (deckId: number | null, days: number) =>
    this.request<StatsSummary>(
      `/stats?${new URLSearchParams({ days: String(days), ...(deckId === null ? {} : { deck_id: String(deckId) }) })}`,
    )
  syncStatus = () => this.request<SyncStatus>('/sync')
  sync = () => this.request<SyncStatus>('/sync', { method: 'POST' })
  fullDownload = () => this.request<SyncStatus>('/sync/full-download', { method: 'POST' })
  fullUpload = () => this.request<SyncStatus>('/sync/full-upload', { method: 'POST' })
  syncLogin = (username: string, password: string) =>
    this.request<SyncStatus>('/sync/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  syncLogout = () => this.request<SyncStatus>('/sync/logout', { method: 'POST' })
  sharingStatus = () => this.request<SharingStatus>('/sharing')
  setSharing = (enabled: boolean) =>
    this.request<SharingStatus>('/sharing', { method: 'POST', body: JSON.stringify({ enabled }) })
  newSharingCode = () => this.request<SharingStatus>('/sharing/new-code', { method: 'POST' })
  sharingQrUrl = (url: string) => `${this.base}/sharing/qr.svg?${new URLSearchParams({ url })}`
  pair = async (code: string) => {
    await this.request<{ paired: boolean }>('/pair', { method: 'POST', body: JSON.stringify({ code }) })
  }
  deckNames = () => this.request<DeckName[]>('/deck-names')
  createDeck = (name: string) => this.request<DeckName>('/decks', { method: 'POST', body: JSON.stringify({ name }) })
  renameDeck = (deckId: number, name: string) =>
    this.request<DeckName>(`/decks/${deckId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  deckCardCount = async (deckId: number) => (await this.request<{ cards: number }>(`/decks/${deckId}/card-count`)).cards
  deleteDeck = (deckId: number) => this.request<DeletedDeck>(`/decks/${deckId}`, { method: 'DELETE' })
  undoStep = async (label: string) => {
    await this.request('/undo-step', { method: 'POST', body: JSON.stringify({ label }) })
  }
  deckOptions = (deckId: number) => this.request<DeckOptions>(`/decks/${deckId}/options`)
  saveDeckOptions = (deckId: number, update: DeckOptionsUpdate) =>
    this.request<DeckOptions>(`/decks/${deckId}/options`, { method: 'PUT', body: JSON.stringify(update) })
  backups = () => this.request<BackupInfo[]>('/backups')
  backupNow = async () => (await this.request<{ created: boolean }>('/backups', { method: 'POST' })).created
  restoreBackup = async (name: string) => {
    await this.request('/backups/restore', { method: 'POST', body: JSON.stringify({ name }) })
  }
  updateInfo = () => this.request<UpdateInfo>('/update')
  customStudyInfo = (deckId: number) => this.request<CustomStudyInfo>(`/decks/${deckId}/custom-study`)
  customStudy = async (deckId: number, request: CustomStudyRequest) =>
    (await this.request<{ deck_id: number }>(`/decks/${deckId}/custom-study`, { method: 'POST', body: JSON.stringify(request) }))
      .deck_id
  filteredDeck = (deckId: number, search?: string) =>
    this.request<FilteredDeckForm>(`/filtered/${deckId}${search ? `?${new URLSearchParams({ search })}` : ''}`)
  saveFilteredDeck = async (spec: FilteredDeckSpec) =>
    (await this.request<{ deck_id: number }>('/filtered', { method: 'PUT', body: JSON.stringify(spec) })).deck_id
  rebuildFilteredDeck = async (deckId: number) =>
    (await this.request<{ cards: number }>(`/filtered/${deckId}/rebuild`, { method: 'POST' })).cards
  emptyFilteredDeck = async (deckId: number) => {
    await this.request(`/filtered/${deckId}/empty`, { method: 'POST' })
  }
  importStatus = () => this.request<ImportStatus>('/import')
  /** XHR rather than fetch: only XHR reports upload progress (big decks take a while). */
  importFile = (file: File, onProgress?: (fraction: number) => void) =>
    new Promise<ImportStatus>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${this.base}/import?${new URLSearchParams({ name: file.name })}`)
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
      xhr.onload = () => {
        let body: { error?: string; detail?: unknown } & Partial<ImportStatus> = {}
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          // non-JSON
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as ImportStatus)
        else reject(new BackendError(xhr.status, body.error ?? 'HttpError', typeof body.detail === 'string' ? body.detail : 'Import failed.'))
      }
      xhr.onerror = () => reject(new BackendError(0, 'Network', 'Can’t reach the study server.'))
      xhr.send(file)
    })
  addDefaults = (deckId?: number) =>
    this.request<AddDefaults>(`/add${deckId ? `?${new URLSearchParams({ deck_id: String(deckId) })}` : ''}`)
  addNote = (notetypeId: number, deckId: number, fields: Record<string, string>, tags: string[]) =>
    this.request<AddNoteResult>('/notes', {
      method: 'POST',
      body: JSON.stringify({ notetype_id: notetypeId, deck_id: deckId, fields, tags }),
    })
  uploadMedia = async (name: string, data: Blob) =>
    (
      await this.request<{ filename: string }>(`/media?${new URLSearchParams({ name })}`, {
        method: 'POST',
        body: data,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    ).filename
  mediaBaseUrl = () => new URL(this.mediaPath, window.location.href).href
}
