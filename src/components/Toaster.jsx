import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { subscribeToasts } from '../utils/toast'

const STYLE = {
  success: { cls: 'bg-success text-white', icon: '✓' },
  error: { cls: 'bg-danger text-white', icon: '!' },
  warning: { cls: 'bg-warning text-white', icon: '!' },
  info: { cls: 'bg-contrast text-white', icon: 'i' },
}

// Shows toast() messages stacked at the bottom centre, above pop-ups.
export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => subscribeToasts((t) => {
    setItems(prev => [...prev.slice(-3), t])
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), t.ms)
  }), [])

  const dismiss = (id) => setItems(prev => prev.filter(x => x.id !== id))

  return createPortal(
    <div className="fixed inset-x-0 bottom-4 z-[300] flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite" role="status">
      {items.map(t => {
        const s = STYLE[t.type] || STYLE.info
        return (
          <button key={t.id} type="button" onClick={() => dismiss(t.id)}
            className={`pointer-events-auto w-full max-w-md flex items-start gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold shadow-2xl ${s.cls}`}>
            <span className="flex-none h-6 w-6 rounded-full bg-white/25 flex items-center justify-center text-xs font-black" aria-hidden="true">{s.icon}</span>
            <span className="flex-1 whitespace-pre-line">{t.message}</span>
            <span className="sr-only">Dismiss</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
