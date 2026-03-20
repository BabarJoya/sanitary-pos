import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'
import { hasFeature } from '../utils/featureGate'

function Products() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])

  useEffect(() => {
    if (user?.shop_id) fetchProducts()
  }, [user?.shop_id])

  const fetchProducts = async () => {
    try {
      if (!user?.shop_id) {
        setLoading(false)
        console.error('Products: Missing user.shop_id!')
        return
      }
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = Promise.all([
        supabase.from('products').select('*, categories(name)').eq('shop_id', user.shop_id).order('created_at', { ascending: false }),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id)
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const [pData, cData] = await Promise.race([fetchPromise, timeoutPromise])

      if (pData.error || cData.error) throw new Error('Supabase fetch failed')

      // Cache to local DB
      if (pData.data) {
        await db.products.bulkPut(JSON.parse(JSON.stringify(pData.data)))
      }
      if (cData.data) {
        await db.categories.bulkPut(JSON.parse(JSON.stringify(cData.data)))
      }

      // Try rendering from local DB first to include any pending offline items
      const sid = String(user.shop_id);
      let finalProducts = []
      let finalCategories = []
      try {
        const [lProds, lCats] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray()
        ])
        finalProducts = lProds.filter(x => String(x.shop_id) === sid)
        finalCategories = lCats.filter(x => String(x.shop_id) === sid)
      } catch (dbErr) {
        console.warn('Products: Local DB read failed:', dbErr)
      }

      // Resilience: if local DB empty, use Supabase
      if (finalProducts.length === 0 && pData.data && pData.data.length > 0) {
        finalProducts = pData.data.filter(x => String(x.shop_id) === sid)
      }
      if (finalCategories.length === 0 && cData.data && cData.data.length > 0) {
        finalCategories = cData.data.filter(x => String(x.shop_id) === sid)
      }

      setProducts(finalProducts)
      setCategories(finalCategories)
    } catch (e) {
      console.log('Fetching products from local DB (Offline)')
      try {
        const [localProds, localCats] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray()
        ])
        const sid = String(user.shop_id)
        setProducts(localProds.filter(x => String(x.shop_id) === sid))
        setCategories(localCats.filter(x => String(x.shop_id) === sid))
      } catch (err) { console.error('Local DB Products Error', err) }
    } finally {
      setLoading(false)
    }
  }

  const filteredProducts = products.filter(p => {
    const matchSearch = String(p.name || '').toLowerCase().includes(search.toLowerCase()) ||
      String(p.brand || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = selectedCategory ? String(p.category_id) === String(selectedCategory) : true
    const matchLow = showLowStockOnly ? p.stock_quantity <= (p.low_stock_threshold || 10) : true
    return matchSearch && matchCat && matchLow
  })

  const handleExport = () => {
    const exportData = products.map(p => ({
      'Product Name': p.name,
      'Brand': p.brand || '-',
      'Category': p.categories?.name || '-',
      'Stock Qty': p.stock_quantity,
      'Cost Price': p.cost_price,
      'Sale Price': p.sale_price,
      'C.Rate': p.c_rate || 0,
      'Min Thresh': p.low_stock_threshold,
      'Status': p.status
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')
    XLSX.writeFile(wb, `Products_Export_${new Date().toLocaleDateString()}.xlsx`)
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

      if (!confirm(`Import ${data.length} rows?`)) return

      setLoading(true)
      let validCount = 0
      let skipCount = 0

      const formatted = []

      for (const row of Object.values(data)) {
        const name = row['Product Name'] || row['name']
        const brand = row['Brand'] || row['brand']

        if (!name || !String(name).trim() || !brand || !String(brand).trim()) {
          skipCount++
          continue
        }

        formatted.push({
          shop_id: user.shop_id,
          name: String(name).trim(),
          brand: String(brand).trim(),
          stock_quantity: parseFloat(row['Stock Qty'] || row['stock'] || 0),
          cost_price: parseFloat(row['Cost Price'] || row['cost'] || 0),
          sale_price: parseFloat(row['Sale Price'] || row['sale'] || 0),
          c_rate: parseFloat(row['C.Rate'] || 0),
          low_stock_threshold: parseFloat(row['Min Thresh'] || 10),
          status: row['Status'] || 'active'
        })
        validCount++
      }

      if (formatted.length === 0) {
        alert('No valid products found! Make sure "Product Name" and "Brand" columns exist and are not empty.')
        setLoading(false)
        return
      }

      const { error } = await supabase.from('products').insert(formatted)
      if (error) alert(error.message)
      else {
        await recordAuditLog(
          'BULK_IMPORT_PRODUCTS',
          'products',
          'multiple',
          { valid_count: validCount, skipped_count: skipCount },
          user.id,
          user.shop_id
        )
        alert(`Import successful! ✅\nAdded: ${validCount}\nSkipped (missing name/brand): ${skipCount}`)
        fetchProducts()
      }
      setLoading(false)
    }
    reader.readAsBinaryString(file)
  }

  // Delete logic
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
      const product = products.find(p => p.id === id)
      if (!product) continue

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('products').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue // Skip local deletion if server rejects (FK constraint)
          }
        } else {
          await addToSyncQueue('products', 'DELETE', { id })
        }

        await moveToTrash('products', id, product, user.id, user.shop_id)
        await db.products.delete(id)
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    // Optimistic UI update only for successful items
    setProducts(prev => prev.filter(p => !successfulIds.includes(p.id)))
    setSelected([])

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\nNote: Failed items may be linked to existing sales/purchases.`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} product(s) moved to Trash!`)
    }

    fetchProducts()
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selected.length === filteredProducts.length) {
      setSelected([])
    } else {
      setSelected(filteredProducts.map(x => x.id))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">📦 Products Portfolio</h1>
          <p className="text-gray-500 text-sm">Manage your inventory items and pricing</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImport}
            className="hidden"
            accept=".xlsx, .xls, .csv"
          />
          {hasFeature('bulk_import') && (
            <button
              onClick={() => fileInputRef.current.click()}
              className="px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 rounded-xl transition font-bold text-sm flex items-center gap-2 shadow-sm"
            >
              <span>📥</span> Import
            </button>
          )}
          <button
            onClick={handleExport}
            className="px-4 py-2 border border-blue-100 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition font-bold text-sm flex items-center gap-2 shadow-sm shadow-blue-50"
          >
            <span>📤</span> Export
          </button>
          {selected.length > 0 && (
            <button
              onClick={() => requestDelete(selected)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm flex items-center gap-2 shadow-sm"
            >
              🗑️ Delete Selected ({selected.length})
            </button>
          )}
          <Link
            to="/add-product"
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition shadow-lg shadow-blue-100 font-bold text-sm flex items-center gap-2"
          >
            <span>+</span> Add Product
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="flex gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search products..."
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1">
          <select
            className="px-4 py-2 border rounded-lg outline-none flex-shrink-0"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 cursor-pointer select-none border-l pl-4 border-gray-200 flex-shrink-0">
            <input
              type="checkbox"
              checked={showLowStockOnly}
              onChange={e => setShowLowStockOnly(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm font-medium text-gray-700">Show Low Stock Only</span>
          </label>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-gray-500">Loading products...</p>
      )}

      {/* Empty state */}
      {!loading && filteredProducts.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-100">
          <p className="text-gray-400 text-lg">No products found</p>
          <p className="text-gray-400">Try adjusting your filters or click "Add Product" to create a new one</p>
        </div>
      )}

      {/* Products Table */}
      {!loading && filteredProducts.length > 0 && (
        <div className="bg-white rounded-xl shadow overflow-hidden relative overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selected.length === filteredProducts.length && filteredProducts.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProducts.map((product) => (
                <tr key={product.id} className={`hover:bg-gray-50 ${selected.includes(product.id) ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selected.includes(product.id)}
                      onChange={() => toggleSelect(product.id)}
                      className="w-4 h-4 rounded"
                    />
                  </td>
                  <td className="px-6 py-4 font-bold text-gray-800">{product.name}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-black uppercase border border-gray-200">
                      {product.brand || 'No Brand'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">{product.categories?.name || 'No category'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${product.stock_quantity <= product.low_stock_threshold
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                      }`}>
                      {product.stock_quantity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500">Rs. {product.cost_price}</td>
                  <td className="px-6 py-4 text-gray-500">Rs. {product.sale_price}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${product.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                      }`}>
                      {product.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex justify-center gap-2">
                      <Link
                        to={`/edit-product/${product.id}`}
                        className="text-blue-600 hover:text-blue-800 font-bold text-sm bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition"
                      >
                        ✏️ Edit
                      </Link>
                      <button
                        onClick={() => requestDelete([product.id])}
                        className="text-red-600 hover:text-red-800 font-bold text-sm bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPasswordModal && (
        <PasswordModal
          title="Delete Product(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </div>
  )
}

export default Products