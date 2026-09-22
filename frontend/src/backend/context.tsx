import { createContext, useContext, type ReactNode } from 'react'
import type { AnkiBackend } from './AnkiBackend'

const BackendContext = createContext<AnkiBackend | null>(null)

export function BackendProvider({ backend, children }: { backend: AnkiBackend; children: ReactNode }) {
  return <BackendContext.Provider value={backend}>{children}</BackendContext.Provider>
}

export function useBackend(): AnkiBackend {
  const backend = useContext(BackendContext)
  if (!backend) throw new Error('useBackend() outside <BackendProvider>')
  return backend
}
