// ============================================================================
// Small toast messages (bottom of the screen) instead of browser alert().
//   toast.success('Prices saved')   toast.error('Save failed: …')
//   toast.info('Saved offline — will sync when online')
// Rendered by <Toaster /> in App (survives page changes). Safe to call from anywhere.
// ============================================================================

const listeners = new Set()
let nextId = 1

function push(type, message, ms) {
  const text = String(message ?? '')
  // Longer messages stay longer (reading time), errors at least 6 s, max 12 s
  const auto = Math.min(12000, Math.max(type === 'error' ? 6000 : 3000, text.length * 60))
  const t = { id: nextId++, type, message: text, ms: ms ?? auto }
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
