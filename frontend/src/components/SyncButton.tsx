import { AlertCircle, Check, CloudOff, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { relativeTime, useSync } from '../lib/sync'
import { Button } from './Button'
import { Dialog } from './Dialog'

function mb(n: number) {
  return `${(n / 1_048_576).toFixed(n > 10_485_760 ? 0 : 1)} MB`
}

/** Top-bar sync control with a status popover. Hidden when sync isn't set up. */
export function SyncButton() {
  const { status, syncNow, fullDownload } = useSync()
  const [open, setOpen] = useState(false)
  const [dismissedNeeds, setDismissedNeeds] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!status?.enabled) return null

  const busy = status.phase !== 'idle'
  const attention = !!status.error || !!status.needs
  const Icon = busy ? RefreshCw : attention ? AlertCircle : status.last_synced_at ? Check : CloudOff
  const label = busy
    ? 'Syncing…'
    : status.error
      ? 'Sync problem'
      : status.needs
        ? 'Sync needs attention'
        : status.last_synced_at
          ? `Synced ${relativeTime(status.last_synced_at)}`
          : 'Not synced yet'

  const conflictOpen = !!status.needs && status.needs !== dismissedNeeds && status.phase === 'idle'
  const downloading = status.phase === 'downloading'
  const pct =
    status.total_bytes && status.transferred_bytes !== null
      ? Math.min(100, Math.round((status.transferred_bytes / status.total_bytes) * 100))
      : null

  return (
    <div className="menu-root" ref={root}>
      <button
        className={`sync-btn ${attention ? 'sync-btn--attention' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
      >
        <Icon size={16} strokeWidth={2} className={busy ? 'spin' : ''} />
        <span className="sync-btn__text">{busy ? 'Syncing' : 'Sync'}</span>
      </button>

      {open && (
        <div className="menu sync-pop" role="dialog" aria-label="Sync">
          <div className="sync-pop__head">
            <strong>{label}</strong>
            <span>AnkiWeb · {status.username}</span>
          </div>
          {status.error && <p className="sync-pop__error">{status.error}</p>}
          {status.server_message && <p className="sync-pop__note">{status.server_message}</p>}
          {status.media_active && <p className="sync-pop__note">Media: {status.media_summary || 'checking…'}</p>}
          <p className="sync-pop__hint">
            Reviews here reach your other devices through AnkiWeb. Sync on those devices too to see the changes there.
          </p>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void syncNow()} className="sync-pop__btn">
            <RefreshCw size={14} className={busy ? 'spin' : ''} /> {busy ? 'Syncing…' : 'Sync now'}
          </Button>
          {status.needs && (
            <Button variant="secondary" size="sm" onClick={() => setDismissedNeeds(null)} className="sync-pop__btn">
              Review sync issue…
            </Button>
          )}
        </div>
      )}

      {/* One-way sync decisions. There is never an upload option here. */}
      <Dialog
        open={conflictOpen && status.needs !== 'server_empty'}
        onClose={() => setDismissedNeeds(status.needs)}
        title={status.needs === 'full_download' ? 'Download your collection' : 'Changes can’t be merged'}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDismissedNeeds(status.needs)}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => void fullDownload()}>
              Download from AnkiWeb
            </Button>
          </>
        }
      >
        {status.needs === 'full_download' ? (
          <p>AnkiWeb has your collection and this device doesn’t yet. Download it now? This can take a few minutes.</p>
        ) : (
          <>
            <p>
              AnkiWeb and this device both changed in a way Anki can’t merge (usually a note type edited on
              another device).
            </p>
            <p>
              <strong>Downloading AnkiWeb’s copy</strong> replaces this device’s copy. Your other devices and AnkiWeb are
              not changed. Reviews done here since the last sync are lost. A backup is saved first.
            </p>
          </>
        )}
      </Dialog>

      <Dialog
        open={conflictOpen && status.needs === 'server_empty'}
        onClose={() => setDismissedNeeds('server_empty')}
        title="AnkiWeb is empty"
        actions={
          <Button variant="primary" onClick={() => setDismissedNeeds('server_empty')}>
            OK
          </Button>
        }
      >
        <p>
          This AnkiWeb account has no collection yet. Open Anki on the Mac and sync there first. This app never
          uploads a whole collection, so it can’t overwrite your cards.
        </p>
      </Dialog>

      <Dialog open={downloading} onClose={() => {}} blocking title="Downloading from AnkiWeb" actions={null}>
        <p>{pct === null ? 'Connecting…' : `${mb(status.transferred_bytes ?? 0)} of ${mb(status.total_bytes ?? 0)}`}</p>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <div className="meter__fill" style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />
        </div>
      </Dialog>
    </div>
  )
}
