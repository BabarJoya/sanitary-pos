import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import * as XLSX from 'xlsx'
import { db, addToSyncQueue } from '../services/db'

function Brands() {
  const { user } = useAuth()
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    name: ''
  })
  const fileInputRef = useRef(null)

  // View Products modal
  const [viewBrand, setViewBrand] = useState(null)
  const [brandProducts, setBrandProducts] = useState([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [expandedProductId, setExpandedProductId] = useState(null)
  const [productHistory, setProductHistory] = useState({})
  const [loadingHistoryId, setLoadingHistoryId] = useState(null)

  useEffect(() => {
    if (user?.shop_id) fetchBrands()
  }, [user?.shop_id])

  const fetchBrands = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('created_at', { ascending: false })
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])
      if (error) throw error

      if (data) {
        await db.brands.bulkPut(JSON.parse(JSON.stringify(data)))
      }

      const localData = await db.brands.toArray()
      const sid = String(user.shop_id)
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setBrands(sorted)
    } catch (err) {
      console.log('Brands: Fetching from local DB (Offline)')
      try {
        const localData = await db.brands.toArray()
        const sid = String(user.shop_id)
        setBrands(localData.filter(x => String(x.shop_id) === sid))
      } catch (e) { console.error('Local DB Brands Error', e) }
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (brand) => {
    setForm({ name: brand.name })
    setEditingId(brand.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = { ...form, shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        const { error } = await supabase.from('brands').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('brands').insert([payload])
        if (error) throw error
      }
      setEditingId(null)
      setForm({ name: '' })
      setShowForm(false)
      fetchBrands()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId ? { ...payload, id: editingId } : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('brands', action, offlineData)
        if (editingId) {
          await db.brands.update(editingId, offlineData)
        } else {
          await db.brands.add(offlineData)
        }
        setEditingId(null)
        setForm({ name: '' })
        setShowForm(false)
        fetchBrands()
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
      const { error } = await supabase.from('brands').delete().eq('id', id)
      if (error) throw error
      fetchBrands()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.brands.delete(id)
        await addToSyncQueue('brands', 'DELETE', { id })
        fetchBrands()
        alert('Offline mode: Brand deleted locally. Will sync when online! 🔄')
      } else {
        alert('Error: ' + errMsg)
      }
    }
  }



  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '' })
  }

  const handleExport = () => {
    if (brands.length === 0) return alert('No data to export')
    const data = brands.map(b => ({
      'Brand Name': b.name,
      'Created At': new Date(b.created_at).toLocaleDateString()
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Brands')
    XLSX.writeFile(wb, `Brands_${new Date().toISOString().slice(0, 10)}.xlsx`)
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
        const name = row['Brand Name'] || row['name'] || row['Name']

        if (name) {
          const exists = brands.find(b => b.name.toLowerCase() === name.toLowerCase())
          if (!exists) {
            await supabase.from('brands').insert([{ name, shop_id: user.shop_id }])
            importedCount++
          }
        }
      }
      setLoading(false)
      alert(`${importedCount} new brands imported!`)
      fetchBrands()
    }
    reader.readAsBinaryString(file)
    e.target.value = null
  }

  const handleViewProducts = async (brand) => {
    setViewBrand(brand)
    setLoadingProducts(true)
    setBrandProducts([])
    setExpandedProductId(null)
    setProductHistory({})
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('brand', brand.name)
          .eq('shop_id', user.shop_id)
          .order('name')
        if (!error && data) setBrandProducts(data)
      } else {
        const local = await db.products.toArray()
        const sid = String(user.shop_id)
        setBrandProducts(local.filter(p => String(p.shop_id) === sid && p.brand === brand.name).sort((a, b) => a.name.localeCompare(b.name)))
      }
    } catch (err) { console.error('View Products Error:', err) }
    finally { setLoadingProducts(false) }
  }

  const fetchProductHistory = async (productId) => {
    if (expandedProductId === productId) {
      setExpandedProductId(null)
      return
    }
    setExpandedProductId(productId)
    if (productHistory[productId]) return // already fetched
    setLoadingHistoryId(productId)
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('purchase_items')
          .select('unit_price, quantity, total_price, purchases(created_at, supplier_id, suppliers(name))')
          .eq('product_id', productId)
          .order('id', { ascending: false })
          .limit(15)
        if (!error && data) {
          const mapped = data.map(item => ({
            date: item.purchases?.created_at,
            price: item.unit_price,
            qty: item.quantity,
            supplier: item.purchases?.suppliers?.name || '-'
          }))
          setProductHistory(prev => ({ ...prev, [productId]: mapped }))
        }
      } else {
        const localItems = await db.purchase_items.where('product_id').equals(productId).toArray()
        const localPurchases = await db.purchases.toArray()
        const localSuppliers = await db.suppliers.toArray()
        const mapped = localItems.map(item => {
          const purchase = localPurchases.find(p => p.id === item.purchase_id)
          const supplier = purchase ? localSuppliers.find(s => s.id === purchase.supplier_id) : null
          return {
            date: purchase?.created_at,
            price: item.unit_price,
            qty: item.quantity,
            supplier: supplier?.name || '-'
          }
        }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 15)
        setProductHistory(prev => ({ ...prev, [productId]: mapped }))
      }
    } catch (err) { console.error('Fetch product history error:', err) }
    finally { setLoadingHistoryId(null) }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🏷️ Brands</h1>
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
            {showForm ? 'Cancel' : '+ Add Brand'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 max-w-lg">
          <h2 className="font-semibold text-gray-700 mb-4">
            {editingId ? 'Edit Brand' : 'New Brand'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Brand Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Master"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update Brand' : 'Save Brand'}
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
      ) : brands.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-lg">No brands yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-y">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Brand Name</th>
                  <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {brands.map((brand) => (
                  <tr key={brand.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-gray-900">{brand.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => handleViewProducts(brand)}
                          className="px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded font-medium transition flex items-center gap-1"
                        >
                          📦 View Products
                        </button>
                        <button
                          onClick={() => handleEdit(brand)}
                          className="px-3 py-1 hover:bg-gray-100 text-gray-600 rounded font-medium transition border"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(brand.id)}
                          className="px-3 py-1 hover:bg-red-50 text-red-500 rounded font-medium transition border border-transparent hover:border-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {brands.length === 0 && (
                  <tr>
                    <td colSpan="2" className="px-6 py-8 text-center text-gray-500">No brands found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* View Products Modal */}
      {viewBrand && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setViewBrand(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-800">📦 Products of {viewBrand.name}</h2>
                <p className="text-xs text-gray-500">Click any product row to view purchase price history</p>
              </div>
              <button onClick={() => setViewBrand(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="flex-1 overflow-auto border rounded-xl bg-gray-50">
              {loadingProducts ? (
                <p className="text-center text-gray-400 py-10">Loading products...</p>
              ) : brandProducts.length === 0 ? (
                <p className="text-center text-gray-400 py-10 italic">No products found for this brand.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-100 sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Product</th>
                      <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">C. Rate</th>
                      <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">Cost Price</th>
                      <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">Sale Price</th>
                      <th className="px-4 py-2 text-center text-xs font-bold text-gray-500 uppercase">Stock</th>
                      <th className="px-4 py-2 text-center text-xs font-bold text-gray-500 uppercase">History</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {brandProducts.map(p => (
                      <>
                        <tr key={p.id} className={`hover:bg-gray-50 cursor-pointer transition ${expandedProductId === p.id ? 'bg-blue-50' : ''}`} onClick={() => fetchProductHistory(p.id)}>
                          <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                          <td className="px-4 py-3 text-right text-blue-600 font-bold">{p.c_rate || 0}</td>
                          <td className="px-4 py-3 text-right text-gray-700">Rs. {p.cost_price || 0}</td>
                          <td className="px-4 py-3 text-right font-bold text-green-600">Rs. {p.sale_price || 0}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${p.stock_quantity <= 5 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>{p.stock_quantity}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button className="text-blue-500 hover:text-blue-700 text-xs font-bold">
                              {expandedProductId === p.id ? '▲ Hide' : '▼ View'}
                            </button>
                          </td>
                        </tr>
                        {expandedProductId === p.id && (
                          <tr key={`${p.id}-history`}>
                            <td colSpan="6" className="px-4 py-2 bg-blue-50/50">
                              {loadingHistoryId === p.id ? (
                                <p className="text-center text-gray-400 text-xs py-3">Loading history...</p>
                              ) : (productHistory[p.id]?.length || 0) === 0 ? (
                                <p className="text-center text-gray-400 text-xs py-3 italic">No previous purchases found.</p>
                              ) : (
                                <div className="border rounded-lg overflow-hidden mx-4 my-1">
                                  <table className="w-full text-xs">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="px-3 py-1.5 text-left text-gray-500 font-bold">Date</th>
                                        <th className="px-3 py-1.5 text-left text-gray-500 font-bold">Supplier</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-bold">Purchase Rate</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-bold">Qty</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {productHistory[p.id].map((h, idx) => (
                                        <tr key={idx} className={`${idx === 0 ? 'bg-yellow-50 font-semibold' : 'hover:bg-gray-50'}`}>
                                          <td className="px-3 py-1.5 text-gray-600">{h.date ? new Date(h.date).toLocaleDateString('en-PK') : '-'}</td>
                                          <td className="px-3 py-1.5 text-gray-600">{h.supplier}</td>
                                          <td className={`px-3 py-1.5 text-right font-bold ${idx > 0 && h.price !== productHistory[p.id][idx - 1]?.price ? 'text-orange-600' : 'text-gray-800'}`}>Rs. {h.price}</td>
                                          <td className="px-3 py-1.5 text-right text-gray-500">{h.qty}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Brands
