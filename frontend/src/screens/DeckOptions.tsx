import { ArrowLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { DeckOptions as Options, DeckOptionsConfig } from '../backend/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { Switch } from '../components/Switch'
import { useToast } from '../components/Toast'
import { useDecks } from '../lib/decks'
import { navigate } from '../lib/router'

// Anki's own names for its enum choices (DeckConfig.Config in the Anki source).
const CHOICES = {
  new_card_insert_order: ['Sequential (oldest first)', 'Random'],
  leech_action: ['Suspend card', 'Tag only'],
  new_card_gather_priority: [
    'Deck',
    'Deck, then random notes',
    'Ascending position',
    'Descending position',
    'Random notes',
    'Random cards',
  ],
  new_card_sort_order: [
    'Card type, then order gathered',
    'Order gathered',
    'Card type, then random',
    'Random note, then card type',
    'Random',
  ],
  new_mix: ['Mix with reviews', 'Show after reviews', 'Show before reviews'],
  interday_learning_mix: ['Mix with reviews', 'Show after reviews', 'Show before reviews'],
  review_order: [
    'Due date, then random',
    'Due date, then deck',
    'Deck, then due date',
    'Ascending intervals',
    'Descending intervals',
    'Ascending ease',
    'Descending ease',
    'Ascending retrievability',
    'Descending retrievability',
    'Relative overdueness',
    'Random',
    'Order added',
    'Reverse order added',
  ],
} as const

type Key = keyof DeckOptionsConfig

/** "1m 10m 1h 1d" ⇄ minutes. */
function formatSteps(steps: number[]): string {
  return steps
    .map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${+m.toFixed(2)}m`))
    .join(' ')
}
function parseSteps(text: string): number[] | null {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  const out: number[] = []
  for (const p of parts) {
    const m = p.match(/^(\d+(?:\.\d+)?)([smhd]?)$/i)
    if (!m) return null
    const n = Number(m[1])
    const unit = (m[2] || 'm').toLowerCase()
    out.push(unit === 's' ? n / 60 : unit === 'h' ? n * 60 : unit === 'd' ? n * 1440 : n)
  }
  return out
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function DeckOptions({ deckId }: { deckId: number }) {
  const backend = useBackend()
  const toast = useToast()
  const { reload: reloadDecks } = useDecks()
  const [opts, setOpts] = useState<Options | null>(null)
  const [draft, setDraft] = useState<DeckOptionsConfig | null>(null)
  const [fsrs, setFsrs] = useState(false)
  const [applyToChildren, setApplyToChildren] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [presetDialog, setPresetDialog] = useState<'rename' | 'new' | null>(null)

  const load = useCallback(
    (o: Options) => {
      setOpts(o)
      setDraft(o.config)
      setFsrs(o.fsrs)
    },
    [],
  )

  useEffect(() => {
    backend.deckOptions(deckId).then(load, (e: Error) => setError(e.message))
  }, [backend, deckId, load])

  const changes = useMemo(() => {
    if (!opts || !draft) return {}
    const out: Partial<DeckOptionsConfig> = {}
    for (const k of Object.keys(draft) as Key[]) if (!same(draft[k], opts.config[k])) (out as Record<string, unknown>)[k] = draft[k]
    return out
  }, [opts, draft])
  const dirty = Object.keys(changes).length > 0 || (opts !== null && fsrs !== opts.fsrs)
  const preset = opts?.presets.find((p) => p.id === opts.preset_id)

  const save = async (extra: { new_preset_name?: string; rename_preset?: string; preset_id?: number } = {}) => {
    if (!opts) return
    setBusy(true)
    setError(null)
    try {
      const next = await backend.saveDeckOptions(deckId, {
        preset_id: extra.preset_id ?? opts.preset_id,
        changes: extra.preset_id !== undefined ? {} : changes,
        fsrs: fsrs !== opts.fsrs ? fsrs : undefined,
        apply_to_children: applyToChildren,
        new_preset_name: extra.new_preset_name,
        rename_preset: extra.rename_preset,
      })
      load(next)
      void reloadDecks()
      toast(extra.preset_id !== undefined ? `Now using “${next.presets.find((p) => p.id === next.preset_id)?.name}”.` : 'Options saved.', 'info')
    } catch (err) {
      setError(err instanceof BackendError ? err.message : 'Couldn’t save the options.')
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends Key>(key: K, value: DeckOptionsConfig[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  if (error && !opts) {
    return (
      <main className="page page--options">
        <BackLink />
        <p className="settings-card__error">{error}</p>
      </main>
    )
  }
  if (!opts || !draft) {
    return (
      <main className="page page--options" aria-busy="true">
        <BackLink />
        <div className="settings-card settings-card--loading" />
        <div className="settings-card settings-card--loading" />
      </main>
    )
  }

  const num = (key: Key, label: string, help: string, props: { min: number; max: number; step?: number; unit?: string }) => (
    <Row label={label} help={help}>
      <NumberInput value={draft[key] as number} onChange={(v) => set(key, v as never)} {...props} />
    </Row>
  )
  const choice = (key: keyof typeof CHOICES, label: string, help: string) => (
    <Row label={label} help={help}>
      <span className="select">
        <select value={draft[key] as number} onChange={(e) => set(key, Number(e.target.value) as never)}>
          {CHOICES[key].map((text, i) => (
            <option key={i} value={i}>
              {text}
            </option>
          ))}
        </select>
      </span>
    </Row>
  )
  const toggle = (key: Key, label: string, help: string) => (
    <Row label={label} help={help}>
      <Switch checked={draft[key] as boolean} onChange={(v) => set(key, v as never)} label={label} />
    </Row>
  )
  const steps = (key: 'learn_steps' | 'relearn_steps', label: string, help: string) => (
    <Row label={label} help={help}>
      <StepsInput value={draft[key]} onChange={(v) => set(key, v)} allowEmpty={key === 'relearn_steps'} />
    </Row>
  )

  return (
    <main className="page page--options">
      <BackLink />
      <h1 className="settings__title">Options</h1>
      <p className="options__deck">{opts.deck_name}</p>

      <section className="settings-card">
        <div className="options__preset">
          <label className="add__picker">
            <span>Preset</span>
            <span className="select">
              <select
                value={opts.preset_id}
                disabled={busy}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  if (dirty) {
                    toast('Save or reset your changes before switching presets.', 'info')
                    return
                  }
                  void save({ preset_id: id })
                }}
              >
                {opts.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.use_count} deck{p.use_count === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="options__preset-actions">
            <Button variant="ghost" size="sm" onClick={() => setPresetDialog('rename')} disabled={busy}>
              Rename
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPresetDialog('new')} disabled={busy}>
              Save as new preset…
            </Button>
          </div>
        </div>
        {preset && preset.use_count > 1 && (
          <p className="settings-card__hint">
            “{preset.name}” is shared by {preset.use_count} decks. Changes apply to all of them; use “Save as new preset”
            to change only this deck.
          </p>
        )}
      </section>

      <Group title="Daily limits">
        {num('new_per_day', 'New cards/day', 'How many new cards to introduce each day.', { min: 0, max: 9999 })}
        {num('reviews_per_day', 'Maximum reviews/day', 'Reviews beyond this wait until tomorrow.', { min: 0, max: 99999 })}
      </Group>

      <Group title="New cards">
        {steps('learn_steps', 'Learning steps', 'Delays between first views, e.g. “1m 10m”.')}
        {!fsrs && num('graduating_interval_good', 'Graduating interval', 'Days until the first review after the last step.', { min: 1, max: 36500, unit: 'days' })}
        {!fsrs && num('graduating_interval_easy', 'Easy interval', 'Days until the first review when you press Easy.', { min: 1, max: 36500, unit: 'days' })}
        {choice('new_card_insert_order', 'Insertion order', 'Order of newly added cards. Changing it reorders existing new cards.')}
      </Group>

      <Group title="Lapses">
        {steps('relearn_steps', 'Relearning steps', 'Delays after forgetting a review card. Empty = none.')}
        {!fsrs && num('minimum_lapse_interval', 'Minimum interval', 'Shortest interval after relearning.', { min: 1, max: 36500, unit: 'days' })}
        {num('leech_threshold', 'Leech threshold', 'Forget a card this many times and it becomes a leech.', { min: 1, max: 99 })}
        {choice('leech_action', 'Leech action', 'What happens to a leech.')}
      </Group>

      <Group title="Display order">
        {choice('new_card_gather_priority', 'New card gather order', 'Which new cards are picked first.')}
        {choice('new_card_sort_order', 'New card sort order', 'How the day’s new cards are then ordered.')}
        {choice('new_mix', 'New/review order', 'When new cards appear relative to reviews.')}
        {choice('interday_learning_mix', 'Interday learning/review order', 'When learning cards due on a later day appear.')}
        {choice('review_order', 'Review sort order', 'The order reviews are shown in.')}
      </Group>

      <Group title="FSRS">
        <Row
          label="Use FSRS"
          help="Anki’s modern scheduler. Applies to every deck in the collection, on all your devices after syncing."
        >
          <Switch checked={fsrs} onChange={setFsrs} label="Use FSRS" />
        </Row>
        {fsrs &&
          num('desired_retention', 'Desired retention', 'The chance you still remember a card when it’s due. Higher means more reviews.', {
            min: 0.7,
            max: 0.99,
            step: 0.01,
          })}
      </Group>

      <Group title="Burying">
        {toggle('bury_new', 'Bury new siblings', 'Other new cards of the same note wait until tomorrow.')}
        {toggle('bury_reviews', 'Bury review siblings', 'Other review cards of the same note wait until tomorrow.')}
        {toggle('bury_interday_learning', 'Bury interday learning siblings', 'The same for learning cards due on later days.')}
      </Group>

      <Group title="Timer and audio">
        {toggle('show_timer', 'Show answer timer', 'Show how long you’ve spent on the card.')}
        {num('cap_answer_time_to_secs', 'Maximum answer seconds', 'Longer answers are recorded as this many seconds.', { min: 30, max: 7200, unit: 's' })}
        {toggle('disable_autoplay', 'Don’t play audio automatically', 'Use the replay button instead.')}
      </Group>

      <Group title="Advanced">
        {num('maximum_review_interval', 'Maximum interval', 'Reviews are never further apart than this.', { min: 1, max: 36500, unit: 'days' })}
        {!fsrs && num('initial_ease', 'Starting ease', 'Ease new cards start with.', { min: 1.31, max: 5, step: 0.05 })}
        {!fsrs && num('easy_multiplier', 'Easy bonus', 'Extra multiplier when you press Easy.', { min: 1, max: 5, step: 0.05 })}
        {!fsrs && num('interval_multiplier', 'Interval modifier', 'Multiplies every review interval.', { min: 0.5, max: 2, step: 0.01 })}
        {!fsrs && num('hard_multiplier', 'Hard interval', 'Multiplier for Hard answers.', { min: 0.5, max: 1.3, step: 0.05 })}
        {!fsrs && num('lapse_multiplier', 'New interval', 'Multiplier for a forgotten card’s interval.', { min: 0, max: 1, step: 0.05 })}
      </Group>

      <div className="options__bar">
        {error ? <span className="sheet__error-inline">{error}</span> : <span className="sheet__hint">{dirty ? 'Unsaved changes' : 'Saved options sync to your other devices.'}</span>}
        {opts.has_children && (
          <label className="options__children">
            <input type="checkbox" checked={applyToChildren} onChange={(e) => setApplyToChildren(e.target.checked)} /> Use for subdecks too
          </label>
        )}
        <Button
          variant="ghost"
          disabled={!dirty || busy}
          onClick={() => {
            setDraft(opts.config)
            setFsrs(opts.fsrs)
          }}
        >
          Reset
        </Button>
        <Button variant="primary" disabled={(!dirty && !applyToChildren) || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <PresetDialog
        mode={presetDialog}
        initial={presetDialog === 'rename' ? (preset?.name ?? '') : `${opts.deck_name.split('::').pop()}`}
        onClose={() => setPresetDialog(null)}
        onSubmit={(name) => {
          setPresetDialog(null)
          void save(presetDialog === 'rename' ? { rename_preset: name } : { new_preset_name: name })
        }}
      />
    </main>
  )
}

function BackLink() {
  return (
    <button className="back-link" onClick={() => (window.history.length > 1 ? window.history.back() : navigate({ name: 'home' }))}>
      <ArrowLeft size={16} /> Decks
    </button>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-card options__group">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="opt-row">
      <div className="opt-row__text">
        <span className="opt-row__label">{label}</span>
        <span className="opt-row__help">{help}</span>
      </div>
      <div className="opt-row__control">{children}</div>
    </div>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
}: {
  value: number
  onChange(v: number): void
  min: number
  max: number
  step?: number
  unit?: string
}) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    // The saved value changed underneath (reset / reload): show it.
    setShown(value)
    setText(String(value))
  }
  const n = Number(text)
  const invalid = text.trim() === '' || Number.isNaN(n) || n < min || n > max
  return (
    <span className="num">
      <input
        className={`num__input tabular ${invalid ? 'is-invalid' : ''}`}
        inputMode={step < 1 ? 'decimal' : 'numeric'}
        value={text}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() !== '' && !Number.isNaN(v) && v >= min && v <= max) {
            setShown(v)
            onChange(v)
          }
        }}
        title={`${min}–${max}`}
      />
      {unit && <span className="num__unit">{unit}</span>}
    </span>
  )
}

function StepsInput({ value, onChange, allowEmpty }: { value: number[]; onChange(v: number[]): void; allowEmpty: boolean }) {
  const [text, setText] = useState(formatSteps(value))
  const [shown, setShown] = useState(value)
  if (!same(shown, value)) {
    setShown(value)
    setText(formatSteps(value))
  }
  const parsed = parseSteps(text)
  const invalid = parsed === null || (!allowEmpty && parsed.length === 0)
  return (
    <input
      className={`num__input num__input--wide ${invalid ? 'is-invalid' : ''}`}
      value={text}
      aria-invalid={invalid}
      placeholder={allowEmpty ? 'none' : '1m 10m'}
      spellCheck={false}
      autoCapitalize="off"
      onChange={(e) => {
        setText(e.target.value)
        const p = parseSteps(e.target.value)
        if (p && (allowEmpty || p.length)) {
          setShown(p)
          onChange(p)
        }
      }}
    />
  )
}

function PresetDialog({
  mode,
  initial,
  onClose,
  onSubmit,
}: {
  mode: 'rename' | 'new' | null
  initial: string
  onClose(): void
  onSubmit(name: string): void
}) {
  const [name, setName] = useState('')
  const value = name || initial
  return (
    <Dialog
      open={mode !== null}
      onClose={() => {
        setName('')
        onClose()
      }}
      title={mode === 'rename' ? 'Rename preset' : 'Save as new preset'}
      actions={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setName('')
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!value.trim()}
            onClick={() => {
              onSubmit(value.trim())
              setName('')
            }}
          >
            {mode === 'rename' ? 'Rename' : 'Save'}
          </Button>
        </>
      }
    >
      <input
        className="dialog-input"
        aria-label="Preset name"
        key={`${mode}-${initial}`}
        defaultValue={initial}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      {mode === 'new' && <p className="dialog-hint">Only this deck will use the new preset, with the settings shown here.</p>}
    </Dialog>
  )
}
