// Helpers for a shop's `next_billing_date` (trial end date for trial shops).
//
// The nightly `suspend_overdue_shops()` job suspends an active shop once
// next_billing_date + GRACE_DAYS is before today. A NULL date is never
// auto-suspended.

import { daysUntil, isTrialShop, planNameOf } from './shopNotifications'

export const GRACE_DAYS = 7

/** Local YYYY-MM-DD (what <input type="date"> and the DATE column use). */
export function toDateInput(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse a DATE column value as a local date (avoids the UTC off-by-one). */
export function parseDate(value) {
  if (!value) return null
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function today() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(base, days) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

export function addMonths(base, months) {
  const d = new Date(base)
  const day = d.getDate()
  d.setMonth(d.getMonth() + months)
  // 31 Jan + 1 month -> 28/29 Feb, not 2/3 Mar.
  if (d.getDate() < day) d.setDate(0)
  return d
}

export function formatLongDate(value) {
  const d = parseDate(value)
  return d ? d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

/** Date the nightly job will suspend the shop (null = never). */
export function suspensionDate(value) {
  const d = parseDate(value)
  return d ? addDays(d, GRACE_DAYS + 1) : null
}

/**
 * Human status of a shop's billing/trial date, for badges.
 * tone: 'none' | 'ok' | 'soon' | 'grace' | 'overdue'
 */
export function billingStatus(shop) {
  const trial = isTrialShop(shop)
  const noun = trial ? 'Trial' : 'Renewal'
  const days = daysUntil(shop?.next_billing_date)
  if (days === null) {
    return { tone: 'none', trial, days, label: 'No end date', detail: 'Never auto-suspended' }
  }
  if (days > 7) return { tone: 'ok', trial, days, label: `${noun} in ${days} days`, detail: formatLongDate(shop.next_billing_date) }
  if (days > 1) return { tone: 'soon', trial, days, label: `${trial ? 'Trial ends' : 'Renews'} in ${days} days`, detail: formatLongDate(shop.next_billing_date) }
  if (days === 1) return { tone: 'soon', trial, days, label: `${trial ? 'Trial ends' : 'Renews'} tomorrow`, detail: formatLongDate(shop.next_billing_date) }
  if (days === 0) return { tone: 'soon', trial, days, label: `${trial ? 'Trial ends' : 'Renews'} today`, detail: formatLongDate(shop.next_billing_date) }
  const late = Math.abs(days)
  if (late <= GRACE_DAYS) {
    return { tone: 'grace', trial, days, label: `${trial ? 'Trial ended' : 'Overdue'} ${late}d ago`, detail: `Auto-suspends in ${GRACE_DAYS - late + 1} day(s)` }
  }
  return { tone: 'overdue', trial, days, label: `${trial ? 'Trial ended' : 'Overdue'} ${late}d ago`, detail: formatLongDate(shop.next_billing_date) }
}

export const BILLING_TONE_CLASSES = {
  none: 'bg-slate-100 text-slate-600 border-slate-200',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  soon: 'bg-orange-50 text-orange-700 border-orange-200',
  grace: 'bg-red-50 text-red-600 border-red-200',
  overdue: 'bg-red-100 text-red-700 border-red-300',
}

export { planNameOf, isTrialShop }
