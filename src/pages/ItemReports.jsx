import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { fetchAllRows } from '../services/fetchAll'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { isDemoMode } from '../utils/demoFlag'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import EmptyState from '../components/EmptyState'
import FilterBar from '../components/FilterBar'
import { buildItemReport, summarizeItemReport, SLOW_DAYS, COVER_DAYS, REORDER_BELOW_DAYS } from '../utils/itemReport'

// ============================================================================
// Item report: profit per item, reorder list (from the last N days of sales),
// and slow / dead stock with the money tied up in it.
// ============================================================================

const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`
const items = (n) => `${n} item${n === 1 ? '' : 's'}`
const TABS = [
  ['profit', '💰 Profit per item'],
  ['reorder', '🛒 Reorder'],
  ['stuck', '🐌 Slow & dead stock'],
]

export default function ItemReports() {
  const { user } = useAuth()
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState('profit')
  const [search, setSearch] = useState('')
  const [data, setData] = useState(null) // { products, items, saleDates }
  const [fromCache, setFromCache] = useState(false)

  useEffect(() => {
    if (!user?.shop_id) return
    let alive = true
    const load = async () => {
      setData(null)
      setFromCache(false)
      const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1))
      const startISO = start.toISOString()
      try {
        if (!navigator.onLine || isDemoMode()) throw new Error('Offline')
        const [pRes, iRes] = await Promise.all([
          fetchAllRows(() => supabase.from('products').select('id, name, brand, sku, stock_quantity, cost_price, sale_price').eq('shop_id', user.shop_id)),
          fetchAllRows(() => supabase.from('sale_items')
            .select('product_id, sale_id, quantity, returned_qty, unit_price, cost_price, sales!inner(created_at, sale_type, shop_id)')
            .eq('sales.shop_id', user.shop_id).eq('sales.sale_type', 'sale').gte('sales.created_at', startISO)),
        ])
        if (pRes.error) throw pRes.error
        if (iRes.error) throw iRes.error
        const saleDates = {}
        const items = (iRes.data || []).map(({ sales: s, ...rest }) => { if (s?.created_at) saleDates[String(rest.sale_id)] = new Date(s.created_at); return rest })
        if (alive) setData({ products: pRes.data || [], items, saleDates })
      } catch {
        // This device's saved data
        const sid = String(user.shop_id)
        const [lP, lS, lI] = await Promise.all([db.products.toArray(), db.sales.toArray(), db.sale_items.toArray()])
        const sales = lS.filter(s => String(s.shop_id) === sid && s.sale_type !== 'quotation' && new Date(s.created_at) >= start)
        const saleDates = Object.fromEntries(sales.map(s => [String(s.id), new Date(s.created_at)]))
        const items = lI.filter(i => saleDates[String(i.sale_id)])
        if (alive) { setData({ products: lP.filter(p => String(p.shop_id) === sid), items, saleDates }); setFromCache(!isDemoMode()) }
      }
    }
    load()
    return () => { alive = false }
  }, [user?.shop_id, days])

  const rows = useMemo(() => data ? buildItemReport({ products: data.products, items: data.items, saleDate: (id) => data.saleDates[String(id)], days }) : [], [data, days])
  const totals = useMemo(() => summarizeItemReport(rows), [rows])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (r) => !q || `${r.product.name} ${r.product.brand || ''} ${r.product.sku || ''}`.toLowerCase().includes(q)
    if (tab === 'profit') return rows.filter(r => r.qty > 0 && match(r)).sort((a, b) => b.profit - a.profit)
    if (tab === 'reorder') return rows.filter(r => r.reorder > 0 && match(r)).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    return rows.filter(r => (r.status === 'dead' || r.status === 'slow') && match(r)).sort((a, b) => b.stockValue - a.stockValue)
  }, [rows, tab, search])
  const tabTotal = tab === 'profit' ? rows.filter(r => r.qty > 0).length : tab === 'reorder' ? totals.reorderCount : totals.deadCount + totals.slowCount

  if (!hasFeature('reports')) return <UpgradeWall feature="reports" />

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">📦 Item report</h1>
          <p className="text-sm text-fg-muted">What each product earns, what to reorder, and what is stuck on the shelf.</p>
        </div>
        <div className="flex gap-1 bg-surface rounded-xl border border-line p-1 self-start" role="group" aria-label="Period">
          {[30, 60, 90].map(d => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
              className={`min-h-9 px-3 rounded-lg text-sm font-bold ${days === d ? 'bg-primary text-white' : 'text-fg-3 hover:bg-surface-2'}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {fromCache && <p className="text-sm rounded-xl px-4 py-2 bg-warning-soft text-warning-strong border border-warning-line">From this device's saved data (no connection to the server).</p>}

      {data === null ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 rounded-2xl bg-surface-3" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border p-4 bg-success-soft border-success-line text-success-strong">
              <p className="text-xs font-bold">Profit on items ({days} days)</p>
              <p className="text-xl font-black tabular-nums">{rs(totals.profit)}</p>
              <p className="text-xs opacity-80">on sales of {rs(totals.revenue)}</p>
            </div>
            <button type="button" onClick={() => setTab('reorder')} className="text-left rounded-2xl border p-4 bg-primary-soft border-primary-line text-primary-strong">
              <p className="text-xs font-bold">To reorder</p>
              <p className="text-xl font-black">{items(totals.reorderCount)}</p>
              <p className="text-xs opacity-80">under {REORDER_BELOW_DAYS} days of stock left</p>
            </button>
            <button type="button" onClick={() => setTab('stuck')} className="text-left rounded-2xl border p-4 bg-danger-soft border-danger-line text-danger-strong">
              <p className="text-xs font-bold">Dead stock (no sale in {days} days)</p>
              <p className="text-xl font-black tabular-nums">{rs(totals.deadValue)}</p>
              <p className="text-xs opacity-80">{items(totals.deadCount)}</p>
            </button>
            <button type="button" onClick={() => setTab('stuck')} className="text-left rounded-2xl border p-4 bg-warning-soft border-warning-line text-warning-strong">
              <p className="text-xs font-bold">Slow stock (over {SLOW_DAYS} days left)</p>
              <p className="text-xl font-black tabular-nums">{rs(totals.slowValue)}</p>
              <p className="text-xs opacity-80">{items(totals.slowCount)}</p>
            </button>
          </div>

          <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Report">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`min-h-10 px-4 rounded-full text-sm font-bold border ${tab === id ? 'bg-primary text-white border-primary' : 'bg-surface text-fg-3 border-line hover:bg-surface-2'}`}>
                {label}
              </button>
            ))}
          </div>

          <FilterBar shown={list.length} total={tabTotal} noun="items" active={!!search} onClear={() => setSearch('')}>
            <input className="input w-full" type="search" placeholder="Search product, brand or barcode" aria-label="Search items" value={search} onChange={e => setSearch(e.target.value)} />
          </FilterBar>

          {tab === 'reorder' && list.length > 0 && (
            <p className="text-xs text-fg-muted">Suggested quantity = enough for {COVER_DAYS} days at the speed it sold in the last {days} days, minus what is in stock. <Link to="/inventory" className="font-bold text-primary-fg underline">Inventory → Reorder</Link> sends the order to suppliers on WhatsApp.</p>
          )}

          {list.length === 0 ? (
            <EmptyState icon={tab === 'reorder' ? '✅' : tab === 'stuck' ? '🎉' : '📭'}
              title={search ? 'No item matches your search' : tab === 'reorder' ? 'Nothing needs reordering' : tab === 'stuck' ? 'No slow or dead stock' : `No sales in the last ${days} days`}
              text={tab === 'profit' && !search ? 'Profit per item appears here once you make sales.' : undefined} />
          ) : (
            <>
              <ul className="md:hidden space-y-2">
                {list.map(r => (
                  <li key={r.product.id} className="card p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-fg leading-snug">{r.product.name}</p>
                        <p className="text-xs text-fg-muted">{r.product.brand || '—'} · stock {r.stock}{r.daysLeft != null ? ` · ${r.daysLeft} days left` : ''}</p>
                      </div>
                      {tab === 'profit' && <p className={`font-black tabular-nums shrink-0 ${r.profit >= 0 ? 'text-success-fg' : 'text-danger-fg'}`}>{rs(r.profit)}</p>}
                      {tab === 'reorder' && <p className="font-black text-primary-fg shrink-0">Order {r.reorder}</p>}
                      {tab === 'stuck' && <span className={`badge ${r.status === 'dead' ? 'badge-danger' : 'badge-warning'} shrink-0`}>{r.status === 'dead' ? 'Dead' : 'Slow'}</span>}
                    </div>
                    <p className="text-xs text-fg-3 mt-1">
                      {tab === 'profit' && <>Sold {r.qty} · sales {rs(r.revenue)} · margin {r.margin ?? '—'}%{r.costMissing ? ' · ⚠️ no cost price' : ''}</>}
                      {tab === 'reorder' && <>Sells {r.perDay}/day · sold {r.qty} in {days} days</>}
                      {tab === 'stuck' && <>{rs(r.stockValue)} on the shelf · {r.lastSold ? `last sold ${r.lastSold.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })}` : `no sale in ${days} days`}</>}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden md:block card p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-xs uppercase text-fg-muted">
                    <tr>
                      <th className="px-4 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-right">Stock</th>
                      {tab === 'profit' && <><th className="px-3 py-2 text-right">Sold</th><th className="px-3 py-2 text-right">Sales</th><th className="px-3 py-2 text-right">Profit</th><th className="px-3 py-2 text-right">Margin</th></>}
                      {tab === 'reorder' && <><th className="px-3 py-2 text-right">Sells / day</th><th className="px-3 py-2 text-right">Days left</th><th className="px-3 py-2 text-right">Order</th></>}
                      {tab === 'stuck' && <><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Value on shelf</th><th className="px-3 py-2 text-right">Last sold</th></>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-subtle">
                    {list.map(r => (
                      <tr key={r.product.id} className="hover:bg-surface-2">
                        <td className="px-4 py-2"><span className="font-semibold text-fg">{r.product.name}</span> <span className="text-xs text-fg-subtle">{r.product.brand || ''}</span>{r.costMissing && tab === 'profit' && <span className="ml-2 badge badge-warning">no cost price</span>}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.stock}</td>
                        {tab === 'profit' && <>
                          <td className="px-3 py-2 text-right tabular-nums">{r.qty}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rs(r.revenue)}</td>
                          <td className={`px-3 py-2 text-right font-bold tabular-nums ${r.profit >= 0 ? 'text-success-fg' : 'text-danger-fg'}`}>{rs(r.profit)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.margin ?? '—'}%</td>
                        </>}
                        {tab === 'reorder' && <>
                          <td className="px-3 py-2 text-right tabular-nums">{r.perDay}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.daysLeft ?? '—'}</td>
                          <td className="px-3 py-2 text-right font-black text-primary-fg tabular-nums">{r.reorder}</td>
                        </>}
                        {tab === 'stuck' && <>
                          <td className="px-3 py-2"><span className={`badge ${r.status === 'dead' ? 'badge-danger' : 'badge-warning'}`}>{r.status === 'dead' ? 'Dead' : `Slow · ${r.daysLeft} days`}</span></td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums">{rs(r.stockValue)}</td>
                          <td className="px-3 py-2 text-right text-fg-muted">{r.lastSold ? r.lastSold.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' }) : '—'}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="text-[11px] text-fg-subtle">Sales and profit are per item line, before any whole-bill discount. Returned quantities are not counted.</p>
        </>
      )}
    </div>
  )
}
