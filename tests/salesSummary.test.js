// Money rules shared by Dashboard, Close Day, Reports and the printed report.
// Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { netOf, paidOf, unpaidOf, paidByMethod, summarizeSales, summarizeCashBook, applyReturns, periodStart, isCashMethod } from '../src/utils/salesSummary.js'

const sale = (o) => ({ id: o.id ?? Math.random(), sale_type: 'sale', total_amount: 0, discount: 0, paid_amount: 0, payment_type: 'cash', ...o })

test('net = bill − discount, paid is capped at net, unpaid is the rest', () => {
  const s = sale({ total_amount: 1000, discount: 100, paid_amount: 2000 })
  assert.equal(netOf(s), 900)
  assert.equal(paidOf(s), 900, 'over-tender (change) is not income')
  assert.equal(unpaidOf(s), 0)
  const credit = sale({ total_amount: 3000, paid_amount: 1000, payment_type: 'credit' })
  assert.equal(unpaidOf(credit), 2000)
})

test('only literal cash counts as cash; wallets and bank are online', () => {
  assert.equal(isCashMethod('cash'), true)
  assert.equal(isCashMethod(undefined), true)
  for (const m of ['jazzcash', 'easypaisa', 'bank', 'card', 'online']) assert.equal(isCashMethod(m), false, m)
})

test('split bill: online lines are exact, change comes out of the cash line', () => {
  // Bill 1000; customer paid 600 JazzCash + handed 500 cash, got 100 change
  const s = sale({ total_amount: 1000, paid_amount: 1000, payment_type: 'split', payment_details: [{ method: 'cash', amount: 500 }, { method: 'jazzcash', amount: 600 }] })
  assert.deepEqual(paidByMethod(s), { cash: 400, online: 600 })
})

test('credit bill part-paid at the counter: the paid part is cash, the rest is credit', () => {
  // POS: cashier picks Credit, then types 1000 received → payment_type 'credit', paid_amount 1000
  const s = sale({ total_amount: 3000, paid_amount: 1000, payment_type: 'credit', payment_details: [{ method: 'credit', amount: 1000 }] })
  assert.deepEqual(paidByMethod(s), { cash: 1000, online: 0 })
  const t = summarizeSales([s])
  assert.equal(t.net, 3000)
  assert.equal(t.cash, 1000)
  assert.equal(t.credit, 2000)
  assert.equal(t.cash + t.online + t.credit, t.net, 'no rupee goes missing')
  // Fully on credit: nothing is cash
  assert.deepEqual(paidByMethod(sale({ total_amount: 3000, paid_amount: 0, payment_type: 'credit' })), { cash: 0, online: 0 })
})

test('a day of sales: cash / online / credit add up to net; quotations ignored', () => {
  const sales = [
    sale({ id: 1, total_amount: 5000, paid_amount: 5000 }),                                   // cash
    sale({ id: 2, total_amount: 2000, paid_amount: 2000, payment_type: 'easypaisa' }),        // online
    sale({ id: 3, total_amount: 3000, paid_amount: 0, payment_type: 'credit' }),              // udhaar
    sale({ id: 4, total_amount: 1500, discount: 500, paid_amount: 1000 }),                    // cash after discount
    sale({ id: 5, total_amount: 9999, paid_amount: 9999, sale_type: 'quotation' }),          // not a sale
  ]
  const t = summarizeSales(sales)
  assert.equal(t.count, 4)
  assert.equal(t.gross, 11500)
  assert.equal(t.discount, 500)
  assert.equal(t.net, 11000)
  assert.equal(t.cash, 6000)
  assert.equal(t.online, 2000)
  assert.equal(t.credit, 3000)
  assert.equal(t.cash + t.online + t.credit, t.net, 'every rupee is cash, online or credit')
})

test('profit uses cost × (sold − returned) and flags lines without cost', () => {
  const sales = [sale({ id: 10, total_amount: 1000, paid_amount: 1000 })]
  const items = [
    { sale_id: 10, quantity: 3, returned_qty: 1, cost_price: 200 }, // 2 kept → 400
    { sale_id: 10, quantity: 1, returned_qty: 0, cost_price: 0 },   // no cost
    { sale_id: 99, quantity: 5, returned_qty: 0, cost_price: 100 }, // other sale: ignored
  ]
  const t = summarizeSales(sales, items)
  assert.equal(t.cogs, 400)
  assert.equal(t.profit, 600)
  assert.equal(t.linesWithoutCost, 1)
})

test('cash book: drawer = cash sales + cash received − refunds − supplier cash − expenses', () => {
  const book = summarizeCashBook({
    sales: [sale({ total_amount: 5000, paid_amount: 5000 }), sale({ total_amount: 3000, paid_amount: 0, payment_type: 'credit' })],
    customerPayments: [
      { amount: 2000, payment_type: 'payment', payment_mode: 'cash' },
      { amount: 700, payment_type: 'payment', payment_mode: 'jazzcash' }, // not in the drawer
      { amount: 300, payment_type: 'refund' },                            // cash given back
      { amount: 400, payment_type: 'return' },                            // record only
    ],
    supplierPayments: [
      { amount: 1000, payment_type: 'payment', payment_mode: 'cash' },
      { amount: 900, payment_type: 'payment', payment_mode: 'bank' },
      { amount: 600, payment_type: 'return' },
    ],
    expenses: [{ amount: 500 }],
  })
  assert.equal(book.salesCash, 5000)
  assert.equal(book.salesCredit, 3000)
  assert.equal(book.recoveriesCash, 2000)
  assert.equal(book.recoveriesOnline, 700)
  assert.equal(book.cashIn, 7000)
  assert.equal(book.cashOut, 300 + 1000 + 500)
  assert.equal(book.netCash, 5200)
})

test('returns: counted on the day they come back, not twice', () => {
  // Today: sale of 1000 (later 200 returned today, stored total now 800) + a 300 return of yesterday's sale
  const today = summarizeSales([sale({ id: 1, total_amount: 800, paid_amount: 800 })], [{ sale_id: 1, quantity: 4, returned_qty: 1, cost_price: 100 }])
  const r = applyReturns(today,
    [{ refund_total: 200, cost_total: 100 }],                                       // returns of today's sales
    [{ refund_total: 200, cost_total: 100 }, { refund_total: 300, cost_total: 150 }]) // returns made today
  assert.equal(r.net, 800 + 200 - 500, 'original 1000 − all 500 returned today')
  assert.equal(r.cogs, 300 + 100 - 250)
  assert.equal(r.profit, r.net - r.cogs)
  assert.equal(r.returns, 500)
  assert.equal(r.returnCount, 2)
})

test('periodStart uses local midnight / first of month', () => {
  const now = new Date(2026, 10, 18, 15, 30)
  assert.equal(periodStart('today', now).getTime(), new Date(2026, 10, 18).getTime())
  assert.equal(periodStart('month', now).getTime(), new Date(2026, 10, 1).getTime())
  assert.equal(periodStart('week', now).getTime(), new Date(2026, 10, 12).getTime())
})
