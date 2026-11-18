import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { customerLedgerDelta, withRunningBalance, paymentRowType, ageBalance } from '../utils/ledgerMath'

// ============================================================================
// Public customer page (/c/:token): the link a shop sends on WhatsApp.
// No login. Data comes from get_customer_portal (sql/customer_portal_migration.sql),
// which returns only this customer's bills, payments and balance.
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`
const day = (d) => new Date(d).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
const waPhone = (p) => {
  let phone = String(p || '').replace(/[^0-9]/g, '')
  if (phone.startsWith('03')) phone = '92' + phone.slice(1)
  return phone
}

function label(e) {
  if (e.payment_type === 'opening') return 'Opening balance (purani dues)'
  if (e.type === 'sale') return `Bill #${String(e.id).slice(-6)}`
  if (e.type === 'debit') return e.note || 'Sale entry'
  if (e.payment_type === 'refund') return e.note || 'Cash refund'
  if (e.type === 'return') return e.note || 'Goods returned'
  return e.note || 'Payment received'
}

export default function CustomerPortal() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', data: null })
  const [open, setOpen] = useState({})

  const load = async () => {
    setState({ status: 'loading', data: null })
    const { data, error } = await supabase.rpc('get_customer_portal', { p_token: String(token || '') })
    if (error) setState({ status: 'error', data: null })
    else if (!data) setState({ status: 'invalid', data: null })
    else setState({ status: 'ok', data })
  }

  useEffect(() => {
    document.title = 'Account statement'
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const view = useMemo(() => {
    const d = state.data
    if (!d) return null
    const entries = [
      ...(d.sales || []).map(s => ({
        id: s.id, date: s.created_at, type: 'sale',
        amount: Number(s.total_amount || 0) - Number(s.discount || 0),
        paid_amount: Number(s.paid_amount || 0), items: s.items || [], discount: Number(s.discount || 0),
      })),
      ...(d.payments || []).map(p => ({ id: `p${p.id}`, date: p.created_at, type: paymentRowType(p), payment_type: p.payment_type, amount: p.amount, note: p.note })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date))
    // Old dues that were never entered as a ledger line: show them as an opening
    // balance so the list adds up to the balance the shop holds.
    const ledgerSum = entries.reduce((s, e) => s + customerLedgerDelta(e), 0)
    const gap = Math.round((Number(d.balance || 0) - ledgerSum) * 100) / 100
    if (Math.abs(gap) >= 1) {
      const first = entries.length ? new Date(entries[0].date).getTime() - 1000 : Date.now()
      entries.unshift({ id: 'opening-gap', date: new Date(first).toISOString(), type: 'debit', payment_type: 'opening', amount: gap })
    }
    const withBal = withRunningBalance(entries, customerLedgerDelta)
    const age = ageBalance(entries, customerLedgerDelta)
    return { entries: withBal.reverse(), age }
  }, [state.data])

  if (state.status === 'loading') {
    return <Shell><p className="py-20 text-center text-fg-muted">Loading your account…</p></Shell>
  }
  if (state.status === 'invalid') {
    return (
      <Shell>
        <div className="card p-6 text-center mt-10">
          <p className="text-4xl mb-2" aria-hidden="true">🔒</p>
          <h1 className="text-lg font-bold text-fg">This link is not valid any more</h1>
          <p className="text-sm text-fg-muted mt-1">It may have expired or been turned off by the shop. Please ask the shop to send a new link.</p>
          <p className="text-sm text-fg-muted mt-1" lang="ur" dir="rtl">یہ لنک اب کام نہیں کرتا۔ دکان سے نیا لنک منگوائیں۔</p>
        </div>
      </Shell>
    )
  }
  if (state.status === 'error') {
    return (
      <Shell>
        <div className="card p-6 text-center mt-10">
          <h1 className="text-lg font-bold text-fg">Could not load your account</h1>
          <p className="text-sm text-fg-muted mt-1">Please check your internet connection and try again.</p>
          <button type="button" onClick={load} className="btn btn-primary mt-4">Try again</button>
        </div>
      </Shell>
    )
  }

  const { shop, customer, balance, link } = state.data
  const owes = Number(balance) > 0
  const shopWa = waPhone(shop?.phone)

  return (
    <Shell>
      <header className="text-center pt-6 pb-4">
        <p className="text-xs uppercase tracking-widest text-fg-subtle font-bold">Account statement</p>
        <h1 className="text-2xl font-black text-fg mt-1">{shop?.name || 'Shop'}</h1>
        {(shop?.address || shop?.phone) && <p className="text-sm text-fg-muted">{[shop?.address, shop?.phone].filter(Boolean).join(' · ')}</p>}
      </header>

      <section className={`card p-5 text-center ${owes ? 'border-danger-line' : 'border-success-line'}`} aria-label="Balance">
        <p className="text-sm text-fg-3">Assalam-o-Alaikum, <b className="text-fg">{customer?.name}</b></p>
        <p className="mt-3 text-xs uppercase font-bold tracking-wider text-fg-subtle">{owes ? 'Amount due (baqaya)' : Number(balance) < 0 ? 'Advance with shop' : 'Balance'}</p>
        <p className={`text-4xl font-black mt-1 ${owes ? 'text-danger-fg' : 'text-success-fg'}`}>{rs(Math.abs(Number(balance)))}</p>
        {!owes && Number(balance) === 0 && <p className="text-sm text-success-strong mt-1">✓ Nothing due. Shukriya!</p>}
        {owes && view?.age.total > 0 && (
          <div className="grid grid-cols-4 gap-1.5 mt-4 text-[11px]">
            {[['0–30 din', view.age.buckets.d0_30], ['31–60', view.age.buckets.d31_60], ['61–90', view.age.buckets.d61_90], ['90+', view.age.buckets.d90]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-surface-2 px-1 py-1.5">
                <p className="text-fg-subtle">{l}</p>
                <p className="font-bold text-fg-2">{Math.round(v).toLocaleString('en-PK')}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center print:hidden">
          {shopWa && (
            <a className="btn btn-primary" href={`https://wa.me/${shopWa}?text=${encodeURIComponent(`Assalam-o-Alaikum, main ${customer?.name} hoon. Mere account ke baare mein baat karni hai.`)}`} target="_blank" rel="noopener noreferrer">
              💬 Message the shop
            </a>
          )}
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">🖨️ Save / Print</button>
        </div>
      </section>

      <section className="mt-5" aria-label="Bills and payments">
        <h2 className="text-sm font-bold uppercase tracking-wider text-fg-subtle mb-2 px-1">Bills and payments</h2>
        {view.entries.length === 0 ? (
          <p className="card p-6 text-center text-sm text-fg-muted">No bills yet.</p>
        ) : (
          <ul className="card divide-y divide-line-subtle overflow-hidden">
            {view.entries.map(e => {
              const delta = customerLedgerDelta(e)
              const isBill = e.type === 'sale'
              const expanded = !!open[e.id]
              return (
                <li key={e.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-fg truncate">{label(e)}</p>
                      <p className="text-xs text-fg-muted">
                        {day(e.date)}
                        {isBill && <> · bill {rs(e.amount)}{e.paid_amount > 0 ? ` · paid ${rs(e.paid_amount)}` : ''}</>}
                      </p>
                      {isBill && e.items.length > 0 && (
                        <button type="button" onClick={() => setOpen(prev => ({ ...prev, [e.id]: !expanded }))} className="text-xs font-semibold text-primary-fg mt-1 print:hidden" aria-expanded={expanded}>
                          {expanded ? 'Hide items' : `Show ${e.items.length} item(s)`}
                        </button>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      {isBill && delta === 0 ? (
                        <p className="text-sm font-bold text-success-fg">Paid ✓</p>
                      ) : delta === 0 ? (
                        <p className="text-sm font-semibold text-fg-muted">{rs(Math.abs(Number(e.amount) || 0))}</p>
                      ) : (
                        <p className={`text-sm font-bold ${delta > 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
                          {delta > 0 ? '+' : '−'}{rs(Math.abs(delta))}
                        </p>
                      )}
                      <p className="text-[11px] text-fg-subtle">Balance {rs(e.balance)}</p>
                    </div>
                  </div>
                  {isBill && e.items.length > 0 && (
                    <ul className={`mt-2 rounded-lg bg-surface-2 px-3 py-2 space-y-1 ${expanded ? '' : 'hidden print:block'}`}>
                      {e.items.map((it, k) => {
                        const qty = Number(it.quantity || 0) - Number(it.returned_qty || 0)
                        return (
                          <li key={k} className="flex justify-between gap-3 text-xs text-fg-2">
                            <span className="truncate">{it.product_name} × {qty}{Number(it.returned_qty) > 0 ? ` (${it.returned_qty} returned)` : ''}</span>
                            <span className="shrink-0">{rs(qty * Number(it.unit_price || 0))}</span>
                          </li>
                        )
                      })}
                      {e.discount > 0 && <li className="flex justify-between text-xs text-success-strong"><span>Discount</span><span>−{rs(e.discount)}</span></li>}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <footer className="py-8 text-center text-[11px] text-fg-subtle">
        This private link shows only your account{link?.expires_at ? ` and works until ${day(link.expires_at)}` : ''}. Do not share it.
      </footer>
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
