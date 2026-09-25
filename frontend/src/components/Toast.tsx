import { WifiOff } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useOnline } from '../lib/connection'

/** A button in the toast, e.g. Undo. */
export interface ToastAction {
  label: string
  run(): void
}

interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: ToastAction
}

type Show = (message: string, tone?: Toast['tone'], action?: ToastAction) => void

const ToastContext = createContext<Show>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const show = useCallback<Show>((message, tone = 'info', action) => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-2), { id, message, tone, action }])
    // Longer when there's something to press.
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : 3200)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <OfflineBanner />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.message}
            {t.action && (
              <button
                className="toast__action"
                onClick={() => {
                  setToasts((all) => all.filter((x) => x.id !== t.id))
                  t.action?.run()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/** Shown while the Pi can't be reached; disappears by itself when it's back. */
function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div className="offline-banner" role="alert">
      <WifiOff size={15} />
      <span>Can’t reach Rounds. Reconnecting…</span>
    </div>
  )
}
