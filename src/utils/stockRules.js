// ============================================================================
// One low-stock rule for POS, Inventory, Products, Categories and Dashboard.
//
// Threshold order: the product's own threshold (0 allowed) → its category's
// threshold → the shop default (10).
// ============================================================================

export const DEFAULT_LOW_STOCK = 10

const isSet = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))

// categories: array of { id, low_stock_threshold } or a Map/object keyed by id
export function getLowStockThreshold(product, categories, shopDefault = DEFAULT_LOW_STOCK) {
  if (isSet(product?.low_stock_threshold)) return Number(product.low_stock_threshold)
  const catId = product?.category_id
  if (catId != null && categories) {
    const cat = Array.isArray(categories)
      ? categories.find(c => String(c.id) === String(catId))
      : (categories instanceof Map ? categories.get(String(catId)) : categories[String(catId)])
    const t = cat?.low_stock_threshold ?? cat
    if (isSet(t) && typeof t !== 'object') return Number(t)
  }
  return shopDefault
}

export const isOutOfStock = (product) => !(Number(product?.stock_quantity) > 0)

export const isLowStock = (product, categories, shopDefault) =>
  Number(product?.stock_quantity || 0) <= getLowStockThreshold(product, categories, shopDefault)

// "Critical" = out of stock, or at most half the threshold (never above 5)
export const isCriticalStock = (product, categories, shopDefault) => {
  const qty = Number(product?.stock_quantity || 0)
  if (qty <= 0) return true
  return qty <= Math.min(5, Math.floor(getLowStockThreshold(product, categories, shopDefault) / 2))
}
