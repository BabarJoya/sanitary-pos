// Customer / supplier ledger rules (running balance, statement, ageing).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customerLedgerDelta, supplierLedgerDelta, withRunningBalance, buildStatement, ageBalance, openingRow, paymentRowType } from '../src/utils/ledgerMath.js'

test('customer: sale adds only the unpaid part; payments subtract; return/refund rows are records only', () => {
  assert.equal(customerLedgerDelta({ type: 'sale', amount: 5000, paid_amount: 2000 }), 3000)
  assert.equal(customerLedgerDelta({ type: 'sale', amount: 5000, paid_amount: 6000 }), 0, 'over-payment at the counter is not a credit')
  assert.equal(customerLedgerDelta({ type: 'payment', amount: 1000 }), -1000)
  assert.equal(customerLedgerDelta({ type: 'payment', amount: -1000 }), -1000, 'sign of a payment row never adds dues')
  assert.equal(customerLedgerDelta({ type: 'return', payment_type: 'return', amount: 800 }), 0)
  assert.equal(customerLedgerDelta({ type: 'payment', payment_type: 'refund', amount: 300 }), 0)
  assert.equal(customerLedgerDelta({ type: 'debit', amount: 250 }), 250)
  assert.equal(customerLedgerDelta({ payment_type: 'opening', amount: -500 }), -500, 'opening advance stays negative')
})

test('supplier: purchase and debit add, payment subtracts, return row is a record only', () => {
  assert.equal(supplierLedgerDelta({ type: 'purchase', amount: 10000 }), 10000)
  assert.equal(supplierLedgerDelta({ type: 'payment', amount: 4000 }), -4000)
  assert.equal(supplierLedgerDelta({ type: 'return', amount: 1000 }), 0)
  assert.equal(supplierLedgerDelta({ payment_type: 'opening', amount: 2000 }), 2000)
})

test('a customer month: opening dues, credit sale, payment, and a return that already lowered the bill', () => {
  // Bill was 3000 (1000 paid); 500 of goods came back → the sale row now says 2500
  const lines = [
    { payment_type: 'opening', amount: 500 },
    { type: 'sale', amount: 2500, paid_amount: 1000 },
    { type: 'payment', payment_type: 'payment', amount: 1500 },
    { type: 'return', payment_type: 'return', amount: 500 },
  ]
  const rows = withRunningBalance(lines, customerLedgerDelta)
  assert.deepEqual(rows.map(r => r.balance), [500, 2000, 500, 500])
})

test('statement for a date range: opening, debits, credits and closing agree', () => {
  const items = [
    { date: '2026-10-05T10:00:00', type: 'sale', amount: 4000, paid_amount: 0 },
    { date: '2026-11-02T10:00:00', type: 'payment', amount: 1000 },
    { date: '2026-11-10T10:00:00', type: 'sale', amount: 1500, paid_amount: 500 },
    { date: '2026-12-01T10:00:00', type: 'payment', amount: 2000 },
  ]
  const st = buildStatement(items, '2026-11-01', '2026-11-30', customerLedgerDelta)
  assert.equal(st.opening, 4000)
  assert.equal(st.debit, 1000)
  assert.equal(st.credit, 1000)
  assert.equal(st.closing, 4000)
  assert.equal(st.rows.length, 2)
  assert.equal(st.closing, st.opening + st.debit - st.credit)
})

test('ageing: payments clear the oldest dues first', () => {
  const now = new Date(2026, 11, 1)
  const items = [
    { date: new Date(2026, 7, 1), type: 'sale', amount: 3000, paid_amount: 0 },  // 122 days
    { date: new Date(2026, 9, 15), type: 'sale', amount: 2000, paid_amount: 0 }, // 47 days
    { date: new Date(2026, 10, 25), type: 'sale', amount: 1000, paid_amount: 0 }, // 6 days
    { date: new Date(2026, 10, 28), type: 'payment', amount: 3500 },
  ]
  const age = ageBalance(items, customerLedgerDelta, now)
  assert.equal(age.total, 2500)
  assert.equal(age.buckets.d90, 0, 'the 122-day bill is fully paid')
  assert.equal(age.buckets.d31_60, 1500)
  assert.equal(age.buckets.d0_30, 1000)
  assert.equal(age.oldestDays, 47)
})

test('opening row and payment row types', () => {
  assert.deepEqual(openingRow({ table: 'supplier_payments', shopId: 1, partyId: 7, amount: '1200' }),
    { shop_id: 1, supplier_id: 7, amount: 1200, payment_type: 'opening', note: 'Opening Balance (purani dues)' })
  assert.equal(openingRow({ table: 'customer_payments', shopId: 1, partyId: 3, amount: 1 }).customer_id, 3)
  assert.equal(paymentRowType({ payment_type: 'opening' }), 'debit')
  assert.equal(paymentRowType({ payment_type: 'return' }), 'return')
  assert.equal(paymentRowType({ payment_type: 'payment' }), 'payment')
})
