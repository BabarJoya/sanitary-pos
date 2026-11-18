// ============================================================================
// Staff action permissions (what a user may DO, not which screens they see).
// Stored in users.permissions next to the screen ids, as 'act:<action>' keys.
// 'act:custom' marks that the owner set them by hand; without it the old
// role-based defaults apply, so existing staff keep working exactly as before.
//
// These rules run in the app. They stop mistakes and casual misuse; they are
// not a security boundary against someone editing the browser.
// ============================================================================

export const STAFF_ACTIONS = [
  { id: 'discount', label: 'Give discount on a bill', hint: 'Bill discount (Rs or %) and quick % buttons in POS' },
  { id: 'edit_price', label: 'Change the selling price in POS', hint: 'Type a different price or apply a brand discount' },
  { id: 'below_cost', label: 'Sell below cost price', hint: 'Allow a price or discount that makes a loss' },
  { id: 'see_profit', label: 'See cost price and profit', hint: 'Cost and profit figures in POS' },
  { id: 'delete', label: 'Delete records', hint: 'Delete sales, purchases, customers, suppliers, products, expenses' },
]

// Before custom permissions existed, these were decided by role
const ROLE_DEFAULTS = {
  manager: { discount: true, edit_price: true, below_cost: true, see_profit: true, delete: true },
  accountant: { discount: true, edit_price: true, below_cost: false, see_profit: true, delete: true },
  cashier: { discount: true, edit_price: true, below_cost: false, see_profit: false, delete: true },
}

const CUSTOM = 'act:custom'

export const hasCustomActions = (perms) => Array.isArray(perms) && perms.includes(CUSTOM)

// May this user do `action`? Admins (and the platform superadmin) always may.
export function can(user, action) {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'superadmin') return true
  const perms = user.permissions
  if (hasCustomActions(perms)) return perms.includes(`act:${action}`)
  return !!(ROLE_DEFAULTS[user.role] || ROLE_DEFAULTS.cashier)[action]
}

// Current action switches for the Users form (custom ones, or the role defaults)
export function actionState(role, perms) {
  const out = {}
  for (const a of STAFF_ACTIONS) out[a.id] = can({ role, permissions: perms }, a.id)
  return out
}

// Replace the action keys inside a permissions array with the chosen switches
export function withActions(perms, state) {
  const screens = (perms || []).filter(p => !String(p).startsWith('act:'))
  const acts = STAFF_ACTIONS.filter(a => state[a.id]).map(a => `act:${a.id}`)
  return [...screens, CUSTOM, ...acts]
}

// Message shown when a user tries something they are not allowed to do
export const notAllowed = (what) => `Aap ko ${what} ki ijazat nahi. Shop admin se rabta karein.`
