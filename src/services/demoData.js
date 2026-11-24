// ============================================================================
// Sample data for the demo shop: a small sanitary store with two weeks of
// sales, udhaar customers, suppliers, purchases and expenses. Deterministic
// (same data every time) and pure, so it is unit-tested (tests/demo.test.js).
// Balances are worked out from the same rows the ledgers read, so every
// screen agrees.
// ============================================================================

import { DEMO_SHOP_ID } from '../utils/demoFlag.js'

const SHOP = DEMO_SHOP_ID

// Small seeded random generator so the demo is the same on every device
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const CATEGORIES = [
  [1, 'Taps & Mixers', 5], [2, 'Pipes & Fittings', 20], [3, 'Bathroom', 3], [4, 'Kitchen', 3], [5, 'Water Tanks', 2],
]
const BRANDS = ['Sonex', 'Faisal', 'Master', 'Porta', 'Popular']
// [name, brand, category, cost, sale, wholesale, stock]
const PRODUCTS = [
  ['Basin Mixer Chrome', 'Sonex', 1, 3200, 4200, 3900, 14],
  ['Sink Mixer Wall', 'Faisal', 1, 2800, 3700, 3400, 9],
  ['Pillar Tap', 'Master', 1, 650, 950, 850, 40],
  ['Bib Cock Brass', 'Faisal', 1, 900, 1300, 1150, 22],
  ['Angle Valve', 'Sonex', 1, 420, 650, 560, 60],
  ['Shower Set Round', 'Sonex', 3, 4500, 6200, 5700, 4],
  ['Commode Seat Cover', 'Porta', 3, 1100, 1650, 1450, 12],
  ['Commode (Complete Set)', 'Porta', 3, 14500, 18500, 17200, 2],
  ['Wash Basin White', 'Porta', 3, 3800, 5200, 4800, 6],
  ['Health Faucet', 'Master', 3, 750, 1150, 1000, 0],
  ['Kitchen Sink Steel', 'Master', 4, 6500, 8800, 8100, 3],
  ['Sink Waste Coupling', 'Popular', 4, 180, 300, 250, 35],
  ['PPR Pipe 1/2" (ft)', 'Popular', 2, 38, 55, 48, 900],
  ['PPR Pipe 3/4" (ft)', 'Popular', 2, 55, 80, 70, 650],
  ['PPR Elbow 1/2"', 'Popular', 2, 18, 30, 25, 400],
  ['PPR Tee 1/2"', 'Popular', 2, 22, 35, 30, 350],
  ['Gate Valve 3/4"', 'Faisal', 2, 850, 1250, 1100, 18],
  ['Union 1/2"', 'Popular', 2, 60, 95, 80, 8],
  ['Teflon Tape', 'Popular', 2, 25, 50, 40, 120],
  ['Water Tank 200 Gallon', 'Porta', 5, 16500, 19800, 18900, 3],
  ['Float Valve 1/2"', 'Faisal', 5, 350, 550, 480, 25],
  ['Geyser Valve Set', 'Sonex', 1, 1900, 2700, 2450, 7],
]
const CUSTOMERS = [
  [1, 'Ahmed Plumber', '03001234567', 'Model Town', 1500],
  [2, 'Bilal Builders', '03211234567', 'Johar Town', 0],
  [3, 'Rashid Contractor', '03331234567', 'Gulberg', 4000],
  [4, 'Usman Sanitary Fitter', '03451234567', 'Township', 0],
  [5, 'Hajji Naseem', '03011234567', 'Shadman', 0],
]
const SUPPLIERS = [
  [1, 'Sonex Distributors', '04235550101', 25000],
  [2, 'Faisal Traders', '04235550202', 0],
  [3, 'Popular Pipes Pvt', '04235550303', 0],
]

const hex = (r) => Array.from({ length: 32 }, () => Math.floor(r() * 16).toString(16)).join('')
const iso = (d) => new Date(d).toISOString()
const atDay = (now, daysAgo, hour, minute) => {
  const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(hour, minute, 0, 0); return d
}

