import { useMemo, useState } from 'react'
import { Modal } from './ui'
import { supabase } from '../services/supabase'
import { db, addToSyncQueue } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import { parseRateRows, compareRateList } from '../utils/rateList'
import toast from '../utils/toast'

// ============================================================================
// Inventory → Supplier rate list: import a supplier's Excel / CSV price list,
// see which cost prices changed, tick the ones to apply. Optionally move the
// sale price too so the profit margin stays the same.
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`

export default function RateListImport({ open, onClose, products, user, onApplied }) {
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState(null) // { matched, unmatched }
  const [picked, setPicked] = useState({})
  const [changedOnly, setChangedOnly] = useState(true)
  const [keepMargin, setKeepMargin] = useState(false)
  const [saving, setSaving] = useState(false)

  const reset = () => { setFileName(''); setResult(null); setPicked({}); setChangedOnly(true); setKeepMargin(false) }
  const close = () => { reset(); onClose() }

  const readFile = async (file) => {
    if (!file) return
    setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const { entries, error } = parseRateRows(rows)
      if (error) { toast.warning(error); setResult(null); return }
      const res = compareRateList(products, entries)
      setResult(res)
      setPicked(Object.fromEntries(res.matched.filter(m => m.change !== 0).map(m => [m.product.id, true])))
      toast.info(`${res.matched.length} items matched, ${res.unmatched.length} not found in your products.`)
    } catch (e) {
      toast.error('Could not read this file: ' + (e?.message || e))
    }
  }

  const newSaleOf = (m) => {
    const sale = Number(m.product.sale_price) || 0
    if (!keepMargin || !(m.oldCost > 0) || !(sale > 0)) return null
    return Math.round((sale * m.newCost) / m.oldCost)
  }

  const rows = useMemo(() => (result?.matched || []).filter(m => !changedOnly || m.change !== 0), [result, changedOnly])
  const ups = (result?.matched || []).filter(m => m.change > 0).length
  const downs = (result?.matched || []).filter(m => m.change < 0).length
  const chosen = (result?.matched || []).filter(m => picked[m.product.id] && m.change !== 0)

  const apply = async () => {
    if (!chosen.length) return
    setSaving(true)
    let offline = !navigator.onLine
    try {
      for (const m of chosen) {
        const fields = { cost_price: m.newCost }
        const sale = newSaleOf(m)
        if (sale != null) fields.sale_price = sale
        if (!offline) {
          const { error } = await supabase.from('products').update(fields).eq('id', m.product.id)
          if (error) {
            if (/Failed to fetch|NetworkError|Load failed/i.test(error.message || '')) offline = true
            else throw error
          }
        }
        if (offline) await addToSyncQueue('products', 'UPDATE', { id: m.product.id, ...fields })
        await db.products.update(m.product.id, fields).catch(() => {})
        try {
          await recordAuditLog('PRICE_CHANGE', 'products', m.product.id, {
            source: 'supplier_rate_list', file: fileName,
            old: { cost: m.oldCost, ...(sale != null ? { sale: m.product.sale_price } : {}) },
            new: { cost: m.newCost, ...(sale != null ? { sale } : {}) },
          }, user.id, user.shop_id)
        } catch { /* audit is best-effort */ }
      }
      toast.success(`${chosen.length} cost price${chosen.length === 1 ? '' : 's'} updated${offline ? ' on this device — will sync' : ''}`)
      onApplied?.()
      close()
    } catch (e) {
      toast.error('Update failed: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={close} title="📥 Supplier rate list" maxWidth="max-w-3xl" dismissible={false}
      subtitle="Upload the supplier's Excel or CSV price list — see which cost prices changed, then apply the ones you tick"
      footer={result ? <>
        <button type="button" className="btn btn-secondary min-h-11" onClick={close}>Cancel</button>
        <button type="button" className="btn btn-primary min-h-11 sm:min-w-48" disabled={saving || chosen.length === 0} onClick={apply}>
          {saving ? 'Updating…' : chosen.length ? `Update ${chosen.length} cost price${chosen.length === 1 ? '' : 's'}` : 'Tick items to update'}
        </button>
      </> : null}>
      <div className="space-y-3">
        <label className="block">
          <span className="label">Rate list file (.xlsx, .xls, .csv)</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="input w-full" onChange={e => readFile(e.target.files?.[0])} />
        </label>
        {!result && (
          <p className="text-xs text-fg-muted">The sheet needs an item name (or code / barcode) column and a rate / price / trade price column — the column names are found automatically. Items are matched by barcode first, then by name (spelling mistakes allowed).</p>
        )}

        {result && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge badge-danger">{ups} cost up</span>
              <span className="badge badge-success">{downs} cost down</span>
              <span className="badge badge-neutral">{result.matched.length - ups - downs} same</span>
              {result.unmatched.length > 0 && <span className="badge badge-warning">{result.unmatched.length} not found</span>}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm font-semibold text-fg-2 min-h-10 cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} /> Changed prices only
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-fg-2 min-h-10 cursor-pointer">
                <input type="checkbox" className="h-4 w-4" checked={keepMargin} onChange={e => setKeepMargin(e.target.checked)} /> Keep my margin (move sale price too)
              </label>
            </div>

            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-fg-muted card">No cost price changed in this list.</p>
            ) : (
              <ul className="divide-y divide-line-subtle rounded-xl border border-line">
                {rows.map(m => {
                  const sale = newSaleOf(m)
                  return (
                    <li key={m.product.id} className={`flex items-start gap-3 p-3 ${picked[m.product.id] ? 'bg-primary-soft' : ''}`}>
                      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" disabled={m.change === 0} checked={!!picked[m.product.id]}
                        onChange={e => setPicked(prev => ({ ...prev, [m.product.id]: e.target.checked }))} aria-label={`Update ${m.product.name}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-fg leading-snug">{m.product.name}</p>
                        <p className="text-xs text-fg-muted">
                          List: {m.entry.name || m.entry.code}{m.how === 'close' ? ' · close match — check it' : m.how === 'code' ? ' · matched by code' : ''}
                          {sale != null && ` · sale ${rs(m.product.sale_price)} → ${rs(sale)}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm tabular-nums"><span className="text-fg-muted line-through">{rs(m.oldCost)}</span> → <b className="text-fg">{rs(m.newCost)}</b></p>
                        <p className={`text-xs font-bold ${m.change > 0 ? 'text-danger-fg' : m.change < 0 ? 'text-success-fg' : 'text-fg-muted'}`}>
                          {m.change === 0 ? 'same' : `${m.change > 0 ? '+' : '−'}${rs(Math.abs(m.change))}${m.changePct != null ? ` (${m.change > 0 ? '+' : ''}${m.changePct}%)` : ''}`}
                        </p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            {result.unmatched.length > 0 && (
              <details className="card p-0 overflow-hidden">
                <summary className="cursor-pointer px-4 py-2 text-sm font-bold text-warning-strong">Not found in your products ({result.unmatched.length})</summary>
                <ul className="px-4 pb-3 text-sm text-fg-3 space-y-0.5">
                  {result.unmatched.slice(0, 100).map((e, i) => <li key={i}>{e.name || e.code} — {rs(e.rate)}</li>)}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
