import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import * as XLSX from 'xlsx'
import { db, addToSyncQueue } from '../services/db'

function Categories() {
  const { user } = useAuth()
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [applyingId, setApplyingId] = useState(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    low_stock_threshold: ''
  })
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (user?.shop_id) {
      fetchCategories()
      fetchProducts()
    }
  }, [user?.shop_id])

  const fetchProducts = async () => {
    try {
      const localData = await db.products.toArray()
      const sid = String(user.shop_id)
      setProducts(localData.filter(x => String(x.shop_id) === sid))
    } catch (e) {
      console.error('Local DB Products Error', e)
    }
  }

  const getProductCount = (catId) => {
    return products.filter(p => p.category_id === catId).length
  }

  const getLowStockCount = (cat) => {
    if (!cat.low_stock_threshold) return 0
    return products.filter(p =>
      p.category_id === cat.id &&
      p.stock_quantity <= cat.low_stock_threshold
    ).length
  }

  const fetchCategories = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = supabase.from('categories').select('*').eq('shop_id', user.shop_id).order('created_at', { ascending: false })
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])
      if (error) throw error

      if (data) {
        const supabaseIds = new Set(data.map(d => d.id))
        const allLocal = await db.categories.toArray()
        const sid = String(user.shop_id)
        const orphanedIds = allLocal
          .filter(c => String(c.shop_id) === sid && !supabaseIds.has(c.id))
          .map(c => c.id)
        if (orphanedIds.length) await db.categories.bulkDelete(orphanedIds)

        await db.categories.bulkPut(JSON.parse(JSON.stringify(data)))
      }

      const sorted = [...(data || [])].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setCategories(sorted)
    } catch (err) {
      console.log('Categories: Fetching from local DB (Offline)')
      try {
        const localData = await db.categories.toArray()
        const sid = String(user.shop_id)
        setCategories(localData.filter(x => String(x.shop_id) === sid))
      } catch (e) { console.error('Local DB Categories Error', e) }
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (cat) => {
    setForm({
      name: cat.name,
      description: cat.description || '',
      low_stock_threshold: cat.low_stock_threshold ?? ''
    })
    setEditingId(cat.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const thresholdVal = form.low_stock_threshold !== '' ? parseInt(form.low_stock_threshold) : null
    const payload = {
      name: form.name.trim(),
      description: form.description,
      low_stock_threshold: (thresholdVal && thresholdVal > 0) ? thresholdVal : null,
      shop_id: user.shop_id
    }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        const { error } = await supabase.from('categories').update(payload).eq('id', editingId)
        if (error) throw error
        await db.categories.update(editingId, payload)
      } else {
        const { data, error } = await supabase.from('categories').insert([payload]).select()
        if (error) throw error
        if (data?.[0]) await db.categories.put(data[0]).catch(() => {})
      }
      setEditingId(null)
      setForm({ name: '', description: '', low_stock_threshold: '' })
      setShowForm(false)
      fetchCategories()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId
          ? { ...payload, id: editingId }
          : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('categories', action, offlineData)
        if (editingId) {
          await db.categories.update(editingId, offlineData)
        } else {
          await db.categories.add(offlineData)
        }
        setEditingId(null)
        setForm({ name: '', description: '', low_stock_threshold: '' })
        setShowForm(false)
        fetchCategories()
        alert('Offline mode: Saved locally. Will sync automatically when online. 🔄')
      } else {
        alert('Error: ' + errMsg)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure?')) return
    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const { error } = await supabase.from('categories').delete().eq('id', id)
      if (error) throw error
      await db.categories.delete(id)
      fetchCategories()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.categories.delete(id)
        await addToSyncQueue('categories', 'DELETE', { id })
        fetchCategories()
        alert('Offline mode: Category deleted locally. Will sync when online! 🔄')
      } else {
        alert('Error: ' + errMsg)
      }
    }
  }

  const handleApplyToProducts = async (cat) => {
    const threshold = cat.low_stock_threshold
    if (!threshold || threshold <= 0) {
      alert('Pehle is category ka "Low Stock Alert" value set karein (Edit karein).')
      return
    }
    const count = getProductCount(cat.id)
    if (count === 0) {
      alert('Is category mein koi product nahi hai.')
      return
    }
    if (!confirm(`"${cat.name}" category ke ${count} products ka Low Stock Alert ≤${threshold} par set ho jayega.\n\nContinue?`)) return

    setApplyingId(cat.id)
    try {
      if (navigator.onLine) {
        const { error } = await supabase
          .from('products')
          .update({ low_stock_threshold: threshold })
          .eq('category_id', cat.id)
          .eq('shop_id', user.shop_id)
        if (error) throw error
      }
      // Always update local DB
      const localProds = products.filter(p => p.category_id === cat.id)
      for (const p of localProds) {
        await db.products.update(p.id, { low_stock_threshold: threshold })
        if (!navigator.onLine) {
          await addToSyncQueue('products', 'UPDATE', { id: p.id, low_stock_threshold: threshold })
        }
      }
      fetchProducts()
      alert(`✅ ${count} products ka Low Stock Alert ≤${threshold} par set ho gaya!`)
    } catch (err) {
      alert('Error: ' + (err.message || String(err)))
    } finally {
      setApplyingId(null)
    }
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', description: '', low_stock_threshold: '' })
  }

  const handleExport = () => {
    if (categories.length === 0) return alert('No data to export')
    const data = categories.map(c => ({
      'Category Name': c.name,
      'Description': c.description || '',
      'Low Stock Alert': c.low_stock_threshold || '',
      'Created At': new Date(c.created_at).toLocaleDateString()
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Categories')
    XLSX.writeFile(wb, `Categories_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  const handleImport = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      const bstr = evt.target.result
      const wb = XLSX.read(bstr, { type: 'binary' })
      const wsname = wb.SheetNames[0]
      const ws = wb.Sheets[wsname]
      const data = XLSX.utils.sheet_to_json(ws)

      if (data.length === 0) return alert('No data found in file')

      setLoading(true)
      let importedCount = 0
      for (const row of data) {
        const name = row['Category Name'] || row['name'] || row['Name']
        const description = row['Description'] || row['description'] || ''
        const lowStock = parseInt(row['Low Stock Alert'] || row['low_stock_threshold'] || 0) || null

        if (name) {
          const exists = categories.find(c => c.name.toLowerCase() === name.toLowerCase())
          if (!exists) {
            await supabase.from('categories').insert([{ name, description, low_stock_threshold: lowStock, shop_id: user.shop_id }])
            importedCount++
          }
        }
      }
      setLoading(false)
      alert(`${importedCount} new categories imported!`)
      fetchCategories()
    }
    reader.readAsBinaryString(file)
    e.target.value = null
  }

  // Summary: categories with low stock alerts active
  const alertCategories = categories.filter(c => c.low_stock_threshold > 0)
  const lowStockSummary = alertCategories
    .map(c => ({ cat: c, count: getLowStockCount(c) }))
    .filter(a => a.count > 0)

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🗂️ Categories</h1>
        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            className="hidden"
            accept=".xlsx, .xls, .csv"
          />
          <button
            onClick={() => fileInputRef.current.click()}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition text-sm font-bold flex items-center gap-2"
          >
            📥 Import
          </button>
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition text-sm font-bold flex items-center gap-2"
          >
            📤 Export
          </button>
          <button
            onClick={() => showForm ? handleCancel() : setShowForm(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-sm font-bold"
          >
            {showForm ? 'Cancel' : '+ Add Category'}
          </button>
        </div>
      </div>

      {/* Low stock summary banner */}
      {lowStockSummary.length > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-bold text-amber-800 mb-2">⚠️ Low Stock Alerts — {lowStockSummary.length} categor{lowStockSummary.length > 1 ? 'ies' : 'y'} mein stock kam hai:</p>
          <div className="flex flex-wrap gap-2">
            {lowStockSummary.map(({ cat, count }) => (
              <span key={cat.id} className="bg-white border border-amber-300 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full">
                📦 {cat.name}: {count} item{count > 1 ? 's' : ''} ≤{cat.low_stock_threshold}
              </span>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 max-w-lg">
          <h2 className="font-semibold text-gray-700 mb-4">
            {editingId ? 'Edit Category' : 'New Category'}
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
                placeholder="e.g. Taps & Faucets"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional description"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">
                ⚠️ Low Stock Alert Threshold
                <span className="text-xs text-gray-400 font-normal ml-2">— is se kam hone par alert aayega</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  value={form.low_stock_threshold}
                  onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                  className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  placeholder="e.g. 5"
                />
                <span className="text-sm text-gray-400">units (0 = disabled)</span>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Category' : 'Save Category'}
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
      ) : categories.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">No categories yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-y">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Sr.</th>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Category Name</th>
                  <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Products</th>
                  <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Low Stock Alert</th>
                  <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categories.map((cat, idx) => {
                  const lowCount = getLowStockCount(cat)
                  return (
                    <tr key={cat.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{idx + 1}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-semibold text-gray-900">{cat.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="px-3 py-1 bg-blue-50 text-blue-700 font-bold rounded-full text-xs">
                          {getProductCount(cat.id)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {cat.low_stock_threshold > 0 ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-xs font-bold border border-amber-200">
                              ⚠️ ≤{cat.low_stock_threshold}
                            </span>
                            {lowCount > 0 && (
                              <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-xs font-bold border border-red-200">
                                🔴 {lowCount} low
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex gap-2 justify-center flex-wrap">
                          <button
                            onClick={() => handleEdit(cat)}
                            className="px-3 py-1 hover:bg-gray-100 text-gray-600 rounded font-medium transition text-sm"
                          >
                            Edit
                          </button>
                          {cat.low_stock_threshold > 0 && (
                            <button
                              onClick={() => handleApplyToProducts(cat)}
                              disabled={applyingId === cat.id}
                              className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded font-medium transition text-sm disabled:opacity-50"
                            >
                              {applyingId === cat.id ? '...' : '📊 Apply to Products'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(cat.id)}
                            className="px-3 py-1 hover:bg-red-50 text-red-500 rounded font-medium transition text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default Categories
