import { useEffect, useState } from 'react'
import { ErrorBoundary, getErrorMessage } from 'react-error-boundary'
import './Errors.css'

const message = thrown => getErrorMessage(thrown) ?? String(thrown)

// Last resort for errors nothing else handled (an un-caught IPC rejection, a throw in an event
// handler). Only the latest is kept: a failing live refresh would otherwise stack one per update.
export function ErrorBanner() {
  const [error, setError] = useState(null)
  useEffect(() => {
    const report = thrown => setError(message(thrown))
    const onError = e => report(e.error ?? e.message)
    const onRejection = e => report(e.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  if (!error) return null
  return (
    <div className="error-banner" role="alert">
      <span>⚠ {error}</span>
      <button type="button" onClick={() => setError(null)} title="Dismiss">×</button>
    </div>
  )
}

// A pane's own error in place of its content — a failed load or a render crash.
export const ErrorMessage = ({ title, error }) => (
  <div className="error-message">⚠ {title}: {message(error)}</div>
)

const AppCrashed = ({ error }) => (
  <div className="app-crash">
    <div>⚠ {message(error)}</div>
    <button type="button" onClick={() => location.reload()}>Reload</button>
  </div>
)

// A render crash anywhere replaces the app with the error and a reload, instead of a blank window.
export const AppErrorBoundary = ({ children }) => (
  <ErrorBoundary FallbackComponent={AppCrashed}>{children}</ErrorBoundary>
)

// Confines a render crash to one pane; `resetKeys` changing (another item picked) retries it.
export const PaneErrorBoundary = ({ title, resetKeys, children }) => (
  <ErrorBoundary resetKeys={resetKeys} fallbackRender={({ error }) => <ErrorMessage title={title} error={error} />}>
    {children}
  </ErrorBoundary>
)
