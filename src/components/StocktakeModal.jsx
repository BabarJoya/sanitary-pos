import { useMemo, useState } from 'react'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { adjustStock, isTempId, toIntId } from '../services/integrity'
import { recordAuditLog } from '../services/auditService'
import { printHTML, getShopBranding, brandedA4Header } from '../utils/printUtils'

// ============================================================================
// Stock count (stocktake): enter what is on the shelf for many products at once.
// Only the difference from the server's current stock is applied (an atomic
// change with reason 'stocktake'), so sales made during the count are kept.
// ============================================================================

const fmt = (n) => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 3 })

export default function StocktakeModal({ products, user, onClose, onDone }) {
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({}) // productId -> counted string
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(p => `${p.name} ${p.brand || ''} ${p.sku || ''}`.toLowerCase().includes(q))
  }, [products, search])

  const changed = products
    .filter(p => counts[p.id] !== undefined && counts[p.id] !== '' && Number(counts[p.id]) !== Number(p.stock_quantity || 0))
    .map(p => {
      const counted = Number(counts[p.id])
      const diff = Math.round((counted - Number(p.stock_quantity || 0)) * 1000) / 1000
      return { p, counted, diff, value: diff * (Number(p.cost_price) || 0) }
    })
  const varianceValue = changed.reduce((s, c) => s + c.value, 0)

  const printSheet = () => {
    const branding = getShopBranding(user?.shop_id)
    const rows = (changed.length ? changed : products.map(p => ({ p, counted: '', diff: '', value: '' })))
      .map(c => `<tr><td>${c.p.name}</td><td>${c.p.brand || ''}</td><td style="text-align:right">${fmt(c.p.stock_quantity)}</td>
        <td style="text-align:right">${c.counted === '' ? '' : fmt(c.counted)}</td>
        <td style="text-align:right">${c.diff === '' ? '' : (c.diff > 0 ? '+' : '') + fmt(c.diff)}</td>
        <td style="text-align:right">${c.value === '' ? '' : Math.round(c.value).toLocaleString()}</td></tr>`).join('')
    printHTML(`<html><head><title>Stock Count</title><style>
      @page{size:A4 portrait;margin:12mm} body{font-family:'Segoe UI',sans-serif;font-size:12px}
      table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px} th{background:#f1f5f9;text-align:left}
    </style></head><body>
      ${brandedA4Header(branding, changed.length ? 'Stock Count — Differences' : 'Stock Count Sheet', new Date().toLocaleString('en-PK'))}
      <table><thead><tr><th>Product</th><th>Brand</th><th>System</th><th>Counted</th><th>Difference</th><th>Value (cost)</th></tr></thead>
      <tbody>${rows}</tbody></table>
      ${changed.length ? `<p><b>Total difference at cost: Rs. ${Math.round(varianceValue).toLocaleString()}</b></p>` : ''}
    </body></html>`)
  }

  const save = async () => {
    if (changed.length === 0) { alert('Koi farq nahi — counted quantity likhein.'); return }
    if (!confirm(`${changed.length} product(s) ka stock count ke mutabiq set ho jayega.\nFarq (cost par): Rs. ${Math.round(varianceValue).toLocaleString()}\n\nContinue?`)) return
    setSaving(true)
    const failed = []
    const applied = []
    try {
      // Live stock for the changed products (sales may have happened during the count)
      const live = {}
      const ids = changed.map(c => toIntId(c.p.id)).filter(id => id != null)
      if (navigator.onLine) {
        for (let k = 0; k < ids.length; k += 150) {
          const { data } = await supabase.from('products').select('id, stock_quantity').in('id', ids.slice(k, k + 150))
          for (const r of data || []) live[String(r.id)] = Number(r.stock_quantity) || 0
        }
      }
      for (const c of changed) {
        let current = live[String(c.p.id)]
        if (current === undefined || isTempId(String(c.p.id))) {
          const local = await db.products.get(c.p.id).catch(() => null)
          current = Number(local?.stock_quantity ?? c.p.stock_quantity) || 0
        }
        const delta = Math.round((c.counted - current) * 1000) / 1000
        if (delta === 0) continue
        const r = await adjustStock(c.p.id, delta, { reason: 'stocktake', note: note || 'Stock count', createdBy: user.username })
        if (r.ok) applied.push({ product: c.p.name, old_stock: current, new_stock: c.counted, change: delta })
        else failed.push(c.p.name)
      }
      await recordAuditLog('STOCKTAKE', 'products', null, { note: note || 'Stock count', lines: applied }, user.id, user.shop_id)
      if (failed.length) alert(`Count saved, but these failed: ${failed.join(', ')}`)
      else alert(`✅ Stock count saved for ${applied.length} product(s).`)
      onDone?.()
    } catch (err) {
      alert('Stock count save nahi hua: ' + (err?.message || String(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="stocktake-title">
      <div className="modal-panel bg-surface w-full max-w-3xl max-h-[90dvh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-2xl">
        <div className="p-4 border-b border-line flex items-start justify-between gap-3">
          <div>
            <h2 id="stocktake-title" className="text-lg font-bold text-fg">📋 Stock Count</h2>
            <p className="text-xs text-fg-muted">Shelf par jitna maal hai woh likhein. Sirf farq apply hoga — count ke dauran hui sales mehfooz rehti hain.</p>
          </div>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg text-2xl leading-none p-2" aria-label="Close">×</button>
        </div>
        <div className="p-4 border-b border-line flex flex-col sm:flex-row gap-2">
          <input className="input flex-1" placeholder="Search product, brand or SKU" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search products" />
          <input className="input flex-1" placeholder="Note (e.g. Month-end count)" value={note} onChange={e => setNote(e.target.value)} aria-label="Count note" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-line-subtle">
          {visible.map(p => {
            const val = counts[p.id] ?? ''
            const diff = val === '' ? null : Math.round((Number(val) - Number(p.stock_quantity || 0)) * 1000) / 1000
            return (
              <div key={p.id} className="px-4 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-fg truncate">{p.name}</p>
                  <p className="text-xs text-fg-muted">{p.brand || '—'} · System: {fmt(p.stock_quantity)}</p>
                </div>
                {diff !== null && diff !== 0 && (
                  <span className={`text-xs font-bold ${diff > 0 ? 'text-success-fg' : 'text-danger-fg'}`}>{diff > 0 ? '+' : ''}{fmt(diff)}</span>
                )}
                <input type="number" inputMode="decimal" step="any" min="0" value={val}
                  onChange={e => setCounts(prev => ({ ...prev, [p.id]: e.target.value }))}
                  className="input w-24 text-right" placeholder={fmt(p.stock_quantity)} aria-label={`Counted quantity for ${p.name}`} />
              </div>
            )
          })}
          {visible.length === 0 && <p className="p-6 text-center text-fg-subtle text-sm">No products match.</p>}
        </div>
        <div className="p-4 border-t border-line flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="text-sm text-fg-2 flex-1">
            {changed.length} changed · difference at cost <b className={varianceValue < 0 ? 'text-danger-fg' : 'text-fg'}>Rs. {Math.round(varianceValue).toLocaleString()}</b>
          </p>
          <button type="button" onClick={printSheet} className="btn btn-secondary">🖨️ {changed.length ? 'Print differences' : 'Print count sheet'}</button>
          <button type="button" onClick={save} disabled={saving || changed.length === 0} className="btn btn-primary disabled:opacity-50">
            {saving ? 'Saving…' : 'Save count'}
          </button>
        </div>
      </div>
    </div>
  )
}
