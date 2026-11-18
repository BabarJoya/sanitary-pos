import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CloudOff, FileText, Printer, MessageCircle, Link2, Plus } from 'lucide-react'
import { billUrl } from '../utils/billLink'

// ============================================================================
// Shown after a sale (or a saved quotation). Rendered into <body> so it always
// covers the whole screen and sits in the centre, whatever the POS layout does.
// Keys (handled by POS so cashiers keep their habit): Enter = print and start a
// new sale, Esc = new sale without printing. P also prints.
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`

function paymentLabel(r) {
  if (r.isQuotation) return { text: 'Quotation', tone: 'badge-info' }
  const sale = r.sale || {}
  const type = String(r.paymentType || sale.payment_type || 'cash').toLowerCase()
  if (type === 'split') return { text: 'Split payment', tone: 'badge-info' }
  if (type === 'credit') return { text: 'Credit (udhaar)', tone: 'badge-warning' }
  if (type === 'cash') return { text: 'Cash', tone: 'badge-success' }
  const provider = sale.online_provider || (Array.isArray(sale.payment_details) && sale.payment_details[0]?.provider) || type
  return { text: `Online · ${String(provider).replace(/^\w/, c => c.toUpperCase())}`, tone: 'badge-primary' }
}

export default function SaleCompleteModal({ receipt, invoicePrefix = 'INV', canSeeProfit, onPrint, onWhatsApp, onClose, savedOffline }) {
  const dialogRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    // Focus the dialog itself (not a button) so Enter only triggers POS's print shortcut
    dialogRef.current?.focus()
    const onKey = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); onPrint() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPrint])

  const r = receipt
  const sale = r.sale || {}
  const isQuote = !!r.isQuotation
  const total = Number(r.total) || 0
  const paid = isQuote ? 0 : Math.min(total, Number(sale.paid_amount ?? total) || 0)
  const due = isQuote ? 0 : Math.max(0, total - paid)
  const change = Number(r.changeDue) || 0
  const pay = paymentLabel(r)
  const billNo = `${isQuote ? 'QT' : invoicePrefix || 'INV'}-${String(sale.id ?? '').slice(-8)}`
  const when = sale.created_at ? new Date(sale.created_at) : new Date()
  const items = r.items || []
  const customerName = r.customer?.name || r.walkInName || 'Walk-in customer'
  const link = sale.bill_token && r.showBillQr !== false ? billUrl(sale.bill_token) : null

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }
  const sendWhatsApp = async () => {
    setSending(true)
    try { await onWhatsApp() } finally { setSending(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-[2px] p-0 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sale-done-title"
        className="outline-none w-full sm:max-w-md max-h-[92dvh] flex flex-col bg-surface rounded-t-2xl sm:rounded-2xl shadow-2xl border border-line overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-5 pb-4 text-center border-b border-line-subtle">
          <div className={`mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full ${isQuote ? 'bg-info-soft text-info-fg' : 'bg-success-soft text-success-fg'}`}>
            {isQuote ? <FileText size={26} /> : <CheckCircle2 size={28} />}
          </div>
          <h2 id="sale-done-title" className="text-lg font-black text-fg">{isQuote ? 'Quotation saved' : 'Sale complete'}</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            {billNo} · {when.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}, {when.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <div className="mt-2 flex items-center justify-center gap-1.5 flex-wrap">
            <span className={`badge ${pay.tone}`}>{pay.text}</span>
            {savedOffline && <span className="badge badge-warning inline-flex items-center gap-1"><CloudOff size={12} /> Saved offline · will sync</span>}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Change to give back — the one number the cashier needs right now */}
          {change > 0 && (
            <div role="status" className="rounded-xl bg-success text-white px-4 py-3 text-center">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/85">Change to return · wapis karein</p>
              <p className="text-4xl font-black tracking-tight mt-0.5 tabular-nums">{rs(change)}</p>
              <p className="text-[11px] text-white/85 mt-1">Received {rs(r.receivedAmount)} · Bill {rs(total)}</p>
            </div>
          )}

          {/* Amounts */}
          <dl className="rounded-xl border border-line divide-y divide-line-subtle text-sm">
            <div className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-fg-3">Total</dt><dd className="text-xl font-black text-fg tabular-nums">{rs(total)}</dd>
            </div>
            {Number(r.totalDiscount) > 0 && (
              <div className="flex justify-between px-4 py-2"><dt className="text-fg-3">Discount given</dt><dd className="text-success-strong tabular-nums">− {rs(r.totalDiscount)}</dd></div>
            )}
            {!isQuote && (
              <div className="flex justify-between px-4 py-2"><dt className="text-fg-3">Paid</dt><dd className="font-semibold text-fg-2 tabular-nums">{rs(paid)}</dd></div>
            )}
            {due > 0 && (
              <div className="flex justify-between px-4 py-2 bg-warning-soft"><dt className="font-bold text-warning-strong">Balance due (udhaar)</dt><dd className="font-black text-warning-strong tabular-nums">{rs(due)}</dd></div>
            )}
          </dl>

          {/* Customer */}
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="text-[11px] uppercase font-bold tracking-wider text-fg-subtle">Customer</p>
              <p className="font-semibold text-fg truncate">{customerName}</p>
            </div>
            {r.balanceAfter != null && (
              <div className="text-right shrink-0">
                <p className="text-[11px] uppercase font-bold tracking-wider text-fg-subtle">Total balance now</p>
                <p className={`font-bold tabular-nums ${Number(r.balanceAfter) > 0 ? 'text-danger-fg' : 'text-success-fg'}`}>{rs(r.balanceAfter)}</p>
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <p className="text-[11px] uppercase font-bold tracking-wider text-fg-subtle mb-1.5">{items.length} item{items.length === 1 ? '' : 's'}</p>
            <ul className="rounded-xl bg-surface-2 divide-y divide-line-subtle max-h-44 overflow-y-auto">
              {items.map((i, k) => (
                <li key={`${i.id}-${k}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-fg truncate">{i.name}</p>
                    <p className="text-xs text-fg-muted tabular-nums">{Number(i.qty)} × {Number(i.custom_price).toLocaleString('en-PK')}</p>
                  </div>
                  <p className="font-semibold text-fg-2 shrink-0 tabular-nums">{rs(Number(i.custom_price) * Number(i.qty))}</p>
                </li>
              ))}
            </ul>
            {canSeeProfit && !isQuote && (
              <p className={`mt-1.5 text-right text-xs font-semibold ${Number(r.totalProfit) >= 0 ? 'text-fg-muted' : 'text-danger-fg'}`}>
                Profit on this bill: {rs(r.totalProfit)}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-line px-5 py-4 space-y-2 bg-surface">
          <div className={`grid gap-2 ${r.customer?.phone ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <button type="button" onClick={onPrint} className="btn btn-primary min-h-11 inline-flex items-center justify-center gap-2">
              <Printer size={18} /> Print bill <kbd className="hidden sm:inline text-[10px] font-bold opacity-75 border border-white/40 rounded px-1">Enter</kbd>
            </button>
            {r.customer?.phone && (
              <button type="button" onClick={sendWhatsApp} disabled={sending} className="btn min-h-11 inline-flex items-center justify-center gap-2 bg-success hover:bg-success-hover text-white disabled:opacity-60">
                <MessageCircle size={18} /> {sending ? 'Preparing…' : 'WhatsApp'}
              </button>
            )}
          </div>
          {link && (
            <button type="button" onClick={copyLink} className="btn btn-secondary w-full min-h-10 inline-flex items-center justify-center gap-2 text-sm">
              <Link2 size={16} /> {copied ? 'Bill link copied ✓' : 'Copy bill link'}
            </button>
          )}
          <button type="button" onClick={onClose} className="btn btn-secondary w-full min-h-11 inline-flex items-center justify-center gap-2 font-bold">
            <Plus size={18} /> New sale <kbd className="hidden sm:inline text-[10px] font-bold text-fg-subtle border border-line rounded px-1">Esc</kbd>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
