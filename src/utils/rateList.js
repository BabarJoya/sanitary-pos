// ============================================================================
// Supplier rate list: read the rows of a supplier's Excel / CSV price list,
// match each line to a product (barcode/SKU first, then name — spelling
// mistakes allowed) and show where the cost price changed.
// Pure, apart from the shared search helpers — unit-tested.
// ============================================================================
import { normalize, buildSearchIndex, searchProducts } from './productSearch.js'

const NAME_COLS = ['item', 'item name', 'product', 'product name', 'name', 'description', 'particulars', 'article', 'items']
const CODE_COLS = ['sku', 'barcode', 'code', 'item code', 'product code', 'article no', 'art no', 'part no']
const RATE_COLS = ['rate', 'price', 'cost', 'cost price', 'trade price', 'tp', 'new rate', 'net rate', 'dealer price', 'unit price', 'rate rs', 'price rs']

const pick = (keys, wanted) => {
  const norm = keys.map(k => [k, normalize(k)])
  for (const w of wanted) { const hit = norm.find(([, n]) => n === w); if (hit) return hit[0] }
  for (const w of wanted) { const hit = norm.find(([, n]) => n.includes(w)); if (hit) return hit[0] }
  return null
}

const toNumber = (v) => {
  if (typeof v === 'number') return v
  const n = Number(String(v ?? '').replace(/rs\.?|pkr|,|\s/gi, ''))
  return Number.isFinite(n) ? n : NaN
}

// rows: array of objects from the sheet (first row = headings)
export function parseRateRows(rows) {
  const keys = Object.keys(rows?.[0] || {})
  const nameCol = pick(keys, NAME_COLS)
  const codeCol = pick(keys, CODE_COLS)
  const rateCol = pick(keys, RATE_COLS)
  if (!rateCol || (!nameCol && !codeCol)) {
    return { entries: [], error: 'Could not find the columns. The sheet needs an item name (or code) column and a rate / price column.' }
  }
  const entries = []
  for (const r of rows) {
    const name = String(r[nameCol] ?? '').trim()
    const code = String(r[codeCol] ?? '').trim()
    const rate = toNumber(r[rateCol])
    if ((!name && !code) || !(rate > 0)) continue
    entries.push({ name, code, rate })
  }
  return { entries, columns: { name: nameCol, code: codeCol, rate: rateCol } }
}

/**
 * Compare entries with products. Returns
 *  matched:   [{ entry, product, oldCost, newCost, change, changePct, how }]  (how: 'code' | 'name' | 'close')
 *  unmatched: entries with no product
 */
export function compareRateList(products, entries) {
  const byCode = new Map()
  for (const p of products) {
    const c = normalize(p.sku || '').replace(/\s+/g, '')
    if (c) byCode.set(c, p)
  }
  const byName = new Map(products.map(p => [normalize(p.name), p]))
  const index = buildSearchIndex(products)
  const used = new Set()
  const matched = []
  const unmatched = []
  for (const e of entries) {
    let product = null, how = null
    const code = normalize(e.code).replace(/\s+/g, '')
    if (code && byCode.has(code)) { product = byCode.get(code); how = 'code' }
    if (!product && e.name && byName.has(normalize(e.name))) { product = byName.get(normalize(e.name)); how = 'name' }
    if (!product && e.name) {
      const hits = searchProducts(index, e.name)
      if (hits.length === 1 || (hits.length > 1 && normalize(hits[0].name).split(' ').length === normalize(e.name).split(' ').length)) {
        product = hits[0]; how = 'close'
      }
    }
    if (!product || used.has(product.id)) { unmatched.push(e); continue }
    used.add(product.id)
    const oldCost = Number(product.cost_price) || 0
    const change = Math.round((e.rate - oldCost) * 100) / 100
    matched.push({ entry: e, product, oldCost, newCost: e.rate, change, changePct: oldCost > 0 ? Math.round((change / oldCost) * 1000) / 10 : null, how })
  }
  return { matched, unmatched }
}
