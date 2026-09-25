import { useEffect, useId, useRef, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { openExternal } from '../lib/platform'
import { useSync } from '../lib/sync'
import { Button } from './Button'
import { Dialog } from './Dialog'

/**
 * AnkiWeb sign-in. The password goes to the local server, which sends it to
 * AnkiWeb once and keeps only the sync key. Only offered on the computer
 * running Rounds (`can_sign_in`), never to a phone on the network.
 */
export function SignInDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { login } = useSync()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const formId = useId()

  useEffect(() => {
    if (open) {
      window.setTimeout(() => emailRef.current?.focus(), 30)
    } else {
      // Clear on close (not on open, which would race with typing).
      setPassword('')
      setError(null)
    }
  }, [open])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password || busy) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      setPassword('')
      onClose()
    } catch (err) {
      setError(
        err instanceof BackendError && err.status !== 0 ? err.message : 'Couldn’t reach Rounds. Is the app still running?',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Sign in to AnkiWeb"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} disabled={busy || !email.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </>
      }
    >
      <form id={formId} className="signin" onSubmit={submit}>
        <p>Use the same account as Anki on your other devices. Your reviews sync both ways.</p>
        <label className="signin__field">
          <span>Email</span>
          <input
            ref={emailRef}
            className="dialog-input"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        <label className="signin__field">
          <span>Password</span>
          <input
            className="dialog-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
        </label>
        {error && (
          <p className="signin__error" role="alert">
            {error}
          </p>
        )}
        <p className="dialog-hint">
          Your password goes straight to AnkiWeb and isn’t saved. No account yet?{' '}
          <a
            href="https://ankiweb.net/account/signup"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              e.preventDefault()
              openExternal(e.currentTarget.href)
            }}
          >
            Create one on ankiweb.net
          </a>
          .
        </p>
      </form>
    </Dialog>
  )
}
