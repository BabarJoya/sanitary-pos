// Item report: profit per item, dead / slow stock, reorder suggestion.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildItemReport, summarizeItemReport } from '../src/utils/itemReport.js'

const products = [
  { id: 1, name: 'Basin Mixer', stock_quantity: 4, cost_price: 1000, sale_price: 1500 },  // fast seller, low stock
  { id: 2, name: 'Gate Valve', stock_quantity: 300, cost_price: 200, sale_price: 260 },   // sells a little, lots of stock
  { id: 3, name: 'Old Shower', stock_quantity: 12, cost_price: 500, sale_price: 800 },    // no sales: dead
  { id: 4, name: 'Discontinued', stock_quantity: 0, cost_price: 50, sale_price: 80 },     // nothing to report
  { id: 5, name: 'No-cost Tap', stock_quantity: 10, cost_price: 0, sale_price: 300 },     // sold, cost unknown
]
const dates = { a: new Date(2026, 10, 1), b: new Date(2026, 10, 20) }
const items = [
  { product_id: 1, sale_id: 'a', quantity: 20, returned_qty: 2, unit_price: 1500, cost_price: 1000 },
  { product_id: 1, sale_id: 'b', quantity: 12, returned_qty: 0, unit_price: 1400, cost_price: 1000 },
  { product_id: 2, sale_id: 'a', quantity: 30, returned_qty: 0, unit_price: 260, cost_price: 0 },  // falls back to product cost
  { product_id: 5, sale_id: 'b', quantity: 3, returned_qty: 0, unit_price: 300, cost_price: 0 },
]
const rows = buildItemReport({ products, items, saleDate: (id) => dates[id], days: 30 })
const row = (id) => rows.find(r => r.product.id === id)

test('profit per item uses kept quantity and the line cost', () => {
  const r = row(1)
  assert.equal(r.qty, 30, '20 − 2 returned + 12')
  assert.equal(r.revenue, 18 * 1500 + 12 * 1400)
  assert.equal(r.cost, 30 * 1000)
  assert.equal(r.profit, 43800 - 30000)
  assert.equal(r.margin, Math.round((13800 / 43800) * 100))
  assert.equal(r.lastSold.getTime(), dates.b.getTime())
})

test('missing line cost falls back to the product cost; unknown cost is flagged', () => {
  assert.equal(row(2).cost, 30 * 200)
  assert.equal(row(2).costMissing, false)
  assert.equal(row(5).costMissing, true)
  assert.equal(row(5).profit, 900, 'no cost known → whole revenue shows as profit, flagged')
})

test('dead, slow and moving stock', () => {
  assert.equal(row(3).status, 'dead')
  assert.equal(row(3).stockValue, 12 * 500)
  assert.equal(row(2).status, 'slow', '300 in stock at 1/day = 300 days')
  assert.equal(row(2).daysLeft, 300)
  assert.equal(row(1).status, 'moving')
  assert.equal(row(4).status, 'none')
})

test('reorder: enough for 30 days when fewer than 14 days are left', () => {
  // Basin Mixer sells 1/day, 4 left → order 30 − 4 = 26
  assert.equal(row(1).perDay, 1)
  assert.equal(row(1).daysLeft, 4)
  assert.equal(row(1).reorder, 26)
  assert.equal(row(2).reorder, 0)
  assert.equal(row(3).reorder, 0, 'never reorder dead stock')
})

test('summary cards', () => {
  const t = summarizeItemReport(rows)
  assert.equal(t.deadCount, 1)
  assert.equal(t.deadValue, 6000)
  assert.equal(t.slowCount, 2, 'Gate Valve (300 days) and No-cost Tap (3 sold in 30 days, 10 left = 100 days)')
  assert.equal(t.slowValue, 60000, 'the tap has no cost, so only the valves add value')
  assert.equal(t.reorderCount, 1, 'only Basin Mixer')
  assert.equal(t.revenue, 43800 + 7800 + 900)
})
