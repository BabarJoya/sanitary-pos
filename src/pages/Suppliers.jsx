import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import PasswordModal from '../components/PasswordModal'

function Suppliers() {
  const { user } = useAuth()
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    brand: '',
    product_type: '',
    other_details: '',
    outstanding_balance: 0
  })
  const [brands, setBrands] = useState([])
  const fileInputRef = useRef(null)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])

  useEffect(() => {
    if (user?.shop_id) {
      fetchSuppliers()
      fetchBrands()
    }
  }, [user?.shop_id])

  const fetchBrands = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const { data } = await supabase.from('products').select('brand').eq('shop_id', user.shop_id)
      if (data) {
        const uniqueBrands = [...new Set(data.map(p => p.brand).filter(Boolean))].sort()
        setBrands(uniqueBrands)
      }
    } catch (e) {
      const localProds = await db.products.toArray()
      const sid = String(user.shop_id)
      const myProds = localProds.filter(x => String(x.shop_id) === sid)
      const uniqueBrands = [...new Set(myProds.map(p => p.brand).filter(Boolean))].sort()
      setBrands(uniqueBrands)
    }
  }

  const fetchSuppliers = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = supabase
        .from('suppliers')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.suppliers.bulkPut(cleanData)
      }

      const localData = await db.suppliers.toArray()
      const sid = String(user.shop_id)
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setSuppliers(sorted)
    } catch (e) {
      console.log('Suppliers: Fetching from local DB (Offline Fallback)')
      try {
        const localData = await db.suppliers.toArray()
        const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        setSuppliers(sorted.filter(x => String(x.shop_id) === String(user.shop_id)))
      } catch (err) { console.error('Local DB Suppliers Error', err) }
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    const exportData = suppliers.map(s => ({
      'Name': s.name,
      'Phone': s.phone || '-',
      'Address': s.address || '-',
      'Outstanding Balance': s.outstanding_balance || 0
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Suppliers')
    XLSX.writeFile(wb, `Suppliers_Export_${new Date().toLocaleDateString()}.xlsx`)
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

      if (!confirm(`Import ${data.length} suppliers ? `)) return

      setLoading(true)
      const formatted = data.map(row => ({
        shop_id: user.shop_id,
        name: row['Name'] || row['name'] || 'New Supplier',
        phone: row['Phone'] || row['phone'] || '',
        address: row['Address'] || row['address'] || '',
        outstanding_balance: parseFloat(row['Outstanding Balance'] || row['balance'] || 0)
      }))

      const { error } = await supabase.from('suppliers').insert(formatted)
      if (error) alert(error.message)
      else {
        alert('Suppliers imported successfully! ✅')
        fetchSuppliers()
      }
      setLoading(false)
    }
    reader.readAsBinaryString(file)
  }

  const handleEdit = (sup) => {
    setForm({
      name: sup.name,
      phone: sup.phone || '',
      address: sup.address || '',
      brand: sup.brand || '',
      product_type: sup.product_type || '',
      other_details: sup.other_details || ''
    })
    setEditingId(sup.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form, shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        const { error } = await supabase.from('suppliers').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('suppliers').insert([payload])
        if (error) {
          throw new Error(error.message + '\nNote: Verify if brand, product_type, and other_details columns exist in your suppliers table.')
        }
      }
      setEditingId(null)
      setForm({ name: '', phone: '', address: '', brand: '', product_type: '', other_details: '' })
      setShowForm(false)
      fetchSuppliers()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId ? { ...payload, id: editingId } : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('suppliers', action, offlineData)

        if (editingId) {
          await db.suppliers.update(editingId, offlineData)
        } else {
          await db.suppliers.add(offlineData)
        }

        setEditingId(null)
        setForm({ name: '', phone: '', address: '', brand: '', product_type: '', other_details: '' })
        setShowForm(false)
        fetchSuppliers()
        alert('Offline mode: Saved locally. Will sync automatically when online. 🔄')
      } else {
        alert('Error: ' + errMsg)
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
      const item = suppliers.find(s => s.id === id)
      if (!item) continue

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('suppliers').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          await addToSyncQueue('suppliers', 'DELETE', { id })
        }

        await moveToTrash('suppliers', id, item, user.id, user.shop_id)
        await db.suppliers.delete(id)
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    setSuppliers(prev => prev.filter(s => !successfulIds.includes(s.id)))
    setSelected([])

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\nNote: Failed items may be linked to existing purchases/payments.`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} supplier(s) moved to Trash!`)
    }
    fetchSuppliers()
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', phone: '', address: '', brand: '', product_type: '', other_details: '' })
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selected.length === suppliers.length) {
      setSelected([])
    } else {
      setSelected(suppliers.map(x => x.id))
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🚚 Suppliers</h1>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          {selected.length > 0 && (
            <button
              onClick={() => requestDelete(selected)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-bold text-sm"
            >
              🗑️ Delete Selected ({selected.length})
            </button>
          )}
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">
            {showForm ? 'Cancel' : '+ Add Supplier / Dealer'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 max-w-lg">
          <h2 className="font-semibold text-gray-700 mb-4">
            {editingId ? 'Edit Supplier / Dealer' : 'New Supplier / Dealer'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Porta Pakistan / Dealer Name"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="03001234567"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Address</label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="City, Pakistan"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-gray-700 font-medium mb-1">Brand (Dealer of)</label>
                <select
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select Brand</option>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value="multi">Multiple Brands</option>
                </select>
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-1">Product Type</label>
                <input
                  type="text"
                  value={form.product_type}
                  onChange={(e) => setForm({ ...form, product_type: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. CP Fittings / Tiles"
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Other Details</label>
              <input
                type="text"
                value={form.other_details}
                onChange={(e) => setForm({ ...form, other_details: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Alternative numbers, specific notes..."
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Supplier' : 'Save Supplier'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">No suppliers yet</p>
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
                      checked={selected.length === suppliers.length && suppliers.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Contact</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Brand / Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {suppliers.map((sup) => (
                  <tr key={sup.id} className={`hover:bg-gray-50 ${selected.includes(sup.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selected.includes(sup.id)}
                        onChange={() => toggleSelect(sup.id)}
                        className="w-4 h-4 rounded"
                      />
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-800 whitespace-nowrap">{sup.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-gray-800 text-sm font-bold">{sup.phone || '-'}</p>
                      <p className="text-gray-400 text-xs">{sup.address || '-'}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <p className="text-blue-600 text-xs font-black uppercase tracking-tighter">{sup.brand || 'No Brand'}</p>
                      <p className="text-gray-500 text-xs">{sup.product_type || 'General'}</p>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`font-medium ${sup.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Rs. {sup.outstanding_balance || 0}
                      </span>
                    </td>
                    <td className="px-6 py-4 flex gap-3 whitespace-nowrap">
                      <Link to={`/suppliers/${sup.id}`} className="text-blue-600 hover:text-blue-800 text-sm font-bold bg-blue-50 px-2 py-1 rounded">
                        Ledger
                      </Link>
                      <button
                        onClick={() => handleEdit(sup)}
                        className="text-blue-500 hover:text-blue-700 text-sm font-medium">
                        Edit
                      </button>
                      <button
                        onClick={() => requestDelete([sup.id])}
                        className="text-red-500 hover:text-red-700 text-sm font-medium">
                        Delete
                      </button>
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
          title="Delete Supplier(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </div>
  )
}

export default Suppliers