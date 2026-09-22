import { Home, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { APP_NAME, Logo } from './components/Logo'
import { TopBar } from './components/TopBar'
import { flattenDecks, useDecks } from './lib/decks'
import { navigate, useRoute } from './lib/router'
import { DeckList } from './screens/DeckList'
import { Study } from './screens/Study'

export default function App() {
  const route = useRoute()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { decks } = useDecks()

  // Cmd/Ctrl+K anywhere (the card iframe forwards it too; see Study).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = []
    if (route.name === 'study') {
      list.push({ id: 'home', label: 'Back to deck list', icon: Home, run: () => navigate({ name: 'home' }) })
    } else if (decks) {
      // Suggest the deck with the most due cards.
      const best = flattenDecks(decks)
        .filter((d) => d.level === 1)
        .sort((a, b) => b.counts.review + b.counts.learning + b.counts.new - (a.counts.review + a.counts.learning + a.counts.new))[0]
      if (best && best.counts.review + best.counts.learning + best.counts.new > 0) {
        list.push({
          id: 'study-best',
          label: `Start studying ${best.full_name}`,
          hint: `${best.counts.review + best.counts.learning} due`,
          icon: Play,
          run: () => navigate({ name: 'study', deckId: best.id }),
        })
      }
    }
    return list
  }, [route, decks])

  const openPalette = () => setPaletteOpen(true)

  return (
    <>
      {route.name === 'study' ? (
        <Study key={route.deckId} deckId={route.deckId} paused={paletteOpen} onOpenPalette={openPalette} />
      ) : (
        <div className="app">
          <TopBar
            onOpenPalette={openPalette}
            left={
              <a className="brand" href="#/">
                <Logo />
                <span className="brand__name">{APP_NAME}</span>
              </a>
            }
          />
          <DeckList />
        </div>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />
    </>
  )
}
