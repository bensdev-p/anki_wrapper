import { WifiOff } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { useOnline } from '../lib/connection'

interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++
    setToasts((t) => [...t.slice(-2), { id, message, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <OfflineBanner />
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            {t.message}
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
      <span>Can’t reach Lacuna. Reconnecting…</span>
    </div>
  )
}
