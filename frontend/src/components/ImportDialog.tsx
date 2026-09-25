import { useEffect, useRef, useState } from 'react'
import { BackendError } from '../backend/AnkiBackend'
import { useBackend } from '../backend/context'
import type { ImportStatus } from '../backend/types'
import { useDecks } from '../lib/decks'
import { IMPORT_EVENT } from '../lib/importer'
import { Button } from './Button'
import { Dialog } from './Dialog'

type Stage = { kind: 'uploading'; fraction: number } | { kind: 'importing'; status: ImportStatus } | { kind: 'done'; status: ImportStatus }

/**
 * Import a shared deck (.apkg). Opened with openImport() from anywhere: it
 * asks for the file first, then shows upload and import progress.
 */
export function ImportDialog() {
  const backend = useBackend()
  const { reload: reloadDecks } = useDecks()
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onOpen = () => input.current?.click()
    window.addEventListener(IMPORT_EVENT, onOpen)
    return () => window.removeEventListener(IMPORT_EVENT, onOpen)
  }, [])

  const poll = async () => {
    for (;;) {
      await new Promise((r) => window.setTimeout(r, 700))
      let status: ImportStatus
      try {
        status = await backend.importStatus()
      } catch {
        continue // keep trying: the server may be busy importing
      }
      if (status.phase === 'idle') {
        setStage({ kind: 'done', status })
        void reloadDecks()
        return
      }
      setStage({ kind: 'importing', status })
    }
  }

  const start = async (file: File) => {
    setError(null)
    setStage({ kind: 'uploading', fraction: 0 })
    try {
      const status = await backend.importFile(file, (fraction) => setStage({ kind: 'uploading', fraction }))
      setStage({ kind: 'importing', status })
      await poll()
    } catch (err) {
      setStage(null)
      setError(err instanceof BackendError ? err.message : 'Couldn’t import that file.')
    }
  }

  const busy = stage?.kind === 'uploading' || stage?.kind === 'importing'
  const result = stage?.kind === 'done' ? stage.status : null
  const pct = stage?.kind === 'uploading' ? Math.round(stage.fraction * 100) : null

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".apkg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void start(file)
        }}
      />
      <Dialog
        open={stage !== null || error !== null}
        blocking={busy}
        onClose={() => {
          if (busy) return
          setStage(null)
          setError(null)
        }}
        title={result ? (result.error ? 'Import failed' : 'Import finished') : error ? 'Import failed' : 'Importing'}
        actions={
          busy ? null : (
            <Button
              variant="primary"
              onClick={() => {
                setStage(null)
                setError(null)
              }}
            >
              Done
            </Button>
          )
        }
      >
        {error && <p className="dialog-error">{error}</p>}
        {stage?.kind === 'uploading' && (
          <>
            <p>Reading the file… {pct}%</p>
            <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
              <div className="meter__fill" style={{ transform: `scaleX(${(pct ?? 0) / 100})` }} />
            </div>
          </>
        )}
        {stage?.kind === 'importing' && (
          <>
            <p>{stage.status.progress || `Importing ${stage.status.filename ?? ''}…`}</p>
            <div className="meter meter--indeterminate" role="progressbar" aria-label="Importing">
              <div className="meter__fill" />
            </div>
            <p className="dialog-hint">Big decks with lots of images can take a few minutes.</p>
          </>
        )}
        {result &&
          (result.error ? (
            <p className="dialog-error">{result.error}</p>
          ) : result.result ? (
            <>
              <p>
                <strong>{result.result.new.toLocaleString()}</strong> new note{result.result.new === 1 ? '' : 's'} added
                {result.result.updated ? `, ${result.result.updated.toLocaleString()} updated` : ''}.
              </p>
              {result.result.duplicate + result.result.conflicting > 0 && (
                <p className="dialog-hint">
                  {(result.result.duplicate + result.result.conflicting).toLocaleString()} were already in your collection and
                  left as they were.
                </p>
              )}
              {result.result.skipped > 0 && (
                <p className="dialog-hint">{result.result.skipped.toLocaleString()} couldn’t be imported (missing note type or empty).</p>
              )}
            </>
          ) : null)}
      </Dialog>
    </>
  )
}
