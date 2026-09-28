import { useCallback, useEffect, useState } from 'react'
import { useBackend } from '../backend/context'
import type { SmartQuizStatus } from '../backend/types'

/** Smarter quiz options' status, refreshed every second while it downloads or indexes. */
export function useSmartQuiz(): [SmartQuizStatus | null, (s: SmartQuizStatus) => void] {
  const backend = useBackend()
  const [status, setStatus] = useState<SmartQuizStatus | null>(null)
  const refresh = useCallback(() => backend.smartQuizStatus().then(setStatus, () => {}), [backend])
  useEffect(() => {
    void refresh()
  }, [refresh])
  const busy = !!status && (status.phase === 'downloading' || status.phase === 'indexing' || (status.enabled && status.phase === 'off'))
  useEffect(() => {
    if (!busy) return
    const id = window.setInterval(() => void refresh(), 1000)
    return () => window.clearInterval(id)
  }, [busy, refresh])
  return [status, setStatus]
}
