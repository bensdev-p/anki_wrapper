import { Check, ChevronDown, Copy, Download, FolderOpen, LogIn, RefreshCw, RotateCcw, Save, Search, Smartphone, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useBackend } from '../backend/context'
import { BackendError } from '../backend/AnkiBackend'
import type { BackupInfo, CollectionInfo, SharingStatus, UpdateInfo } from '../backend/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { APP_NAME } from '../components/Logo'
import { SignInDialog } from '../components/SignInDialog'
import { Switch } from '../components/Switch'
import { useToast } from '../components/Toast'
import { openImport } from '../lib/importer'
import { load, save } from '../lib/storage'
import { ThemeSwatch } from '../components/ThemeMenu'
import { useTheme } from '../themes/ThemeProvider'
import { EDITOR_FAMILIES } from '../themes/editorThemes'
import { CORE_THEME_IDS, SYSTEM, type Theme } from '../themes/themes'
import { inDesktopWindow, openExternal, openFolder } from '../lib/platform'
import { relativeTime, useSync } from '../lib/sync'

export function Settings() {
  const backend = useBackend()
  useEffect(() => {
    if (!window.location.hash.includes('appearance')) return
    const id = window.setTimeout(() => document.getElementById('appearance')?.scrollIntoView({ block: 'start' }), 60)
    return () => window.clearTimeout(id)
  }, [])
  const [info, setInfo] = useState<CollectionInfo | null>(null)

  useEffect(() => {
    backend.info().then(setInfo, () => {})
  }, [backend])

  return (
    <main className="page page--settings">
      <h1 className="settings__title">Settings</h1>
      <AccountSection />
      <AppearanceSection />
      {info?.desktop && !info.remote && <PhoneSection />}
      {info?.remote && (
        <section className="settings-card">
          <h2>This device</h2>
          <p className="settings-card__text">
            This device is connected to {APP_NAME} on your computer. Keep {APP_NAME} open there, and the computer awake,
            while you study.
          </p>
        </section>
      )}
      <section className="settings-card">
        <h2>Import</h2>
        <p className="settings-card__text">
          Add a shared deck from a file (.apkg), e.g. one downloaded from AnkiWeb’s shared decks. Cards you already have are
          left as they are.
        </p>
        <div className="settings-card__actions">
          <Button variant="secondary" onClick={openImport}>
            <Upload size={15} /> Import a deck file…
          </Button>
        </div>
      </section>
      {info && !info.remote && !info.is_sample && <BackupsSection canRestore={info.desktop} />}
      <section className="settings-card">
        <h2>About</h2>
        <p className="settings-card__text">
          {APP_NAME} {info?.version ?? ''} studies with Anki’s own engine, so reviews, scheduling and sync behave exactly
          as in Anki. Your cards stay on your computer and in your AnkiWeb account.
        </p>
        {info?.desktop && !info.remote && <UpdateRow />}
        {inDesktopWindow() && (
          <div className="settings-card__actions">
            <Button variant="ghost" size="sm" onClick={() => openFolder('logs')}>
              <FolderOpen size={14} /> Show log files
            </Button>
          </div>
        )}
      </section>
    </main>
  )
}

function AccountSection() {
  const { status, syncNow, logout } = useSync()
  const [signInOpen, setSignInOpen] = useState(false)
  if (!status) return <section className="settings-card settings-card--loading" aria-busy="true" />

  return (
    <section className="settings-card">
      <h2>AnkiWeb</h2>
      {status.enabled ? (
        <>
          <p className="settings-card__text">
            Signed in as <strong>{status.username}</strong>.{' '}
            {status.last_synced_at ? `Last synced ${relativeTime(status.last_synced_at)}.` : 'Not synced yet.'}
          </p>
          <div className="settings-card__actions">
            <Button variant="secondary" onClick={() => void syncNow()} disabled={status.phase !== 'idle'}>
              <RefreshCw size={15} className={status.phase !== 'idle' ? 'spin' : ''} /> Sync now
            </Button>
            {status.can_sign_in && (
              <Button variant="ghost" onClick={() => void logout()} disabled={status.phase !== 'idle'}>
                Sign out
              </Button>
            )}
          </div>
        </>
      ) : status.can_sign_in ? (
        <>
          <p className="settings-card__text">
            Sign in to keep this computer in sync with Anki on your other devices. Your password goes straight to
            AnkiWeb and isn’t saved.
          </p>
          <div className="settings-card__actions">
            <Button variant="primary" onClick={() => setSignInOpen(true)}>
              <LogIn size={15} /> Sign in to AnkiWeb
            </Button>
          </div>
          <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
        </>
      ) : (
        <p className="settings-card__text">Sync isn’t set up for this collection.</p>
      )}
    </section>
  )
}

