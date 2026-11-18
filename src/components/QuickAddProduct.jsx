import { useState } from 'react'
import { Modal } from './ui'
import { supabase } from '../services/supabase'
import { db, addToSyncQueue } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import toast from '../utils/toast'

// ============================================================================
// POS: a scanned barcode is not in the product list → add the product on the
// spot (barcode, name, sale price, cost, stock) and put it straight in the
// cart. Same save rules as Add Product: online insert, or local + sync queue
// when offline; respects the plan's product limit.
// ============================================================================

export default function QuickAddProduct({ open, barcode, user, showCost, onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', sale_price: '', cost_price: '', stock_quantity: '1' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const save = async (e) => {
    e?.preventDefault()
    const name = form.name.trim()
    const sale = Number(form.sale_price)
    const stock = Number(form.stock_quantity)
    if (!name) { toast.warning('Product ka naam likhein.'); return }
    if (!(sale > 0)) { toast.warning('Sale price likhein.'); return }
    if (!(stock > 0)) { toast.warning('Stock kam se kam 1 rakhein taa ke bill mein add ho sake.'); return }

    // Plan product limit (same check as Add Product)
    try {
      const sid = user?.shop_id
      const limits = JSON.parse((sid ? localStorage.getItem(`plan_limits_${sid}`) : null) || localStorage.getItem('plan_limits') || '{}')
      const count = await db.products.where('shop_id').equals(user.shop_id).count()
      if (limits.product_limit && count >= limits.product_limit) {
        toast.warning(`Limit Reached! Aapka ${limits.plan_name || 'TRIAL'} plan sirf ${limits.product_limit} products ki ijazat deta hai.`)
        return
      }
    } catch { /* limit check is best-effort */ }

    setSaving(true)
    const base = {
      shop_id: user.shop_id, name, sku: String(barcode || '').trim(),
      sale_price: sale, cost_price: Number(form.cost_price) || 0, c_rate: 0,
      stock_quantity: stock, brand: '', category_id: null,
    }
    try {
      let product
      try {
        if (!navigator.onLine) throw new TypeError('Failed to fetch')
        const { data, error } = await supabase.from('products').insert([base]).select().single()
        if (error) throw error
        product = data
        await db.products.put(product)
      } catch (err) {
        if (!/Failed to fetch|NetworkError|Load failed/i.test(err?.message || '') && navigator.onLine) throw err
        product = { ...base, id: crypto.randomUUID() }
        await db.products.add(product)
        await addToSyncQueue('products', 'INSERT', product)
      }
      try {
        await recordAuditLog('PRODUCT_ADDED', 'products', product.id, { name, sku: base.sku, from: 'pos_quick_add' }, user.id, user.shop_id)
      } catch { /* audit is best-effort */ }
      toast.success(`${name} added to products and to the bill`)
      setForm({ name: '', sale_price: '', cost_price: '', stock_quantity: '1' })
      onAdded(product)
    } catch (err) {
      toast.error('Product save nahi hua: ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="➕ New product" subtitle={<>Barcode <b className="font-mono">{barcode}</b> is not in your products</>}
      maxWidth="max-w-sm" dismissible={false}
      footer={<>
        <button type="button" className="btn btn-secondary min-h-11" onClick={onClose}>Cancel</button>
        <button type="submit" form="quick-add-product" className="btn btn-primary min-h-11 sm:min-w-40" disabled={saving}>{saving ? 'Saving…' : 'Save & add to bill'}</button>
      </>}>
      <form id="quick-add-product" onSubmit={save} className="space-y-3">
        <label className="block">
          <span className="label">Product name *</span>
          <input className="input w-full" value={form.name} onChange={set('name')} autoFocus placeholder="e.g. Basin mixer chrome" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Sale price *</span>
            <input className="input w-full" type="number" inputMode="decimal" min="0" value={form.sale_price} onChange={set('sale_price')} />
          </label>
          <label className="block">
            <span className="label">Stock now *</span>
            <input className="input w-full" type="number" inputMode="decimal" min="0" value={form.stock_quantity} onChange={set('stock_quantity')} />
          </label>
        </div>
        {showCost && (
          <label className="block">
            <span className="label">Cost price (for profit)</span>
            <input className="input w-full" type="number" inputMode="decimal" min="0" value={form.cost_price} onChange={set('cost_price')} placeholder="optional" />
          </label>
        )}
        <p className="text-xs text-fg-muted">Brand, category and other details can be added later in Products.</p>
      </form>
    </Modal>
  )
}
