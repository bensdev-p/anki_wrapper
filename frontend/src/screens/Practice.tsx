import { ArrowRight, Check, RotateCcw, Search, Tag, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { QuizCards, QuizQuestion, QuizRequest, QuizSet, TagMatch } from '../backend/types'
import { Button } from '../components/Button'
import { CardFrame, type CardKeyEvent } from '../components/card/CardFrame'
import { Kbd } from '../components/Kbd'
import { flattenDecks, useDecks } from '../lib/decks'
import { checkAnswer, type Verdict } from '../lib/quizCheck'
import { navigate } from '../lib/router'
import { load, save } from '../lib/storage'
import { useTheme } from '../themes/ThemeProvider'

type Format = 'choice' | 'typed' | 'mix'

interface Settings {
  source: 'deck' | 'tag'
  tag: string
  count: number
  format: Format
  cards: QuizCards
}

const DEFAULTS: Settings = { source: 'deck', tag: '', count: 20, format: 'choice', cards: 'mixed' }
const COUNTS = [10, 20, 40]
const FORMATS: { id: Format; label: string }[] = [
  { id: 'choice', label: 'Multiple choice' },
  { id: 'typed', label: 'Type the answer' },
  { id: 'mix', label: 'Mix' },
]
const CARD_SETS: { id: QuizCards; label: string; hint: string }[] = [
  { id: 'mixed', label: 'Cards I’ve studied', hint: 'A random mix of cards you’ve already seen.' },
  { id: 'weak', label: 'My weak spots', hint: 'Cards you’ve forgotten before or find hard.' },
  { id: 'all', label: 'Everything', hint: 'Includes new cards you haven’t studied yet.' },
]
const LETTERS = ['A', 'B', 'C', 'D']

interface Result {
  chosen: number | null
  typed: string
  verdict: Verdict
  /** "I was right": she overrules the typed-answer check. */
  overruled: boolean
}

const isRight = (r: Result | undefined) => !!r && (r.verdict !== 'wrong' || r.overruled)

/**
 * Practice quizzes from her own cards: multiple choice (wrong options are
 * answers from related cards) or typing the answer. Nothing here answers or
 * reschedules a card, so it never affects reviews or sync.
 */
export function Practice({ deckId: initialDeck }: { deckId: number | null }) {
  const backend = useBackend()
  const { decks } = useDecks()
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULTS, ...load<Partial<Settings>>('quiz', {}) }))
  const [deckId, setDeckId] = useState<number | null>(initialDeck)
  const [phase, setPhase] = useState<'setup' | 'loading' | 'quiz' | 'done'>('setup')
  const [error, setError] = useState<string | null>(null)
  const [quiz, setQuiz] = useState<QuizSet | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [index, setIndex] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [finishedAt, setFinishedAt] = useState(0)

  // Each phase starts at the top of the page.
  // Braces: an effect may only return a cleanup function. (In the desktop
  // window scrollTo returns a value, and React then crashed calling it.)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [phase])

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    save('quiz', next)
  }

  const start = async (cardIds?: number[]) => {
    const request: QuizRequest = cardIds
      ? { card_ids: cardIds, count: cardIds.length, cards: 'all' }
      : {
          deck_id: settings.source === 'deck' ? deckId : null,
          tag: settings.source === 'tag' ? settings.tag || null : null,
          count: settings.count,
          cards: settings.cards,
        }
    setPhase('loading')
    setError(null)
    try {
      const q = await backend.quiz(request)
      if (!q.questions.length) {
        setError(
          q.available
            ? 'These cards don’t have short answers to quiz on (for example, image-only cards).'
            : settings.cards === 'weak'
              ? 'No weak spots here yet: nothing you’ve forgotten. Nice! Try “Cards I’ve studied”.'
              : settings.cards === 'mixed'
                ? 'You haven’t studied any cards here yet. Try “Everything”.'
                : 'No cards match.',
        )
        setPhase('setup')
        return
      }
      setQuiz(q)
      setResults([])
      setIndex(0)
      setStartedAt(Date.now())
      setPhase('quiz')
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'Couldn’t build the quiz.')
      setPhase('setup')
    }
  }

  if ((phase === 'quiz' || phase === 'done') && quiz) {
    if (phase === 'done') {
      return (
        <Results
          quiz={quiz}
          results={results}
          ms={finishedAt - startedAt}
          onRetry={(ids) => void start(ids)}
          onNew={() => setPhase('setup')}
        />
      )
    }
    return (
      <Runner
        quiz={quiz}
        format={settings.format}
        index={index}
        results={results}
        onResult={(r) => setResults((prev) => Object.assign([...prev], { [index]: r }))}
        onNext={() => {
          if (index + 1 < quiz.questions.length) setIndex(index + 1)
          else {
            setFinishedAt(Date.now())
            setPhase('done')
          }
        }}
        onEnd={() => {
          setFinishedAt(Date.now())
          setPhase(results.length ? 'done' : 'setup')
        }}
      />
    )
  }

  const deckOptions = decks ? flattenDecks(decks) : []
  return (
    <main className="page page--practice">
      <h1 className="settings__title">Practice quiz</h1>
      <p className="practice__intro">
        Test yourself with questions made from your own cards. Quizzes are just practice: they don’t change your reviews or
        schedule.
      </p>

      <section className="settings-card practice-setup">
        <div className="practice-field">
          <h2 className="practice-field__label">Quiz me on</h2>
          <div className="segmented" role="radiogroup" aria-label="Quiz source">
            <button role="radio" aria-checked={settings.source === 'deck'} className="segmented__item" onClick={() => update({ source: 'deck' })}>
              A deck
            </button>
            <button role="radio" aria-checked={settings.source === 'tag'} className="segmented__item" onClick={() => update({ source: 'tag' })}>
              A tag
            </button>
          </div>
          {settings.source === 'deck' ? (
            <span className="select practice-field__control">
              <select value={deckId ?? ''} onChange={(e) => setDeckId(e.target.value ? Number(e.target.value) : null)} aria-label="Deck">
                <option value="">All decks</option>
                {deckOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {' '.repeat(d.level - 1)}
                    {d.name}
                  </option>
                ))}
              </select>
            </span>
          ) : (
            <TagPicker value={settings.tag} onChange={(tag) => update({ tag })} />
          )}
        </div>

        <div className="practice-field">
          <h2 className="practice-field__label">Questions</h2>
          <div className="segmented" role="radiogroup" aria-label="Number of questions">
            {COUNTS.map((n) => (
              <button key={n} role="radio" aria-checked={settings.count === n} className="segmented__item" onClick={() => update({ count: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="practice-field">
          <h2 className="practice-field__label">Answer by</h2>
          <div className="segmented" role="radiogroup" aria-label="Answer format">
            {FORMATS.map((f) => (
              <button key={f.id} role="radio" aria-checked={settings.format === f.id} className="segmented__item" onClick={() => update({ format: f.id })}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="practice-field">
          <h2 className="practice-field__label">Which cards</h2>
          <div className="practice-options" role="radiogroup" aria-label="Which cards">
            {CARD_SETS.map((c) => (
              <button key={c.id} role="radio" aria-checked={settings.cards === c.id} className="practice-option" onClick={() => update({ cards: c.id })}>
                <span className="practice-option__dot" aria-hidden="true" />
                <span>
                  <strong>{c.label}</strong>
                  <span className="practice-option__hint">{c.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="practice-setup__foot">
          {error ? <p className="dialog-error practice-setup__error">{error}</p> : <span />}
          <Button
            variant="primary"
            onClick={() => void start()}
            disabled={phase === 'loading' || (settings.source === 'tag' && !settings.tag)}
          >
            {phase === 'loading' ? 'Building your quiz…' : 'Start quiz'}
            <ArrowRight size={16} />
          </Button>
        </div>
      </section>
    </main>
  )
}

function TagPicker({ value, onChange }: { value: string; onChange(tag: string): void }) {
  const backend = useBackend()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<TagMatch[]>([])

  useEffect(() => {
    if (!query.trim()) return
    let cancelled = false
    const t = window.setTimeout(() => {
      backend.quizTags(query).then(
        (h) => !cancelled && setHits(h),
        () => {},
      )
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [backend, query])

  if (value) {
    return (
      <div className="practice-tag">
        <Tag size={15} aria-hidden="true" />
        <span className="practice-tag__name" title={value}>
          {value}
        </span>
        <button className="practice-tag__clear" onClick={() => onChange('')} aria-label="Choose another tag">
          <X size={14} />
        </button>
      </div>
    )
  }
  return (
    <div className="practice-field__control">
      <label className="filter">
        <Search size={16} className="filter__icon" aria-hidden="true" />
        <input
          className="filter__input"
          type="search"
          placeholder="Search tags, e.g. “cardio pharm”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) onChange(hits[0].tag)
          }}
          aria-label="Search tags"
          autoComplete="off"
          spellCheck={false}
          autoFocus
        />
      </label>
      {query.trim() && hits.length > 0 && (
        <ul className="practice-tags" aria-label="Matching tags">
          {hits.map((h) => (
            <li key={h.tag}>
              <button className="practice-tags__item" onClick={() => onChange(h.tag)} title={h.tag}>
                <strong>{h.label}</strong>
                <span>{h.tag}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && hits.length === 0 && <p className="practice-tags__none">No tags match.</p>}
    </div>
  )
}

function modeOf(q: QuizQuestion, format: Format, i: number): 'choice' | 'typed' {
  if (!q.choices.length || format === 'typed') return 'typed'
  if (format === 'choice') return 'choice'
  return i % 2 ? 'typed' : 'choice'
}

interface RunnerProps {
  quiz: QuizSet
  format: Format
  index: number
  results: Result[]
  onResult(r: Result): void
  onNext(): void
  onEnd(): void
}

function Runner({ quiz, format, index, results, onResult, onNext, onEnd }: RunnerProps) {
  const backend = useBackend()
  const { theme } = useTheme()
  const mediaBase = useMemo(() => backend.mediaBaseUrl(), [backend])
  const q = quiz.questions[index]
  const mode = modeOf(q, format, index)
  const result = results[index] as Result | undefined
  const answered = !!result
  // What she's typing, for this question only.
  const [draft, setDraft] = useState({ index, text: '' })
  const typed = draft.index === index ? draft.text : ''
  const setTyped = (text: string) => setDraft({ index, text })
  const input = useRef<HTMLInputElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)
  const score = results.filter(isRight).length
  const noop = useCallback(() => {}, [])

  useEffect(() => {
    if (mode === 'typed') input.current?.focus({ preventScroll: true })
  }, [index, mode])
  useEffect(() => {
    if (answered) nextBtn.current?.focus()
  }, [answered])

  const choose = (i: number) => {
    if (answered) return
    onResult({ chosen: i, typed: '', verdict: i === q.correct ? 'correct' : 'wrong', overruled: false })
  }
  const submitTyped = () => {
    if (answered || !typed.trim()) return
    onResult({ chosen: null, typed, verdict: checkAnswer(typed, q.answer), overruled: false })
  }

  const onKey = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, target?: EventTarget | null) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return false
    if (!answered && mode === 'choice') {
      const k = e.key.toLowerCase()
      const i = /^[1-4]$/.test(k) ? Number(k) - 1 : /^[a-d]$/.test(k) ? k.charCodeAt(0) - 97 : -1
      if (i >= 0 && i < q.choices.length) {
        choose(i)
        return true
      }
    }
    if (answered && (e.key === 'Enter' || e.key === ' ') && !(target instanceof HTMLButtonElement)) {
      onNext()
      return true
    }
    return false
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return
      if (e.target instanceof HTMLInputElement) return
      if (onKey(e, e.target)) e.preventDefault()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })

  const verdictText =
    !result
      ? null
      : result.overruled
        ? 'Counted as right.'
        : result.verdict === 'correct'
          ? 'Correct!'
          : result.verdict === 'close'
            ? 'Right, but check the spelling.'
            : null

  return (
    <main className="page page--practice page--practice-run">
      <div className="practice-run__head">
        <p className="practice-run__count tabular">
          Question <strong>{index + 1}</strong> of {quiz.questions.length}
          <span className="practice-run__deck">{q.deck_name.split('::').slice(-2).join(' › ')}</span>
        </p>
        <span className="practice-run__score tabular" aria-label={`${score} right so far`}>
          <Check size={14} aria-hidden="true" /> {score}
        </span>
        <Button variant="ghost" size="sm" onClick={onEnd}>
          End quiz
        </Button>
      </div>
      <div className="progress practice-run__progress" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={quiz.questions.length} aria-valuenow={index + (answered ? 1 : 0)}>
        <div className="progress__bar" style={{ transform: `scaleX(${(index + (answered ? 1 : 0)) / quiz.questions.length})` }} />
      </div>

      <div className="card-surface practice-run__card">
        <CardFrame
          renderKey={`${q.card_id}:${index}:${answered ? 'a' : 'q'}`}
          rendered={q.rendered}
          side={answered ? 'answer' : 'question'}
          scrollToAnswer={false}
          theme={theme}
          mediaBaseUrl={mediaBase}
          onKey={(e: CardKeyEvent) => void onKey(e)}
          onTap={noop}
          onPlay={noop}
        />
      </div>

      <div className="practice-run__answer">
        {mode === 'choice' ? (
          <div className="practice-choices" role="group" aria-label="Choose an answer">
            {q.choices.map((c, i) => {
              const state = !answered ? '' : i === q.correct ? 'is-correct' : i === result?.chosen ? 'is-wrong' : 'is-dim'
              return (
                <button key={i} className={`practice-choice ${state}`} onClick={() => choose(i)} disabled={answered && state === 'is-dim'} aria-pressed={result?.chosen === i}>
                  <Kbd className="practice-choice__key">{LETTERS[i]}</Kbd>
                  <span className="practice-choice__text">{c}</span>
                  {state === 'is-correct' && <Check size={16} aria-label="Correct answer" />}
                  {state === 'is-wrong' && <X size={16} aria-label="Your answer" />}
                </button>
              )
            })}
          </div>
        ) : (
          <form
            className="practice-typed"
            onSubmit={(e) => {
              e.preventDefault()
              if (answered) onNext()
              else submitTyped()
            }}
          >
            <input
              ref={input}
              className={`practice-typed__input ${result ? (isRight(result) ? 'is-correct' : 'is-wrong') : ''}`}
              value={answered ? result!.typed : typed}
              onChange={(e) => setTyped(e.target.value)}
              readOnly={answered}
              placeholder="Type your answer"
              aria-label="Your answer"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {!answered && (
              <Button variant="primary" type="submit" disabled={!typed.trim()}>
                Check
              </Button>
            )}
          </form>
        )}

        <div className="practice-run__feedback" aria-live="polite">
          {answered && (
            <>
              {verdictText ? (
                <span className="practice-verdict practice-verdict--right">{verdictText}</span>
              ) : (
                <span className="practice-verdict practice-verdict--wrong">
                  {mode === 'typed' ? (
                    <>
                      Answer: <strong>{q.answer}</strong>
                    </>
                  ) : (
                    'Not quite. The right answer is highlighted.'
                  )}
                </span>
              )}
              {mode === 'typed' && result!.verdict === 'wrong' && !result!.overruled && (
                <button className="link" onClick={() => onResult({ ...result!, overruled: true })}>
                  I was right
                </button>
              )}
              <Button ref={nextBtn} variant="primary" onClick={onNext} className="practice-run__next">
                {index + 1 < quiz.questions.length ? 'Next' : 'See results'}
                <Kbd className="kbd--on-accent">↵</Kbd>
              </Button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

function Results({ quiz, results, ms, onRetry, onNew }: { quiz: QuizSet; results: Result[]; ms: number; onRetry(ids: number[]): void; onNew(): void }) {
  const done = results.filter(Boolean).length
  const right = results.filter(isRight).length
  const missed = quiz.questions.filter((_, i) => results[i] && !isRight(results[i]))
  const pct = done ? Math.round((right / done) * 100) : 0
  const minutes = Math.max(1, Math.round(ms / 60000))
  return (
    <main className="page page--practice">
      <section className="practice-score">
        <p className="eyebrow">Quiz finished</p>
        <h1 className="practice-score__big tabular">
          {right}
          <span> / {done}</span>
        </h1>
        <p className="practice-score__sub">
          {pct}% right in about {minutes} minute{minutes === 1 ? '' : 's'}.{' '}
          {pct >= 90 ? 'Excellent.' : pct >= 70 ? 'Solid work.' : 'The misses below are worth a second look.'}
        </p>
        <div className="settings-card__actions">
          {missed.length > 0 && (
            <Button variant="primary" onClick={() => onRetry(missed.map((q) => q.card_id))}>
              <RotateCcw size={15} /> Retry the {missed.length} I missed
            </Button>
          )}
          <Button variant="secondary" onClick={onNew}>
            New quiz
          </Button>
          {missed.length > 0 && (
            <Button variant="ghost" onClick={() => navigate({ name: 'browse', q: `cid:${missed.map((q) => q.card_id).join(',')}` })}>
              Open missed cards in Browse
            </Button>
          )}
        </div>
      </section>
      {missed.length > 0 && (
        <section className="settings-card">
          <h2>To review</h2>
          <ul className="practice-missed">
            {missed.map((q) => {
              const r = results[quiz.questions.indexOf(q)]
              const yours = r.chosen !== null ? q.choices[r.chosen] : r.typed
              return (
                <li key={q.card_id}>
                  {q.prompt && <span className="practice-missed__prompt">{q.prompt}</span>}
                  <span className="practice-missed__answer">{q.answer}</span>
                  <span className="practice-missed__meta">
                    You answered “{yours}” · {q.deck_name.split('::').slice(-2).join(' › ')}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}
