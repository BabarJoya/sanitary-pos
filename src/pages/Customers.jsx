import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import PasswordModal from '../components/PasswordModal'

function Customers() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '', outstanding_balance: 0 })
  const fileInputRef = useRef(null)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])

  useEffect(() => {
    if (user?.shop_id) fetchCustomers()
  }, [user?.shop_id])

  const fetchCustomers = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = supabase
        .from('customers')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.customers.bulkPut(cleanData)
      }

      const localData = await db.customers.toArray()
      const sid = String(user.shop_id)
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setCustomers(sorted)
    } catch (e) {
      console.log('Customers: Fetching from local DB (Offline Fallback)')
      try {
        const localData = await db.customers.toArray()
        const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        setCustomers(sorted.filter(x => String(x.shop_id) === String(user.shop_id)))
      } catch (err) { console.error('Local DB Customers Error', err) }
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
        alert('Empty file!')
        return
      }

      if (!confirm(`Import ${data.length} customers?`)) return

      setLoading(true)
      const formatted = data.map(row => ({
        shop_id: user.shop_id,
        name: row['Name'] || row['name'] || 'New Customer',
        phone: row['Phone'] || row['phone'] || '',
        address: row['Address'] || row['address'] || '',
        outstanding_balance: parseFloat(row['Outstanding Balance'] || row['balance'] || 0)
      }))

      const { error } = await supabase.from('customers').insert(formatted)
      if (error) alert(error.message)
      else {
        alert('Customers imported successfully! ✅')
        fetchCustomers()
      }
      setLoading(false)
    }
    reader.readAsBinaryString(file)
  }

  const handleEdit = (c) => {
    setForm({ name: c.name, phone: c.phone || '', address: c.address || '' })
    setEditingId(c.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form, shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        const { error } = await supabase.from('customers').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('customers').insert([payload])
        if (error) throw error
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
        }
        setEditingId(null)
        setForm({ name: '', phone: '', address: '' })
        setShowForm(false)
        fetchCustomers()
        alert('Offline mode: Saved locally. Will sync automatically when online. 🔄')
      } else {
        alert('Error: ' + error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (ids) => {
    setPendingDeleteIds(ids)
    setShowPasswordModal(true)
  }

  const executeDelete = async () => {
    setShowPasswordModal(false)
    const ids = pendingDeleteIds
    setPendingDeleteIds([])

    let successCount = 0
    let failCount = 0
    const successfulIds = []

    for (const id of ids) {
      const item = customers.find(c => c.id === id)
      if (!item) continue

      try {
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
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\nNote: Failed items may be linked to existing sales/payments.`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} customer(s) moved to Trash!`)
    }
    fetchCustomers()
  }

  const handleCancel = () => {
    setShowForm(false); setEditingId(null); setForm({ name: '', phone: '', address: '' })
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
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
      alert('Sab customers ka balance 0 hai!')
      return
    }

    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Outstanding Balances</title>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { bg-color: #f4f4f4; }
        h1 { text-align: center; margin-bottom: 5px; }
        p.center { text-align: center; color: #666; margin-top: 0; }
        .total-row { font-weight: bold; background: #f9f9f9; }
      </style></head><body>
      <h1>Outstanding Balance Report</h1>
      <p class="center">Date: ${new Date().toLocaleDateString()}</p>
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
            <td>${outstanding.reduce((sum, c) => sum + (c.outstanding_balance || 0), 0).toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">👥 Customers</h1>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {selected.length > 0 && (
            <button
              onClick={() => requestDelete(selected)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-bold text-sm">
              🗑️ Delete Selected ({selected.length})
            </button>
          )}
          <button
            onClick={handlePrintOutstanding}
            className="px-4 py-2 border border-blue-600 text-blue-600 hover:bg-blue-50 rounded-lg transition font-bold text-sm flex items-center gap-2">
            🖨️ Print Outstanding
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">
            {showForm ? 'Cancel' : '+ Add Customer'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 max-w-lg">
          <h2 className="font-semibold text-gray-700 mb-4">{editingId ? 'Edit Customer' : 'New Customer'}</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Name *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                required className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Ahmed Khan" />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="03001234567" />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Address</label>
              <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="City, Pakistan" />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Customer' : 'Save Customer'}
              </button>
              <button type="button" onClick={handleCancel}
                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : customers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">No customers yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.length === customers.length && customers.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Phone</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Address</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {customers.map((c) => (
                  <tr key={c.id} className={`hover:bg-gray-50 ${selected.includes(c.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="w-4 h-4 rounded"
                      />
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-800 whitespace-nowrap">{c.name}</td>
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap">{c.phone || '-'}</td>
                    <td className="px-6 py-4 text-gray-500 whitespace-nowrap">{c.address || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${c.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Rs. {c.outstanding_balance || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex gap-3 whitespace-nowrap items-center">
                      <Link to={`/customers/${c.id}`} className="text-blue-600 hover:text-blue-800 text-sm font-bold bg-blue-50 px-2 py-1 rounded">
                        Ledger
                      </Link>
                      {c.phone && (
                        <button
                          title="Send WhatsApp Reminder"
                          onClick={async () => {
                            const { data: shop } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
                            const phone = c.phone.replace(/[^0-9]/g, '')
                            let formattedPhone = phone
                            if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                            else if (phone.length === 10) formattedPhone = '92' + phone

                            const template = shop?.wa_reminder_template || "Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!"
                            const msg = template
                              .replace(/\[Name\]/g, c.name)
                              .replace(/\[Amount\]/g, (c.outstanding_balance || 0).toLocaleString())
                              .replace(/\[Shop Name\]/g, shop?.name || 'our shop')

                            window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
                          }}
                          className="text-green-600 hover:text-green-800 text-lg"
                        >
                          💬
                        </button>
                      )}
                      <button onClick={() => handleEdit(c)} className="text-blue-500 hover:text-blue-700 text-sm font-medium">Edit</button>
                      <button onClick={() => requestDelete([c.id])} className="text-red-500 hover:text-red-700 text-sm font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <PasswordModal
          title="Delete Customer(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </div>
  )
}

export default Customers