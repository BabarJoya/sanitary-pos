// ============================================================
// Feature Gate Utility
// Usage:  hasFeature('suppliers')  → true | false
//         getPrintTemplateCount()  → 1 | 2 | 3
// Features are stored in localStorage at login from secure_login RPC
// ============================================================

const CORE_FEATURES = ['pos', 'products', 'categories', 'customers', 'sales_history', 'discount']

export function getFeatures() {
  try {
    const raw = localStorage.getItem('plan_features')
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function hasFeature(key) {
  const f = getFeatures()
  // No features configured (pre-migration plan or features column not yet set) → allow everything
  // Restrictions only apply when features are explicitly seeded in the DB
  if (!f || Object.keys(f).length === 0) return true
  const val = f[key]
  // Explicitly false = locked. Undefined = not configured = allow (forward compat)
  return val !== false
}

export function getPrintTemplateCount() {
  const f = getFeatures()
  // No features configured → allow all 3 templates
  if (!f || Object.keys(f).length === 0) return 3
  const n = Number(f.print_templates)
  return isNaN(n) ? 3 : Math.max(1, Math.min(3, n))
}

export function getPlanName() {
  try {
    const limits = JSON.parse(localStorage.getItem('plan_limits') || '{}')
    return limits.plan_name || 'Trial'
  } catch {
    return 'Trial'
  }
}
