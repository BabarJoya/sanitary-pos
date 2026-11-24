// ESC/POS receipt bytes for direct thermal printing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEscposReceipt, twoCols, wrap, toAscii, qrBytes, CMD } from '../src/utils/escpos.js'

const text = (bytes) => Array.from(bytes, b => (b >= 0x20 && b < 0x7f) || b === 0x0a ? String.fromCharCode(b) : '·').join('')
const has = (bytes, seq) => {
  outer: for (let i = 0; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) if (bytes[i + j] !== seq[j]) continue outer
    return true
  }
  return false
}

const receipt = {
  sale: { id: 12345678, created_at: '2026-11-24T10:00:00Z', created_by: 'ali' },
  items: [{ name: 'Basin Mixer Chrome Deluxe With Long Name', qty: 2, custom_price: 1500 }, { name: 'PPR Pipe', qty: 2.5, custom_price: 400 }],
  customer: { name: 'Ahmed Khan' }, subtotal: 4000, totalDiscount: 100, total: 3900,
  paymentType: 'cash', receivedAmount: 4000, changeDue: 100, previousBalance: 500, balanceAfter: 500,
}

test('layout helpers keep to the paper width', () => {
  assert.equal(twoCols('Total', '3,900', 32).length, 32)
  assert.ok(twoCols('Total', '3,900', 32).endsWith('3,900'))
  for (const l of wrap('Basin Mixer Chrome Deluxe With Long Name', 16)) assert.ok(l.length <= 16)
  assert.equal(toAscii('Rs. ₨ “ok” — نل'), 'Rs. Rs "ok" - ??')
})

test('receipt has shop, bill, items, totals, balance and ends with a cut', () => {
  const b = buildEscposReceipt(receipt, { width: 48, shop: { name: 'Al-Madina Sanitary', phone: '0300-1234567' }, invoicePrefix: 'AMS' })
  const t = text(b)
  assert.deepEqual(Array.from(b.slice(0, 2)), CMD.init)
  for (const s of ['Al-Madina Sanitary', 'AMS-12345678', 'Customer: Ahmed Khan', '2 x 1,500', '3,000', '2.5 x 400', 'Discount', '-100', 'TOTAL', '3,900', 'Change', 'Total balance']) {
    assert.ok(t.includes(s), `missing "${s}"`)
  }
  assert.ok(has(b, CMD.cut))
  assert.ok(!has(b, CMD.drawer), 'no drawer pulse unless asked')
  // Text lines (command bytes stripped) fit the 48-column paper
  const lines = t.split('\n').map(l => l.replace(/^(?:·[\s\S]?·?)+/, ''))
  assert.ok(lines.includes('-'.repeat(48)), 'full-width rule')
  for (const l of lines.filter(l => /\d$/.test(l))) assert.ok(l.length <= 48, `line too long: ${l}`)
})

test('cash drawer pulse and QR when asked; 58 mm uses 32 columns', () => {
  const b = buildEscposReceipt(receipt, { width: 32, drawer: true, qrUrl: 'https://pos.edgexsuite.com/b/0123456789abcdef0123456789abcdef' })
  assert.ok(has(b, CMD.drawer))
  assert.ok(has(b, [0x1d, 0x28, 0x6b]), 'QR command')
  assert.ok(text(b).includes('Scan to view this bill online'))
  const ruleLine = text(b).split('\n').find(l => /^-+$/.test(l))
  assert.equal(ruleLine.length, 32)
})

test('QR command carries the length of the link', () => {
  const url = 'https://x.y/b/abc'
  const q = qrBytes(url)
  const store = q.indexOf(0x50) // fn 80 (store data)
  const len = q[store - 3] + (q[store - 2] << 8)
  assert.equal(len, url.length + 3)
})
