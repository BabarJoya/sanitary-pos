// "Try demo" sample shop: same data every time, and every balance agrees with
// the ledger rules the real screens use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDemoData } from '../src/services/demoData.js'
import { customerLedgerDelta, supplierLedgerDelta, paymentRowType } from '../src/utils/ledgerMath.js'
import { summarizeSales } from '../src/utils/salesSummary.js'
import { DEMO_SHOP_ID } from '../src/utils/demoFlag.js'

const now = new Date(2026, 10, 24, 18, 0)
const d = buildDemoData(now)

test('deterministic: the same demo every time', () => {
  assert.deepEqual(buildDemoData(now), d)
})

test('everything belongs to the demo shop and ids are unique', () => {
  for (const [name, rows] of Object.entries(d)) {
    if (!Array.isArray(rows)) continue
    assert.ok(rows.every(r => r.shop_id === DEMO_SHOP_ID), `${name} shop_id`)
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length, `${name} unique ids`)
  }
  assert.equal(d.shop.id, DEMO_SHOP_ID)
})

test('links are valid: items → sales/products, products → categories', () => {
  const saleIds = new Set(d.sales.map(s => s.id))
  const productIds = new Set(d.products.map(p => p.id))
  const catIds = new Set(d.categories.map(c => c.id))
  assert.ok(d.sale_items.every(i => saleIds.has(i.sale_id) && productIds.has(i.product_id)))
  assert.ok(d.purchase_items.every(i => d.purchases.some(p => p.id === i.purchase_id)))
  assert.ok(d.products.every(p => catIds.has(p.category_id)))
})

test('customer balances = their ledger (opening + unpaid sales − payments)', () => {
  for (const c of d.customers) {
    const lines = [
      ...d.sales.filter(s => s.customer_id === c.id && s.sale_type !== 'quotation').map(s => ({ type: 'sale', amount: s.total_amount - s.discount, paid_amount: s.paid_amount })),
      ...d.customer_payments.filter(p => p.customer_id === c.id).map(p => ({ ...p, type: paymentRowType(p) })),
    ]
    const ledger = lines.reduce((a, l) => a + customerLedgerDelta(l), 0)
    assert.equal(Math.round(ledger * 100) / 100, c.outstanding_balance, c.name)
    assert.ok(c.outstanding_balance >= 0, `${c.name} never owes a negative amount`)
  }
  assert.ok(d.customers.some(c => c.outstanding_balance > 0), 'some udhaar to show in reminders')
})

test('supplier balances = their ledger (opening + purchases − payments)', () => {
  for (const s of d.suppliers) {
    const lines = [
      ...d.purchases.filter(p => p.supplier_id === s.id).map(p => ({ type: 'purchase', amount: p.total_amount })),
      ...d.supplier_payments.filter(p => p.supplier_id === s.id).map(p => ({ ...p, type: paymentRowType(p) })),
    ]
    assert.equal(lines.reduce((a, l) => a + supplierLedgerDelta(l), 0), s.outstanding_balance, s.name)
  }
})

test('a believable shop: sales today, low stock, a quotation that is not a sale', () => {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  const today = d.sales.filter(s => new Date(s.created_at) >= start)
  assert.ok(today.length >= 3, 'sales today for the Dashboard')
  assert.ok(today.every(s => new Date(s.created_at) <= now), 'no sales in the future')
  const t = summarizeSales(d.sales, d.sale_items)
  assert.ok(t.count < d.sales.length, 'quotation excluded')
  assert.ok(t.cash > 0 && t.credit > 0 && t.online > 0, 'cash, credit and online all appear')
  assert.ok(t.profit > 0)
  assert.ok(d.products.some(p => p.stock_quantity === 0), 'an out-of-stock item')
  assert.ok(d.sales.filter(s => s.sale_type === 'sale').every(s => /^[0-9a-f]{32}$/.test(s.bill_token)), 'bills have QR codes')
})
