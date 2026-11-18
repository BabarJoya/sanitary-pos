// Shared UI primitives backed by the theme tokens in src/index.css.
// They are thin wrappers over the .btn / .input / .card / .badge / .modal-* classes,
// so pages can also use the classes directly while migrating incrementally.
import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

const cx = (...parts) => parts.filter(Boolean).join(' ')

export function Button({ variant = 'primary', size, className, type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={cx('btn', `btn-${variant}`, size && `btn-${size}`, className)}
      {...props}
    />
  )
}

export function Card({ as = 'div', className, ...props }) {
  const Tag = as
  return <Tag className={cx('card', className)} {...props} />
}

export function Badge({ tone = 'neutral', className, ...props }) {
  return <span className={cx('badge', `badge-${tone}`, className)} {...props} />
}

export function Input({ label, id, className, inputClassName, ...props }) {
  const autoId = useId()
  const inputId = id || autoId
  return (
    <div className={className}>
      {label && <label htmlFor={inputId} className="label">{label}</label>}
      <input id={inputId} className={cx('input', inputClassName)} {...props} />
    </div>
  )
}

// Open modals, newest last: Esc closes only the top one when pop-ups are stacked.
const modalStack = []

// Phone-friendly modal: bottom sheet on small screens, centred dialog on sm+,
// bounded to 90dvh with an internally scrolling body and a visible close button.
// - Esc closes the top-most modal only; focus moves into the modal and returns
//   to the button that opened it.
// - dismissible={false}: tapping outside does not close it (use for forms, so
//   typed data is not lost by a stray tap). Esc and × still close.
export function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 'max-w-lg', dismissible = true, bodyClassName }) {
  const titleId = useId()
  const panelRef = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Remember what had focus before this modal first rendered (an autoFocus
  // field inside the modal takes focus before effects run).
  const openerRef = useRef(null)
  if (open && openerRef.current === null && typeof document !== 'undefined') openerRef.current = document.activeElement || false
  if (!open) openerRef.current = null

  useEffect(() => {
    if (!open) return
    const token = {}
    modalStack.push(token)
    const opener = openerRef.current
    const onKey = (e) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== token) return
      e.stopPropagation()
      closeRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    // Focus the first field (or the close button) once the panel is on screen
    const t = setTimeout(() => {
      const panel = panelRef.current
      if (!panel || panel.contains(document.activeElement)) return
      const first = panel.querySelector('[autofocus], [data-autofocus], input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')
      ;(first || panel.querySelector('[data-modal-close]'))?.focus()
    }, 30)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      const i = modalStack.indexOf(token)
      if (i >= 0) modalStack.splice(i, 1)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose?.() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} className={cx('modal-panel', maxWidth)}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base sm:text-lg font-black text-fg leading-snug">{title}</h2>
            {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} data-modal-close className="btn btn-ghost btn-sm !min-h-10 !w-10 !p-0 shrink-0" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className={cx('flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar', bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-line px-4 py-3 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
