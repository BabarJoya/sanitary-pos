import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Sparkles, X, ArrowRight } from 'lucide-react'
import WHATS_NEW, { LATEST_WHATS_NEW_ID } from '../data/whatsNew'
import { isDemoMode } from '../utils/demoFlag'

// Header ✨ button + the full-screen "What's new" page.
// - A dot shows until this device has opened the newest entry (per device).
// - The page opens by itself once after each new release (never over the POS
//   screen, so a sale is not interrupted) and always closes with × or Esc.
// - `?whatsnew=1` on any page opens it (used by admin notifications).
// - Each update has an "Open" button that goes to that module.
const SEEN_KEY = 'edgex_whats_new_seen'
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' } }
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, LATEST_WHATS_NEW_ID) } catch { /* storage unavailable */ } }
const itemOf = (it) => (typeof it === 'string' ? { text: it } : it || {})

function WhatsNewScreen({ onClose, onOpenModule }) {
  const closeRef = useRef(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-app flex flex-col" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
      <header className="flex-none border-b border-line bg-surface">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <span className="h-10 w-10 rounded-xl bg-primary-soft text-primary-strong flex items-center justify-center flex-none" aria-hidden="true"><Sparkles size={20} /></span>
          <div className="min-w-0 flex-1">
            <h2 id="whats-new-title" className="text-lg font-black text-fg leading-tight">What's new in EdgeX POS</h2>
            <p className="text-xs text-fg-muted">Your software gets better every week. Tap an update to open it.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close what's new"
            className="h-11 w-11 rounded-xl border border-line bg-surface hover:bg-surface-3 text-fg-2 flex items-center justify-center flex-none">
            <X size={20} />
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ol className="max-w-3xl mx-auto px-4 py-5 space-y-5">
          {WHATS_NEW.map((entry, idx) => (
            <li key={entry.id} className={`card p-0 overflow-hidden ${idx === 0 ? 'ring-2 ring-primary-line' : ''}`}>
              <div className={`px-4 py-3 flex items-baseline justify-between gap-3 ${idx === 0 ? 'bg-primary-soft' : 'bg-surface-2'}`}>
                <h3 className="font-bold text-fg">{entry.title}</h3>
                <span className="text-xs text-fg-subtle shrink-0">{entry.date}{idx === 0 && <span className="ml-2 badge badge-success">New</span>}</span>
              </div>
              <ul className="divide-y divide-line-subtle">
                {entry.items.map((raw, k) => {
                  const it = itemOf(raw)
                  const body = (
                    <>
                      <span className="text-success-fg shrink-0 mt-0.5" aria-hidden="true">✓</span>
                      <span className="flex-1 min-w-0">
                        {it.module && <span className={`badge ${it.module === 'Fix' ? 'badge-warning' : 'badge-primary'} mr-2 align-middle`}>{it.module}</span>}
                        <span className="text-sm text-fg-2 align-middle">{it.text}</span>
                      </span>
                    </>
                  )
                  return (
                    <li key={k}>
                      {it.to ? (
                        <button type="button" onClick={() => onOpenModule(it.to)}
                          className="w-full text-left flex items-start gap-2 px-4 py-3 hover:bg-surface-2 focus-visible:bg-surface-2 min-h-12">
                          {body}
                          <span className="shrink-0 self-center inline-flex items-center gap-1 text-xs font-bold text-primary-fg">Open <ArrowRight size={14} /></span>
                        </button>
                      ) : (
                        <div className="flex items-start gap-2 px-4 py-3">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ol>
      </div>

      <footer className="flex-none border-t border-line bg-surface">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <button type="button" onClick={onClose} className="btn btn-primary w-full min-h-12">Got it — close</button>
        </div>
      </footer>
    </div>,
    document.body,
  )
}

export default function WhatsNewButton() {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(readSeen)
  const hasNew = !!LATEST_WHATS_NEW_ID && seen < LATEST_WHATS_NEW_ID
  const location = useLocation()
  const navigate = useNavigate()

  const openPanel = () => {
    setOpen(true)
    setSeen(LATEST_WHATS_NEW_ID)
    markSeen()
  }
  const close = useCallback(() => setOpen(false), [])

  // ?whatsnew=1 (from a notification) opens it on any page, then tidies the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('whatsnew') === '1') {
      openPanel()
      params.delete('whatsnew')
      const qs = params.toString()
      navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '', hash: location.hash }, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  // Opens by itself once per new release, but never over the POS screen.
  useEffect(() => {
    // Not in the demo shop: visitors should land on the dashboard (the ✨ button still opens it)
    if (hasNew && !open && !isDemoMode() && !location.pathname.startsWith('/pos')) openPanel()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const openModule = (to) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="relative w-9 h-9 rounded-xl border border-line bg-surface text-fg-3 hover:bg-surface-3 hover:text-fg flex items-center justify-center transition cursor-pointer"
        title="What's new"
        aria-label={hasNew ? "What's new (new updates)" : "What's new"}
      >
        <Sparkles size={17} />
        {hasNew && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-danger ring-2 ring-surface" aria-hidden="true" />}
      </button>
      {open && <WhatsNewScreen onClose={close} onOpenModule={openModule} />}
    </>
  )
}
