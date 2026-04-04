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
  const [brands, setBrands] = useState([])
  const [units, setUnits] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showLowStockOnly, setShowLowStockOnly] = useState(false)
  const { user } = useAuth()
  const fileInputRef = useRef(null)
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkBrand, setBulkBrand] = useState('')
  const [bulkUnit, setBulkUnit] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // Inline edit state
  const [inlineEditId, setInlineEditId] = useState(null)
  const [inlineForm, setInlineForm] = useState({})
  const [inlineSaving, setInlineSaving] = useState(false)

  // Import preview state
  const [showImportPreview, setShowImportPreview] = useState(false)
  const [importPreviewRows, setImportPreviewRows] = useState([])
  const [autoCreateCategories, setAutoCreateCategories] = useState(false)
  const [autoCreateBrands, setAutoCreateBrands] = useState(false)

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
        supabase.from('categories').select('*').eq('shop_id', user.shop_id),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('units').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const [pData, cData, bData, uData] = await Promise.race([fetchPromise, timeoutPromise])

      if (pData.error || cData.error || bData.error) throw new Error('Supabase fetch failed')

      // Cache to local DB
      if (pData.data) {
        await db.products.bulkPut(JSON.parse(JSON.stringify(pData.data)))
      }
      if (cData.data) {
        await db.categories.bulkPut(JSON.parse(JSON.stringify(cData.data)))
      }
      if (bData.data) {
        await db.brands.bulkPut(JSON.parse(JSON.stringify(bData.data)))
      }
      if (uData?.data) {
        await db.units.bulkPut(JSON.parse(JSON.stringify(uData.data))).catch(() => {})
      }

      // Try rendering from local DB first to include any pending offline items
      const sid = String(user.shop_id);
      let finalProducts = []
      let finalCategories = []
      let finalBrands = []
      let finalUnits = []
      try {
        const [lProds, lCats, lBrands, lUnits] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray(),
          db.brands.toArray(),
          db.units.toArray()
        ])
        finalProducts = lProds.filter(x => String(x.shop_id) === sid)
        finalCategories = lCats.filter(x => String(x.shop_id) === sid)
        finalBrands = lBrands.filter(x => String(x.shop_id) === sid)
        finalUnits = lUnits.filter(x => String(x.shop_id) === sid)
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
      if (finalBrands.length === 0 && bData.data && bData.data.length > 0) {
        finalBrands = bData.data.filter(x => String(x.shop_id) === sid)
      }
      if (finalUnits.length === 0 && uData?.data && uData.data.length > 0) {
        finalUnits = uData.data.filter(x => String(x.shop_id) === sid)
      }

      setProducts(finalProducts)
      setCategories(finalCategories)
      setBrands(finalBrands)
      setUnits(finalUnits)
    } catch (e) {
      console.log('Fetching products from local DB (Offline)')
      try {
        const [localProds, localCats, localBrands, localUnits] = await Promise.all([
          db.products.toArray(),
          db.categories.toArray(),
          db.brands.toArray(),
          db.units.toArray()
        ])
        const sid = String(user.shop_id)
        setProducts(localProds.filter(x => String(x.shop_id) === sid))
        setCategories(localCats.filter(x => String(x.shop_id) === sid))
        setBrands(localBrands.filter(x => String(x.shop_id) === sid))
        setUnits(localUnits.filter(x => String(x.shop_id) === sid))
      } catch (err) { console.error('Local DB Products Error', err) }
    } finally {
      setLoading(false)
    }
  }

  // Effective threshold: product-level → category-level → system default (10)
  const getEffectiveThreshold = (product) => {
    if (product.low_stock_threshold) return product.low_stock_threshold
    const cat = categories.find(c => c.id === product.category_id)
    if (cat?.low_stock_threshold) return cat.low_stock_threshold
    return 10
  }

  const filteredProducts = products.filter(p => {
    const matchSearch = String(p.name || '').toLowerCase().includes(search.toLowerCase()) ||
      String(p.brand || '').toLowerCase().includes(search.toLowerCase())
    const matchCat = selectedCategory ? String(p.category_id) === String(selectedCategory) : true
    const matchLow = showLowStockOnly ? p.stock_quantity <= getEffectiveThreshold(p) : true
    return matchSearch && matchCat && matchLow
  })

  // Category low stock summary for banner
  const categoryLowStockAlerts = categories
    .filter(c => c.low_stock_threshold > 0)
    .map(c => ({
      cat: c,
      count: products.filter(p => p.category_id === c.id && p.stock_quantity <= c.low_stock_threshold).length
    }))
    .filter(a => a.count > 0)

  const handleExport = () => {
    const toExport = selected.length > 0
      ? products.filter(p => selected.includes(p.id))
      : products
    const exportData = toExport.map(p => {
      const unit = units.find(u => u.id === p.unit_id)
      return {
        'SKU': p.sku || '',
        'Product Name': p.name,
        'Brand': p.brand || '-',
        'Category': p.categories?.name || '-',
        'Unit': unit ? unit.name : '',
        'Stock Qty': p.stock_quantity,
        'Cost Price': p.cost_price,
        'Sale Price': p.sale_price,
        'C.Rate': p.c_rate || 0,
        'Min Thresh': p.low_stock_threshold,
        'Status': p.status
      }
    })

    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Products')
    XLSX.writeFile(wb, `Products_Export_${new Date().toLocaleDateString()}.xlsx`)
  }

  const handleImport = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = null

    const reader = new FileReader()
    reader.onload = (evt) => {
      const bstr = evt.target.result
      const wb = XLSX.read(bstr, { type: 'binary' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(ws)
      if (data.length === 0) { alert('Empty file!'); return }

      const previewRows = []
      for (const row of data) {
        const name = String(row['Product Name'] || row['name'] || '').trim()
        const brand = String(row['Brand'] || row['brand'] || '').trim()
        if (!name || !brand) continue
        const categoryName = String(row['Category'] || row['category'] || '').trim()
        const matchedCat = categoryName && categoryName !== '-'
          ? categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase())
          : null
        const unitName = String(row['Unit'] || row['unit'] || '').trim()
        const matchedUnit = unitName ? units.find(u => u.name.toLowerCase() === unitName.toLowerCase()) : null
        const brandLower = brand.toLowerCase()
        const brandMatched = brands.some(b => b.name.toLowerCase() === brandLower)
        previewRows.push({
          name, brand, categoryName: categoryName !== '-' ? categoryName : '',
          categoryId: matchedCat?.id || null,
          matched: !categoryName || categoryName === '-' || !!matchedCat,
          brandMatched,
          sku: String(row['SKU'] || row['sku'] || '').trim(),
          unitName,
          unitId: matchedUnit?.id || null,
          stock_quantity: parseFloat(row['Stock Qty'] || row['stock'] || 0),
          cost_price: parseFloat(row['Cost Price'] || row['cost'] || 0),
          sale_price: parseFloat(row['Sale Price'] || row['sale'] || 0),
          c_rate: parseFloat(row['C.Rate'] || 0),
          low_stock_threshold: parseFloat(row['Min Thresh'] || 10),
          status: row['Status'] || 'active'
        })
      }

      if (previewRows.length === 0) { alert('No valid rows (Product Name + Brand required)'); return }
      setImportPreviewRows(previewRows)
      setAutoCreateCategories(false)
      setShowImportPreview(true)
    }
    reader.readAsBinaryString(file)
  }

  const handleConfirmImport = async () => {
    setLoading(true)
    setShowImportPreview(false)

    let rows = importPreviewRows
    let currentCategories = [...categories]

    // Auto-create missing categories — use upsert to avoid duplicates
    if (autoCreateCategories) {
      const unmatchedNames = [...new Set(rows
        .filter(r => r.categoryName && !r.categoryId)
        .map(r => r.categoryName))]

      for (const catName of unmatchedNames) {
        try {
          // First check if it already exists (case-insensitive)
          const existing = currentCategories.find(c => c.name.toLowerCase() === catName.toLowerCase())
          if (existing) continue

          // Check in Supabase too (in case local cache is stale)
          const { data: found } = await supabase
            .from('categories')
            .select('*')
            .eq('shop_id', user.shop_id)
            .ilike('name', catName)
            .maybeSingle()

          if (found) {
            currentCategories.push(found)
          } else {
            const { data: newCat, error } = await supabase
              .from('categories')
              .insert([{ name: catName, shop_id: user.shop_id }])
              .select()
            if (!error && newCat?.[0]) currentCategories.push(newCat[0])
          }
        } catch (err) { /* skip */ }
      }

      // Re-map category IDs after creating
      rows = rows.map(r => {
        if (r.categoryName && !r.categoryId) {
          const found = currentCategories.find(c => c.name.toLowerCase() === r.categoryName.toLowerCase())
          return { ...r, categoryId: found?.id || null }
        }
        return r
      })
    }

    // Auto-create missing brands — same pattern as categories
    let currentBrands = [...brands]
    if (autoCreateBrands) {
      const unmatchedBrandNames = [...new Set(rows
        .filter(r => r.brand && !r.brandMatched)
        .map(r => r.brand))]

      for (const brandName of unmatchedBrandNames) {
        try {
          const existingLocal = currentBrands.find(b => b.name.toLowerCase() === brandName.toLowerCase())
          if (existingLocal) continue

          const { data: found } = await supabase
            .from('brands')
            .select('*')
            .eq('shop_id', user.shop_id)
            .ilike('name', brandName)
            .maybeSingle()

          if (found) {
            currentBrands.push(found)
          } else {
            const { data: newBrand, error } = await supabase
              .from('brands')
              .insert([{ name: brandName, shop_id: user.shop_id }])
              .select()
            if (!error && newBrand?.[0]) currentBrands.push(newBrand[0])
          }
        } catch (err) { /* skip */ }
      }

      // Re-map brandMatched after creating
      rows = rows.map(r => {
        if (r.brand && !r.brandMatched) {
          const found = currentBrands.find(b => b.name.toLowerCase() === r.brand.toLowerCase())
          return { ...r, brandMatched: !!found }
        }
        return r
      })
    }

    // Fetch existing product names to skip duplicates
    const { data: existingProds } = await supabase
      .from('products')
      .select('name, brand')
      .eq('shop_id', user.shop_id)

    const existingKeys = new Set(
      (existingProds || []).map(p => `${p.name.toLowerCase()}||${(p.brand || '').toLowerCase()}`)
    )

    const formatted = []
    const skipped = []
    for (const r of rows) {
      const key = `${r.name.toLowerCase()}||${r.brand.toLowerCase()}`
      if (existingKeys.has(key)) {
        skipped.push(r.name)
        continue
      }
      formatted.push({
        shop_id: user.shop_id,
        name: r.name,
        brand: r.brand,
        sku: r.sku || '',
        category_id: r.categoryId,
        unit_id: r.unitId || null,
        stock_quantity: r.stock_quantity,
        cost_price: r.cost_price,
        sale_price: r.sale_price,
        c_rate: r.c_rate,
        low_stock_threshold: r.low_stock_threshold,
        status: r.status
      })
    }

    if (formatted.length === 0) {
      alert(`⚠️ Koi naya product nahi mila.\n${skipped.length} products pehle se mojood hain (duplicate skip kiye).`)
      setLoading(false)
      setImportPreviewRows([])
      return
    }

    const { error } = await supabase.from('products').insert(formatted)
    if (error) {
      alert('Import error: ' + error.message)
    } else {
      await recordAuditLog('BULK_IMPORT_PRODUCTS', 'products', 'multiple', { count: formatted.length }, user.id, user.shop_id)
      const skipMsg = skipped.length > 0 ? `\n⏭️ ${skipped.length} duplicate(s) skip kiye.` : ''
      alert(`Import successful! ✅ ${formatted.length} products added.${skipMsg}`)
      fetchProducts()
    }
    setLoading(false)
    setImportPreviewRows([])
  }

  const handleInlineSave = async () => {
    if (!inlineForm.name?.trim()) return alert('Product Name is required')
    setInlineSaving(true)
    const toIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n }
    const updates = {
      name: inlineForm.name.trim(),
      brand: inlineForm.brand || '',
      category_id: inlineForm.category_id ? toIntOrNull(inlineForm.category_id) : null,
      unit_id: inlineForm.unit_id ? toIntOrNull(inlineForm.unit_id) : null,
      sku: inlineForm.sku || '',
      cost_price: parseFloat(inlineForm.cost_price) || 0,
      sale_price: parseFloat(inlineForm.sale_price) || 0,
      c_rate: parseFloat(inlineForm.c_rate) || 0,
      status: inlineForm.status || 'active'
    }
    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const { error } = await supabase.from('products').update(updates).eq('id', inlineEditId)
      if (error) throw error
      setInlineEditId(null)
      fetchProducts()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.products.update(inlineEditId, updates)
        await addToSyncQueue('products', 'UPDATE', { id: inlineEditId, ...updates })
        setInlineEditId(null)
        fetchProducts()
        alert('Offline mode: Updated locally! Will sync when online. 🔄')
      } else {
        alert('Error: ' + errMsg)
      }
    } finally {
      setInlineSaving(false)
    }
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
          const { error } = await supabase.from('products').delete().eq('id', id).eq('shop_id', user.shop_id)
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
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\n👉 Yeh products abhi bhi Sales ya Purchases mein linked hain.\n\nSahi order:\n1. Sale Items delete karein (Trash Bin > Sale Items)\n2. Purchase Items delete karein (Trash Bin > Purchase Items)\n3. Sales & Purchases delete karein\n4. Phir yeh products delete ho jayenge`)
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

  const handleBulkEdit = async () => {
    if (!bulkCategory && !bulkBrand && !bulkUnit) {
      alert('Category, Brand ya Unit mein se kuch toh select karo!')
      return
    }
    if (!confirm(`${selected.length} product(s) update honge. Continue?`)) return

    setBulkSaving(true)
    const updates = {}
    if (bulkCategory) updates.category_id = parseInt(bulkCategory)
    if (bulkBrand) updates.brand = bulkBrand
    if (bulkUnit) updates.unit_id = parseInt(bulkUnit)

    let successCount = 0
    let failCount = 0

    for (const id of selected) {
      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('products').update(updates).eq('id', id).eq('shop_id', user.shop_id)
          if (error) { failCount++; continue }
        } else {
          await addToSyncQueue('products', 'UPDATE', { id, ...updates })
        }
        await db.products.update(id, updates)
        successCount++
      } catch (err) {
        console.error('Bulk edit error:', err)
        failCount++
      }
    }

    await recordAuditLog(
      'BULK_EDIT_PRODUCTS',
      'products',
      'multiple',
      { updated_count: successCount, failed_count: failCount, changes: updates },
      user.id,
      user.shop_id
    )

    setShowBulkEdit(false)
    setBulkCategory('')
    setBulkBrand('')
    setBulkUnit('')
    setSelected([])
    // If category was changed, clear the active category filter so user can see updated products
    if (bulkCategory) setSelectedCategory('')
    await fetchProducts()
    setBulkSaving(false)

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Updated: ${successCount}\n❌ Failed: ${failCount}`)
    } else {
      alert(`✅ ${successCount} product(s) updated successfully!`)
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
            <span>📤</span> Export{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
          {selected.length > 0 && (
            <>
              <button
                onClick={() => { setShowBulkEdit(true); setBulkCategory(''); setBulkBrand(''); setBulkUnit('') }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition font-bold text-sm flex items-center gap-2 shadow-sm"
              >
                ✏️ Bulk Edit ({selected.length})
              </button>
              <button
                onClick={() => requestDelete(selected)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm flex items-center gap-2 shadow-sm"
              >
                🗑️ Delete Selected ({selected.length})
              </button>
            </>
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

      {/* Category Low Stock Alert Banner */}
      {!loading && categoryLowStockAlerts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-amber-700 font-bold text-sm">⚠️ Category Low Stock Alerts</span>
            <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full border border-amber-300">
              {categoryLowStockAlerts.length} categor{categoryLowStockAlerts.length > 1 ? 'ies' : 'y'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {categoryLowStockAlerts.map(({ cat, count }) => (
              <button
                key={cat.id}
                onClick={() => { setSelectedCategory(String(cat.id)); setShowLowStockOnly(true) }}
                className="bg-white border border-amber-300 hover:border-amber-400 text-amber-800 text-xs font-semibold px-3 py-1.5 rounded-full transition cursor-pointer"
              >
                📦 {cat.name}: <span className="text-red-600">{count} low</span> (≤{cat.low_stock_threshold})
              </button>
            ))}
          </div>
          <p className="text-xs text-amber-600 mt-2">👆 Kisi category par click karein filtered list dekhne ke liye</p>
        </div>
      )}

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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Cost Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sale Price</th>
                {(user.role === 'admin' || user.role === 'manager') && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Margin</th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredProducts.map((product) => (
                inlineEditId === product.id ? (
                  <tr key={product.id} className="bg-blue-50 ring-2 ring-inset ring-blue-300">
                    <td className="px-4 py-3">
                      <input type="checkbox" disabled className="w-4 h-4 rounded opacity-30" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={inlineForm.name || ''} onChange={e => setInlineForm(f => ({ ...f, name: e.target.value }))}
                        className="w-full text-sm border rounded px-2 py-1 focus:ring-1 focus:ring-blue-400 outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={inlineForm.brand || ''} onChange={e => setInlineForm(f => ({ ...f, brand: e.target.value }))}
                        className="w-28 text-sm border rounded px-2 py-1 focus:ring-1 focus:ring-blue-400 outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={inlineForm.category_id || ''} onChange={e => setInlineForm(f => ({ ...f, category_id: e.target.value }))}
                        className="w-full text-sm border rounded px-2 py-1 outline-none">
                        <option value="">-- None --</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={inlineForm.unit_id || ''} onChange={e => setInlineForm(f => ({ ...f, unit_id: e.target.value }))}
                        className="w-24 text-sm border rounded px-2 py-1 outline-none">
                        <option value="">-- None --</option>
                        {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-gray-400 text-xs text-center">{product.stock_quantity}</td>
                    <td className="px-3 py-2">
                      <input value={inlineForm.sku || ''} onChange={e => setInlineForm(f => ({ ...f, sku: e.target.value }))}
                        className="w-20 text-xs font-mono border rounded px-2 py-1 outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={inlineForm.cost_price || ''} onChange={e => setInlineForm(f => ({ ...f, cost_price: e.target.value }))}
                        className="w-20 text-sm border rounded px-2 py-1 outline-none" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" value={inlineForm.sale_price || ''} onChange={e => setInlineForm(f => ({ ...f, sale_price: e.target.value }))}
                        className="w-20 text-sm border rounded px-2 py-1 outline-none" />
                    </td>
                    {(user.role === 'admin' || user.role === 'manager') && <td className="px-3 py-2"></td>}
                    <td className="px-3 py-2">
                      <select value={inlineForm.status || 'active'} onChange={e => setInlineForm(f => ({ ...f, status: e.target.value }))}
                        className="text-sm border rounded px-2 py-1 outline-none">
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex justify-center gap-2">
                        <button onClick={handleInlineSave} disabled={inlineSaving}
                          className="text-green-600 hover:text-green-800 font-bold text-sm bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                          {inlineSaving ? '...' : '✓ Save'}
                        </button>
                        <button onClick={() => setInlineEditId(null)}
                          className="text-gray-500 hover:text-gray-700 font-bold text-sm bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-lg transition">
                          ✗
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
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
                    {(() => {
                      const unit = units.find(u => u.id === product.unit_id)
                      return unit
                        ? <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-semibold border border-blue-100">{unit.name}</span>
                        : <span className="text-gray-300 text-xs">—</span>
                    })()}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${product.stock_quantity <= getEffectiveThreshold(product)
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                      }`}>
                      {product.stock_quantity}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-gray-400">{product.sku || <span className="italic">—</span>}</td>
                  <td className="px-6 py-4 text-gray-500">Rs. {product.cost_price}</td>
                  <td className="px-6 py-4 text-gray-500">Rs. {product.sale_price}</td>
                  {(user.role === 'admin' || user.role === 'manager') && (() => {
                    const cost = Number(product.cost_price || 0)
                    const sale = Number(product.sale_price || 0)
                    const margin = sale > 0 ? ((sale - cost) / sale * 100) : 0
                    return (
                      <td className="px-6 py-4">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${margin >= 30 ? 'bg-green-100 text-green-700' : margin >= 15 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                          {margin.toFixed(0)}%
                        </span>
                      </td>
                    )
                  })()}
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
                      <button
                        onClick={() => { setInlineEditId(product.id); setInlineForm({ ...product }) }}
                        className="text-blue-600 hover:text-blue-800 font-bold text-sm bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => requestDelete([product.id])}
                        className="text-red-600 hover:text-red-800 font-bold text-sm bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import Preview Modal */}
      {showImportPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl flex flex-col">
            <h2 className="text-xl font-bold text-gray-800 mb-1">📥 Import Preview</h2>
            <p className="text-sm text-gray-500 mb-3">{importPreviewRows.length} products ready to import. Category match status check karein.</p>

            {importPreviewRows.some(r => r.categoryName && !r.categoryId) && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-yellow-800 font-medium">
                  ⚠️ {importPreviewRows.filter(r => r.categoryName && !r.categoryId).length} row(s) mein category match nahi hui.
                </p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={autoCreateCategories} onChange={e => setAutoCreateCategories(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-yellow-800">Missing categories auto-create karo</span>
                </label>
              </div>
            )}

            {importPreviewRows.some(r => r.brand && !r.brandMatched) && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3">
                <p className="text-sm text-orange-800 font-medium">
                  ⚠️ {importPreviewRows.filter(r => r.brand && !r.brandMatched).length} row(s) mein brand match nahi hui — ye brands aapke system mein nahi hain.
                </p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input type="checkbox" checked={autoCreateBrands} onChange={e => setAutoCreateBrands(e.target.checked)} className="w-4 h-4 rounded accent-orange-500" />
                  <span className="text-sm text-orange-800">Missing brands auto-create karo</span>
                </label>
              </div>
            )}

            <div className="flex-1 overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">#</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Product Name</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Brand</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Category</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Cost</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Sale</th>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {importPreviewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{row.name}</td>
                      <td className="px-3 py-2">
                        {row.brand ? (
                          row.brandMatched ? (
                            <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✓ {row.brand}</span>
                          ) : (
                            <span className="text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full text-xs font-medium">✗ {row.brand}</span>
                          )
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.categoryName ? (
                          row.categoryId ? (
                            <span className="text-green-700 bg-green-50 px-2 py-0.5 rounded-full text-xs font-medium">✓ {row.categoryName}</span>
                          ) : (
                            <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-full text-xs font-medium">✗ {row.categoryName}</span>
                          )
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600">Rs.{row.cost_price}</td>
                      <td className="px-3 py-2 text-gray-600">Rs.{row.sale_price}</td>
                      <td className="px-3 py-2 text-gray-600">{row.stock_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={handleConfirmImport}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition">
                ✅ Confirm Import ({importPreviewRows.length} products)
              </button>
              <button onClick={() => { setShowImportPreview(false); setImportPreviewRows([]) }}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition">
                Cancel
              </button>
            </div>
          </div>
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

      {/* Bulk Edit Modal */}
      {showBulkEdit && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-4 sm:p-6 w-full max-w-sm">
            <h2 className="text-xl font-bold text-gray-800 mb-1">✏️ Bulk Edit</h2>
            <p className="text-sm text-gray-500 mb-4">{selected.length} product(s) selected. Sirf woh fields update hongi jo aap select karein.</p>

            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 font-medium mb-1">Category</label>
                <select
                  value={bulkCategory}
                  onChange={e => setBulkCategory(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Don't change —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Brand</label>
                <select
                  value={bulkBrand}
                  onChange={e => setBulkBrand(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Don't change —</option>
                  {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">Unit</label>
                <select
                  value={bulkUnit}
                  onChange={e => setBulkUnit(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                >
                  <option value="">— Don't change —</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleBulkEdit}
                disabled={bulkSaving || (!bulkCategory && !bulkBrand && !bulkUnit)}
                className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold transition disabled:opacity-50"
              >
                {bulkSaving ? 'Updating...' : '✅ Apply Changes'}
              </button>
              <button
                onClick={() => { setShowBulkEdit(false); setBulkUnit('') }}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-bold transition"
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

export default Products