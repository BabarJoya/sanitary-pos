import { useMemo, useState } from 'react'
import { buildStatement, ageBalance, customerLedgerDelta } from '../utils/ledgerMath'
import { localDateKey, todayLocal } from '../utils/dates'
import { printHTML, getShopBranding, brandedA4Header } from '../utils/printUtils'
import { openWhatsApp } from '../utils/whatsapp'

// ============================================================================
// Customer statement for a date range (opening → lines → closing) and ageing of
// what is still owed. `ledger` is the CustomerLedger list (newest first).
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`
const firstOfMonth = () => { const d = new Date(); return localDateKey(new Date(d.getFullYear(), d.getMonth(), 1)) }

export function AgeingStrip({ ledger }) {
  const age = useMemo(() => ageBalance([...ledger].reverse(), customerLedgerDelta), [ledger])
  if (!(age.total > 0)) return null
  const cells = [
    ['0–30 din', age.buckets.d0_30, 'text-fg-2'],
    ['31–60 din', age.buckets.d31_60, 'text-warning-strong'],
    ['61–90 din', age.buckets.d61_90, 'text-danger-fg'],
    ['90+ din', age.buckets.d90, 'text-danger-strong'],
  ]
  return (
    <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Dues by age">
      {cells.map(([label, val, cls]) => (
        <div key={label} className="rounded-xl border border-line-subtle bg-surface px-3 py-2">
          <p className="text-[11px] font-semibold text-fg-muted uppercase">{label}</p>
          <p className={`text-sm font-bold ${cls}`}>{rs(val)}</p>
        </div>
      ))}
    </div>
  )
}

export default function CustomerStatement({ ledger, customer, user, onClose }) {
  const [from, setFrom] = useState(firstOfMonth())
  const [to, setTo] = useState(todayLocal())
  const st = useMemo(() => buildStatement([...ledger].reverse(), from, to, customerLedgerDelta), [ledger, from, to])
  const age = useMemo(() => ageBalance([...ledger].reverse(), customerLedgerDelta), [ledger])
  const shopName = (user?.shop_id ? localStorage.getItem(`shop_name_${user.shop_id}`) : null) || 'Shop'
  const label = (it) => it.payment_type === 'opening' ? 'Opening balance' : it.type === 'sale' ? it.note : it.type === 'debit' ? (it.note || 'Manual sale') : it.type === 'return' ? (it.note || 'Return') : (it.note || 'Payment')

  const print = () => {
    const branding = getShopBranding(user?.shop_id)
    const rows = st.rows.map(r => `<tr><td>${new Date(r.date).toLocaleDateString('en-PK')}</td><td>${label(r)}</td>
      <td style="text-align:right">${r.delta > 0 ? Math.round(r.delta).toLocaleString() : ''}</td>
      <td style="text-align:right">${r.delta < 0 ? Math.round(-r.delta).toLocaleString() : ''}</td>
      <td style="text-align:right">${Math.round(r.runBalance).toLocaleString()}</td></tr>`).join('')
    printHTML(`<html><head><title>Statement - ${customer.name}</title><style>
      @page{size:A4 portrait;margin:12mm} body{font-family:'Segoe UI',sans-serif;font-size:12px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px} th{background:#f1f5f9;text-align:left}
      .sum{display:flex;gap:16px;margin:10px 0} .sum div{border:1px solid #ddd;border-radius:6px;padding:8px 12px}
    </style></head><body>
      ${brandedA4Header(branding, 'Customer Statement', `${customer.name}${customer.phone ? ' · ' + customer.phone : ''} · ${from} to ${to}`)}
      <div class="sum"><div>Opening: <b>${rs(st.opening)}</b></div><div>Sales: <b>${rs(st.debit)}</b></div><div>Received / returns: <b>${rs(st.credit)}</b></div><div>Closing: <b>${rs(st.closing)}</b></div></div>
      <table><thead><tr><th>Date</th><th>Details</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
      <tbody><tr><td>${from}</td><td>Opening balance</td><td></td><td></td><td style="text-align:right">${Math.round(st.opening).toLocaleString()}</td></tr>${rows}</tbody></table>
      ${age.total > 0 ? `<p>Dues by age — 0-30 days: ${rs(age.buckets.d0_30)} · 31-60: ${rs(age.buckets.d31_60)} · 61-90: ${rs(age.buckets.d61_90)} · 90+: ${rs(age.buckets.d90)}</p>` : ''}
    </body></html>`)
  }

  const whatsapp = () => {
    const msg = `*${shopName}* — Account Statement\n${customer.name}\n${from} to ${to}\n\n`
      + `Opening balance: ${rs(st.opening)}\nSales: ${rs(st.debit)}\nReceived / returns: ${rs(st.credit)}\n*Closing balance: ${rs(st.closing)}*`
      + (age.total > 0 && age.oldestDays > 30 ? `\n\nOldest unpaid bill: ${age.oldestDays} din purana.` : '')
      + `\n\nShukriya!`
    openWhatsApp({ shopId: user?.shop_id, kind: 'statement', phone: customer.phone, name: customer.name, text: msg })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center-safe justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="stmt-title">
      <div className="bg-surface w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="p-4 border-b border-line flex items-start justify-between gap-3">
          <div>
            <h2 id="stmt-title" className="text-lg font-bold text-fg">📄 Statement — {customer.name}</h2>
            <p className="text-xs text-fg-muted">Opening balance, entries in the period, and closing balance.</p>
          </div>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg text-2xl leading-none p-2" aria-label="Close">×</button>
        </div>
        <div className="p-4 border-b border-line grid grid-cols-2 gap-2">
          <label className="text-xs text-fg-3">From<input type="date" className="input w-full mt-1" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="text-xs text-fg-3">To<input type="date" className="input w-full mt-1" value={to} onChange={e => setTo(e.target.value)} /></label>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          <div className="rounded-lg bg-surface-2 p-2"><p className="text-[11px] text-fg-muted">Opening</p><p className="font-bold">{rs(st.opening)}</p></div>
          <div className="rounded-lg bg-surface-2 p-2"><p className="text-[11px] text-fg-muted">Sales</p><p className="font-bold text-danger-fg">{rs(st.debit)}</p></div>
          <div className="rounded-lg bg-surface-2 p-2"><p className="text-[11px] text-fg-muted">Received / returns</p><p className="font-bold text-success-fg">{rs(st.credit)}</p></div>
          <div className="rounded-lg bg-surface-2 p-2"><p className="text-[11px] text-fg-muted">Closing</p><p className="font-black">{rs(st.closing)}</p></div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line-subtle border-t border-line">
          {st.rows.length === 0 && <p className="p-6 text-center text-sm text-fg-subtle">No entries in this period.</p>}
          {st.rows.map((r, i) => (
            <div key={`${r.id}-${i}`} className="px-4 py-2 flex items-center gap-3 text-sm">
              <span className="text-xs text-fg-muted w-20 shrink-0">{new Date(r.date).toLocaleDateString('en-PK')}</span>
              <span className="flex-1 min-w-0 truncate text-fg-2">{label(r)}</span>
              <span className={`font-semibold ${r.delta > 0 ? 'text-danger-fg' : 'text-success-fg'}`}>{r.delta > 0 ? '+' : '−'}{Math.round(Math.abs(r.delta)).toLocaleString()}</span>
              <span className="w-24 text-right font-bold text-fg">{Math.round(r.runBalance).toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-line flex flex-col sm:flex-row gap-2">
          <button type="button" onClick={print} className="btn btn-secondary flex-1">🖨️ Print / PDF</button>
          <button type="button" onClick={whatsapp} className="btn btn-primary flex-1">📱 WhatsApp</button>
        </div>
      </div>
    </div>
  )
}
