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
  const [form, setForm] = useState({
    name: '',
    description: ''
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

  const fetchCategories = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = supabase.from('categories').select('*').eq('shop_id', user.shop_id).order('created_at', { ascending: false })
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])
      if (error) throw error

      if (data) {
        await db.categories.bulkPut(JSON.parse(JSON.stringify(data)))
      }

      // Always render from local DB to include pending items
      const localData = await db.categories.toArray()
      const sid = String(user.shop_id)
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
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
    setForm({ name: cat.name, description: cat.description || '' })
    setEditingId(cat.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form, shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        const { error } = await supabase.from('categories').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('categories').insert([payload])
        if (error) throw error
      }
      setEditingId(null)
      setForm({ name: '', description: '' })
      setShowForm(false)
      fetchCategories()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId ? { ...payload, id: editingId } : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('categories', action, offlineData)
        if (editingId) {
          await db.categories.update(editingId, offlineData)
        } else {
          await db.categories.add(offlineData)
        }
        setEditingId(null)
        setForm({ name: '', description: '' })
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

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', description: '' })
  }

  const handleExport = () => {
    if (categories.length === 0) return alert('No data to export')
    const data = categories.map(c => ({
      'Category Name': c.name,
      'Description': c.description || '',
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

        if (name) {
          // Check if already exists to avoid duplicates
          const exists = categories.find(c => c.name.toLowerCase() === name.toLowerCase())
          if (!exists) {
            await supabase.from('categories').insert([{ name, description, shop_id: user.shop_id }])
            importedCount++
          }
        }
      }
      setLoading(false)
      alert(`${importedCount} new categories imported!`)
      fetchCategories()
    }
    reader.readAsBinaryString(file)
    e.target.value = null // Reset input
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🗂️ Categories</h1>
        <div className="flex gap-2 w-full sm:w-auto">
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
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition text-sm font-bold"
          >
            {showForm ? 'Cancel' : '+ Add Category'}
          </button>
        </div>
      </div>

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
            <div className="flex gap-3">
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
                  <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Linked Products</th>
                  <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categories.map((cat, idx) => (
                  <tr key={cat.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{idx + 1}</td>
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-gray-900">{cat.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className="px-3 py-1 bg-blue-50 text-blue-700 font-bold rounded-full text-xs">
                        {getProductCount(cat.id)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => handleEdit(cat)}
                          className="px-3 py-1 hover:bg-gray-100 text-gray-600 rounded font-medium transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(cat.id)}
                          className="px-3 py-1 hover:bg-red-50 text-red-500 rounded font-medium transition"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr>
                    <td colSpan="4" className="px-6 py-8 text-center text-gray-500">No categories found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default Categories