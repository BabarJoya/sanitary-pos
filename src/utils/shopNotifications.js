// Shared helpers for in-app shop notifications (the `announcements` table).
// Used by the superadmin composer (src/pages/admin/Notifications.jsx) and the
// shop app shell (src/components/Layout.jsx).

export const SUPPORT_PHONE = '0301-2616367'
export const SUPPORT_WHATSAPP_URL = 'https://wa.me/923012616367'
export const BUY_PLAN_PATH = '/settings#plan'

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from today to `date` (negative once it has passed). null when no date. */
export function daysUntil(date) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d - today) / DAY_MS)
}

export function daysText(days) {
  if (days === null || days === undefined) return 'soon'
  if (days < -1) return `${Math.abs(days)} days ago`
  if (days === -1) return 'yesterday'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

export function planNameOf(shop) {
  return shop?.subscription_plans?.name || shop?.subscription_plan || 'Trial'
}

export function isTrialShop(shop) {
  return String(planNameOf(shop)).toLowerCase() === 'trial'
}

export function formatDate(date) {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Placeholder values available in titles and messages. */
export function templateVars(shop) {
  const days = daysUntil(shop?.next_billing_date)
  return {
    shop_name: shop?.name || 'there',
    plan: planNameOf(shop),
    end_date: formatDate(shop?.next_billing_date),
    days_left: days === null ? '' : String(Math.max(days, 0)),
    days_text: daysText(days),
    support_phone: SUPPORT_PHONE,
  }
}

export function renderTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, key) => (key in vars ? vars[key] : m))
}

/**
 * Call-to-action links must be an in-app path or an https:// URL
 * (the database enforces the same rule).
 */
export function isSafeCtaUrl(url) {
  if (!url) return false
  return /^\/[^/]/.test(url) || /^https:\/\//i.test(url)
}

/** Settings (where the plan lives) is admin-only; send other staff to support instead. */
export function resolveCtaUrl(url, role) {
  if (!isSafeCtaUrl(url)) return null
  if (url.startsWith('/settings') && role && role !== 'admin') return SUPPORT_WHATSAPP_URL
  return url
}

export function isExternalUrl(url) {
  return /^https:\/\//i.test(url || '')
}

export const NOTIFICATION_CATEGORIES = {
  general: 'General',
  trial_ending: 'Trial ending',
  trial_expired: 'Trial expired',
  payment_due: 'Payment due',
  plan_upgrade: 'Plan upgrade',
}

export const NOTIFICATION_TEMPLATES = [
  {
    id: 'trial_ending',
    label: 'Trial ending soon',
    category: 'trial_ending',
    audience: 'trial_ending',
    type: 'warning',
    title: 'Your free trial ends {days_text}',
    message: 'Assalam-o-Alaikum {shop_name}! Your EdgeX POS trial ends on {end_date}. Buy a plan now to keep using the POS without interruption. Your data stays safe.',
    ctaLabel: 'Buy Plan',
    ctaMode: 'plan',
    showPopup: true,
    expiry: 'billing',
  },
  {
    id: 'trial_expired',
    label: 'Trial expired, buy plan',
    category: 'trial_expired',
    audience: 'trial_expired',
    type: 'error',
    title: 'Your free trial has ended',
    message: '{shop_name}, your trial ended on {end_date}. Buy a plan to continue using the POS. Call or WhatsApp {support_phone} and we will activate it right away.',
    ctaLabel: 'Buy Plan',
    ctaMode: 'whatsapp',
    showPopup: true,
    expiry: 'days',
  },
  {
    id: 'payment_due',
    label: 'Subscription renewal due',
    category: 'payment_due',
    audience: 'payment_due',
    type: 'warning',
    title: 'Your {plan} plan renews {days_text}',
    message: 'Please pay your subscription fee by {end_date} to avoid interruption. Contact {support_phone} for payment details.',
    ctaLabel: 'Pay Now',
    ctaMode: 'whatsapp',
    showPopup: false,
    expiry: 'billing',
  },
  {
    id: 'custom',
    label: 'Custom message',
    category: 'general',
    audience: 'all',
    type: 'info',
    title: '',
    message: '',
    ctaLabel: '',
    ctaMode: 'none',
    showPopup: false,
    expiry: 'days',
  },
]

/** localStorage keys (shop-scoped) for what this device has dismissed or seen. */
export const dismissedKey = (shopId) => `dismissed_notifications_${shopId}`
export const popupSeenKey = (shopId) => `seen_notification_popups_${shopId}`
export const systemAlertedKey = (shopId) => `alerted_notifications_${shopId}`

export function readIdSet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    return new Set(Array.isArray(raw) ? raw.map(String) : [])
  } catch {
    return new Set()
  }
}

export function addToIdSet(key, id) {
  const set = readIdSet(key)
  set.add(String(id))
  // Keep the list bounded; old ids belong to deleted/expired rows.
  const list = [...set].slice(-200)
  try { localStorage.setItem(key, JSON.stringify(list)) } catch { /* storage full or blocked */ }
  return new Set(list)
}
