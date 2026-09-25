import { AlertCircle, Check, CloudOff, LogIn, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { relativeTime, useSync } from '../lib/sync'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { SignInDialog } from './SignInDialog'

function mb(n: number) {
  return `${(n / 1_048_576).toFixed(n > 10_485_760 ? 0 : 1)} MB`
}

/**
 * Top-bar sync control with a status popover, plus the one-way sync
 * decisions. Offers sign-in on the computer running Rounds; hidden elsewhere
 * when sync isn't set up.
 */
export function SyncButton() {
  const { status, syncNow, fullDownload, fullUpload, logout } = useSync()
  const [open, setOpen] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [confirmUpload, setConfirmUpload] = useState(false)
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

  if (!status) return null

  if (!status.enabled) {
    if (!status.can_sign_in) return null
    return (
      <>
        <button className="sync-btn" onClick={() => setSignInOpen(true)} title="Sign in to AnkiWeb to sync">
          <LogIn size={16} strokeWidth={2} />
          <span className="sync-btn__text">Sign in</span>
        </button>
        <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />
      </>
    )
  }

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

  const needs = status.phase === 'idle' && status.needs !== dismissedNeeds ? status.needs : null
  const dismiss = () => {
    setConfirmUpload(false)
    setDismissedNeeds(status.needs)
  }
  const transferring = status.phase === 'downloading' || status.phase === 'uploading'
  const pct =
    status.total_bytes && status.transferred_bytes !== null
      ? Math.min(100, Math.round((status.transferred_bytes / status.total_bytes) * 100))
      : null
  const upload = () => {
    setConfirmUpload(false)
    void fullUpload()
  }

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
          {status.can_sign_in && (
            <button
              className="link sync-pop__signout"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                void logout()
              }}
            >
              Sign out of AnkiWeb
            </button>
          )}
        </div>
      )}

      {/* New device: AnkiWeb has a collection, this one is empty. */}
      <Dialog
        open={needs === 'full_download'}
        onClose={dismiss}
        title="Download your collection"
        actions={
          <>
            <Button variant="ghost" onClick={dismiss}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => void fullDownload()}>
              Download from AnkiWeb
            </Button>
          </>
        }
      >
        <p>AnkiWeb has your collection and this device doesn’t yet. Download it now? This can take a few minutes.</p>
      </Dialog>

      {/* Both sides changed in a way that can't be merged: pick a direction. */}
      <Dialog
        open={needs === 'full_sync' && !confirmUpload}
        onClose={dismiss}
        title="Changes can’t be merged"
        actions={
          <>
            <Button variant="ghost" onClick={dismiss}>
              Not now
            </Button>
            {status.can_upload && (
              <Button variant="secondary" onClick={() => setConfirmUpload(true)}>
                Upload this computer’s copy
              </Button>
            )}
            <Button variant="primary" onClick={() => void fullDownload()}>
              Download from AnkiWeb
            </Button>
          </>
        }
      >
        <p>
          AnkiWeb and this device both changed in a way Anki can’t merge (usually a note type edited on another
          device). Pick which copy to keep. A backup is saved first either way.
        </p>
        <p>
          <strong>Download from AnkiWeb</strong> replaces this device’s copy. Reviews done here since the last sync
          are lost. {status.can_upload ? 'Usually the right choice if you study on other devices.' : ''}
        </p>
        {status.can_upload && (
          <p>
            <strong>Upload this computer’s copy</strong> replaces AnkiWeb’s. Your other devices then have to download
            it, and anything they haven’t synced yet is lost.
          </p>
        )}
      </Dialog>

      {/* AnkiWeb has nothing yet and this device has cards. */}
      <Dialog
        open={needs === 'server_empty' && !confirmUpload}
        onClose={dismiss}
        title="AnkiWeb is empty"
        actions={
          status.can_upload ? (
            <>
              <Button variant="ghost" onClick={dismiss}>
                Not now
              </Button>
              <Button variant="primary" onClick={() => setConfirmUpload(true)}>
                Upload to AnkiWeb
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={dismiss}>
              OK
            </Button>
          )
        }
      >
        {status.can_upload ? (
          <p>
            This AnkiWeb account has no collection yet. Upload the cards on this computer so your other devices can
            download them?
          </p>
        ) : (
          <p>
            This AnkiWeb account has no collection yet. Sync from Anki on your computer first. This device never
            uploads a whole collection, so it can’t overwrite your cards.
          </p>
        )}
      </Dialog>

      <Dialog
        open={confirmUpload && !!needs}
        onClose={() => setConfirmUpload(false)}
        title="Replace AnkiWeb’s collection?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmUpload(false)}>
              Go back
            </Button>
            <Button variant="primary" onClick={upload}>
              Upload and replace
            </Button>
          </>
        }
      >
        <p>
          AnkiWeb’s copy will be replaced with the one on this computer. Your other devices will need to download
          it, and reviews on them that haven’t synced yet will be lost.
        </p>
        <p>A backup of this computer’s collection is saved first.</p>
      </Dialog>

      <Dialog
        open={transferring}
        onClose={() => {}}
        blocking
        title={status.phase === 'uploading' ? 'Uploading to AnkiWeb' : 'Downloading from AnkiWeb'}
        actions={null}
      >
        <p>{pct === null ? 'Connecting…' : `${mb(status.transferred_bytes ?? 0)} of ${mb(status.total_bytes ?? 0)}`}</p>
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <div className="meter__fill" style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />
        </div>
      </Dialog>
    </div>
  )
}
