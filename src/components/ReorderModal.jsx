import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './ui'
import { db } from '../services/db'
import { getLowStockThreshold, isLowStock } from '../utils/stockRules'
import { openWhatsApp } from '../utils/whatsapp'
import toast from '../utils/toast'

// ============================================================================
// Reorder: low-stock products grouped by supplier, with a suggested quantity
// (enough to reach twice the alert level, rounded up to whole packs). For each
// supplier: send the order on WhatsApp, or save it as a held purchase that
// opens in Purchases ready to receive.
// ============================================================================


function suggestQty(p, categories) {
  const need = Math.max(0, getLowStockThreshold(p, categories) * 2 - Math.max(0, Number(p.stock_quantity) || 0))
  const pack = Number(p.pack_size) || 0
  if (pack > 1) return Math.max(pack, Math.ceil(need / pack) * pack)
  return Math.max(1, Math.ceil(need))
}

export default function ReorderModal({ open, onClose, products, categories, user, shopName, template }) {
  const navigate = useNavigate()
  const low = useMemo(() => products.filter(p => isLowStock(p, categories)), [products, categories])
  const [qty, setQty] = useState({})
  const [skip, setSkip] = useState({})
  const [savedFor, setSavedFor] = useState({})

  const groups = useMemo(() => {
    const g = {}
    for (const p of low) {
      const key = p.supplier_id != null ? String(p.supplier_id) : 'none'
      if (!g[key]) g[key] = { key, supplierId: p.supplier_id ?? null, name: p.suppliers?.name || 'No supplier set', phone: p.suppliers?.phone || '', items: [] }
      g[key].items.push(p)
    }
    return Object.values(g).sort((a, b) => (a.key === 'none') - (b.key === 'none') || a.name.localeCompare(b.name))
  }, [low])

  const qtyOf = (p) => (qty[p.id] !== undefined ? qty[p.id] : String(suggestQty(p, categories)))
  const lines = (grp) => grp.items.filter(p => !skip[p.id] && Number(qtyOf(p)) > 0)

  const sendWhatsApp = (grp) => {
    const items = lines(grp)
    if (!items.length) return toast.warning('Koi item select nahi.')
    const list = items.map(p => {
      const q = Number(qtyOf(p))
      const pack = Number(p.pack_size) > 1 ? ` (${Math.round(q / Number(p.pack_size) * 100) / 100} ${p.pack_name || 'Box'})` : ''
      return `• ${p.name}${p.brand ? ` (${p.brand})` : ''} — ${q}${pack}`
    }).join('\n')
    const tpl = template || 'Assalam-o-Alaikum *[Supplier Name]*! 🙏\n\n*[Shop Name]* se order:\n\n[Items]\n\nMeharbani farma kar jald supply karein. Shukriya!'
    const msg = tpl.replace(/\[Supplier Name\]/g, grp.name).replace(/\[Shop Name\]/g, shopName || 'Shop').replace(/\[Items\]/g, list)
    openWhatsApp({ shopId: user?.shop_id, kind: 'reorder', phone: grp.phone, name: grp.name, text: msg })
  }

  const makeDraft = async (grp) => {
    const items = lines(grp)
    if (!items.length) return toast.warning('Koi item select nahi.')
    const cart = items.map(p => ({ ...p, qty: Number(qtyOf(p)), purchase_price: Number(p.cost_price) || 0 }))
    try {
      await db.held_purchases.add({
        shop_id: user.shop_id,
        supplier_id: grp.supplierId,
        items: JSON.parse(JSON.stringify(cart)),
        total: cart.reduce((s, i) => s + i.qty * i.purchase_price, 0),
        saved_at: new Date().toISOString(),
        note: 'Reorder draft',
      })
      setSavedFor(prev => ({ ...prev, [grp.key]: true }))
    } catch (err) {
      toast.error('Draft save nahi hua: ' + (err?.message || String(err)))
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="📦 Reorder low stock" maxWidth="max-w-2xl">
      {groups.length === 0 ? (
        <p className="py-8 text-center text-fg-muted">🎉 No product is low on stock.</p>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-fg-muted">Suggested quantity fills stock up to twice the alert level, rounded up to whole boxes. Change any number or untick an item.</p>
          {groups.map(grp => (
            <section key={grp.key} className="rounded-xl border border-line">
              <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 py-2 bg-surface-2 rounded-t-xl border-b border-line">
                <div>
                  <h3 className="font-bold text-fg">{grp.name}</h3>
                  <p className="text-xs text-fg-muted">{grp.items.length} item(s){grp.phone ? ` · ${grp.phone}` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => sendWhatsApp(grp)} className="btn btn-secondary btn-sm">💬 WhatsApp order</button>
                  {savedFor[grp.key]
                    ? <button type="button" onClick={() => { onClose(); navigate('/purchases') }} className="btn btn-primary btn-sm">Open in Purchases →</button>
                    : <button type="button" onClick={() => makeDraft(grp)} className="btn btn-primary btn-sm">🛒 Make purchase draft</button>}
                </div>
              </header>
              <ul className="divide-y divide-line-subtle">
                {grp.items.map(p => (
                  <li key={p.id} className="px-3 py-2 flex items-center gap-3">
                    <input type="checkbox" checked={!skip[p.id]} onChange={() => setSkip(prev => ({ ...prev, [p.id]: !prev[p.id] }))} className="w-5 h-5" aria-label={`Include ${p.name}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-fg truncate">{p.name}</p>
                      <p className="text-xs text-fg-muted">Stock {Number(p.stock_quantity) || 0} · alert at {getLowStockThreshold(p, categories)}{Number(p.pack_size) > 1 ? ` · ${p.pack_name || 'Box'} of ${p.pack_size}` : ''}</p>
                    </div>
                    <input type="number" inputMode="decimal" min="0" step="any" value={qtyOf(p)} onChange={e => setQty(prev => ({ ...prev, [p.id]: e.target.value }))}
                      className="input w-24 text-right" aria-label={`Order quantity for ${p.name}`} disabled={!!skip[p.id]} />
                  </li>
                ))}
              </ul>
              {savedFor[grp.key] && <p className="px-3 py-2 text-xs text-success-strong">✓ Saved as a held purchase. Open Purchases → Held to receive it.</p>}
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
