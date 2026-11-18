// Low-stock rule, local dates, and Sync status labels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getLowStockThreshold, isLowStock, isCriticalStock, isOutOfStock } from '../src/utils/stockRules.js'
import { localDateKey } from '../src/utils/dates.js'
import { describeSyncItem, explainSyncError } from '../src/utils/syncLabels.js'

test('low stock threshold: product → category → shop default (10); 0 is allowed', () => {
  const cats = [{ id: 1, low_stock_threshold: 4 }]
  assert.equal(getLowStockThreshold({ low_stock_threshold: 0, category_id: 1 }, cats), 0)
  assert.equal(getLowStockThreshold({ low_stock_threshold: '', category_id: 1 }, cats), 4)
  assert.equal(getLowStockThreshold({ category_id: 2 }, cats), 10)
  assert.equal(isLowStock({ stock_quantity: 4, category_id: 1 }, cats), true)
  assert.equal(isLowStock({ stock_quantity: 5, category_id: 1 }, cats), false)
})

test('critical = out of stock, or at most half the threshold (max 5)', () => {
  assert.equal(isOutOfStock({ stock_quantity: 0 }), true)
  assert.equal(isCriticalStock({ stock_quantity: 0 }), true)
  assert.equal(isCriticalStock({ stock_quantity: 5 }), true)   // default 10 → half = 5
  assert.equal(isCriticalStock({ stock_quantity: 6 }), false)
  assert.equal(isCriticalStock({ stock_quantity: 5, low_stock_threshold: 40 }), true, 'never above 5')
  assert.equal(isCriticalStock({ stock_quantity: 6, low_stock_threshold: 40 }), false)
})

test('localDateKey is the local calendar day, not UTC', () => {
  assert.equal(localDateKey(new Date(2026, 0, 1, 0, 30)), '2026-01-01')
  assert.equal(localDateKey(new Date(2026, 11, 31, 23, 59)), '2026-12-31')
})

test('sync labels: queued sale, payment and stock change read like the shop talks', () => {
  const tx = describeSyncItem({ table: 'complete_sale', action: 'TX', data: { params: { p_sale: { total_amount: 4300, customer_name: 'Ahmed' }, p_items: [{}, {}] } } })
  assert.deepEqual(tx, { title: 'Sale (bill)', detail: 'Ahmed · 2 items', amount: 4300 })
  const pay = describeSyncItem({ table: 'customer_payments', action: 'INSERT', data: { amount: 2500 } })
  assert.equal(pay.title, 'New customer payment')
  assert.equal(pay.amount, 2500)
  assert.equal(describeSyncItem({ table: 'adjust_product_stock', action: 'RPC', data: { p_delta: -2 } }).detail, '-2')
})

test('sync errors are explained with a next step', () => {
  assert.match(explainSyncError('TypeError: Failed to fetch').text, /internet/i)
  assert.match(explainSyncError('duplicate key value violates unique constraint').hint, /Discard/)
  assert.match(explainSyncError('column "client_ref" does not exist').text, /database needs an update/i)
  assert.match(explainSyncError('', { waiting: true }).text, /earlier change/)
})
