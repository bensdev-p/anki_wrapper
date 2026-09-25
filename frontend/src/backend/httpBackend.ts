import { BackendError, type AnkiBackend } from './AnkiBackend'
import { reportOnline } from '../lib/connection'
import type {
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
  StatsSummary,
  SyncStatus,
  StudyState,
  UndoResponse,
} from './types'

/** AnkiBackend over the FastAPI server (same origin; Vite proxies /api in dev). */
export class HttpBackend implements AnkiBackend {
  private readonly base: string

  constructor(base = '/api') {
    this.base = base
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
      throw new BackendError(res.status, kind, detail)
    }
    return res.json() as Promise<T>
  }

  info = () => this.request<CollectionInfo>('/info')
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
  mediaBaseUrl = () => new URL(this.base + '/media/', window.location.href).href
}
