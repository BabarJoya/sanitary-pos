import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Modal } from './ui'
import WHATS_NEW, { LATEST_WHATS_NEW_ID } from '../data/whatsNew'

// Header button that opens the "What's new" list. A dot shows until this device
// has opened the newest entry (per device, like the theme).
const SEEN_KEY = 'edgex_whats_new_seen'
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) || '' } catch { return '' } }

export default function WhatsNewButton() {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(readSeen)
  const hasNew = !!LATEST_WHATS_NEW_ID && seen < LATEST_WHATS_NEW_ID

  const openPanel = () => {
    setOpen(true)
    setSeen(LATEST_WHATS_NEW_ID)
    try { localStorage.setItem(SEEN_KEY, LATEST_WHATS_NEW_ID) } catch { /* storage unavailable */ }
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

      <Modal open={open} onClose={() => setOpen(false)} title="✨ What's new in EdgeX POS">
        <p className="text-sm text-fg-muted mb-4">Your software gets better every week. Here is what changed recently.</p>
        <ol className="space-y-5">
          {WHATS_NEW.map((entry, idx) => (
            <li key={entry.id}>
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <h3 className="font-bold text-fg">{entry.title}</h3>
                <span className="text-xs text-fg-subtle shrink-0">{entry.date}{idx === 0 && <span className="ml-2 badge badge-success">New</span>}</span>
              </div>
              <ul className="space-y-1.5">
                {entry.items.map((line, k) => (
                  <li key={k} className="flex gap-2 text-sm text-fg-2">
                    <span className="text-success-fg shrink-0" aria-hidden="true">✓</span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  )
}
