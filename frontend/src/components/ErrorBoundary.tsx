import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { AnkiBackend } from '../backend/AnkiBackend'
import { navigate } from '../lib/router'
import { Button } from './Button'

interface Props {
  backend: AnkiBackend
  /** The screen, for the log. Give the boundary key={screen} so moving to another screen clears the error. */
  screen: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * A screen that crashes shows what went wrong and a way out, instead of an
 * empty window, and the details go to the log file (Settings → About → Show
 * log files) so they can be reported.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void this.props.backend.reportError(
      'render',
      error.message,
      `screen ${this.props.screen}\n${error.stack ?? ''}\n${info.componentStack ?? ''}`,
    )
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="page crash" role="alert">
        <h1 className="settings__title">Something went wrong on this screen</h1>
        <p className="crash__text">
          Your cards and reviews are safe. The details were saved to the log file (Settings → About → Show log files).
        </p>
        <pre className="crash__detail">{this.state.error.message}</pre>
        <div className="settings-card__actions">
          <Button variant="primary" onClick={() => navigate({ name: 'home' })}>
            Back to decks
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </main>
    )
  }
}

/** Errors outside React's rendering (event handlers, promises) go to the log too. */
export function reportUncaughtErrors(backend: AnkiBackend): void {
  let sent = 0
  const send = (kind: string, message: string, detail: string) => {
    if (sent++ < 20) void backend.reportError(kind, message, `${window.location.hash}\n${detail}`)
  }
  window.addEventListener('error', (e) => send('error', e.message, e.error?.stack ?? `${e.filename}:${e.lineno}`))
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string; stack?: string } | undefined
    send('promise', reason?.message ?? String(e.reason), reason?.stack ?? '')
  })
}
