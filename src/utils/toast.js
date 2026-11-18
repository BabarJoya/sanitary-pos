// ============================================================================
// Small toast messages (bottom of the screen) instead of browser alert().
//   toast.success('Prices saved')   toast.error('Save failed: …')
//   toast.info('Saved offline — will sync when online')
// Rendered by <Toaster /> in Layout. Safe to call from anywhere.
// ============================================================================

const listeners = new Set()
let nextId = 1

function push(type, message, ms) {
  const t = { id: nextId++, type, message: String(message ?? ''), ms: ms ?? (type === 'error' ? 6000 : 3000) }
  listeners.forEach(fn => fn(t))
  return t.id
}

export const toast = {
  success: (m, ms) => push('success', m, ms),
  error: (m, ms) => push('error', m, ms),
  info: (m, ms) => push('info', m, ms),
  warning: (m, ms) => push('warning', m, ms),
}

export function subscribeToasts(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export default toast
