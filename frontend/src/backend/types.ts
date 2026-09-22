// Wire types. Mirror backend/service/types.py (snake_case, as sent).

export interface Counts {
  new: number
  learning: number
  review: number
}

export interface DeckNode {
  id: number
  /** Leaf name, e.g. "Pharm". */
  name: string
  /** Full path, e.g. "Step 1::Cardio::Pharm". */
  full_name: string
  level: number
  collapsed: boolean
  filtered: boolean
  counts: Counts
  total_cards: number
  children: DeckNode[]
}

export interface AudioRef {
  side: 'q' | 'a'
  index: number
  filename: string
}

export interface RenderedCard {
  question_html: string
  answer_html: string
  css: string
  /** "card cardN": Anki's reviewer classes, without night-mode classes. */
  body_class: string
  audio: AudioRef[]
  autoplay: boolean
}

export type QueueKind = 'new' | 'learning' | 'review'

export interface StudyCard {
  card_id: number
  note_id: number
  deck_id: number
  deck_name: string
  notetype_name: string
  queue: QueueKind
  /** Next-interval labels for Again / Hard / Good / Easy. */
  button_labels: [string, string, string, string]
  counts: Counts
  rendered: RenderedCard
  flag: number
  marked: boolean
}

export interface StudyState {
  deck_id: number
  deck_name: string
  counts: Counts
  /** null when the deck is done for today. */
  card: StudyCard | null
  can_undo: boolean
  undo_label: string | null
}

export type Rating = 1 | 2 | 3 | 4

export interface AnswerResult {
  card_id: number
  rating: Rating
  due_before: number
  due_after: number
  leech: boolean
}

export interface AnswerResponse {
  result: AnswerResult
  state: StudyState
}

export interface UndoResponse {
  result: { undone: string }
  state: StudyState
}

export interface SearchHit {
  card_id: number
  note_id: number
  deck_id: number
  deck_name: string
  preview: string
}

export interface SearchResult {
  query: string
  total: number
  hits: SearchHit[]
}

export interface CollectionInfo {
  collection: string
  is_sample: boolean
  card_count: number
  sync_enabled: boolean
}

// Statistics (mirror service/types.py)

export interface TodayStats {
  answered: number
  seconds: number
  correct: number
  learn: number
  review: number
  relearn: number
  mature_correct: number
  mature_answered: number
}

export interface DayReviews {
  /** Days relative to today (0 = today, -1 = yesterday). */
  day: number
  learn: number
  relearn: number
  young: number
  mature: number
  filtered: number
  seconds: number
}

export interface DueDay {
  /** Days from today (0 = due today). */
  day: number
  count: number
}

export interface CardCountStats {
  new: number
  learning: number
  young: number
  mature: number
  suspended: number
  buried: number
}

export interface RetentionCounts {
  young_passed: number
  young_failed: number
  mature_passed: number
  mature_failed: number
}

export type RetentionPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'all_time'

export interface StatsSummary {
  deck_id: number | null
  deck_name: string | null
  days: number
  fsrs: boolean
  today: TodayStats
  reviews: DayReviews[]
  forecast: DueDay[]
  overdue: number
  daily_load: number
  cards: CardCountStats
  retention: Record<RetentionPeriod, RetentionCounts>
  /** FSRS average probability of recall (0–1). */
  average_retrievability: number | null
}

// Sync (mirror api/sync_manager.py)

export interface SyncStatus {
  /** This collection syncs and a sync key is saved on the server. */
  enabled: boolean
  username: string | null
  phase: 'idle' | 'syncing' | 'downloading'
  /** A decision only the user can make. There is never an "upload" option. */
  needs: 'full_download' | 'full_sync' | 'server_empty' | null
  error: string | null
  server_message: string | null
  /** Unix seconds. */
  last_synced_at: number | null
  media_active: boolean
  media_summary: string
  transferred_bytes: number | null
  total_bytes: number | null
}
