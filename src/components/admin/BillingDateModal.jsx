import { useMemo, useState } from 'react'
import { CalendarClock, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { adminDb } from '../../services/adminApi'
import { logAction } from '../../services/auditService'
import {
  GRACE_DAYS, toDateInput, parseDate, today, addDays, addMonths, formatLongDate,
  suspensionDate, billingStatus, BILLING_TONE_CLASSES, planNameOf, isTrialShop,
} from '../../utils/billingDates'

const TRIAL_PRESETS = [
  { id: 'd7', label: '+7 days', apply: (b) => addDays(b, 7) },
  { id: 'd14', label: '+14 days', apply: (b) => addDays(b, 14) },
  { id: 'd30', label: '+30 days', apply: (b) => addDays(b, 30) },
]
const PAID_PRESETS = [
  { id: 'm1', label: '+1 month', apply: (b) => addMonths(b, 1) },
  { id: 'm3', label: '+3 months', apply: (b) => addMonths(b, 3) },
  { id: 'm6', label: '+6 months', apply: (b) => addMonths(b, 6) },
  { id: 'y1', label: '+1 year', apply: (b) => addMonths(b, 12) },
]
const ALL_PRESETS = [...TRIAL_PRESETS, ...PAID_PRESETS]

/**
 * Set a shop's trial end / next billing date.
 * mode="activate" is used when reactivating a suspended shop whose date has passed.
 */
export default function BillingDateModal({ shop, mode = 'edit', onClose, onSaved }) {
  const current = parseDate(shop.next_billing_date)
  const now = today()
  const trial = isTrialShop(shop)
  const suspended = shop.status === 'suspended'
  const status = billingStatus(shop)

  // Extend from the current date if it's still ahead, otherwise from today,
  // so a late renewal doesn't start already overdue.
  const [from, setFrom] = useState(current && current > now ? 'current' : 'today')
  const [choice, setChoice] = useState(trial ? 'd14' : 'm1')
  const [customDate, setCustomDate] = useState(toDateInput(addDays(now, 14)))
  const [activate, setActivate] = useState(suspended)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const base = from === 'current' && current ? current : now

  const newDate = useMemo(() => {
    if (choice === 'none') return null
    if (choice === 'custom') return customDate || null
    const preset = ALL_PRESETS.find(p => p.id === choice)
    return preset ? toDateInput(preset.apply(base)) : null
  }, [choice, customDate, base])

  const newDateObj = parseDate(newDate)
  const willSuspend = newDateObj && suspensionDate(newDate) <= now
  const invalid = choice === 'custom' && !customDate

  const save = async (e) => {
    e.preventDefault()
    if (invalid) return
    setSaving(true)
    setError('')
    const updates = { next_billing_date: newDate }
    if (activate && !willSuspend) {
      updates.status = 'active'
      updates.suspension_reason = null
    }
    const { error: updateError } = await adminDb.from('shops').update(updates).eq('id', shop.id)
    if (updateError) {
      setError(updateError.message || 'Could not save')
      setSaving(false)
      return
    }
    await logAction({
      action_type: updates.status ? 'SET_BILLING_DATE_AND_ACTIVATE' : 'SET_BILLING_DATE',
      target_type: 'SHOP',
      target_id: shop.id,
      details: { previousBillingDate: shop.next_billing_date || null, nextBillingDate: newDate, activated: !!updates.status, note: note.trim() || undefined },
    })
    setSaving(false)
    onSaved?.({ ...shop, ...updates })
  }

  const presetButton = (p) => (
    <button
      type="button"
      key={p.id}
      onClick={() => setChoice(p.id)}
      className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${choice === p.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'}`}
    >
      {p.label}
    </button>
  )

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center-safe justify-center p-3 sm:p-4" onClick={onClose}>
      <form
        onSubmit={save}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-date-title"
        className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-white rounded-2xl shadow-2xl text-sm"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-start gap-3">
          <div className="p-2 rounded-xl bg-blue-50 text-blue-600 shrink-0"><CalendarClock size={20} /></div>
          <div className="flex-1 min-w-0">
            <h2 id="billing-date-title" className="font-black text-slate-800 text-base">
              {mode === 'activate' ? 'Activate shop' : trial ? 'Trial end date' : 'Next billing date'}
            </h2>
            <p className="text-slate-500 truncate">{shop.name} · {planNameOf(shop)} plan</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Current */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Current</p>
              <p className="font-bold text-slate-800">{current ? formatLongDate(shop.next_billing_date) : 'Not set'}</p>
            </div>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${BILLING_TONE_CLASSES[status.tone]}`}>{status.label}</span>
          </div>

          {mode === 'activate' && (
            <p className="flex gap-2 p-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-800">
              <AlertTriangle size={18} className="shrink-0" />
              The date has passed, so the nightly auto-suspend job would suspend this shop again. Set a new date to keep it active.
            </p>
          )}

          {/* Extend from */}
          {current && (
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Count from</p>
              <div className="inline-flex p-1 rounded-lg bg-slate-100">
                {[
                  { id: 'current', label: `Current date (${formatLongDate(shop.next_billing_date)})` },
                  { id: 'today', label: 'Today' },
                ].map(o => (
                  <button
                    type="button"
                    key={o.id}
                    onClick={() => setFrom(o.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${from === o.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Presets */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Trial</p>
              <div className="flex flex-wrap gap-2">{TRIAL_PRESETS.map(presetButton)}</div>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Paid period</p>
              <div className="flex flex-wrap gap-2">{PAID_PRESETS.map(presetButton)}</div>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 mb-1.5">Other</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setChoice('custom')}
                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${choice === 'custom' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'}`}
                >
                  Exact date
                </button>
                <button
                  type="button"
                  onClick={() => setChoice('none')}
                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${choice === 'none' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300'}`}
                >
                  No end date (lifetime)
                </button>
                {choice === 'custom' && (
                  <input
                    type="date"
                    value={customDate}
                    onChange={e => setCustomDate(e.target.value)}
                    aria-label="Exact date"
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-bold"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Result */}
          <div className={`p-3 rounded-xl border ${willSuspend ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">New {trial ? 'trial end' : 'billing'} date</p>
            <p className="text-lg font-black text-slate-800">{newDate ? formatLongDate(newDate) : 'No end date'}</p>
            <p className={`text-xs font-medium mt-0.5 ${willSuspend ? 'text-red-700' : 'text-emerald-700'}`}>
              {!newDate
                ? 'The shop will never be auto-suspended.'
                : willSuspend
                  ? 'This date is more than 7 days ago, so the shop would be suspended again tonight.'
                  : `If unpaid, the shop is auto-suspended on ${suspensionDate(newDate).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })} (after a ${GRACE_DAYS}-day grace period).`}
            </p>
          </div>

          {suspended && (
            <label className="flex items-start gap-2 font-medium text-slate-700 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={activate} onChange={e => setActivate(e.target.checked)} />
              <span>Also activate the shop <span className="block text-xs text-slate-500 font-normal">It is suspended{shop.suspension_reason ? `: ${shop.suspension_reason}` : ''}</span></span>
            </label>
          )}

          <label className="block">
            <span className="block text-xs font-bold text-slate-500 mb-1">Note for the audit log (optional)</span>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="e.g. Trial extended on request" className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
          </label>

          {error && <p className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-medium">{error}</p>}
          <p className="text-xs text-slate-500">To record a payment as well, use Billing &amp; Subs → Pay, which also moves this date.</p>
        </div>

        <div className="p-5 pt-0 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || invalid} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-black flex items-center justify-center gap-2">
            <CheckCircle2 size={16} />
            {saving ? 'Saving…' : activate && suspended && !willSuspend ? 'Save and activate' : 'Save date'}
          </button>
        </div>
      </form>
    </div>
  )
}

export function BillingBadge({ shop, onClick, className = '' }) {
  const s = billingStatus(shop)
  const content = (
    <>
      <span className="block font-bold">{s.label}</span>
      <span className="block text-[10px] opacity-80 font-medium">{s.detail}</span>
    </>
  )
  const cls = `inline-block text-left text-xs px-2.5 py-1 rounded-lg border ${BILLING_TONE_CLASSES[s.tone]} ${className}`
  if (!onClick) return <span className={cls}>{content}</span>
  return (
    <button type="button" onClick={onClick} title="Change trial / billing date" className={`${cls} hover:ring-2 hover:ring-blue-300 transition`}>
      {content}
    </button>
  )
}