export function buildDemoData(now = new Date()) {
  const r = rng(20261124)
  const pick = (arr) => arr[Math.floor(r() * arr.length)]

  const categories = CATEGORIES.map(([id, name, low]) => ({ id, name, shop_id: SHOP, low_stock_threshold: low }))
  const brands = BRANDS.map((name, i) => ({ id: i + 1, name, shop_id: SHOP }))
  const products = PRODUCTS.map(([name, brand, category_id, cost, sale, wholesale, stock], i) => ({
    id: i + 1, shop_id: SHOP, name, brand, category_id, cost_price: cost, c_rate: cost, sale_price: sale,
    wholesale_price: wholesale, stock_quantity: stock, sku: `8960${String(1001 + i)}`, unit: name.includes('(ft)') ? 'ft' : 'pcs',
  }))
  const customers = CUSTOMERS.map(([id, name, phone, address, opening]) => ({
    id, shop_id: SHOP, name, phone, address, outstanding_balance: 0, credit_limit: id === 3 ? 50000 : 0,
    price_tier: id === 2 || id === 3 ? 'wholesale' : 'retail', created_at: iso(atDay(now, 40, 10, 0)), _opening: opening,
  }))
  const suppliers = SUPPLIERS.map(([id, name, phone, opening]) => ({
    id, shop_id: SHOP, name, phone, outstanding_balance: 0, created_at: iso(atDay(now, 40, 10, 0)), _opening: opening,
  }))

  // Opening balances are ledger rows (payment_type 'opening')
  let cpId = 1, spId = 1
  const customer_payments = customers.filter(c => c._opening).map(c => ({
    id: cpId++, shop_id: SHOP, customer_id: c.id, amount: c._opening, payment_type: 'opening',
    note: 'Opening Balance (purani dues)', created_at: c.created_at,
  }))
  const supplier_payments = suppliers.filter(s => s._opening).map(s => ({
    id: spId++, shop_id: SHOP, supplier_id: s.id, amount: s._opening, payment_type: 'opening',
    note: 'Opening Balance (purani dues)', created_at: s.created_at,
  }))

  // ── Two weeks of sales ──
  const sales = []
  const sale_items = []
  let saleId = 10001, itemId = 1
  for (let day = 13; day >= 0; day--) {
    const count = day === 0 ? 4 : 3 + Math.floor(r() * 4)
    for (let k = 0; k < count; k++) {
      const when = atDay(now, day, 10 + Math.floor((k * 9) / count), Math.floor(r() * 59))
      if (day === 0 && when > now) when.setTime(now.getTime() - (count - k) * 600000)
      const lines = 1 + Math.floor(r() * 3)
      const chosen = new Set()
      while (chosen.size < lines) chosen.add(Math.floor(r() * products.length))
      const credit = r() < 0.3
      const customer = credit || r() < 0.3 ? pick(customers) : null
      const wholesale = customer?.price_tier === 'wholesale'
      let total = 0
      const items = [...chosen].map(idx => {
        const p = products[idx]
        const qty = p.unit === 'ft' ? 10 + Math.floor(r() * 40) : 1 + Math.floor(r() * 3)
        const price = wholesale ? p.wholesale_price : p.sale_price
        total += price * qty
        return { id: itemId++, sale_id: saleId, shop_id: SHOP, product_id: p.id, product_name: p.name, quantity: qty, unit_price: price, cost_price: p.cost_price, line_total: price * qty, returned_qty: 0 }
      })
      const discount = total > 5000 && r() < 0.4 ? Math.round(total * 0.03 / 10) * 10 : 0
      const net = total - discount
      const online = !credit && r() < 0.25
      const paid = credit ? (r() < 0.4 ? Math.round(net * 0.3 / 100) * 100 : 0) : net
      const method = credit ? 'credit' : online ? 'jazzcash' : 'cash'
      sales.push({
        id: saleId, shop_id: SHOP, customer_id: customer?.id ?? null, customer_name: customer ? null : (r() < 0.3 ? 'Walk-in' : null),
        total_amount: total, discount, paid_amount: paid, payment_type: method, payment_method: method,
        online_provider: online ? 'JazzCash' : null, payment_details: [{ method, amount: paid }],
        sale_type: 'sale', status: 'completed', created_by: 'Demo Owner', created_at: iso(when),
        bill_token: hex(r), ...(wholesale ? { price_tier: 'wholesale' } : { price_tier: 'retail' }),
      })
      sale_items.push(...items)
      saleId++
    }
  }
  // One quotation (never counted as a sale)
  sales.push({ id: saleId++, shop_id: SHOP, customer_id: 2, total_amount: 52000, discount: 0, paid_amount: 0, payment_type: 'quotation', sale_type: 'quotation', status: 'completed', created_by: 'Demo Owner', created_at: iso(atDay(now, 2, 15, 30)) })

  // Customer payments toward udhaar (never more than owed)
  const owed = {}
  for (const c of customers) owed[c.id] = c._opening
  for (const s of sales) if (s.sale_type === 'sale' && s.customer_id) owed[s.customer_id] += Math.max(0, s.total_amount - s.discount - s.paid_amount)
  for (const c of customers) {
    if (owed[c.id] <= 0 || c.id === 3) continue // Rashid keeps an old balance (shows in reminders)
    const amt = Math.round((owed[c.id] * 0.5) / 100) * 100
    if (amt <= 0) continue
    customer_payments.push({ id: cpId++, shop_id: SHOP, customer_id: c.id, amount: amt, payment_type: 'payment', payment_mode: r() < 0.5 ? 'cash' : 'easypaisa', note: 'Payment received', created_at: iso(atDay(now, 1, 17, 15)) })
    owed[c.id] -= amt
  }
  for (const c of customers) { c.outstanding_balance = owed[c.id]; delete c._opening }

  // ── Purchases from suppliers ──
  const purchases = []
  const purchase_items = []
  let purId = 501, piId = 1
  const buy = (supplierId, daysAgo, rows, paid, type) => {
    let total = 0
    for (const [pid, qty] of rows) {
      const p = products[pid - 1]
      total += p.cost_price * qty
      purchase_items.push({ id: piId++, purchase_id: purId, shop_id: SHOP, product_id: p.id, product_name: p.name, quantity: qty, unit_price: p.cost_price, total_price: p.cost_price * qty, returned_qty: 0 })
    }
    purchases.push({ id: purId, shop_id: SHOP, supplier_id: supplierId, total_amount: total, discount: 0, paid_amount: paid === 'all' ? total : paid, payment_type: type, status: 'completed', created_by: 'Demo Owner', created_at: iso(atDay(now, daysAgo, 12, 0)) })
    purId++
    return total
  }
  const owedSup = {}
  for (const s of suppliers) owedSup[s.id] = s._opening
  let t = buy(1, 9, [[1, 6], [6, 3], [22, 4]], 0, 'credit'); owedSup[1] += t
  t = buy(2, 6, [[2, 5], [4, 10], [17, 8]], 'all', 'cash')
  supplier_payments.push({ id: spId++, shop_id: SHOP, supplier_id: 2, amount: t, payment_type: 'payment', payment_mode: 'cash', note: 'Cash purchase', created_at: iso(atDay(now, 6, 12, 0)) })
  t = buy(3, 3, [[13, 500], [14, 300], [15, 200], [16, 150]], 20000, 'credit'); owedSup[3] += t - 20000
  supplier_payments.push({ id: spId++, shop_id: SHOP, supplier_id: 3, amount: 20000, payment_type: 'payment', payment_mode: 'bank', note: 'Part payment', created_at: iso(atDay(now, 3, 12, 0)) })
  supplier_payments.push({ id: spId++, shop_id: SHOP, supplier_id: 1, amount: 15000, payment_type: 'payment', payment_mode: 'cash', note: 'Payment', created_at: iso(atDay(now, 0, 11, 30)) })
  owedSup[1] -= 15000
  for (const s of suppliers) { s.outstanding_balance = owedSup[s.id]; delete s._opening }

  // ── Expenses ──
  let exId = 1
  const expenses = [
    [0, 'Tea / Food', 350, 'Chai for staff'], [1, 'Transport', 1200, 'Rickshaw for delivery'], [3, 'Utility Bills', 6800, 'Electricity bill'],
    [5, 'Tea / Food', 400, ''], [8, 'Salary', 25000, 'Helper salary'], [10, 'Misc', 750, 'Shop cleaning'],
  ].map(([d, category, amount, note]) => ({ id: exId++, shop_id: SHOP, category, amount, note, created_at: iso(atDay(now, d, 13, 0)) }))

  const shop = {
    id: SHOP, name: 'Demo Sanitary Store', phone: '0300-0000000', address: 'Main Bazaar, Lahore',
    invoice_footer: 'Thank you! Goods once sold can be exchanged within 7 days with the bill.',
    invoice_prefix: 'DEMO', print_template: '5', print_size: '80mm', bill_page_full: true, status: 'active',
  }
  const users = [{ id: 'demo-owner', shop_id: SHOP, username: 'demo', role: 'admin', name: 'Demo Owner', permissions: [] }]

  return { shop, users, categories, brands, products, customers, suppliers, sales, sale_items, customer_payments, supplier_payments, purchases, purchase_items, expenses }
}
