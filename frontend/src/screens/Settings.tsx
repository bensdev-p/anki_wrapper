import { Check, Copy, LogIn, RefreshCw, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useBackend } from '../backend/context'
import type { CollectionInfo, SharingStatus } from '../backend/types'
import { Button } from '../components/Button'
import { Dialog } from '../components/Dialog'
import { APP_NAME } from '../components/Logo'
import { SignInDialog } from '../components/SignInDialog'
import { Switch } from '../components/Switch'
import { useToast } from '../components/Toast'
import { relativeTime, useSync } from '../lib/sync'

export function Settings() {
  const backend = useBackend()
  const [info, setInfo] = useState<CollectionInfo | null>(null)

  useEffect(() => {
    backend.info().then(setInfo, () => {})
  }, [backend])

  return (
    <main className="page page--settings">
      <h1 className="settings__title">Settings</h1>
      <AccountSection />
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
        <h2>About</h2>
        <p className="settings-card__text">
          {APP_NAME} {info?.version ?? ''} studies with Anki’s own engine, so reviews, scheduling and sync behave exactly
          as in Anki. Your cards stay on your computer and in your AnkiWeb account.
        </p>
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