function PhoneSection() {
  const backend = useBackend()
  const toast = useToast()
  const [sharing, setSharing] = useState<SharingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmNewCode, setConfirmNewCode] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = useCallback(() => backend.sharingStatus().then(setSharing, () => {}), [backend])
  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      setSharing(await backend.setSharing(enabled))
    } catch {
      toast('Couldn’t change sharing. Try again.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const newCode = async () => {
    setConfirmNewCode(false)
    setSharing(await backend.newSharingCode())
    toast('New code set. Phones need to connect again.', 'info')
  }

  const url = sharing?.urls[0]
  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked; the address is selectable anyway
    }
  }

  return (
    <section className="settings-card" aria-labelledby="phone-title">
      <div className="settings-card__head">
        <div>
          <h2 id="phone-title">Use on your phone</h2>
          <p className="settings-card__text">
            Study on your phone or tablet over your home Wi-Fi, from the cards on this computer.
          </p>
        </div>
        {sharing ? (
          <Switch checked={sharing.enabled} onChange={(v) => void toggle(v)} disabled={busy} label="Use on your phone" />
        ) : (
          <span className="skeleton" style={{ width: 44, height: 26, borderRadius: 13 }} />
        )}
      </div>

      {sharing?.error && <p className="settings-card__error">{sharing.error}</p>}

      {sharing?.enabled && sharing.running && url && (
        <div className="phone">
          <img className="phone__qr" src={backend.sharingQrUrl(url)} width={180} height={180} alt="QR code to open Rounds on your phone" />
          <ol className="phone__steps">
            <li>Connect your phone to the same Wi-Fi as this computer.</li>
            <li>
              Point your phone’s camera at the code, or open{' '}
              <span className="phone__url">
                <code>{url}</code>
                <button className="icon-btn" onClick={() => void copy()} aria-label="Copy address">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </span>
            </li>
            <li>
              If it asks for a code, enter <strong className="phone__code tabular">{sharing.code}</strong>
            </li>
          </ol>
          <div className="phone__foot">
            <span>
              <Smartphone size={14} aria-hidden="true" /> {sharing.devices === 0 ? 'No phones connected yet' : `${sharing.devices} connected`}
            </span>
            <button className="link" onClick={() => setConfirmNewCode(true)}>
              Change code…
            </button>
          </div>
          <p className="settings-card__hint">
            Keep {APP_NAME} open on this computer while you study. If your computer asks whether {APP_NAME} may accept
            incoming connections, choose Allow. On an iPhone, Share → Add to Home Screen makes it feel like an app.
          </p>
        </div>
      )}

      <Dialog
        open={confirmNewCode}
        onClose={() => setConfirmNewCode(false)}
        title="Change the code?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmNewCode(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void newCode()}>
              Change code
            </Button>
          </>
        }
      >
        <p>Every connected phone is signed out and needs the new code to connect again.</p>
      </Dialog>
    </section>
  )
}

function UpdateRow() {
  const backend = useBackend()
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  useEffect(() => {
    backend.updateInfo().then(setUpdate, () => {})
  }, [backend])
  // No answer from GitHub (offline, private repo): say nothing rather than guess.
  if (!update?.latest) return null
  return update.available && update.url ? (
    <div className="update-row">
      <span>
        <strong>{APP_NAME} {update.latest}</strong> is available.
      </span>
      <Button variant="primary" size="sm" onClick={() => openExternal(update.url!)}>
        <Download size={14} /> Download
      </Button>
    </div>
  ) : (
    <p className="settings-card__hint">You have the latest version.</p>
  )
}

