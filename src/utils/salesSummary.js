// ============================================================================
// One set of money rules for Dashboard, End of Day, Reports and the printed
// sales report, so every screen shows the same totals.
//
// sales.total_amount = bill before the bill discount
// sales.discount     = bill discount
// sales.paid_amount  = what was paid toward the bill at the counter (never more than net)
// sales.payment_details = [{ method, amount }] — amounts as tendered (may exceed the bill)
// ============================================================================

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const round2 = (n) => Math.round(n * 100) / 100

export const isCompletedSale = (s) => s?.sale_type !== 'quotation'

export const netOf = (s) => Math.max(0, num(s?.total_amount) - num(s?.discount))
export const paidOf = (s) => Math.min(netOf(s), Math.max(0, num(s?.paid_amount ?? s?.amount_paid)))
export const unpaidOf = (s) => Math.max(0, netOf(s) - paidOf(s))
const methodOf = (s) => String(s?.payment_type || s?.payment_method || 'cash').toLowerCase()

// A payment method counts as cash only when it is literally cash; JazzCash,
// EasyPaisa, bank, card and other online methods are "online".
export const isCashMethod = (m) => !m || String(m).toLowerCase() === 'cash'

/**
 * What a sale actually brought in at the counter, split into cash and online.
 * Split bills use their payment lines, applied in order and capped at paid_amount
 * (change given back on a cash line is not income).
 */
export function paidByMethod(sale) {
  const applied = paidOf(sale)
  const out = { cash: 0, online: 0 }
  if (applied <= 0) return out
  const method = methodOf(sale)
  const lines = Array.isArray(sale?.payment_details) ? sale.payment_details : null
  if (lines && lines.length > 0 && (method === 'split' || lines.length > 1)) {
    let left = applied
    // Online lines first: they are exact amounts; cash is where change comes from
    const ordered = [...lines].sort((a, b) => (isCashMethod(a.method) ? 1 : 0) - (isCashMethod(b.method) ? 1 : 0))
    for (const line of ordered) {
      const amt = Math.min(left, Math.max(0, num(line.amount)))
      left -= amt
      if (isCashMethod(line.method)) out.cash += amt
      else out.online += amt
    }
    out.cash += left // payment lines short of paid_amount: count the rest as cash
    return out
  }
  // Credit bill with part paid at the counter (cashier chose Credit and typed an
  // amount received): that money was taken in cash. It used to be counted
  // nowhere, so Cash in drawer / Close Day came out short.
  if (method === 'credit' || isCashMethod(method)) out.cash = applied
  else out.online = applied
  return out
}

/**
 * Totals for a list of sales and (optionally) their line items.
 * Quotations are ignored. Items whose sale is not in `sales` are ignored.
 */
export function summarizeSales(sales, items = []) {
  const list = (sales || []).filter(isCompletedSale)
  const ids = new Set(list.map(s => String(s.id)))
  const t = {
    count: list.length, gross: 0, discount: 0, net: 0, paid: 0, cash: 0, online: 0, credit: 0,
    wholesaleNet: 0, cogs: 0, profit: 0, linesWithoutCost: 0,
  }
  for (const s of list) {
    t.gross += num(s.total_amount)
    t.discount += num(s.discount)
    t.net += netOf(s)
    t.paid += paidOf(s)
    t.credit += unpaidOf(s)
    const pm = paidByMethod(s)
    t.cash += pm.cash
    t.online += pm.online
    if (s.price_tier === 'wholesale') t.wholesaleNet += netOf(s)
  }
  for (const i of items || []) {
    if (i.sale_id != null && !ids.has(String(i.sale_id))) continue
    const qty = Math.max(0, num(i.quantity) - num(i.returned_qty))
    if (qty <= 0) continue
    if (!(num(i.cost_price) > 0)) t.linesWithoutCost += 1
    t.cogs += num(i.cost_price) * qty
  }
  t.profit = t.net - t.cogs
  for (const k of Object.keys(t)) if (k !== 'count' && k !== 'linesWithoutCost') t[k] = round2(t[k])
  return t
}

/**
 * Cash book for a period (normally one day).
 *  - customerPayments: customer_payments rows (payment = recovery, refund = cash back,
 *    return/debit = no cash)
 *  - supplierPayments: supplier_payments rows (payment = paid out, including the
 *    automatic row written for a cash purchase; return/debit = no cash)
 *  - expenses: all treated as paid in cash
 */
export function summarizeCashBook({ sales = [], customerPayments = [], supplierPayments = [], expenses = [] }) {
  const s = summarizeSales(sales)
  let recoveriesCash = 0, recoveriesOnline = 0, refunds = 0, supplierCash = 0, supplierOnline = 0
  for (const p of customerPayments) {
    const type = p.payment_type
    if (type === 'refund') refunds += Math.abs(num(p.amount))
    else if (type === 'payment' || type == null) {
      if (isCashMethod(p.payment_mode)) recoveriesCash += Math.abs(num(p.amount))
      else recoveriesOnline += Math.abs(num(p.amount))
    }
  }
  for (const p of supplierPayments) {
    if (p.payment_type !== 'payment') continue
    if (isCashMethod(p.payment_mode)) supplierCash += Math.abs(num(p.amount))
    else supplierOnline += Math.abs(num(p.amount))
  }
  const expenseTotal = expenses.reduce((a, e) => a + num(e.amount), 0)
  const cashIn = s.cash + recoveriesCash
  const cashOut = refunds + supplierCash + expenseTotal
  return {
    sales: s,
    salesCash: s.cash,
    salesOnline: s.online,
    salesCredit: s.credit,
    recoveriesCash: round2(recoveriesCash),
    recoveriesOnline: round2(recoveriesOnline),
    refunds: round2(refunds),
    supplierCash: round2(supplierCash),
    supplierOnline: round2(supplierOnline),
    expenses: round2(expenseTotal),
    cashIn: round2(cashIn),
    cashOut: round2(cashOut),
    netCash: round2(cashIn - cashOut),
  }
}

// Local-time start of today / this month / N days back, as Date objects
export function periodStart(range, now = new Date()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0)
  if (range === 'today') return d
  if (range === 'week') { d.setDate(d.getDate() - 6); return d } // today + previous 6 days
  if (range === 'month') return new Date(d.getFullYear(), d.getMonth(), 1)
  if (range === 'year') return new Date(d.getFullYear(), 0, 1)
  return new Date(2000, 0, 1)
}

/**
 * Dated return documents (sale_returns, sql/transactions_migration.sql).
 * A return lowers its sale's stored totals, so a period's sales are rebuilt as
 *   sales made in the period at their original value  (current + their returns)
 *   − returns made in the period                      (whatever day the sale was)
 * Returns recorded before the migration have no document and stay on the sale's day.
 *  returnsOfPeriodSales: sale_returns whose sale was made in the period
 *  returnsInPeriod:      sale_returns created in the period
 */
export function applyReturns(sum, returnsOfPeriodSales = [], returnsInPeriod = []) {
  const add = (rows, k) => rows.reduce((a, r) => a + num(r[k]), 0)
  const net = sum.net + add(returnsOfPeriodSales, 'refund_total') - add(returnsInPeriod, 'refund_total')
  const cogs = sum.cogs + add(returnsOfPeriodSales, 'cost_total') - add(returnsInPeriod, 'cost_total')
  return {
    ...sum,
    net: round2(net),
    cogs: round2(cogs),
    profit: round2(net - cogs),
    returns: round2(add(returnsInPeriod, 'refund_total')),
    returnCount: returnsInPeriod.length,
  }
}
