// ============================================================================
// Running-balance rules shared by the customer and supplier ledgers.
//
// A return already lowers the invoice it came from (sales.total_amount /
// purchases.total_amount are reduced when goods come back). The `return` row
// written to customer_payments / supplier_payments is therefore a record only:
// subtracting it again would count the return twice.
// ============================================================================

// payment_type 'opening' = opening balance (purani dues) recorded when the
// customer/supplier was added or imported. Signed: negative = advance.
export const OPENING = 'opening'
export const isOpeningEntry = (item) => item?.payment_type === OPENING

// Change one customer-ledger line makes to what the customer owes
export function customerLedgerDelta(item) {
  if (isOpeningEntry(item)) return Number(item.amount || 0)
  if (item.type === 'sale') {
    const owed = Number(item.amount || 0) - Number(item.paid_amount || 0)
    return owed > 0 ? owed : 0
  }
  if (item.type === 'debit') return Number(item.amount || 0)
  if (item.payment_type === 'refund' || item.payment_type === 'return') return 0
  return -Math.abs(Number(item.amount || 0))
}

// Change one supplier-ledger line makes to what the shop owes the supplier
export function supplierLedgerDelta(item) {
  if (isOpeningEntry(item)) return Number(item.amount || 0)
  if (item.type === 'purchase' || item.type === 'debit') return Number(item.amount || 0)
  if (item.type === 'return') return 0
  return -Math.abs(Number(item.amount || 0))
}

// Adds a running `balance` to items sorted oldest first
export function withRunningBalance(items, deltaFn) {
  let running = 0
  return items.map(item => {
    running += deltaFn(item)
    return { ...item, balance: running }
  })
}

// Ledger type for a customer_payments / supplier_payments row (opening shows as a debit line)
export const paymentRowType = (p) =>
  p.payment_type === 'return' ? 'return'
    : (p.payment_type === 'debit' || p.payment_type === OPENING) ? 'debit'
      : 'payment'

/**
 * Write the opening-balance ledger row for a new customer/supplier.
 * The stored outstanding_balance is set by the caller (it already includes this
 * amount), so this only records it. Returns the rows to insert.
 */
export function openingRow({ table, shopId, partyId, amount, date }) {
  const key = table === 'supplier_payments' ? 'supplier_id' : 'customer_id'
  return {
    shop_id: shopId,
    [key]: partyId,
    amount: Number(amount),
    payment_type: OPENING,
    note: 'Opening Balance (purani dues)',
    ...(date ? { created_at: date } : {}),
  }
}

// Only completed sales belong in a customer's ledger (quotations are not dues)
export const isLedgerSale = (s) => s?.sale_type !== 'quotation'

/**
 * Statement for a date range. itemsAsc: ledger lines oldest first, each with `date`.
 * from / to: 'YYYY-MM-DD' (local days, inclusive).
 */
export function buildStatement(itemsAsc, from, to, deltaFn) {
  const [fy, fm, fd] = String(from).split('-').map(Number)
  const [ty, tm, td] = String(to).split('-').map(Number)
  const start = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  const end = new Date(ty, tm - 1, td, 23, 59, 59, 999)
  let opening = 0
  const rows = []
  let debit = 0, credit = 0
  for (const it of itemsAsc) {
    const d = new Date(it.date)
    const delta = deltaFn(it)
    if (d < start) { opening += delta; continue }
    if (d > end) continue
    if (delta > 0) debit += delta; else credit += -delta
    rows.push({ ...it, delta })
  }
  let running = opening
  const withBal = rows.map(r => { running += r.delta; return { ...r, runBalance: running } })
  const r2 = (n) => Math.round(n * 100) / 100
  return { opening: r2(opening), debit: r2(debit), credit: r2(credit), closing: r2(running), rows: withBal }
}

/**
 * Ageing of what is still owed: payments and returns pay off the oldest dues first.
 * Returns { total, buckets: { d0_30, d31_60, d61_90, d90 }, oldestDays }.
 */
export function ageBalance(itemsAsc, deltaFn, now = new Date()) {
  const debits = []
  let credits = 0
  for (const it of itemsAsc) {
    const delta = deltaFn(it)
    if (delta > 0) debits.push({ date: new Date(it.date), left: delta })
    else credits += -delta
  }
  for (const d of debits) {
    if (credits <= 0) break
    const used = Math.min(d.left, credits)
    d.left -= used
    credits -= used
  }
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
  let oldestDays = 0
  for (const d of debits) {
    if (d.left <= 0.004) continue
    const days = Math.floor((now - d.date) / 86400000)
    oldestDays = Math.max(oldestDays, days)
    if (days <= 30) buckets.d0_30 += d.left
    else if (days <= 60) buckets.d31_60 += d.left
    else if (days <= 90) buckets.d61_90 += d.left
    else buckets.d90 += d.left
  }
  const total = buckets.d0_30 + buckets.d31_60 + buckets.d61_90 + buckets.d90
  return { total: Math.round(total * 100) / 100, buckets, oldestDays }
}
