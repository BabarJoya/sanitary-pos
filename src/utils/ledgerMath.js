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
