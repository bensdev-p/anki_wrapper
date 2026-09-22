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
}
