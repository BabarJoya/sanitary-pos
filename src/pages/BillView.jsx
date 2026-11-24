import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { buildBillHTML, DEFAULT_TEMPLATE } from '../utils/billTemplates'

// ============================================================================
// Public bill page (/b/:token) — opened from the QR code printed on a bill.
// No login. Data comes from get_bill (sql/bill_link_migration.sql +
// sql/bill_page_options_migration.sql): this one bill's display fields only.
// Views: Summary, and — when the shop allows it (Settings → Print) — the actual
// printed bill as an 80mm receipt or an A4 invoice, with its QR code, to print
// or download as PDF.
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`
const waPhone = (p) => {
  let phone = String(p || '').replace(/[^0-9]/g, '')
  if (phone.startsWith('03')) phone = '92' + phone.slice(1)
  return phone
}

// Turn the public bill data into the receipt object the bill templates expect
function toReceipt(data, token) {
  const { bill = {}, items = [] } = data
  const lines = items
    .map(it => ({ name: it.product_name, qty: Number(it.quantity || 0) - Number(it.returned_qty || 0), custom_price: Number(it.unit_price || 0) }))
    .filter(l => l.qty > 0)
  const subtotal = lines.reduce((s, l) => s + l.qty * l.custom_price, 0)
  const net = Math.max(0, Number(bill.total_amount || 0) - Number(bill.discount || 0))
  return {
    sale: {
      id: bill.id, created_at: bill.created_at, paid_amount: bill.paid_amount, payment_type: bill.payment_type,
      payment_details: bill.payment_details, online_provider: bill.online_provider, price_tier: bill.price_tier,
      created_by: bill.created_by, bill_token: token,
    },
    customer: bill.customer_name ? { name: bill.customer_name } : null,
    walkInName: bill.customer_name ? null : 'Walk-in Customer',
    items: lines,
    subtotal,
    totalDiscount: Number(bill.discount || 0),
    total: net,
    showBillQr: true,
  }
}

function billHtml(data, token, size) {
  const shop = data.shop || {}
  const settings = {
    name: shop.name, address: shop.address, phone: shop.phone, logo_url: shop.logo_url,
    invoice_footer: shop.invoice_footer, quotation_footer: shop.quotation_footer, invoice_prefix: shop.invoice_prefix,
    print_template: shop.print_template || DEFAULT_TEMPLATE, print_size: size, bill_qr: true,
  }
  return buildBillHTML(toReceipt(data, token), data.bill?.sale_type === 'quotation', settings)
    .replace(/<script>[\s\S]*?<\/script>/gi, '')
}

// The printed bill drawn in an iframe, scaled down to fit narrow phones
function PrintedBill({ html, width }) {
  const boxRef = useRef(null)
  const frameRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [height, setHeight] = useState(600)

  useEffect(() => {
    const fit = () => {
      const w = boxRef.current?.clientWidth || width
      setScale(Math.min(1, w / width))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [width])

  const onLoad = () => {
    const doc = frameRef.current?.contentDocument
    if (doc) setHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0) + 8)
  }

  return (
    <div ref={boxRef} className="w-full overflow-hidden flex justify-center" style={{ height: height * scale }}>
      <iframe ref={frameRef} title="Bill" srcDoc={html} onLoad={onLoad}
        style={{ width, height, border: 0, background: '#fff', transform: `scale(${scale})`, transformOrigin: 'top center', boxShadow: '0 1px 6px rgba(0,0,0,.12)' }} />
    </div>
  )
}

export default function BillView() {
  const { token } = useParams()
  const [state, setState] = useState({ status: 'loading', data: null })
  const [view, setView] = useState('summary') // 'summary' | 'receipt' | 'a4'
  const [busy, setBusy] = useState(false)
  // Shop staff who scan a bill with the phone camera land here: offer the
  // return screen when this device is logged in with Sales access.
  const staffCanReturn = useMemo(() => {
    try { return ['admin', 'manager', 'accountant'].includes(JSON.parse(localStorage.getItem('user') || 'null')?.role) } catch { return false }
  }, [])

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

  const printedHtml = useMemo(() => {
    if (state.status !== 'ok' || view === 'summary') return ''
    return billHtml(state.data, token, view === 'a4' ? 'a4' : 'thermal')
  }, [state, view, token])

  const printBill = () => {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(printedHtml.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</' + 'script></body>'))
    w.document.close()
  }

  const downloadPdf = async () => {
    setBusy(true)
    try {
      const { generateBillPDF } = await import('../utils/pdfShare')
      const blob = await generateBillPDF(printedHtml, view === 'a4' ? { width: 794 } : { width: 320, pageWidthMm: 80 })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bill-${String(state.data?.bill?.id ?? '').slice(-8)}${view === 'a4' ? '-A4' : ''}.pdf`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (err) {
      console.error('Bill PDF failed', err)
      alert('PDF could not be made on this phone. Use Print → Save as PDF instead.')
    } finally {
      setBusy(false)
    }
  }

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
  const canShowPrinted = shop.bill_page_full !== false
  const views = canShowPrinted ? [['summary', 'Summary'], ['receipt', 'Receipt'], ['a4', 'A4 invoice']] : [['summary', 'Summary']]

  return (
    <Shell wide={view === 'a4'}>
      <header className="text-center pt-6 pb-4">
        {shop.logo_url && <img src={shop.logo_url} alt="" className="mx-auto mb-2 max-h-14 max-w-24 object-contain" />}
        <h1 className="text-2xl font-black text-fg">{shop.name || 'Shop'}</h1>
        {(shop.address || shop.phone) && <p className="text-sm text-fg-muted">{[shop.address, shop.phone].filter(Boolean).join(' · ')}</p>}
      </header>

      {views.length > 1 && (
        <div className="mb-4 flex justify-center print:hidden">
          <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="Bill view">
            {views.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={`min-h-10 px-4 rounded-lg text-sm font-bold transition ${view === id ? 'bg-primary text-white shadow-sm' : 'text-fg-3 hover:bg-surface-2'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'summary' ? (
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
      ) : (
        <PrintedBill html={printedHtml} width={view === 'a4' ? 794 : 330} />
      )}

      <div className="mt-4 flex flex-col sm:flex-row gap-2 justify-center print:hidden">
        {view !== 'summary' && (
          <>
            <button type="button" onClick={downloadPdf} disabled={busy} className="btn btn-primary">{busy ? 'Making PDF…' : '⬇️ Download PDF'}</button>
            <button type="button" onClick={printBill} className="btn btn-secondary">🖨️ Print</button>
          </>
        )}
        {view === 'summary' && canShowPrinted && (
          <button type="button" onClick={() => setView('receipt')} className="btn btn-secondary">🧾 View printed bill</button>
        )}
        {staffCanReturn && !isQuote && (
          <Link to={`/sales?bill=${token}`} className="btn btn-secondary">↩️ Open in Sales (return items)</Link>
        )}
        {shopWa && (
          <a className={`btn ${view === 'summary' ? 'btn-primary' : 'btn-secondary'}`} href={`https://wa.me/${shopWa}?text=${encodeURIComponent(`Assalam-o-Alaikum, bill ${billNo} ke baare mein baat karni hai.`)}`} target="_blank" rel="noopener noreferrer">
            💬 Message the shop
          </a>
        )}
        {view === 'summary' && !canShowPrinted && (
          <button type="button" onClick={() => window.print()} className="btn btn-secondary">🖨️ Save / Print</button>
        )}
      </div>

      {shop.invoice_footer && view === 'summary' && <p className="mt-6 text-center text-sm font-semibold text-fg-3">{shop.invoice_footer}</p>}
      <p className="py-6 text-center text-[11px] text-fg-subtle">Opened from the QR code on your bill. Keep it for warranty or returns.</p>
    </Shell>
  )
}

function Shell({ children, wide }) {
  return (
    <div className="min-h-dvh bg-app">
      <main className={`mx-auto w-full px-4 ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>{children}</main>
    </div>
  )
}
