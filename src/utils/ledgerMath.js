// ============================================================================
// Running-balance rules shared by the customer and supplier ledgers.
//
// A return already lowers the invoice it came from (sales.total_amount /
// purchases.total_amount are reduced when goods come back). The `return` row
// written to customer_payments / supplier_payments is therefore a record only:
// subtracting it again would count the return twice.
// ============================================================================

// Change one customer-ledger line makes to what the customer owes
export function customerLedgerDelta(item) {
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

// Only completed sales belong in a customer's ledger (quotations are not dues)
export const isLedgerSale = (s) => s?.sale_type !== 'quotation'
