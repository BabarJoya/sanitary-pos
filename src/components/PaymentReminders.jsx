import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { fetchAllRows } from '../services/fetchAll'
import { db } from '../services/db'
import { ageBalance, customerLedgerDelta, paymentRowType, isLedgerSale } from '../utils/ledgerMath'

// ============================================================================
// Payment reminders: customers who owe money, oldest dues first, with a one-tap
// WhatsApp reminder. Dues are aged from the ledger (payments pay off the oldest
// bills first). A balance the ledger cannot explain (old dues from before the
// app) counts as 90+ days. "Reminded" is remembered on this device.
// ============================================================================

const DAY = 86400000
const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`
const waPhone = (p) => {
  let phone = String(p || '').replace(/[^0-9]/g, '')
  if (phone.startsWith('03')) phone = '92' + phone.slice(1)
  else if (phone.length === 10 && phone.startsWith('3')) phone = '92' + phone
  return phone
}

export default function PaymentReminders({ customers, user }) {
  const [rows, setRows] = useState(null) // per-customer ageing
  const [error, setError] = useState('')
  const [reminded, setReminded] = useState({})
  const remindKey = (id) => `reminded_${user?.shop_id}_${id}`

  useEffect(() => {
    const r = {}
    for (const c of customers) { try { const v = localStorage.getItem(remindKey(c.id)); if (v) r[c.id] = v } catch { /* storage unavailable */ } }
    setReminded(r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setError('')
      const debtors = customers.filter(c => Number(c.outstanding_balance) > 0)
      if (debtors.length === 0) { setRows([]); return }
      let sales = [], payments = []
      try {
        if (!navigator.onLine) throw new Error('Offline')
        const [sRes, pRes] = await Promise.all([
          fetchAllRows(() => supabase.from('sales').select('id, customer_id, total_amount, discount, paid_amount, sale_type, created_at').eq('shop_id', user.shop_id).not('customer_id', 'is', null).or('sale_type.is.null,sale_type.neq.quotation')),
          fetchAllRows(() => supabase.from('customer_payments').select('id, customer_id, amount, payment_type, created_at').eq('shop_id', user.shop_id)),
        ])
        if (sRes.error) throw sRes.error
        if (pRes.error) throw pRes.error
        sales = sRes.data || []; payments = pRes.data || []
      } catch {
        const sid = String(user.shop_id)
        sales = (await db.sales.toArray()).filter(s => String(s.shop_id) === sid && s.customer_id != null && isLedgerSale(s))
        payments = (await db.customer_payments.toArray()).filter(p => String(p.shop_id) === sid)
        if (!cancelled) setError('Showing this device\'s saved data — ages may be incomplete.')
      }
      const byCustomer = {}
      const push = (cid, item) => { (byCustomer[String(cid)] ||= []).push(item) }
      for (const s of sales) push(s.customer_id, { type: 'sale', amount: Number(s.total_amount || 0) - Number(s.discount || 0), paid_amount: s.paid_amount || 0, date: s.created_at })
      for (const p of payments) if (p.customer_id != null) push(p.customer_id, { type: paymentRowType(p), payment_type: p.payment_type, amount: p.amount, date: p.created_at })
      const now = new Date()
      const out = debtors.map(c => {
        const items = (byCustomer[String(c.id)] || []).sort((a, b) => new Date(a.date) - new Date(b.date))
        const age = ageBalance(items, customerLedgerDelta, now)
        const balance = Number(c.outstanding_balance) || 0
        const gap = Math.max(0, balance - age.total) // old dues not in the ledger
        return {
          c, balance,
          oldestDays: gap > 0.5 ? Math.max(age.oldestDays, 91) : age.oldestDays,
          over90: age.buckets.d90 + gap,
          over30: age.buckets.d31_60 + age.buckets.d61_90 + age.buckets.d90 + gap,
        }
      })
      if (!cancelled) setRows(out)
    }
    load()
    return () => { cancelled = true }
  }, [customers, user?.shop_id])

  // Not reminded in the last 3 days first, then the oldest dues
  const list = useMemo(() => {
    if (!rows) return []
    const recent = (id) => reminded[id] && Date.now() - new Date(reminded[id]).getTime() < 3 * DAY
    return [...rows].sort((a, b) => (recent(a.c.id) - recent(b.c.id)) || (b.oldestDays - a.oldestDays) || (b.balance - a.balance))
  }, [rows, reminded])

  const sendReminder = (r) => {
    const shopName = localStorage.getItem(`shop_name_${user?.shop_id}`) || 'our shop'
    const msg = `Assalam-o-Alaikum ${r.c.name}!\n\n${shopName} se yaad dehani: aap ka baqaya *${rs(r.balance)}* hai`
      + (r.oldestDays > 30 ? ` (sab se purana bill ${r.oldestDays} din purana).` : '.')
      + `\n\nMeharbani farma kar jald ada kar dein. Shukriya!`
    const phone = waPhone(r.c.phone)
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank')
    const now = new Date().toISOString()
    try { localStorage.setItem(remindKey(r.c.id), now) } catch { /* storage unavailable */ }
    setReminded(prev => ({ ...prev, [r.c.id]: now }))
  }

  if (rows === null) return <p className="p-6 text-center text-fg-muted">Working out who owes the longest…</p>
  if (list.length === 0) return <p className="p-6 text-center text-fg-muted">🎉 No customer owes money right now.</p>

  const total90 = list.reduce((s, r) => s + r.over90, 0)
  return (
    <div>
      <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
        <p className="text-fg-2">{list.length} customer(s) owe money · <b className="text-danger-fg">{rs(total90)}</b> older than 90 days</p>
        {error && <p className="text-xs text-warning-strong">{error}</p>}
      </div>
      <ul className="space-y-2" aria-label="Customers to remind">
        {list.map(r => {
          const when = reminded[r.c.id]
          const days = when ? Math.floor((Date.now() - new Date(when).getTime()) / DAY) : null
          return (
            <li key={r.c.id} className="card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <Link to={`/customers/${r.c.id}`} className="font-bold text-fg hover:text-primary-fg truncate block">{r.c.name}</Link>
                <p className="text-xs text-fg-muted">
                  {r.c.phone || 'No phone'} · oldest unpaid: <b className={r.oldestDays > 90 ? 'text-danger-fg' : r.oldestDays > 30 ? 'text-warning-strong' : 'text-fg-2'}>{r.oldestDays} din</b>
                  {r.over30 > 0 && <> · over 30 days: {rs(r.over30)}</>}
                </p>
                {when && <p className="text-[11px] text-fg-subtle">Reminded {days === 0 ? 'today' : `${days} day(s) ago`}</p>}
              </div>
              <div className="flex items-center gap-3 sm:justify-end">
                <span className="font-black text-danger-fg">{rs(r.balance)}</span>
                {r.c.phone
                  ? <button type="button" onClick={() => sendReminder(r)} className="btn btn-primary btn-sm">💬 Remind</button>
                  : <Link to={`/customers`} className="btn btn-secondary btn-sm" title="Add a phone number to send reminders">Add phone</Link>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
