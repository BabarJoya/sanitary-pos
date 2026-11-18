import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'

// ============================================================================
// Public bill page (/b/:token) — opened from the QR code printed on a bill.
// No login. Data comes from get_bill (sql/bill_link_migration.sql): this one
// bill's display fields only.
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`
const waPhone = (p) => {
  let phone = String(p || '').replace(/[^0-9]/g, '')
  if (phone.startsWith('03')) phone = '92' + phone.slice(1)
  return phone
}

export default function BillView() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', data: null })

  const load = async () => {
    setState({ status: 'loading', data: null })
    const { data, error } = await supabase.rpc('get_bill', { p_token: String(token || '') })
    if (error) setState({ status: 'error', data: null })
    else if (!data) setState({ status: 'invalid', data: null })
    else setState({ status: 'ok', data })
  }

  useEffect(() => {
    document.title = 'Bill'
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (state.status === 'loading') return <Shell><p className="py-20 text-center text-fg-muted">Loading bill…</p></Shell>
  if (state.status === 'invalid') {
    return (
      <Shell>
        <div className="card p-6 text-center mt-10">
          <p className="text-4xl mb-2" aria-hidden="true">🧾</p>
          <h1 className="text-lg font-bold text-fg">Bill not found</h1>
          <p className="text-sm text-fg-muted mt-1">This bill may have been cancelled. Please contact the shop.</p>
          <p className="text-sm text-fg-muted mt-1" lang="ur" dir="rtl">یہ بل نہیں ملا۔ دکان سے رابطہ کریں۔</p>
        </div>
      </Shell>
    )
  }
  if (state.status === 'error') {
    return (
      <Shell>
        <div className="card p-6 text-center mt-10">
          <h1 className="text-lg font-bold text-fg">Could not load the bill</h1>
          <p className="text-sm text-fg-muted mt-1">Please check your internet connection and try again.</p>
          <button type="button" onClick={load} className="btn btn-primary mt-4">Try again</button>
        </div>
      </Shell>
    )
  }

  const { shop = {}, bill = {}, items = [] } = state.data
  const isQuote = bill.sale_type === 'quotation'
  const net = Math.max(0, Number(bill.total_amount || 0) - Number(bill.discount || 0))
  const paid = Math.min(net, Number(bill.paid_amount || 0))
  const due = Math.max(0, net - paid)
  const billNo = `${isQuote ? 'QT' : (shop.invoice_prefix || 'INV')}-${String(bill.id).slice(-8)}`
  const when = new Date(bill.created_at)
  const status = isQuote ? 'QUOTATION' : due > 0 ? (paid > 0 ? 'PARTLY PAID' : 'UNPAID') : 'PAID'
  const shopWa = waPhone(shop.phone)

  return (
    <Shell>
      <header className="text-center pt-6 pb-4">
        {shop.logo_url && <img src={shop.logo_url} alt="" className="mx-auto mb-2 max-h-14 max-w-24 object-contain" />}
        <h1 className="text-2xl font-black text-fg">{shop.name || 'Shop'}</h1>
        {(shop.address || shop.phone) && <p className="text-sm text-fg-muted">{[shop.address, shop.phone].filter(Boolean).join(' · ')}</p>}
      </header>

      <section className="card overflow-hidden" aria-label="Bill">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-line bg-surface-2">
          <div>
            <p className="text-xs uppercase tracking-wider font-bold text-fg-subtle">{isQuote ? 'Quotation' : bill.price_tier === 'wholesale' ? 'Wholesale invoice' : 'Invoice'}</p>
            <p className="font-black text-fg">{billNo}</p>
            <p className="text-xs text-fg-muted">{when.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })} · {when.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
          <span className={`badge ${status === 'PAID' ? 'badge-success' : status === 'QUOTATION' ? 'badge-info' : 'badge-danger'}`}>{status}</span>
        </div>
        {bill.customer_name && <p className="px-4 pt-3 text-sm text-fg-3">Customer: <b className="text-fg">{bill.customer_name}</b></p>}

        <ul className="divide-y divide-line-subtle px-4">
          {items.map((it, k) => {
            const qty = Number(it.quantity || 0)
            const ret = Number(it.returned_qty || 0)
            const kept = qty - ret
            return (
              <li key={k} className="py-2.5 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{it.product_name}</p>
                  <p className="text-xs text-fg-muted">{kept} × {Number(it.unit_price || 0).toLocaleString('en-PK')}{ret > 0 ? ` · ${ret} returned` : ''}</p>
                </div>
                <p className="text-sm font-bold text-fg shrink-0">{rs(kept * Number(it.unit_price || 0))}</p>
              </li>
            )
          })}
        </ul>

        <div className="px-4 py-3 border-t border-line space-y-1 text-sm">
          {Number(bill.discount) > 0 && <div className="flex justify-between text-success-strong"><span>Discount</span><span>− {rs(bill.discount)}</span></div>}
          <div className="flex justify-between text-lg font-black text-fg"><span>Total</span><span>{rs(net)}</span></div>
          {!isQuote && <div className="flex justify-between text-fg-3"><span>Paid{bill.payment_type ? ` (${String(bill.payment_type).toLowerCase()})` : ''}</span><span>{rs(paid)}</span></div>}
          {!isQuote && due > 0 && <div className="flex justify-between font-bold text-danger-fg"><span>Balance due</span><span>{rs(due)}</span></div>}
        </div>
      </section>

      <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center print:hidden">
        {shopWa && (
          <a className="btn btn-primary" href={`https://wa.me/${shopWa}?text=${encodeURIComponent(`Assalam-o-Alaikum, bill ${billNo} ke baare mein baat karni hai.`)}`} target="_blank" rel="noopener noreferrer">
            💬 Message the shop
          </a>
        )}
        <button type="button" onClick={() => window.print()} className="btn btn-secondary">🖨️ Save / Print</button>
      </div>

      {shop.invoice_footer && <p className="mt-6 text-center text-sm font-semibold text-fg-3">{shop.invoice_footer}</p>}
      <p className="py-6 text-center text-[11px] text-fg-subtle">Opened from the QR code on your bill. Keep it for warranty or returns.</p>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-dvh bg-app">
      <main className="mx-auto w-full max-w-xl px-4">{children}</main>
    </div>
  )
}
