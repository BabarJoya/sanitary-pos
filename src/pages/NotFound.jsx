import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// ============================================================================
// Unknown address. Usually a phone running an older cached copy of the app that
// does not know a newer page (e.g. a bill QR link). The first time, clear the
// app's cached files and reload once by itself; if the page is still unknown,
// show a clear message with an "Update app" button instead of a blank screen.
// ============================================================================

const RETRY_KEY = 'edgex_notfound_retry'

async function refreshApp() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map(k => caches.delete(k)))
    }
    const reg = await navigator.serviceWorker?.getRegistration?.()
    await reg?.update?.()
  } catch { /* best effort */ }
  window.location.reload()
}

export default function NotFound() {
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    document.title = 'Page not found'
    let tried = null
    try { tried = sessionStorage.getItem(RETRY_KEY) } catch { /* storage unavailable */ }
    if (tried !== window.location.pathname) {
      try { sessionStorage.setItem(RETRY_KEY, window.location.pathname) } catch { /* storage unavailable */ }
      setRetrying(true)
      refreshApp()
    }
  }, [])

  if (retrying) {
    return <div className="min-h-dvh bg-app flex items-center justify-center p-6"><p className="text-fg-muted">Updating the app…</p></div>
  }

  return (
    <div className="min-h-dvh bg-app flex items-center justify-center p-4">
      <div className="card max-w-sm w-full p-6 text-center">
        <p className="text-4xl mb-2" aria-hidden="true">🔎</p>
        <h1 className="text-lg font-bold text-fg">Page not found</h1>
        <p className="text-sm text-fg-muted mt-1">This link may be old, or this phone has an older copy of the app.</p>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" onClick={refreshApp} className="btn btn-primary">⟳ Update app and try again</button>
          <Link to="/" className="btn btn-secondary">Go to home</Link>
        </div>
      </div>
    </div>
  )
}
