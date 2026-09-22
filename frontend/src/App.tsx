import { BarChart3, Home, Play, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { AppNav } from './components/AppNav'
import { CommandPalette, type PaletteAction } from './components/CommandPalette'
import { APP_NAME, Logo } from './components/Logo'
import { TopBar } from './components/TopBar'
import { flattenDecks, useDecks } from './lib/decks'
import { navigate, STATS_DEFAULT_DAYS, useRoute } from './lib/router'
import { SYNCED_EVENT, useSyncLifecycle } from './lib/sync'
import { Browser } from './screens/Browser'
import { DeckList } from './screens/DeckList'
import { Stats } from './screens/Stats'
import { Study } from './screens/Study'

export default function App() {
  const route = useRoute()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const { decks, reload: reloadDecks } = useDecks()
  useSyncLifecycle()

  // After a sync, deck counts may have changed on another device.
  useEffect(() => {
    const onSynced = () => void reloadDecks()
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [reloadDecks])

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
    if (route.name !== 'home') {
      list.push({ id: 'home', label: 'Go to deck list', icon: Home, run: () => navigate({ name: 'home' }) })
    }
    if (route.name !== 'stats') {
      const deckId = route.name === 'study' ? route.deckId : null
      list.push({
        id: 'stats',
        label: deckId === null ? 'Open statistics' : 'Statistics for this deck',
        icon: BarChart3,
        run: () => navigate({ name: 'stats', deckId, days: STATS_DEFAULT_DAYS }),
      })
    }
    if (route.name !== 'browse') {
      list.push({ id: 'browse', label: 'Browse cards', icon: Search, run: () => navigate({ name: 'browse', q: '' }) })
    }
    if (route.name === 'home' && decks) {
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
            center={<AppNav route={route} />}
          />
          {route.name === 'stats' ? (
            <Stats deckId={route.deckId} days={route.days} />
          ) : route.name === 'browse' ? (
            <Browser initialQuery={route.q} />
          ) : (
            <DeckList />
          )}
          <AppNav route={route} variant="tabs" />
        </div>
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />
    </>
  )
}
