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
  /** Has a [[type:…]] box; the answer side has a #typeans-result slot. */
  type_answer: boolean
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
  result: { undone: string; was_answer: boolean }
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
  /** Running as the desktop app (rather than the Pi server). */
  desktop: boolean
  /** Where card media is served for this client (a token path for paired phones). */
  media_path: string
  /** This client is another device (a paired phone), not the computer running Rounds. */
  remote: boolean
  version: string
}

/** Using the desktop app from a phone on the same Wi-Fi (mirror api/sharing.py). */
export interface SharingStatus {
  enabled: boolean
  running: boolean
  error: string | null
  port: number
  /** 6-digit pairing code. */
  code: string
  /** Addresses to open on the phone (IP first). */
  urls: string[]
  /** Paired devices. */
  devices: number
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
  phase: 'idle' | 'syncing' | 'downloading' | 'uploading'
  /** A one-way sync decision only the user can make. */
  needs: 'full_download' | 'full_sync' | 'server_empty' | null
  error: string | null
  server_message: string | null
  /** Unix seconds. */
  last_synced_at: number | null
  media_active: boolean
  media_summary: string
  transferred_bytes: number | null
  total_bytes: number | null
  /** This client may sign in/out (the collection can sync, and it's this computer). */
  can_sign_in: boolean
  /** This client may replace AnkiWeb's copy when a one-way sync is required (desktop app only). */
  can_upload: boolean
}

// Card info & note editing (mirror service/types.py)

export interface RevlogEntry {
  /** Unix seconds. */
  time: number
  kind: 'learning' | 'review' | 'relearning' | 'filtered' | 'manual' | 'rescheduled'
  button: number
  interval_secs: number
  ease: number
  taken_secs: number
  stability_days: number | null
  difficulty: number | null
}

export interface CardInfo {
  card_id: number
  note_id: number
  deck: string
  notetype: string
  card_type: string
  added: number
  first_review: number | null
  latest_review: number | null
  due: string | null
  interval_days: number
  ease: number | null
  reviews: number
  lapses: number
  average_secs: number
  total_secs: number
  fsrs: boolean
  stability_days: number | null
  difficulty: number | null
  retrievability: number | null
  desired_retention: number | null
  preset: string
  tags: string[]
  revlog: RevlogEntry[]
}

export interface NoteField {
  name: string
  html: string
}

export interface NoteForEdit {
  note_id: number
  notetype: string
  /** Cloze note type (the editor offers the cloze button). */
  is_cloze: boolean
  fields: NoteField[]
  tags: string[]
  css: string
}

// Browser (mirror service/types.py)

export interface BrowseRow {
  card_id: number
  note_id: number
  text: string
  deck: string
  template: string
  state: 'new' | 'learning' | 'review' | 'relearning' | 'suspended' | 'buried'
  due: string | null
  interval_days: number
  ease: number | null
  /** FSRS difficulty 0–1. */
  difficulty: number | null
  reviews: number
  lapses: number
  flag: number
  marked: boolean
  tags: string[]
}

export interface BrowsePage {
  query: string
  sort: string
  reverse: boolean
  total: number
  offset: number
  rows: BrowseRow[]
  fsrs: boolean
}

export type BrowseSort = 'noteFld' | 'deck' | 'cardDue' | 'cardIvl' | 'cardEase' | 'difficulty' | 'cardReps' | 'cardLapses'

/** Explicit cards, or every card matching a search. */
export type BrowseSelection = { card_ids: number[] } | { query: string; sort: BrowseSort; reverse: boolean }

export type BrowseActionKind = 'suspend' | 'unsuspend' | 'flag' | 'add_tags' | 'remove_tags' | 'set_due'

// Deck management & options (mirror service/types.py)

export interface DeckName {
  id: number
  /** Full name, e.g. "Step 1::Cardio". */
  name: string
  filtered: boolean
}

export interface DeletedDeck {
  name: string
  cards: number
  /** Pass to undoStep() to undo exactly this deletion. */
  undo_label: string
}

/** Steps in minutes, intervals in days; enum fields hold Anki's enum numbers. */
export interface DeckOptionsConfig {
  new_per_day: number
  reviews_per_day: number
  learn_steps: number[]
  relearn_steps: number[]
  graduating_interval_good: number
  graduating_interval_easy: number
  new_card_insert_order: number
  leech_threshold: number
  leech_action: number
  minimum_lapse_interval: number
  maximum_review_interval: number
  initial_ease: number
  easy_multiplier: number
  hard_multiplier: number
  lapse_multiplier: number
  interval_multiplier: number
  desired_retention: number
  new_card_gather_priority: number
  new_card_sort_order: number
  new_mix: number
  interday_learning_mix: number
  review_order: number
  bury_new: boolean
  bury_reviews: boolean
  bury_interday_learning: boolean
  show_timer: boolean
  cap_answer_time_to_secs: number
  disable_autoplay: boolean
}

export interface DeckPreset {
  id: number
  name: string
  /** Decks using this preset. */
  use_count: number
}

export interface DeckOptions {
  deck_id: number
  deck_name: string
  preset_id: number
  presets: DeckPreset[]
  config: DeckOptionsConfig
  /** FSRS is on for the whole collection. */
  fsrs: boolean
  has_children: boolean
}

export interface DeckOptionsUpdate {
  preset_id: number
  changes: Partial<DeckOptionsConfig>
  rename_preset?: string
  new_preset_name?: string
  fsrs?: boolean
  apply_to_children?: boolean
}

// Adding notes

export interface NotetypeInfo {
  id: number
  name: string
  fields: string[]
  is_cloze: boolean
}

export interface AddDefaults {
  notetypes: NotetypeInfo[]
  decks: DeckName[]
  notetype_id: number
  deck_id: number
}

export interface AddNoteResult {
  note_id: number
  cards: number
  /** Matches another note's first field (added anyway, as in Anki). */
  duplicate: boolean
}

// Custom study, filtered decks, importing (mirror service/types.py)

export interface CustomStudyInfo {
  deck_id: number
  deck_name: string
  available_new: number
  available_review: number
  available_new_in_children: number
  available_review_in_children: number
  extend_new: number
  extend_review: number
  tags: string[]
}

export type CustomStudyKind = 'new' | 'review' | 'forgot' | 'ahead' | 'preview' | 'cram'
export type CramKind = 'due' | 'new' | 'review' | 'all'

export interface CustomStudyRequest {
  kind: CustomStudyKind
  amount: number
  cram_kind?: CramKind
  tags_include?: string[]
  tags_exclude?: string[]
}

export interface FilteredDeckSpec {
  /** 0 for a new filtered deck. */
  id: number
  name: string
  search: string
  limit: number
  order: number
  reschedule: boolean
  search2: string | null
  limit2: number
  order2: number
}

export interface FilteredDeckForm {
  deck: FilteredDeckSpec
  /** Anki's names for the order choices (index = order number). */
  order_labels: string[]
}

export interface ImportSummary {
  new: number
  updated: number
  duplicate: number
  conflicting: number
  skipped: number
  found: number
}

export interface ImportStatus {
  phase: 'idle' | 'importing'
  filename: string | null
  progress: string | null
  result: ImportSummary | null
  error: string | null
}

// Backups & updates

export interface BackupInfo {
  name: string
  /** Unix seconds. */
  created: number
  /** Bytes. */
  size: number
}

export interface UpdateInfo {
  current: string
  latest: string | null
  available: boolean
  /** Release page to download from. */
  url: string | null
}