function formatSize(bytes: number): string {
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function BackupsSection({ canRestore }: { canRestore: boolean }) {
  const backend = useBackend()
  const toast = useToast()
  const [list, setList] = useState<BackupInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState<BackupInfo | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(() => backend.backups().then(setList, () => setList([])), [backend])
  useEffect(() => {
    void load()
  }, [load])

  const backupNow = async () => {
    setBusy(true)
    try {
      const created = await backend.backupNow()
      toast(created ? 'Backup saved.' : 'Nothing changed since the last backup.', 'info')
      await load()
    } catch (err) {
      toast(err instanceof BackendError ? err.message : 'Couldn’t make a backup.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    if (!restoring) return
    setBusy(true)
    try {
      await backend.restoreBackup(restoring.name)
      setRestoring(null)
      // Everything on screen may have changed: start fresh.
      window.location.hash = '#/'
      window.location.reload()
    } catch (err) {
      toast(err instanceof BackendError ? err.message : 'Couldn’t restore that backup.', 'error')
      setBusy(false)
    }
  }

  const shown = list ? (showAll ? list : list.slice(0, 5)) : []
  const when = (b: BackupInfo) =>
    new Date(b.created * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  return (
    <section className="settings-card">
      <h2>Backups</h2>
      <p className="settings-card__text">
        Anki saves a backup before every sync, every 30 minutes while you study, and when you quit.
      </p>
      <div className="settings-card__actions">
        <Button variant="secondary" onClick={() => void backupNow()} disabled={busy}>
          <Save size={15} /> Back up now
        </Button>
        {inDesktopWindow() && (
          <Button variant="ghost" onClick={() => openFolder('backups')}>
            <FolderOpen size={15} /> Show in folder
          </Button>
        )}
      </div>
      {list && list.length > 0 && (
        <ul className="backups">
          {shown.map((b) => (
            <li key={b.name} className="backups__row">
              <span className="backups__when">{when(b)}</span>
              <span className="backups__size tabular">{formatSize(b.size)}</span>
              {canRestore && (
                <button className="link" onClick={() => setRestoring(b)} disabled={busy}>
                  <RotateCcw size={13} /> Restore…
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {list && list.length > 5 && (
        <button className="link backups__more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}

      <Dialog
        open={restoring !== null}
        blocking={busy}
        onClose={() => setRestoring(null)}
        title="Restore this backup?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setRestoring(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void restore()} disabled={busy}>
              {busy ? 'Restoring…' : 'Restore'}
            </Button>
          </>
        }
      >
        <p>
          Your collection on this computer goes back to how it was on <strong>{restoring ? when(restoring) : ''}</strong>.
          Anything you did since then is replaced. A backup of how it is now is saved first, so you can undo this.
        </p>
        <p>
          The next sync will ask which copy to keep: choose <strong>Upload</strong> to send the restored cards to AnkiWeb
          and your other devices.
        </p>
      </Dialog>
    </section>
  )
}

function ThemeCard({ theme, selected, onPick }: { theme: Theme; selected: boolean; onPick(): void }) {
  const t = theme.tokens
  return (
    <button className="theme-card" role="radio" aria-checked={selected} onClick={onPick} title={theme.description}>
      <span className="theme-card__preview" style={{ background: t.bg, borderColor: t.border }} aria-hidden="true">
        <span className="theme-card__panel" style={{ background: t.surface, borderColor: t.border }}>
          <span className="theme-card__line" style={{ background: t.text }} />
          <span className="theme-card__line theme-card__line--short" style={{ background: t['text-subtle'] }} />
          <span className="theme-card__dots">
            {(['again', 'hard', 'good', 'easy'] as const).map((k) => (
              <span key={k} style={{ background: t[k] }} />
            ))}
          </span>
        </span>
        <span className="theme-card__accent" style={{ background: t.accent }} />
      </span>
      <span className="theme-card__name">{theme.name}</span>
    </button>
  )
}

function AppearanceSection() {
  const { choice, theme, themes, setChoice } = useTheme()
  // Closed by default (it's long); remembered; "All themes…" opens it.
  const [open, setOpenState] = useState(() => window.location.hash.includes('appearance') || load('appearance-open', false))
  const setOpen = (next: boolean) => {
    setOpenState(next)
    save('appearance-open', next)
  }
  useEffect(() => {
    const onHash = () => window.location.hash.includes('appearance') && setOpenState(true)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const [kind, setKind] = useState<'all' | 'light' | 'dark'>('all')
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const match = (t: Theme) =>
    (kind === 'all' || t.kind === kind) && (!q || `${t.name} ${t.family ?? 'rounds'} ${t.description}`.toLowerCase().includes(q))
  const all: [string, Theme[]][] = [
    ['Rounds', themes.filter((t) => CORE_THEME_IDS.includes(t.id))],
    ...EDITOR_FAMILIES.map((f): [string, Theme[]] => [f, themes.filter((t) => t.family === f)]),
  ]
  const groups = all
    .map(([label, list]): [string, Theme[]] => [label, list.filter(match)])
    .filter(([, list]) => list.length > 0)

  return (
    <section className="settings-card" id="appearance">
      <div className="settings-card__head">
        <div>
          <h2>Appearance</h2>
          <p className="settings-card__text appearance__current">
            <ThemeSwatch theme={theme} />
            <span>
              <strong>{theme.name}</strong>
              {choice === SYSTEM ? ' (matching your system)' : ''}
            </span>
          </p>
        </div>
        <label className="options__children">
          <input type="checkbox" checked={choice === SYSTEM} onChange={(e) => setChoice(e.target.checked ? SYSTEM : theme.id)} />
          Match system light/dark
        </label>
      </div>
      <button
        className="appearance__toggle"
        aria-expanded={open}
        aria-controls="appearance-gallery"
        onClick={() => setOpen(!open)}
      >
        <span>{open ? 'Hide themes' : `Show all ${themes.length} themes`}</span>
        <ChevronDown size={16} className={open ? 'is-open' : ''} aria-hidden="true" />
      </button>
      {open && (
        <div id="appearance-gallery">
          <p className="settings-card__hint">Cards follow along: dark themes turn on your decks’ night mode.</p>
          <div className="theme-filter">
            <div className="chips" role="radiogroup" aria-label="Show">
              {(['all', 'dark', 'light'] as const).map((k) => (
                <button key={k} className="chip" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                  {k === 'all' ? 'All' : k === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
            <label className="filter theme-filter__search">
              <Search size={15} className="filter__icon" aria-hidden="true" />
              <input
                className="filter__input"
                type="search"
                placeholder="Find a theme"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Find a theme"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          {groups.length === 0 && <p className="settings-card__hint">No themes match “{query}”.</p>}
          {groups.map(([label, list]) => (
            <div key={label} className="theme-grid__group">
              <h3 className="theme-grid__label">{label}</h3>
              <div className="theme-grid" role="radiogroup" aria-label={label}>
                {list.map((t) => (
                  <ThemeCard key={t.id} theme={t} selected={choice === t.id} onPick={() => setChoice(t.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
