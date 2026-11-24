// ============================================================================
// ESC/POS receipt bytes for direct thermal printing (58mm = 32 columns,
// 80mm = 48 columns). Pure — no imports — and unit-tested. Thermal printers
// in raw mode print plain Latin text; Urdu letters are replaced, so shops that
// print Urdu names keep the normal (browser) print.
// ============================================================================

const ESC = 0x1b, GS = 0x1d, LF = 0x0a

export const CMD = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0], alignCenter: [ESC, 0x61, 1], alignRight: [ESC, 0x61, 2],
  boldOn: [ESC, 0x45, 1], boldOff: [ESC, 0x45, 0],
  bigOn: [GS, 0x21, 0x11], bigOff: [GS, 0x21, 0x00],
  cut: [GS, 0x56, 0x42, 0x03],                 // feed 3 lines and cut (partial)
  drawer: [ESC, 0x70, 0x00, 0x19, 0xfa],       // pulse pin 2: 50 ms on, 500 ms off
}

// Plain printable text (code page 437 basics); anything else becomes '?'
export function toAscii(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/₨/g, 'Rs')
    .replace(/[^\x20-\x7e]/g, '?')
}

const pad = (s, n, right = false) => {
  s = toAscii(s)
  if (s.length >= n) return s.slice(0, n)
  return right ? ' '.repeat(n - s.length) + s : s + ' '.repeat(n - s.length)
}

// "Left ........ Right" on one line
export function twoCols(left, right, width) {
  const r = toAscii(right)
  const l = toAscii(left)
  const room = width - r.length - 1
  if (room < 1) return r.slice(0, width)
  return pad(l, room) + ' ' + r
}

// Wrap long text to the paper width
export function wrap(text, width) {
  const words = toAscii(text).split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words) {
    if (!line) line = w.slice(0, width)
    else if ((line + ' ' + w).length <= width) line += ' ' + w
    else { lines.push(line); line = w.slice(0, width) }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')
const qtyText = (q) => { const n = Number(q) || 0; return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000) }

// GS ( k — QR code (model 2, size 6, error level M)
export function qrBytes(data) {
  const bytes = Array.from(new TextEncoder().encode(String(data)))
  const len = bytes.length + 3
  return [
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 0x06,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31,
    GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...bytes,
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30,
  ]
}

/**
 * receipt: the POS "Sale complete" object { sale, items, customer, walkInName,
 *   subtotal, totalDiscount, total, paymentType, receivedAmount, changeDue,
 *   previousBalance, balanceAfter }
 * opts: { shop: { name, phone, address }, width: 32|48, drawer, qrUrl, invoicePrefix, footer }
 */
export function buildEscposReceipt(receipt, opts = {}) {
  const width = opts.width === 32 ? 32 : 48
  const shop = opts.shop || {}
  const out = []
  const push = (...parts) => { for (const p of parts) out.push(...p) }
  const line = (t = '') => push(Array.from(toAscii(t), c => c.charCodeAt(0)), [LF])
  const rule = () => line('-'.repeat(width))
  const sale = receipt?.sale || {}
  const items = receipt?.items || []

  push(CMD.init, CMD.alignCenter, CMD.boldOn, CMD.bigOn)
  for (const l of wrap(shop.name || 'Shop', Math.floor(width / 2))) line(l)
  push(CMD.bigOff, CMD.boldOff)
  if (shop.address) for (const l of wrap(shop.address, width)) line(l)
  if (shop.phone) line(`Ph: ${shop.phone}`)
  push(CMD.alignLeft)
  rule()
  const billNo = `${opts.invoicePrefix || 'INV'}-${String(sale.id ?? '').slice(-8)}`
  line(twoCols(`Bill: ${billNo}`, sale.created_at ? new Date(sale.created_at).toLocaleDateString('en-GB') : '', width))
  const who = receipt?.customer?.name || receipt?.walkInName
  if (who) line(`Customer: ${who}`)
  if (sale.created_by) line(`Served by: ${sale.created_by}`)
  rule()

  for (const it of items) {
    const price = Number(it.custom_price ?? it.unit_price ?? it.sale_price) || 0
    const qty = Number(it.qty ?? it.quantity) || 0
    for (const l of wrap(it.name ?? it.product_name ?? 'Item', width)) line(l)
    line(twoCols(`  ${qtyText(qty)} x ${money(price)}`, money(price * qty), width))
  }
  rule()
  if (Number(receipt?.totalDiscount) > 0) {
    line(twoCols('Subtotal', money(receipt.subtotal), width))
    line(twoCols('Discount', `-${money(receipt.totalDiscount)}`, width))
  }
  push(CMD.boldOn, CMD.bigOn)
  line(twoCols('TOTAL', money(receipt?.total), Math.floor(width / 2)))
  push(CMD.bigOff, CMD.boldOff)
  const pt = String(receipt?.paymentType || sale.payment_type || '').toLowerCase()
  if (pt) line(twoCols('Payment', pt.toUpperCase(), width))
  if (Number(receipt?.receivedAmount) > 0) line(twoCols('Received', money(receipt.receivedAmount), width))
  if (Number(receipt?.changeDue) > 0) line(twoCols('Change', money(receipt.changeDue), width))
  if (receipt?.balanceAfter != null) {
    line(twoCols('Previous balance', money(receipt.previousBalance), width))
    push(CMD.boldOn); line(twoCols('Total balance', money(receipt.balanceAfter), width)); push(CMD.boldOff)
  }
  rule()
  push(CMD.alignCenter)
  if (opts.qrUrl) { push(qrBytes(opts.qrUrl)); line('Scan to view this bill online') }
  for (const l of wrap(opts.footer || 'Thank you for shopping!', width)) line(l)
  line(); line()
  push(CMD.cut)
  if (opts.drawer) push(CMD.drawer)
  return Uint8Array.from(out)
}

// A short test page (Settings → Test print)
export function buildTestPage({ width = 48, drawer = false, shopName = 'EdgeX POS' } = {}) {
  return buildEscposReceipt({
    sale: { id: 'TEST', created_at: new Date().toISOString() },
    items: [{ name: 'Test item', qty: 1, custom_price: 100 }], total: 100, paymentType: 'cash',
  }, { width, drawer, shop: { name: shopName }, footer: `Printer works - ${width === 32 ? '58mm' : '80mm'}` })
}
