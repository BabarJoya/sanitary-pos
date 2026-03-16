import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { recordAuditLog } from '../services/auditService'
import { db, addToSyncQueue } from '../services/db'
import * as XLSX from 'xlsx'

function Inventory() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)

  // Bulk Price Update
  const [showBulkPriceModal, setShowBulkPriceModal] = useState(false)
  const [bulkBrand, setBulkBrand] = useState('')
  const [bulkPercent, setBulkPercent] = useState('')
  const [bulkAction, setBulkAction] = useState('increase')
  const [showBulkEditor, setShowBulkEditor] = useState(false)
  const [editingProducts, setEditingProducts] = useState([])
  const [historyProduct, setHistoryProduct] = useState(null)
  const [historyLogs, setHistoryLogs] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const handleExport = () => {
    const exportData = products.map(p => ({
      'Product': p.name,
      'Category': p.categories?.name || '-',
      'Brand': p.brand || '-',
      'Sale Price': p.sale_price,
      'Cost Price': user.role === 'admin' ? p.cost_price : 'HIDDEN',
      'Stock': p.stock_quantity,
      'Status': p.stock_quantity <= (p.low_stock_threshold || 10) ? 'LOW' : 'In Stock'
    }))

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory')
    XLSX.writeFile(wb, `Inventory_Report_${new Date().toLocaleDateString()}.xlsx`)
  }

  const handlePrint = () => {
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Stock Report - ${new Date().toLocaleDateString()}</title>
      <style>
        body { font-family: sans-serif; padding: 30px; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #eee; padding: 12px; text-align: left; }
        th { background: #f9f9f9; font-size: 12px; text-transform: uppercase; color: #666; }
        .low-stock { color: red; font-weight: bold; }
        .footer { margin-top: 30px; text-align: center; color: #888; font-size: 10px; }
      </style></head><body>
      <div class="header">
        <h1>Inventory Stock Report</h1>
        <p>Date: ${new Date().toLocaleString()}</p>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product Name</th>
            <th>Category</th>
            <th>Brand</th>
            <th>Price</th>
            <th>Current Stock</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${(products || []).filter(p => !showLowStockOnly || p.stock_quantity <= (p.low_stock_threshold || 10)).filter(p => !search || String(p.name || '').toLowerCase().includes(search.toLowerCase()) || (p.brand && p.brand.toLowerCase().includes(search.toLowerCase()))).map(p => `
            <tr>
              <td>${p.name}</td>
              <td>${p.categories?.name || '-'}</td>
              <td>${p.brand || '-'}</td>
              <td>Rs. ${p.sale_price}</td>
              <td>${p.stock_quantity}</td>
              <td><span class="${p.stock_quantity <= (p.low_stock_threshold || 10) ? 'low-stock' : ''}">
                ${p.stock_quantity <= (p.low_stock_threshold || 10) ? 'LOW STOCK' : 'In Stock'}
              </span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="footer">Computer Generated Stock Report</div>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  // Adjustment Modal
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [newStock, setNewStock] = useState('')
  const [adjustmentNote, setAdjustmentNote] = useState('')
  const [returnProduct, setReturnProduct] = useState(null)
  const [returnQty, setReturnQty] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (user?.shop_id) fetchInventory()
  }, [user?.shop_id])

  const fetchInventory = async () => {
    setLoading(true)
    try {
      if (!user?.shop_id) {
        setLoading(false)
        console.error('Inventory: Missing user.shop_id!')
        return
      }
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = Promise.all([
        supabase.from('products').select('*, categories(name)').eq('shop_id', user.shop_id).order('name'),
        supabase.from('categories').select('*').eq('shop_id', user.shop_id),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const [p, c, b] = await Promise.race([fetchPromise, timeoutPromise])

      if (p.error || c.error || b.error) throw new Error('Supabase fetch failed')

      // Cache to local DB
      if (p.data) {
        const cleanP = JSON.parse(JSON.stringify(p.data))
        try { await db.products.bulkPut(cleanP) } catch (dbErr) { console.warn('Inventory: Local cache write failed:', dbErr) }
      }
      if (c.data) {
        const cleanC = JSON.parse(JSON.stringify(c.data))
        try { await db.categories.bulkPut(cleanC) } catch (dbErr) { console.warn('Inventory: Local cache write failed:', dbErr) }
      }
      if (b.data) {
        const cleanB = JSON.parse(JSON.stringify(b.data))
        try { await db.brands.bulkPut(cleanB) } catch (dbErr) { console.warn('Inventory: Local cache write failed:', dbErr) }
      }

      // Try rendering from local DB first to include any pending offline items
      const sid = String(user.shop_id);
      let finalProducts = []
      let finalCategories = []
      try {
        const [lProds, lCats, lBrands] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray(),
          db.brands.toArray()
        ])
        finalProducts = lProds.filter(x => String(x.shop_id) === sid)
        finalCategories = lCats.filter(x => String(x.shop_id) === sid)
        const finalBrands = lBrands.filter(x => String(x.shop_id) === sid)
        setBrands(finalBrands)
      } catch (dbErr) {
        console.warn('Inventory: Local DB read failed, using Supabase data directly:', dbErr)
      }

      // Resilience: if local DB returned empty but Supabase had data, use Supabase directly
      if (finalProducts.length === 0 && p.data && p.data.length > 0) {
        console.log('Inventory: Local DB returned empty, using Supabase data directly (' + p.data.length + ' products)')
        finalProducts = p.data.filter(x => String(x.shop_id) === sid)
      }
      if (finalCategories.length === 0 && c.data && c.data.length > 0) {
        finalCategories = c.data.filter(x => String(x.shop_id) === sid)
      }

      console.log('Inventory: Loaded', finalProducts.length, 'products,', finalCategories.length, 'categories')
      setProducts(finalProducts)
      setCategories(finalCategories)
      if (!brands.length && b?.data) setBrands(b.data)
    } catch (e) {
      console.log('Inventory: Fetching from local DB (Offline Fallback)', e.message)
      try {
        const [lProds, lCats, lBrands] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray(),
          db.brands.toArray()
        ])
        const sid = String(user.shop_id);
        const myProds = lProds.filter(x => String(x.shop_id) === sid)
        const myCats = lCats.filter(x => String(x.shop_id) === sid)
        const myBrands = lBrands.filter(x => String(x.shop_id) === sid)
        setProducts(myProds)
        setCategories(myCats)
        setBrands(myBrands)
      } catch (err) { console.error('Local DB Inventory Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const filtered = products.filter(p => {
    const matchSearch = String(p.name || '').toLowerCase().includes(search.toLowerCase()) ||
      String(p.brand || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = selectedCategory ? String(p.category_id) === String(selectedCategory) : true
    const matchBrand = selectedBrand ? String(p.brand) === String(selectedBrand) : true
    const matchLow = showLowStockOnly ? p.stock_quantity <= (p.low_stock_threshold || 10) : true
    return matchSearch && matchCat && matchBrand && matchLow
  })

  // Valuation
  const totalCostValue = products.reduce((sum, p) => sum + (p.cost_price || 0) * p.stock_quantity, 0)
  const totalSaleValue = products.reduce((sum, p) => sum + (p.sale_price || 0) * p.stock_quantity, 0)
  const totalProfitValue = totalSaleValue - totalCostValue
  const lowStockCount = products.filter(p => p.stock_quantity <= (p.low_stock_threshold || 10)).length
  const criticalStockCount = products.filter(p => p.stock_quantity <= 5).length

  const handleAdjustStock = async (e) => {
    e.preventDefault()
    if (!selectedProduct || newStock === '') return

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      const { error } = await supabase
        .from('products')
        .update({ stock_quantity: parseInt(newStock) })
        .eq('id', selectedProduct.id)

      if (error) throw error

      // Audit Log
      recordAuditLog(
        'STOCK_ADJUSTMENT',
        'products',
        selectedProduct.id,
        {
          product: selectedProduct.name,
          old_stock: selectedProduct.stock_quantity,
          new_stock: parseInt(newStock),
          note: adjustmentNote || 'Manual adjustment'
        },
        user.id,
        user.shop_id
      )

      setSelectedProduct(null)
      setNewStock('')
      setAdjustmentNote('')
      fetchInventory()
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const updatedProduct = { ...selectedProduct, stock_quantity: parseInt(newStock) }
        await db.products.update(selectedProduct.id, { stock_quantity: parseInt(newStock) })
        await addToSyncQueue('products', 'UPDATE', updatedProduct)

        setSelectedProduct(null)
        setNewStock('')
        fetchInventory()
        alert('Offline mode: Stock adjusted locally. Will sync when online! 🔄')
      } else {
        alert('Error updating stock: ' + errMsg)
      }
    }
    setSaving(false)
  }

  const handleRecordReturn = async (e) => {
    e.preventDefault()
    if (!returnProduct || !returnProduct.id || returnQty === '') return

    setSaving(true)
    const qty = parseInt(returnQty)
    let currentStock = 0

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      // 1. Fetch latest stock to ensure accuracy
      const { data: latest, error: fetchError } = await supabase
        .from('products')
        .select('stock_quantity')
        .eq('id', returnProduct.id)
        .single()

      if (fetchError) throw fetchError
      currentStock = latest.stock_quantity || 0
      const newTotal = currentStock + qty

      // 2. Update stock
      const { error: updateError } = await supabase
        .from('products')
        .update({ stock_quantity: newTotal })
        .eq('id', returnProduct.id)

      if (updateError) throw updateError

      // 3. Audit Log
      await recordAuditLog(
        'PRODUCT_RETURN',
        'products',
        returnProduct.id,
        {
          product: returnProduct.name,
          old_stock: currentStock,
          new_stock: newTotal,
          return_qty: qty,
          note: 'Recorded product return (Robust Update)'
        },
        user.id,
        user.shop_id
      )

      alert(`Success! ${qty} units returned. New stock: ${newTotal}`)
      setReturnProduct(null)
      setReturnQty('')
      fetchInventory()
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        // Offline Fallback for returns
        const localProd = await db.products.get(returnProduct.id)
        currentStock = localProd?.stock_quantity || 0
        const newTotal = currentStock + qty

        await db.products.update(returnProduct.id, { stock_quantity: newTotal })
        await addToSyncQueue('products', 'UPDATE', { ...returnProduct, stock_quantity: newTotal })

        alert(`Offline mode: ${qty} units returned locally. New stock: ${newTotal}. Will sync later! 🔄`)
        setReturnProduct(null)
        setReturnQty('')
        fetchInventory()
      } else {
        alert('Error recording return: ' + errMsg)
      }
    } finally {
      setSaving(false)
    }
  }

  const fetchProductHistory = async (product) => {
    setHistoryProduct(product)
    setLoadingHistory(true)
    try {
      // Fetch from local DB for speed and offline support
      const [logs, sales, purchases] = await Promise.all([
        db.audit_logs.where('entity_id').equals(product.id).toArray(),
        db.sale_items.where('product_id').equals(product.id).toArray(),
        db.purchase_items.where('product_id').equals(product.id).toArray()
      ])

      // Map and merge
      const merged = [
        ...logs.map(l => ({
          date: l.timestamp,
          type: 'AUDIT',
          desc: `${l.action.replace(/_/g, ' ')}: ${JSON.stringify(l.details)}`
        })),
        ...sales.map(s => ({
          date: s.created_at || new Date().toISOString(),
          type: 'SALE',
          desc: `Sold ${s.quantity} units @ Rs. ${s.unit_price}`
        })),
        ...purchases.map(p => ({
          date: p.created_at || new Date().toISOString(),
          type: 'PURCHASE',
          desc: `Purchased ${p.quantity} units @ Rs. ${p.unit_price}`
        }))
      ].sort((a, b) => new Date(b.date) - new Date(a.date))

      setHistoryLogs(merged)
    } catch (err) {
      console.error('History Error:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const openBulkEditor = () => {
    const brandProds = bulkBrand ? products.filter(p => p.brand === bulkBrand) : products;
    setEditingProducts(brandProds.map(p => ({ ...p, original_c_rate: p.c_rate || 0, original_cost: p.cost_price, original_sale: p.sale_price })));
    setShowBulkEditor(true);
  }

  const handleBulkEditorSave = async () => {
    setSaving(true)
    const modified = editingProducts.filter(p => p.c_rate !== p.original_c_rate || p.cost_price !== p.original_cost || p.sale_price !== p.original_sale);

    try {
      if (navigator.onLine) {
        for (const p of modified) {
          const { error } = await supabase.from('products').update({ c_rate: p.c_rate, cost_price: p.cost_price, sale_price: p.sale_price }).eq('id', p.id);
          if (error) throw error;

          await recordAuditLog('PRICE_CHANGE', 'products', p.id, {
            old: { c_rate: p.original_c_rate, cost: p.original_cost, sale: p.original_sale },
            new: { c_rate: p.c_rate, cost: p.cost_price, sale: p.sale_price }
          }, user.id, user.shop_id);
        }
      } else {
        for (const p of modified) {
          await addToSyncQueue('products', 'UPDATE', { id: p.id, c_rate: p.c_rate, cost_price: p.cost_price, sale_price: p.sale_price });
        }
      }

      // Update local storage
      for (const p of modified) {
        await db.products.update(p.id, { c_rate: p.c_rate, cost_price: p.cost_price, sale_price: p.sale_price });
      }

      alert('Prices updated and logged!');
      setShowBulkEditor(false);
      fetchInventory();
    } catch (err) {
      alert('Save failed: ' + err.message);
    } finally {
      setSaving(false)
    }
  }

  const handleBulkPriceUpdate = async (e) => {
    e.preventDefault()
    if (!bulkBrand || !bulkPercent) return

    setSaving(true)
    const factor = bulkAction === 'increase' ? (1 + parseFloat(bulkPercent) / 100) : (1 - parseFloat(bulkPercent) / 100)

    try {
      const affected = products.filter(p => p.brand === bulkBrand)
      if (affected.length === 0) throw new Error('No products found for this brand.')

      if (navigator.onLine) {
        for (const p of affected) {
          const newCost = Math.round((p.cost_price || 0) * factor)
          const newSale = Math.round((p.sale_price || 0) * factor)

          const { error } = await supabase.from('products').update({ cost_price: newCost, sale_price: newSale }).eq('id', p.id)
          if (error) throw error

          await recordAuditLog('PRICE_CHANGE_BULK', 'products', p.id, {
            old: { cost: p.cost_price, sale: p.sale_price },
            new: { cost: newCost, sale: newSale },
            percent: bulkPercent,
            action: bulkAction
          }, user.id, user.shop_id)
        }
      } else {
        for (const p of affected) {
          const newCost = Math.round((p.cost_price || 0) * factor)
          const newSale = Math.round((p.sale_price || 0) * factor)
          await addToSyncQueue('products', 'UPDATE', { id: p.id, cost_price: newCost, sale_price: newSale })
        }
      }

      // Local update
      for (const p of affected) {
        const newCost = Math.round((p.cost_price || 0) * factor)
        const newSale = Math.round((p.sale_price || 0) * factor)
        await db.products.update(p.id, { cost_price: newCost, sale_price: newSale })
      }

      alert(`Successfully updated ${affected.length} products of brand ${bulkBrand} by ${bulkPercent}%`)
      setShowBulkPriceModal(false)
      setBulkPercent('')
      fetchInventory()
    } catch (err) {
      alert('Bulk update failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const openAdjustModal = (p) => {
    setSelectedProduct(p)
    setNewStock(p.stock_quantity)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">📦 Inventory Management</h1>
          <p className="text-gray-500">Track and manage your stock levels</p>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1 max-w-full">
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
            <p className="text-xs text-gray-400 font-bold uppercase">Total Items</p>
            <p className="text-lg font-bold text-blue-600">{products.length}</p>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
            <p className="text-xs text-gray-400 font-bold uppercase">Low Stock</p>
            <p className="text-lg font-bold text-orange-500">{lowStockCount}</p>
          </div>
          <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
            <p className="text-xs text-gray-400 font-bold uppercase">Critical</p>
            <p className="text-lg font-bold text-red-600">{criticalStockCount}</p>
          </div>
          {(user.role === 'admin' || user.role === 'manager') && (
            <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
              <p className="text-xs text-gray-400 font-bold uppercase">Est. Profit</p>
              <p className="text-lg font-bold text-green-600">Rs. {totalProfitValue.toLocaleString()}</p>
            </div>
          )}
          {(user.role === 'admin' || user.role === 'manager') && (
            <div className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
              <p className="text-xs text-gray-400 font-bold uppercase">Stock Value (Cost)</p>
              <p className="text-lg font-bold text-blue-600">Rs. {totalCostValue.toLocaleString()}</p>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-4 w-full sm:w-auto">
          <input
            type="text"
            placeholder="Search product or brand..."
            className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            value={search}
            onChange={e => setSearch(e.target.value)}
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
          <select
            className="px-4 py-2 border rounded-lg outline-none flex-shrink-0"
            value={selectedBrand}
            onChange={e => setSelectedBrand(e.target.value)}
          >
            <option value="">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          <label className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0">
            <input
              type="checkbox"
              checked={showLowStockOnly}
              onChange={e => setShowLowStockOnly(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm font-medium text-gray-700">Show Low Stock Only</span>
          </label>
          <button
            onClick={handleExport}
            className="px-4 py-2 border border-blue-100 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition font-bold text-sm flex items-center gap-2 shadow-sm flex-shrink-0"
          >
            <span>📤</span> Export to Excel
          </button>
          {(user.role === 'admin' || user.role === 'manager') && (
            <button
              onClick={() => setReturnProduct({})} // Open return modal with empty/any selection
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition font-bold text-sm flex items-center gap-2 flex-shrink-0"
            >
              <span>🔙</span> Record Return
            </button>
          )}
          {(user.role === 'admin' || user.role === 'manager') && (
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setShowBulkPriceModal(true)}
                className="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition font-bold text-sm flex items-center gap-2"
              >
                <span>📈</span> % Change
              </button>
              <button
                onClick={openBulkEditor}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-bold text-sm flex items-center gap-2 shadow-md shadow-purple-100"
              >
                <span>✏️</span> Edit Prices
              </button>
            </div>
          )}
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-bold text-sm flex items-center gap-2 shadow-sm flex-shrink-0"
          >
            <span>🖨️</span> Print Inventory
          </button>
          <button
            onClick={() => { setSearch(''); setSelectedCategory(''); setSelectedBrand(''); setShowLowStockOnly(false); }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition flex-shrink-0"
          >
            Reset
          </button>
          <button
            onClick={fetchInventory}
            className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition flex-shrink-0"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Product</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Category</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Brand</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">C. Rate</th>
                {(user.role === 'admin' || user.role === 'manager') && <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Cost Price</th>}
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Sale Price</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-center whitespace-nowrap">Stock</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan="8" className="px-6 py-10 text-center text-gray-400 italic text-lg">Loading inventory data...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="8" className="px-6 py-10 text-center text-gray-400 italic text-lg">No products found matching criteria.</td></tr>
              ) : filtered.map(p => {
                const isLow = p.stock_quantity <= (p.low_stock_threshold || 10)
                const isCritical = p.stock_quantity <= 5
                const isZero = p.stock_quantity <= 0
                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 font-semibold text-gray-800">{p.name}</td>
                    <td className="px-6 py-4 text-gray-500">{p.categories?.name || '-'}</td>
                    <td className="px-6 py-4 text-gray-500">{p.brand || '-'}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded-lg font-bold text-xs border border-blue-100 italic">
                        {p.c_rate || 0}
                      </span>
                    </td>
                    {(user.role === 'admin' || user.role === 'manager') && <td className="px-6 py-4 text-gray-600">Rs. {p.cost_price}</td>}
                    <td className="px-6 py-4 text-blue-600 font-bold text-lg">Rs. {p.sale_price}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-4 py-1.5 rounded-full font-bold text-lg ${isZero ? 'bg-black text-white' : isCritical ? 'bg-red-100 text-red-700 border border-red-200' : isLow ? 'bg-orange-100 text-orange-700 border border-orange-200' : 'bg-green-100 text-green-700 border border-green-200'}`}>
                        {p.stock_quantity}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {isZero ? (
                        <span className="flex items-center gap-1.5 text-black font-black uppercase text-xs">
                          ⚠️ Out of Stock
                        </span>
                      ) : isCritical ? (
                        <span className="flex items-center gap-1.5 text-red-600 font-bold animate-pulse">
                          <span className="w-2.5 h-2.5 bg-red-600 rounded-full"></span> Critical
                        </span>
                      ) : isLow ? (
                        <span className="text-orange-600 font-bold">Low Stock</span>
                      ) : (
                        <span className="text-green-600 font-medium">In Stock</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => fetchProductHistory(p)}
                          className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition"
                          title="View Product History"
                        >
                          📜
                        </button>
                        {(user.role === 'admin' || user.role === 'manager') && (
                          <button
                            onClick={() => openAdjustModal(p)}
                            className="px-3 py-1.5 bg-gray-600 hover:bg-gray-800 text-white rounded-lg text-sm transition"
                          >
                            Adjust
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Stock Modal */}
      {selectedProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Manual Adjustment</h2>
              <button onClick={() => setSelectedProduct(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Update stock for <b>{selectedProduct.name}</b></p>
            <form onSubmit={handleAdjustStock} className="space-y-4">
              <div>
                <label className="block text-gray-700 font-medium mb-1">New Stock Quantity</label>
                <input
                  type="number"
                  autoFocus
                  required
                  value={newStock}
                  onChange={e => setNewStock(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-xl font-bold"
                />
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-1 text-sm">Reason / Note</label>
                <input
                  type="text"
                  placeholder="e.g. Broken item, Found in warehouse..."
                  value={adjustmentNote}
                  onChange={e => setAdjustmentNote(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50"
                >
                  {saving ? 'Updating...' : 'Update Stock'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedProduct(null)}
                  className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Record Return Modal */}
      {returnProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Record Product Return</h2>
              <button onClick={() => setReturnProduct(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <form onSubmit={handleRecordReturn} className="space-y-4">
              <div>
                <label className="block text-gray-700 font-medium mb-1">Select Product</label>
                <select
                  required
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  value={returnProduct?.id || ''}
                  onChange={e => {
                    const p = products.find(x => String(x.id) === String(e.target.value))
                    if (p) {
                      setReturnProduct(p)
                    } else {
                      setReturnProduct({}) // Fallback to empty object instead of undefined to keep modal open
                    }
                  }}
                >
                  <option value="">Choose a product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.brand})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-700 font-medium mb-1">Return Quantity</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={returnQty}
                  onChange={e => setReturnQty(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="How many items returned?"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={saving || !returnProduct?.id}
                  className="flex-1 py-2 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Confirm Return'}
                </button>
                <button
                  type="button"
                  onClick={() => setReturnProduct(null)}
                  className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Price Update Modal */}
      {showBulkPriceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-800">Bulk Price Update</h2>
              <button onClick={() => setShowBulkPriceModal(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <p className="text-sm text-gray-500 mb-6">Modify all products of a specific brand by a percentage.</p>

            <form onSubmit={handleBulkPriceUpdate} className="space-y-4">
              <div>
                <label className="block text-gray-700 font-medium mb-1">Select Brand</label>
                <select
                  required
                  className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                  value={bulkBrand}
                  onChange={e => setBulkBrand(e.target.value)}
                >
                  <option value="">Choose a brand...</option>
                  {brands.map(b => (
                    <option key={b.id} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-700 font-medium mb-1">Action</label>
                  <select
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                    value={bulkAction}
                    onChange={e => setBulkAction(e.target.value)}
                  >
                    <option value="increase">Increase (+)</option>
                    <option value="decrease">Decrease (-)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-gray-700 font-medium mb-1">Percentage (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    min="0"
                    className="w-full px-4 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-purple-500"
                    value={bulkPercent}
                    onChange={e => setBulkPercent(e.target.value)}
                    placeholder="e.g. 10"
                  />
                </div>
              </div>

              <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 mb-2">
                <p className="text-xs text-purple-700 font-medium leading-relaxed">
                  <b>Note:</b> Both Cost Price and Sale Price will be updated. Values will be rounded to the nearest integer.
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition disabled:opacity-50 shadow-md shadow-purple-100"
                >
                  {saving ? 'Updating Prices...' : `Apply ${bulkAction.charAt(0).toUpperCase() + bulkAction.slice(1)}`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowBulkPriceModal(false)}
                  className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Timeline: {historyProduct.name}</h2>
                <p className="text-xs text-gray-500">{historyProduct.brand} | {historyProduct.sku || 'No SKU'}</p>
              </div>
              <button onClick={() => setHistoryProduct(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {loadingHistory ? (
                <p className="text-center py-10 text-gray-400">Fetching history logs...</p>
              ) : historyLogs.length === 0 ? (
                <p className="text-center py-10 text-gray-400 italic">No history found for this product.</p>
              ) : historyLogs.map((log, idx) => (
                <div key={idx} className="flex gap-4 p-3 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="shrink-0 flex flex-col items-center">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${log.type === 'SALE' ? 'bg-green-100 text-green-600' :
                        log.type === 'PURCHASE' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'
                      }`}>
                      {log.type === 'SALE' ? '🛒' : log.type === 'PURCHASE' ? '🚚' : '📝'}
                    </span>
                    <div className="w-0.5 flex-1 bg-gray-200 my-1"></div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{log.type}</span>
                      <span className="text-[10px] text-gray-400">{new Date(log.date).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-gray-700 font-medium">{log.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bulk Price Editor Modal */}
      {showBulkEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-gray-800">Individual Bulk Price Editor</h2>
                <p className="text-sm text-gray-500">Edit costs and sale prices for <b>{bulkBrand || 'All Brands'}</b></p>
              </div>
              <button onClick={() => setShowBulkEditor(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>

            <div className="flex-1 overflow-auto border rounded-xl mb-4 bg-gray-50">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left text-xs font-bold text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">C. Rate</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">Cost Price</th>
                    <th className="px-4 py-2 text-right text-xs font-bold text-gray-500 uppercase">Sale Price</th>
                    <th className="px-4 py-2 text-center text-xs font-bold text-gray-500 uppercase">Margin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {editingProducts.map((p, idx) => {
                    const margin = p.sale_price - p.cost_price;
                    const marginPercent = p.cost_price > 0 ? ((margin / p.cost_price) * 100).toFixed(0) : 0;
                    return (
                      <tr key={p.id}>
                        <td className="px-4 py-2 font-medium text-gray-700">{p.name} <span className="text-[10px] text-gray-400">({p.brand})</span></td>
                        <td className="px-4 py-2">
                          <input type="number"
                            value={p.c_rate || 0}
                            onChange={e => {
                              const newProds = [...editingProducts];
                              newProds[idx].c_rate = Number(e.target.value);
                              setEditingProducts(newProds);
                            }}
                            className={`w-20 px-2 py-1 border rounded text-right focus:ring-2 focus:ring-blue-500 outline-none ${p.c_rate !== p.original_c_rate ? 'bg-yellow-50 border-yellow-400' : ''}`}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number"
                            value={p.cost_price}
                            onChange={e => {
                              const newProds = [...editingProducts];
                              newProds[idx].cost_price = Number(e.target.value);
                              setEditingProducts(newProds);
                            }}
                            className={`w-24 px-2 py-1 border rounded text-right focus:ring-2 focus:ring-purple-500 outline-none ${p.cost_price !== p.original_cost ? 'bg-yellow-50 border-yellow-400' : ''}`}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number"
                            value={p.sale_price}
                            onChange={e => {
                              const newProds = [...editingProducts];
                              newProds[idx].sale_price = Number(e.target.value);
                              setEditingProducts(newProds);
                            }}
                            className={`w-24 px-2 py-1 border rounded text-right focus:ring-2 focus:ring-purple-500 outline-none ${p.sale_price !== p.original_sale ? 'bg-yellow-50 border-yellow-400' : ''}`}
                          />
                        </td>
                        <td className={`px-4 py-2 text-center font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {marginPercent}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 shrink-0">
              <button
                onClick={handleBulkEditorSave}
                disabled={saving}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition disabled:opacity-50"
              >
                {saving ? 'Saving Changes...' : '✅ Save All Changes'}
              </button>
              <button
                onClick={() => setShowBulkEditor(false)}
                className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Inventory
