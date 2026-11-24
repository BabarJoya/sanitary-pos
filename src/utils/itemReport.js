// ============================================================================
// Item report: what each product earned, how fast it moves, what is sitting
// dead on the shelf, and how much to reorder. Pure — no imports — so it is
// unit-tested (tests/itemReport.test.js).
//
// Revenue and profit are per line (unit price × quantity kept, after returns),
// i.e. before any whole-bill discount. Cost uses the line's cost_price, else
// the product's current cost.
// ============================================================================

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const r2 = (n) => Math.round(n * 100) / 100

export const SLOW_DAYS = 90   // more than this many days of stock left → slow
export const COVER_DAYS = 30  // reorder up to this many days of sales
export const REORDER_BELOW_DAYS = 14 // reorder when fewer days of stock than this are left

/**
 * products: [{ id, name, brand, stock_quantity, cost_price, sale_price }]
 * items:    sale_items of completed sales in the period [{ product_id, quantity, returned_qty, unit_price, cost_price, sale_id }]
 * saleDate: (sale_id) => Date of that sale (for "last sold")
 * days:     length of the period in days
 */
export function buildItemReport({ products = [], items = [], saleDate = () => null, days = 30, coverDays = COVER_DAYS }) {
  const period = Math.max(1, Number(days) || 30)
  const by = new Map()
  for (const it of items) {
    const key = String(it.product_id ?? '')
    if (!key) continue
    const kept = Math.max(0, num(it.quantity) - num(it.returned_qty))
    const row = by.get(key) || { qty: 0, revenue: 0, cost: 0, noCost: 0, last: null }
    row.qty += kept
    row.revenue += num(it.unit_price) * kept
    if (kept > 0) {
      const unitCost = num(it.cost_price)
      if (unitCost > 0) row.cost += unitCost * kept
      else row.noCost += kept
      const d = saleDate(it.sale_id)
      if (d && (!row.last || d > row.last)) row.last = d
    }
    by.set(key, row)
  }

  return products.map(p => {
    const s = by.get(String(p.id)) || { qty: 0, revenue: 0, cost: 0, noCost: 0, last: null }
    const stock = num(p.stock_quantity)
    const productCost = num(p.cost_price)
    const cost = s.cost + s.noCost * productCost
    const profit = s.revenue - cost
    const perDay = s.qty / period
    const daysLeft = perDay > 0 ? stock / perDay : (stock > 0 ? Infinity : 0)
    let status
    if (stock <= 0 && s.qty === 0) status = 'none'
    else if (s.qty === 0) status = 'dead'
    else if (daysLeft > SLOW_DAYS) status = 'slow'
    else status = 'moving'
    const reorder = perDay > 0 && daysLeft < REORDER_BELOW_DAYS ? Math.max(0, Math.ceil(perDay * coverDays - stock)) : 0
    return {
      product: p,
      qty: r2(s.qty),
      revenue: r2(s.revenue),
      cost: r2(cost),
      profit: r2(profit),
      margin: s.revenue > 0 ? Math.round((profit / s.revenue) * 100) : null,
      perDay: r2(perDay),
      daysLeft: Number.isFinite(daysLeft) ? Math.round(daysLeft) : null,
      lastSold: s.last,
      stock,
      stockValue: r2(Math.max(0, stock) * productCost),
      status,
      reorder,
      costMissing: s.qty > 0 && s.noCost > 0 && productCost <= 0,
    }
  })
}

// Totals for the cards at the top
export function summarizeItemReport(rows) {
  const t = { revenue: 0, profit: 0, deadCount: 0, deadValue: 0, slowCount: 0, slowValue: 0, reorderCount: 0 }
  for (const r of rows) {
    t.revenue += r.revenue
    t.profit += r.profit
    if (r.status === 'dead') { t.deadCount += 1; t.deadValue += r.stockValue }
    if (r.status === 'slow') { t.slowCount += 1; t.slowValue += r.stockValue }
    if (r.reorder > 0) t.reorderCount += 1
  }
  for (const k of ['revenue', 'profit', 'deadValue', 'slowValue']) t[k] = r2(t[k])
  return t
}
