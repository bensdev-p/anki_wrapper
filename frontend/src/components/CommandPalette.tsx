import { Command } from 'cmdk'
import { Check, Layers, Monitor, type LucideIcon } from 'lucide-react'
import { flattenDecks, useDecks } from '../lib/decks'
import { navigate } from '../lib/router'
import { useTheme } from '../themes/ThemeProvider'
import { SYSTEM } from '../themes/themes'
import { CountPills } from './CountPills'
import { ThemeSwatch } from './ThemeMenu'

/**
 * Every search term must appear in the item. Matches in the label outrank
 * matches in keywords; whole words outrank prefixes, which outrank substrings.
 * Stricter than cmdk's default fuzzy match, which lets e.g. "dark" match
 * "Step 2 CK / Pediatrics" letter by letter.
 */
function filterItems(value: string, search: string, keywords: string[] = []): number {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return 1
  const label = value.toLowerCase()
  const labelWords = label.split(/[\s:/]+/)
  const extra = keywords.join(' ').toLowerCase()
  let score = 0
  for (const t of terms) {
    if (labelWords.includes(t)) score += 4
    else if (labelWords.some((w) => w.startsWith(t))) score += 3
    else if (label.includes(t)) score += 2
    else if (extra.includes(t)) score += 1
    else return 0
  }
  return score / (terms.length * 4)
}

export interface PaletteAction {
  id: string
  label: string
  icon: LucideIcon
  hint?: string
  run(): void
}

interface Props {
  open: boolean
  onOpenChange(open: boolean): void
  actions: PaletteAction[]
}

export function CommandPalette({ open, onOpenChange, actions }: Props) {
  const { decks } = useDecks()
  const { choice, themes, setChoice } = useTheme()
  const all = decks ? flattenDecks(decks) : []

  const run = (fn: () => void) => {
    onOpenChange(false)
    fn()
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="palette-overlay"
      contentClassName="palette"
      filter={filterItems}
      loop
    >
      <Command.Input className="palette__input" placeholder="Jump to a deck, switch theme…" autoFocus />
      <Command.List className="palette__list">
        <Command.Empty className="palette__empty">No matches</Command.Empty>

        {actions.length > 0 && (
          <Command.Group heading="Actions">
            {actions.map((a) => (
              <Command.Item key={a.id} value={a.label}
                keywords={['action']} onSelect={() => run(a.run)} className="palette__item">
                <a.icon size={16} className="palette__icon" />
                <span className="palette__main">{a.label}</span>
                {a.hint && <span className="palette__hint">{a.hint}</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        <Command.Group heading="Study deck">
          {all.map((d) => {
            const parts = d.full_name.split('::')
            return (
              <Command.Item
                key={d.id}
                value={d.full_name}
                keywords={['study', 'deck']}
                onSelect={() => run(() => navigate({ name: 'study', deckId: d.id }))}
                className="palette__item"
              >
                <Layers size={16} className="palette__icon" />
                <span className="palette__main palette__deck">
                  {parts.slice(0, -1).map((p, i) => (
                    <span key={i} className="palette__crumb">
                      {p}
                      <span className="palette__sep">/</span>
                    </span>
                  ))}
                  <span className="palette__leaf">{parts[parts.length - 1]}</span>
                </span>
                <CountPills counts={d.counts} size="sm" />
              </Command.Item>
            )
          })}
        </Command.Group>

        <Command.Group heading="Theme">
          <Command.Item value="Theme: System" keywords={['theme', 'auto', 'light', 'dark']} onSelect={() => run(() => setChoice(SYSTEM))} className="palette__item">
            <span className="swatch swatch--icon">
              <Monitor size={13} />
            </span>
            <span className="palette__main">Theme: System</span>
            {choice === SYSTEM && <Check size={16} className="palette__check" />}
          </Command.Item>
          {themes.map((t) => (
            <Command.Item
              key={t.id}
              value={`Theme: ${t.name}`}
              keywords={['theme', t.kind]}
              onSelect={() => run(() => setChoice(t.id))}
              className="palette__item"
            >
              <ThemeSwatch theme={t} />
              <span className="palette__main">Theme: {t.name}</span>
              <span className="palette__hint">{t.description}</span>
              {choice === t.id && <Check size={16} className="palette__check" />}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
