import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import { PAIRING_REQUIRED_EVENT } from '../backend/httpBackend'
import { Button } from './Button'
import { APP_NAME, Logo } from './Logo'

type State = 'loading' | 'pair' | 'ready'

/** A code in the link from the QR code: http://…:8766/#pair=123456 */
function codeFromUrl(): string | null {
  const m = window.location.hash.match(/^#pair=(\d{6})/)
  return m ? m[1] : null
}

/**
 * Loads the collection info before the app renders (it tells the backend
 * where this device gets media). A phone that hasn't paired with the
 * desktop app yet sees the pairing screen instead.
 */
export function PairingGate({ children }: { children: ReactNode }) {
  const backend = useBackend()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    backend.info().then(
      () => setState('ready'),
      // Offline or another error: let the app show its usual offline state.
      (err) => setState(err instanceof BackendError && err.kind === 'PairingRequired' ? 'pair' : 'ready'),
    )
    const onRequired = () => setState('pair')
    window.addEventListener(PAIRING_REQUIRED_EVENT, onRequired)
    return () => window.removeEventListener(PAIRING_REQUIRED_EVENT, onRequired)
  }, [backend])

  if (state === 'loading') return null
  if (state === 'pair') {
    return (
      <PairScreen
        onPaired={() => {
          // Start fresh: every screen reloads with this device's access.
          window.location.replace(window.location.pathname + '#/')
          window.location.reload()
        }}
      />
    )
  }
  return <>{children}</>
}

function PairScreen({ onPaired }: { onPaired(): void }) {
  const backend = useBackend()
  const [code, setCode] = useState(() => codeFromUrl() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const autoTried = useRef(false)

  const submit = useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return
      setBusy(true)
      setError(null)
      try {
        await backend.pair(value)
        onPaired()
      } catch (err) {
        setError(err instanceof BackendError && err.status !== 0 ? err.message : 'Can’t reach your computer. Is Rounds open on it?')
        setCode('')
        inputRef.current?.focus()
      } finally {
        setBusy(false)
      }
    },
    [backend, busy, onPaired],
  )

  // Opened from the QR code: the code is already in the link.
  useEffect(() => {
    const fromUrl = codeFromUrl()
    if (fromUrl && !autoTried.current) {
      autoTried.current = true
      void submit(fromUrl)
    }
  }, [submit])

  return (
    <main className="pair">
      <form
        className="pair__card"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(code)
        }}
      >
        <Logo size={40} />
        <h1>Connect to {APP_NAME}</h1>
        <p>
          On your computer, open {APP_NAME} → <strong>Settings</strong> → <strong>Use on your phone</strong>, and enter the
          6-digit code shown there.
        </p>
        <input
          ref={inputRef}
          className="pair__input tabular"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          aria-label="Pairing code"
          value={code}
          disabled={busy}
          autoFocus
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, '').slice(0, 6)
            setCode(next)
            if (next.length === 6) void submit(next)
          }}
        />
        {error && (
          <p className="pair__error" role="alert">
            {error}
          </p>
        )}
        <Button variant="primary" size="lg" type="submit" disabled={busy || code.length !== 6}>
          {busy ? 'Connecting…' : 'Connect'}
        </Button>
        <p className="pair__hint">This phone stays connected until the code is changed on the computer.</p>
      </form>
    </main>
  )
}
