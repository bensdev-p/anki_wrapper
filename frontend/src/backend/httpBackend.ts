import { BackendError, type AnkiBackend } from './AnkiBackend'
import type {
  AnswerResponse,
  CollectionInfo,
  DeckNode,
  Rating,
  SearchResult,
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
      throw new BackendError(0, 'Network', 'Can’t reach the study server.')
    }
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
  search = (query: string, limit = 50) =>
    this.request<SearchResult>(
      `/search?${new URLSearchParams({ q: query, limit: String(limit) })}`,
    )
  mediaBaseUrl = () => new URL(this.base + '/media/', window.location.href).href
}
