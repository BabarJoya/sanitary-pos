import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { useNavigate, useParams } from 'react-router-dom'
import { db, addToSyncQueue } from '../services/db'

function EditProduct() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [categories, setCategories] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [showNewBrandInput, setShowNewBrandInput] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [form, setForm] = useState({
    name: '',
    sku: '',
    brand: '',
    category_id: '',
    supplier_id: '',
    c_rate: '',
    cost_price: '',
    sale_price: '',
    stock_quantity: '',
    low_stock_threshold: '10',
    status: 'active'
  })

  useEffect(() => {
    fetchData()
  }, [id])

  const fetchData = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')

      // Fetch product and relationships
      const fetchPromise = Promise.all([
        supabase.from('products').select('*').eq('id', id).single(),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('suppliers').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const [prodResult, catResult, supResult, brandResult] = await Promise.race([fetchPromise, timeoutPromise])

      if (prodResult.error) throw new Error('Product not found')
      
      const product = prodResult.data
      setForm({
        name: product.name || '',
        sku: product.sku || '',
        brand: product.brand || '',
        category_id: product.category_id || '',
        supplier_id: product.supplier_id || '',
        c_rate: product.c_rate || '',
        cost_price: product.cost_price || '',
        sale_price: product.sale_price || '',
        stock_quantity: product.stock_quantity || '',
        low_stock_threshold: product.low_stock_threshold || '10',
        status: product.status || 'active'
      })

      const sid = String(user.shop_id)

      if (catResult.data) {
        setCategories(catResult.data)
        await db.categories.bulkPut(JSON.parse(JSON.stringify(catResult.data)))
      }
      if (supResult.data) {
        setSuppliers(supResult.data)
        await db.suppliers.bulkPut(JSON.parse(JSON.stringify(supResult.data)))
      }
      if (brandResult.data) {
        setBrands(brandResult.data)
        await db.brands.bulkPut(JSON.parse(JSON.stringify(brandResult.data)))
      }

    } catch (e) {
      console.log('EditProduct: Fetching from local DB (Offline)')
      try {
        const localProd = await db.products.get(id)
        if (localProd) {
            setForm({
                name: localProd.name || '',
                sku: localProd.sku || '',
                brand: localProd.brand || '',
                category_id: localProd.category_id || '',
                supplier_id: localProd.supplier_id || '',
                c_rate: localProd.c_rate || '',
                cost_price: localProd.cost_price || '',
                sale_price: localProd.sale_price || '',
                stock_quantity: localProd.stock_quantity || '',
                low_stock_threshold: localProd.low_stock_threshold || '10',
                status: localProd.status || 'active'
            })
        }

        const [lCats, lSups, lBrands] = await Promise.all([
          db.categories.toArray(),
          db.suppliers.toArray(),
          db.brands.toArray()
        ])
        const sid = String(user.shop_id)
        setCategories(lCats.filter(x => String(x.shop_id) === sid))
        setSuppliers(lSups.filter(x => String(x.shop_id) === sid))
        setBrands(lBrands.filter(x => String(x.shop_id) === sid))
      } catch (err) {
        console.error('Local DB EditProduct Error:', err)
      }
    } finally {
        setFetching(false)
    }
  }

  const handleAddBrand = async () => {
    if (!newBrandName.trim()) return

    const brandData = { id: crypto.randomUUID(), name: newBrandName.trim(), shop_id: user.shop_id }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      // Strip the local UUID id — brands.id is SERIAL (integer) in Supabase
      const { id: _localId, ...supabasePayload } = brandData
      const { data, error } = await supabase.from('brands').insert([supabasePayload]).select()
      if (error) throw error

      setBrands([...brands, data[0]])
      setForm({ ...form, brand: data[0].name })
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.brands.add(brandData)
        await addToSyncQueue('brands', 'INSERT', brandData)
        setBrands([...brands, brandData])
        setForm({ ...form, brand: brandData.name })
        alert('Offline mode: Brand added locally. Will sync when online! 🔄')
      } else {
        alert('Error adding brand: ' + errMsg)
      }
    }

    setNewBrandName('')
    setShowNewBrandInput(false)
  }

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    const updatedProductData = { ...form }
    
    // Ensure numeric fields are parsed correctly, treating empty strings as null/0 based on DB defaults
    if(updatedProductData.c_rate === '') updatedProductData.c_rate = 0;

    // Sanitize integer FK fields — offline-created records have UUID ids which
    // Supabase cannot cast to INTEGER. Parse to int; if it fails (UUID), set null.
    const toIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n }
    updatedProductData.category_id = updatedProductData.category_id ? toIntOrNull(updatedProductData.category_id) : null
    updatedProductData.supplier_id = updatedProductData.supplier_id ? toIntOrNull(updatedProductData.supplier_id) : null

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      const { error } = await supabase.from('products').update(updatedProductData).eq('id', id)
      if (error) throw error

      alert('Product updated successfully!')
      navigate('/products')
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        // Offline: Save to Local DB and Queue Sync
        await db.products.update(id, updatedProductData)
        await addToSyncQueue('products', 'UPDATE', { id, ...updatedProductData })
        alert('Offline mode: Product updated locally! It will sync automatically when you are back online. 🔄')
        navigate('/products')
      } else {
        alert('Error: ' + error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
      return <div className="text-gray-500 p-6">Loading product data...</div>
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">✏️ Edit Product</h1>

      <div className="bg-white rounded-xl shadow p-6 max-w-3xl">
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Basic Info */}
          <h2 className="font-semibold text-gray-700 border-b pb-2">Basic Information</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Product Name *</label>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Basin Tap"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1 flex justify-between">
                <span>Brand</span>
                <button
                  type="button"
                  onClick={() => setShowNewBrandInput(!showNewBrandInput)}
                  className="text-[10px] text-blue-600 font-bold uppercase hover:underline"
                >
                  {showNewBrandInput ? '← Select' : '+ New Brand'}
                </button>
              </label>
              {showNewBrandInput ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    className="flex-1 px-4 py-2 border border-blue-300 bg-blue-50 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Brand name..."
                  />
                  <button
                     type="button"
                    onClick={handleAddBrand}
                    className="px-3 bg-blue-600 text-white rounded-lg font-bold"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <select
                  name="brand"
                  value={form.brand}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select brand</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">SKU</label>
              <input
                type="text"
                name="sku"
                value={form.sku}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. TAP-001"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Category</label>
              <select
                name="category_id"
                value={form.category_id}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-gray-700 font-medium mb-1">Supplier</label>
            <select
              name="supplier_id"
              value={form.supplier_id}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select supplier</option>
              {suppliers.map((sup) => (
                <option key={sup.id} value={sup.id}>{sup.name}</option>
              ))}
            </select>
          </div>

          {/* Pricing */}
          <h2 className="font-semibold text-gray-700 border-b pb-2 pt-2">Pricing</h2>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">C.Rate (Company Rate)</label>
              <input
                type="number"
                name="c_rate"
                value={form.c_rate}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Purchase Price *</label>
              <input
                type="number"
                name="cost_price"
                value={form.cost_price}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Sale Price *</label>
              <input
                type="number"
                name="sale_price"
                value={form.sale_price}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
          </div>

          {/* Profit Preview */}
          {form.cost_price && form.sale_price && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-green-700 font-medium">
                💰 Profit per unit: Rs. {(parseFloat(form.sale_price) - parseFloat(form.cost_price)).toFixed(2)}
                <span className="ml-3 text-green-500">
                  ({(((parseFloat(form.sale_price) - parseFloat(form.cost_price)) / parseFloat(form.cost_price)) * 100).toFixed(1)}%)
                </span>
              </p>
            </div>
          )}

          {/* Stock */}
          <h2 className="font-semibold text-gray-700 border-b pb-2 pt-2">Stock</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Stock Quantity *</label>
              <input
                type="number"
                name="stock_quantity"
                value={form.stock_quantity}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Low Stock Alert</label>
              <input
                type="number"
                name="low_stock_threshold"
                value={form.low_stock_threshold}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="10"
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-700 font-medium mb-1">Status</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
              {loading ? 'Saving Update...' : 'Update Product'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/products')}
              className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition">
              Cancel
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}

export default EditProduct
