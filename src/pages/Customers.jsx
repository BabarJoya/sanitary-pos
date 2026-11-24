import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { must, isMissingColumn } from '../services/integrity'
import { fetchAllRows } from '../services/fetchAll'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { printHTML, getShopBranding, brandedA4Header } from '../utils/printUtils'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import PasswordModal from '../components/PasswordModal'
import { getShopSettings, isWholesaleEnabled, normalizeTier } from '../utils/businessPresets'
import { openingRow } from '../utils/ledgerMath'
import EmptyState from '../components/EmptyState'
import FilterBar from '../components/FilterBar'
import { can, notAllowed } from '../utils/permissions'
import { openWhatsApp, templateFor, fillTemplate } from '../utils/whatsapp'
import toast from '../utils/toast'

function Customers() {
  const { user } = useAuth()
  const wholesaleEnabled = isWholesaleEnabled(getShopSettings(user?.shop_id))
  const [customers, setCustomers] = useState([])
  const [custSearch, setCustSearch] = useState('')
  const [owesOnly, setOwesOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '', outstanding_balance: 0 })
  const fileInputRef = useRef(null)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])
  const [wipeLedger, setWipeLedger] = useState(false)

  useEffect(() => {
    if (user?.shop_id) fetchCustomers()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads when these inputs change; the fetch functions read current state (listing them would refetch every render)
  }, [user?.shop_id])

  const fetchCustomers = async () => {
    if (!user?.shop_id) {
      setLoading(false)
      console.error('Customers: Missing user.shop_id!')
      return
    }

    const sid = String(user.shop_id)

    // ── Step 1: Show local IndexedDB data IMMEDIATELY (instant UI) ────────────
    try {
      const localData = await db.customers.toArray()
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setCustomers(sorted)
      if (sorted.length > 0) {
        setLoading(false)
      }
    } catch (localErr) {
      console.warn('Customers: Local DB read failed:', localErr)
    }

    // ── Step 2: Background refresh from Supabase (updates UI silently) ────────
    if (!navigator.onLine) {
      setLoading(false)
      return
    }

    try {
      const fetchPromise = fetchAllRows(() => supabase
        .from('customers')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false }))

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.customers.bulkPut(cleanData)
      }

      const localData = await db.customers.toArray()
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setCustomers(sorted)
    } catch (e) {
      console.warn('Customers: Supabase background refresh failed:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    const exportData = customers.map(c => ({
      'Name': c.name,
      'Phone': c.phone || '-',
      'Address': c.address || '-',
      'Outstanding Balance': c.outstanding_balance || 0
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Customers')
    XLSX.writeFile(wb, `Customers_Export_${new Date().toLocaleDateString()}.xlsx`)
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      const bstr = evt.target.result
      const wb = XLSX.read(bstr, { type: 'binary' })
      const wsname = wb.SheetNames[0]
      const ws = wb.Sheets[wsname]
      const data = XLSX.utils.sheet_to_json(ws)

      if (data.length === 0) {
        toast.warning('Empty file!')
        return
      }

      if (!confirm(`Import ${data.length} customers?`)) return

      setLoading(true)
      const formatted = data.map(row => ({
        shop_id: user.shop_id,
        name: row['Name'] || row['name'] || 'New Customer',
        phone: String(row['Phone'] || row['phone'] || '').trim(),
        address: row['Address'] || row['address'] || '',
        outstanding_balance: parseFloat(row['Outstanding Balance'] || row['balance'] || 0)
      }))

      // Deduplicate by phone against already-loaded customers
      const existingPhones = new Set(customers.map(c => c.phone).filter(Boolean))
      const unique = formatted.filter(r => !r.phone || !existingPhones.has(r.phone))
      const skipped = formatted.length - unique.length

      if (unique.length === 0) {
        toast.error('Tamam rows pehle se exist karti hain (phone number match). Kuch import nahi hua.')
        setLoading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      const { data: inserted, error } = await supabase.from('customers').insert(unique).select('id, outstanding_balance')
      if (!error) {
        // Imported balances are old dues: record each as an opening ledger entry
        const obRows = (inserted || []).filter(c => Number(c.outstanding_balance) !== 0)
          .map(c => openingRow({ table: 'customer_payments', shopId: user.shop_id, partyId: c.id, amount: Number(c.outstanding_balance) }))
        for (let k = 0; k < obRows.length; k += 500) {
          const { error: obErr } = await supabase.from('customer_payments').insert(obRows.slice(k, k + 500))
          if (obErr) { toast.error('Customers imported, but opening balance ledger entries failed: ' + obErr.message); break }
        }
      }
      if (error) toast.error(error.message)
      else {
        toast.success(`Customers import ho gaye! ✅ ${unique.length} add${skipped ? `, ${skipped} skip (duplicate phone)` : ''}`)
        fetchCustomers()
      }
      setLoading(false)
    }
    reader.readAsBinaryString(file)
  }

  // WhatsApp payment reminder from the shop's template (Settings → WhatsApp).
  // No server call before opening WhatsApp, so phone browsers do not block it.
  const sendReminder = (c) => {
    const settings = getShopSettings(user?.shop_id)
    const text = fillTemplate(templateFor('reminder', settings), {
      Name: c.name,
      'Shop Name': localStorage.getItem(`shop_name_${user?.shop_id}`) || settings.name || 'our shop',
      Amount: Math.round(Number(c.outstanding_balance) || 0).toLocaleString('en-PK'),
      Days: '',
      Link: '',
    })
    openWhatsApp({ shopId: user.shop_id, kind: 'reminder', phone: c.phone, name: c.name, text })
  }

  const handleEdit = (c) => {
    setForm({ name: c.name, phone: c.phone || '', address: c.address || '', price_tier: normalizeTier(c.price_tier), credit_limit: c.credit_limit ?? '' })
    setEditingId(c.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const { price_tier, outstanding_balance: openingInput, credit_limit: limitInput, ...formFields } = form
    // price_tier is only sent when the shop uses Wholesale Mode (keeps un-migrated DBs working)
    const payload = { ...formFields, shop_id: user.shop_id, ...(wholesaleEnabled ? { price_tier: normalizeTier(price_tier) } : {}) }
    // Opening balance (old dues) only when adding: stored on the customer AND written
    // to the ledger as an 'opening' entry so the ledger and the balance agree.
    const opening = editingId ? 0 : (Number(openingInput) || 0)
    if (!editingId) payload.outstanding_balance = opening
    // Credit limit only when filled in (column added by sql/transactions_migration.sql)
    if (limitInput !== undefined && limitInput !== '') payload.credit_limit = Math.max(0, Number(limitInput) || 0)
    else if (editingId && limitInput === '') payload.credit_limit = null

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        let { error } = await supabase.from('customers').update(payload).eq('id', editingId)
        if (error && isMissingColumn(error) && 'credit_limit' in payload) {
          const { credit_limit: _cl, ...rest } = payload
          ;({ error } = await supabase.from('customers').update(rest).eq('id', editingId))
          if (!error && _cl != null) toast.warning('Credit limit needs a database update first (sql/transactions_migration.sql). Other details were saved.')
        }
        if (error) throw error
      } else {
        let { data: created, error } = await supabase.from('customers').insert([payload]).select('id').single()
        if (error && isMissingColumn(error) && 'credit_limit' in payload) {
          const { credit_limit: _cl, ...rest } = payload
          ;({ data: created, error } = await supabase.from('customers').insert([rest]).select('id').single())
        }
        if (error) throw error
        if (opening !== 0 && created?.id != null) {
          const { error: obErr } = await supabase.from('customer_payments').insert([openingRow({ table: 'customer_payments', shopId: user.shop_id, partyId: created.id, amount: opening })])
          if (obErr) toast.error('Customer saved, but the opening balance ledger entry failed: ' + obErr.message)
        }
      }
      setEditingId(null)
      setForm({ name: '', phone: '', address: '' })
      setShowForm(false)
      fetchCustomers()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId ? { ...payload, id: editingId } : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('customers', action, offlineData)
        if (editingId) {
          await db.customers.update(editingId, offlineData)
        } else {
          await db.customers.add(offlineData)
          if (opening !== 0) {
            // Queued after the customer, so sync swaps in the real customer id
            const obRow = { ...openingRow({ table: 'customer_payments', shopId: user.shop_id, partyId: offlineData.id, amount: opening }), id: crypto.randomUUID(), created_at: offlineData.created_at }
            await db.customer_payments.add(obRow).catch(() => {})
            await addToSyncQueue('customer_payments', 'INSERT', obRow)
          }
        }
        setEditingId(null)
        setForm({ name: '', phone: '', address: '' })
        setShowForm(false)
        fetchCustomers()
        toast.success('Offline mode: Saved locally. Will sync automatically when online. 🔄')
      } else {
        toast.error('Error: ' + error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (ids) => {

    if (!can(user, 'delete')) { toast.warning(notAllowed('delete karne')); return }
    setPendingDeleteIds(ids)
    setWipeLedger(false)
    setShowPasswordModal(true)
  }

  const executeDelete = async () => {
    setShowPasswordModal(false)
    const ids = pendingDeleteIds
    setPendingDeleteIds([])
    const isWipe = wipeLedger

    let successCount = 0
    let failCount = 0
    const successfulIds = []

    for (const id of ids) {
      const item = customers.find(c => c.id === id)
      if (!item) continue

      try {
        if (isWipe) {
          // Deep clean ledger history
          const localSales = await db.sales.where({ customer_id: id }).toArray()
          const saleIds = localSales.map(s => s.id)
          
          if (navigator.onLine) {
            const { data: onlineSales } = await supabase.from('sales').select('id').eq('customer_id', id)
            const onlineIds = onlineSales?.map(s => s.id) || []
            const allSaleIds = [...new Set([...saleIds, ...onlineIds])]
            
            if (allSaleIds.length > 0) {
              await must(supabase.from('sale_items').delete().in('sale_id', allSaleIds))
            }
            await must(supabase.from('sales').delete().eq('customer_id', id))
            await must(supabase.from('customer_payments').delete().eq('customer_id', id))
          } else {
            for (const sId of saleIds) {
              const items = await db.sale_items.where({ sale_id: sId }).toArray()
              for (const it of items) await addToSyncQueue('sale_items', 'DELETE', { id: it.id })
              await addToSyncQueue('sales', 'DELETE', { id: sId })
            }
            const localPay = await db.customer_payments.where({ customer_id: id }).toArray()
            for (const p of localPay) await addToSyncQueue('customer_payments', 'DELETE', { id: p.id })
          }

          if (saleIds.length > 0) await db.sale_items.where('sale_id').anyOf(saleIds).delete()
          await db.sales.where({ customer_id: id }).delete()
          await db.customer_payments.where({ customer_id: id }).delete()
        }

        if (navigator.onLine) {
          const { error } = await supabase.from('customers').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          await addToSyncQueue('customers', 'DELETE', { id })
        }

        await moveToTrash('customers', id, item, user.id, user.shop_id)
        await db.customers.delete(id)
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    setCustomers(prev => prev.filter(c => !successfulIds.includes(c.id)))
    setSelected([])

    if (failCount > 0) {
      toast.error(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\n👉 Yeh customers ke sales records abhi bhi database mein hain.\n\nSahi order:\n1. Sale Items delete karein (Trash Bin)\n2. Sales delete karein\n3. Phir yeh customers delete ho jayenge`)
    } else if (successCount > 0) {
      toast.success(`🗑️ ${successCount} customer(s) moved to Trash!`)
    }
    fetchCustomers()
  }

  const handleCancel = () => {
    setShowForm(false); setEditingId(null); setForm({ name: '', phone: '', address: '' })
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const getSegment = (c) => {
    const isNew = new Date(c.created_at) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const bal = Number(c.outstanding_balance || 0)
    if (isNew) return { label: '🆕 New', bg: 'bg-primary-muted text-primary-strong' }
    if (bal >= 10000) return { label: '⭐ VIP', bg: 'bg-warning-muted text-warning-strong' }
    if (bal === 0) return { label: '✓ Clear', bg: 'bg-success-muted text-success-strong' }
    return null
  }

  const toggleSelectAll = () => {
    if (selected.length === customers.length) {
      setSelected([])
    } else {
      setSelected(customers.map(x => x.id))
    }
  }

  const handlePrintOutstanding = () => {
    const outstanding = customers.filter(c => c.outstanding_balance > 0)
    if (outstanding.length === 0) {
      toast.info('Sab customers ka balance 0 hai!')
      return
    }

    const branding = getShopBranding(user?.shop_id)
    const totalOutstanding = outstanding.reduce((sum, c) => sum + (c.outstanding_balance || 0), 0)
    const header = brandedA4Header(branding, 'Outstanding Balance Report', `${outstanding.length} customers  |  Total: Rs. ${totalOutstanding.toLocaleString()}`)

    printHTML(`
      <html><head><title>Outstanding Balances</title>
      <style>
        @page{size:A4 portrait;margin:12mm}
        *{box-sizing:border-box;print-color-adjust:exact;-webkit-print-color-adjust:exact}
        body { font-family: 'Segoe UI', sans-serif; padding: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
        th { background: #f4f4f4; font-size: 12px; }
        .total-row { font-weight: bold; background: #f9f9f9; }
      </style></head><body>
      ${header}
      <table>
        <thead>
          <tr>
            <th>Customer Name</th>
            <th>Phone</th>
            <th>Address</th>
            <th>Balance (Rs.)</th>
          </tr>
        </thead>
        <tbody>
          ${outstanding.map(c => `
            <tr>
              <td>${c.name}</td>
              <td>${c.phone || '-'}</td>
              <td>${c.address || '-'}</td>
              <td>${c.outstanding_balance.toLocaleString()}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr class="total-row">
            <td colspan="3" style="text-align: right">Total Outstanding</td>
            <td>${totalOutstanding.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      </body></html>
    `)
  }

  const custQ = custSearch.trim().toLowerCase()
  const shownCustomers = customers.filter(c => (!owesOnly || Number(c.outstanding_balance) > 0) &&
    (!custQ || `${c.name || ''} ${c.phone || ''} ${c.address || ''} ${c.city || ''}`.toLowerCase().includes(custQ)))
  const clearCustFilters = () => { setCustSearch(''); setOwesOnly(false) }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-fg">👥 Customers</h1>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {selected.length > 0 && (
            <button
              onClick={() => requestDelete(selected)}
              className="px-4 py-2 bg-danger hover:bg-danger-hover text-white rounded-lg transition font-bold text-sm">
              🗑️ Delete Selected ({selected.length})
            </button>
          )}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <button onClick={handleExport}
            className="px-4 py-2 border border-success text-success-fg hover:bg-success-soft rounded-lg transition font-bold text-sm flex items-center gap-2">
            📤 Export
          </button>
          <button onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 border border-warning text-warning-fg hover:bg-warning-soft rounded-lg transition font-bold text-sm flex items-center gap-2">
            📥 Import
          </button>
          <button
            onClick={handlePrintOutstanding}
            className="px-4 py-2 border border-primary text-primary-fg hover:bg-primary-soft rounded-lg transition font-bold text-sm flex items-center gap-2">
            🖨️ Print Outstanding
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition">
            {showForm ? 'Cancel' : '+ Add Customer'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-surface rounded-xl shadow p-6 mb-6 max-w-lg">
          <h2 className="font-semibold text-fg-2 mb-4">{editingId ? 'Edit Customer' : 'New Customer'}</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-fg-2 font-medium mb-1">Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                required className="w-full px-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Ahmed Khan" />
            </div>
            <div>
              <label className="block text-fg-2 font-medium mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="03001234567" />
            </div>
            <div>
              <label className="block text-fg-2 font-medium mb-1">Address</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="City, Pakistan" />
            </div>
            <div>
              <label htmlFor="customer-credit-limit" className="block text-fg-2 font-medium mb-1">Credit limit (udhaar ki hadd)</label>
              <input id="customer-credit-limit" type="number" inputMode="decimal" min="0" step="any" value={form.credit_limit ?? ''}
                onChange={(e) => setForm({ ...form, credit_limit: e.target.value })}
                className="w-full px-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Blank = no limit" />
            </div>
            {!editingId && (
              <div>
                <label htmlFor="customer-opening" className="block text-fg-2 font-medium mb-1">Opening balance (purani dues)</label>
                <input id="customer-opening" type="number" inputMode="decimal" step="any" value={form.outstanding_balance ?? ''}
                  onChange={(e) => setForm({ ...form, outstanding_balance: e.target.value })}
                  className="w-full px-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="0 — use a minus amount for an advance" />
              </div>
            )}
            {wholesaleEnabled && (
              <div>
                <label htmlFor="customer-price-tier" className="block text-fg-2 font-medium mb-1">Customer Type</label>
                <select id="customer-price-tier" value={normalizeTier(form.price_tier)} onChange={(e) => setForm({ ...form, price_tier: e.target.value })}
                  className="w-full px-4 py-2 border border-line-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-surface">
                  <option value="retail">Retail customer</option>
                  <option value="wholesale">Wholesale customer (POS switches to wholesale prices)</option>
                </select>
              </div>
            )}
            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Customer' : 'Save Customer'}
              </button>
              <button type="button" onClick={handleCancel}
                className="px-6 py-2 bg-surface-4 hover:bg-surface-5 text-fg-2 rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {!loading && customers.length > 0 && (
        <div className="mb-3">
          <FilterBar shown={shownCustomers.length} total={customers.length} noun="customers"
            active={!!custSearch || owesOnly} onClear={clearCustFilters}
            className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <input type="search" className="input flex-1" placeholder="Search name, phone or address" aria-label="Search customers"
              value={custSearch} onChange={e => setCustSearch(e.target.value)} />
            <label className="flex items-center gap-2 min-h-10 cursor-pointer select-none text-sm font-medium text-fg-2 shrink-0">
              <input type="checkbox" className="w-4 h-4" checked={owesOnly} onChange={e => setOwesOnly(e.target.checked)} />
              Owes money only
            </label>
          </FilterBar>
        </div>
      )}

      {loading ? (
        <p className="text-fg-muted">Loading...</p>
      ) : customers.length > 0 && shownCustomers.length === 0 ? (
        <EmptyState icon="🔍" title="No customers match these filters" action={{ label: 'Clear filters', onClick: clearCustFilters }} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No customers yet"
          text="Add the customers who buy on credit (udhaar) to track their balance, send reminders and print statements."
          action={!showForm ? { label: '+ Add first customer', onClick: () => setShowForm(true) } : null}
        />
      ) : (
        <>
        {/* Phones: one card per customer, balance and main actions visible without sideways scrolling */}
        <ul className="md:hidden space-y-2" aria-label="Customers">
          {shownCustomers.map((c) => {
            const bal = Number(c.outstanding_balance || 0)
            const seg = getSegment(c)
            return (
              <li key={c.id} className={`card p-3 ${selected.includes(c.id) ? 'ring-2 ring-primary' : ''}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleSelect(c.id)} className="mt-1 w-5 h-5 rounded shrink-0" aria-label={`Select ${c.name}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="font-bold text-fg truncate">{c.name}</p>
                      {wholesaleEnabled && c.price_tier === 'wholesale' && (
                        <span className="rounded bg-wholesale-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-wholesale-strong">Wholesale</span>
                      )}
                      {seg && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${seg.bg}`}>{seg.label}</span>}
                    </div>
                    <p className="text-xs text-fg-muted truncate">{c.phone || 'No phone'}{c.address ? ` · ${c.address}` : ''}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase font-bold text-fg-subtle">Balance</p>
                    <p className={`font-black ${bal > 0 ? 'text-danger-fg' : 'text-success-fg'}`}>Rs. {bal.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  <Link to={`/customers/${c.id}`} className="btn btn-primary btn-sm col-span-2">📒 Ledger</Link>
                  {c.phone
                    ? <button type="button" onClick={() => sendReminder(c)} className="btn btn-secondary btn-sm" aria-label={`Send WhatsApp reminder to ${c.name}`}>💬</button>
                    : <span />}
                  <button type="button" onClick={() => handleEdit(c)} className="btn btn-secondary btn-sm">Edit</button>
                </div>
              </li>
            )
          })}
        </ul>

        {/* Tablets and computers: full table */}
        <div className="hidden md:block bg-surface rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-surface-2 border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.length === customers.length && customers.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase whitespace-nowrap">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase whitespace-nowrap">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase whitespace-nowrap">Address</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase whitespace-nowrap">Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shownCustomers.map((c) => (
                  <tr key={c.id} className={`hover:bg-surface-2 ${selected.includes(c.id) ? 'bg-primary-soft' : ''}`}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="w-4 h-4 rounded"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-fg">{c.name}</span>
                        {wholesaleEnabled && c.price_tier === 'wholesale' && (
                          <span className="ml-1.5 rounded bg-wholesale-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-wholesale-strong">Wholesale</span>
                        )}
                        {(() => { const seg = getSegment(c); return seg ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${seg.bg}`}>{seg.label}</span> : null })()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-fg-muted whitespace-nowrap">{c.phone || '-'}</td>
                    <td className="px-6 py-4 text-fg-muted whitespace-nowrap">{c.address || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${c.outstanding_balance > 0 ? 'text-danger-fg' : 'text-success-fg'}`}>
                        Rs. {c.outstanding_balance || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex gap-3 whitespace-nowrap items-center">
                      <Link to={`/customers/${c.id}`} className="text-primary-fg hover:text-primary-strong text-sm font-bold bg-primary-soft px-2 py-1 rounded">
                        Ledger
                      </Link>
                      {c.phone && (
                        <button
                          title="Send WhatsApp Reminder"
                          onClick={() => sendReminder(c)}
                          className="text-success-fg hover:text-success-strong text-lg"
                        >
                          💬
                        </button>
                      )}
                      <button onClick={() => handleEdit(c)} className="text-primary-fg hover:text-primary-strong text-sm font-medium">Edit</button>
                      <button onClick={() => requestDelete([c.id])} className="text-danger-fg hover:text-danger-strong text-sm font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {showPasswordModal && (
        <PasswordModal
          title="Delete Customer(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
          checkboxLabel="Wipe all ledger history (sales, payments) forever?"
          checkboxChecked={wipeLedger}
          onCheckboxChange={setWipeLedger}
        />
      )}
    </div>
  )
}

export default Customers