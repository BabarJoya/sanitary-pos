import { useEffect, useState } from 'react'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'

function Purchases() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [brands, setBrands] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedBrand, setSelectedBrand] = useState('')
  const [cart, setCart] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [paymentType, setPaymentType] = useState('cash')
  const [saving, setSaving] = useState(false)
  const [discount, setDiscount] = useState(0)

  // Hold Purchase
  const [heldPurchases, setHeldPurchases] = useState([])
  const [showHeldPurchases, setShowHeldPurchases] = useState(false)

  const [quickViewProduct, setQuickViewProduct] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [showMobileCart, setShowMobileCart] = useState(false)

  useEffect(() => {
    if (user?.shop_id) fetchData()
  }, [user?.shop_id])

  useEffect(() => {
    if (user?.shop_id) fetchHeldPurchases()
  }, [user?.shop_id])

  const fetchHeldPurchases = async () => {
    try {
      const carts = await db.held_purchases.where('shop_id').equals(user.shop_id).toArray()
      setHeldPurchases(carts)
    } catch (e) { console.warn('No held_purchases table yet') }
  }

  const fetchData = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = Promise.all([
        supabase.from('products').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('suppliers').select('*').eq('shop_id', user.shop_id).order('name'),
        supabase.from('brands').select('*').eq('shop_id', user.shop_id).order('name')
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const [p, s, b] = await Promise.race([fetchPromise, timeoutPromise])

      if (p.error || s.error || b.error) throw new Error('Supabase fetch failed')

      if (p.data) {
        const cleanP = JSON.parse(JSON.stringify(p.data))
        await db.products.bulkPut(cleanP)
      }
      if (s.data) {
        const cleanS = JSON.parse(JSON.stringify(s.data))
        await db.suppliers.bulkPut(cleanS)
      }
      if (b.data) {
        const cleanB = JSON.parse(JSON.stringify(b.data))
        await db.brands.bulkPut(cleanB)
      }

      // Render from local DB to merge
      const [lProds, lSups, lBrands] = await Promise.all([
        db.products.toArray(),
        db.suppliers.toArray(),
        db.brands.toArray()
      ])
      const sid = String(user.shop_id)
      setProducts(lProds.filter(x => String(x.shop_id) === sid))
      setSuppliers(lSups.filter(x => String(x.shop_id) === sid))
      setBrands(lBrands.filter(x => String(x.shop_id) === sid))
    } catch (e) {
      console.log('Purchases: Fetching from local DB (Offline Fallback)')
      try {
        const [lProds, lSups, lBrands] = await Promise.all([
          db.products.toArray(),
          db.suppliers.toArray(),
          db.brands.toArray()
        ])
        const sid = String(user.shop_id);
        setProducts(lProds.filter(x => String(x.shop_id) === sid))
        setSuppliers(lSups.filter(x => String(x.shop_id) === sid))
        setBrands(lBrands.filter(x => String(x.shop_id) === sid))
      } catch (err) { console.error('Local DB Purchases Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const fetchPriceHistory = async (productId) => {
    setLoadingHistory(true)
    setPriceHistory([])
    try {
      if (navigator.onLine) {
        const { data, error } = await supabase
          .from('purchase_items')
          .select('unit_price, quantity, total_price, purchases(created_at, supplier_id, suppliers(name))')
          .eq('product_id', productId)
          .order('id', { ascending: false })
          .limit(20)
        if (!error && data) {
          const mapped = data.map(item => ({
            date: item.purchases?.created_at,
            price: item.unit_price,
            qty: item.quantity,
            total: item.total_price,
            supplier: item.purchases?.suppliers?.name || '-'
          }))
          setPriceHistory(mapped)
        }
      } else {
        // Offline fallback from local DB
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
            total: item.total_price,
            supplier: supplier?.name || '-'
          }
        }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 20)
        setPriceHistory(mapped)
      }
    } catch (err) {
      console.error('Price history fetch error:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const openQuickView = (product) => {
    setQuickViewProduct(product)
    fetchPriceHistory(product.id)
  }

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id)
      if (existing) {
        return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      }
      return [{ ...product, qty: 1, purchase_price: product.cost_price || 0 }, ...prev]
    })
  }

  const updateQty = (id, qty) => {
    const num = parseInt(qty)
    if (isNaN(num) || num < 1) return
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: num } : i))
  }

  const incrementQty = (id) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: i.qty + 1 } : i))
  }

  const decrementQty = (id) => {
    setCart(prev => prev.map(i => i.id === id ? (i.qty > 1 ? { ...i, qty: i.qty - 1 } : i) : i))
  }

  const updatePrice = (id, price) => {
    const num = parseFloat(price)
    if (isNaN(num) || num < 0) return
    setCart(prev => prev.map(i => i.id === id ? { ...i, purchase_price: num } : i))
  }

  const removeFromCart = (id) => setCart(prev => prev.filter(i => i.id !== id))

  const clearCart = () => {
    setCart([]); setSupplierId(''); setPaymentType('cash'); setDiscount(0)
  }

  const subtotal = cart.reduce((sum, i) => sum + i.purchase_price * i.qty, 0)
  const totalDiscount = parseFloat(discount) || 0
  const total = Math.max(0, subtotal - totalDiscount)

  // Hold Purchase
  const handleHoldPurchase = async () => {
    if (cart.length === 0) return
    const heldData = {
      shop_id: user.shop_id,
      supplier_id: supplierId || null,
      items: cart,
      total,
      saved_at: new Date().toISOString()
    }
    try {
      await db.held_purchases.add(heldData)
      await fetchHeldPurchases()
      clearCart()
      alert('Purchase held successfully! ⏸️')
    } catch (err) {
      alert('Error holding purchase: ' + err.message)
    }
  }

  const handleResumePurchase = (held) => {
    if (cart.length > 0) {
      if (!confirm('Current cart will be replaced. Continue?')) return
    }
    setCart(held.items)
    setSupplierId(held.supplier_id || '')
    db.held_purchases.delete(held.id).then(fetchHeldPurchases)
    setShowHeldPurchases(false)
  }

  const handleDeleteHeld = async (id) => {
    await db.held_purchases.delete(id)
    fetchHeldPurchases()
  }

  const handleCompletePurchase = async () => {
    if (cart.length === 0) return alert('Khareedari ke liye products add karein!')
    if (!supplierId) return alert('Pehle supplier select karein!')

    setSaving(true)
    // Sanitize integer FK — offline-created suppliers have UUID ids
    const toIntOrNull = (v) => { const n = parseInt(v); return isNaN(n) ? null : n }
    const purchaseData = {
      shop_id: user.shop_id,
      supplier_id: toIntOrNull(supplierId),
      total_amount: total,
      paid_amount: paymentType === 'cash' ? total : 0,
      payment_type: paymentType,
      status: 'completed'
    }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      // 1. Save Purchase
      const { data: purchase, error: pError } = await supabase.from('purchases').insert([purchaseData]).select().single()
      if (pError) throw pError

      // 2. Save Purchase Items
      const items = cart.map(i => ({
        purchase_id: purchase.id,
        product_id: toIntOrNull(i.id),
        product_name: i.name,
        quantity: i.qty,
        unit_price: i.purchase_price,
        total_price: i.purchase_price * i.qty
      }))
      const { error: itemsError } = await supabase.from('purchase_items').insert(items)
      if (itemsError) throw itemsError

      // 3. Update Product Stock and Cost Price (online + local cache)
      for (const item of cart) {
        const newStock = item.stock_quantity + item.qty
        await supabase.from('products')
          .update({
            stock_quantity: newStock,
            cost_price: item.purchase_price
          })
          .eq('id', item.id)
        // Mirror to local DB so Inventory shows accurate stock immediately
        await db.products.update(item.id, { stock_quantity: newStock, cost_price: item.purchase_price })
      }

      // 4. Update Supplier Balance if Credit
      if (paymentType === 'credit') {
        const supplier = suppliers.find(s => String(s.id) === String(supplierId))
        const newBalance = (supplier?.outstanding_balance || 0) + total
        await supabase.from('suppliers').update({ outstanding_balance: newBalance }).eq('id', supplierId)
        // Mirror to local DB
        await db.suppliers.update(supplierId, { outstanding_balance: newBalance })
      } else if (paymentType === 'cash' && total > 0) {
        // Record the cash payment explicitly
        const paymentData = {
          shop_id: user.shop_id,
          supplier_id: supplierId,
          amount: total,
          payment_type: 'payment',
          note: `Cash Paid for Purchase PR-${String(purchase.id).slice(-6)}`
        }
        await supabase.from('supplier_payments').insert([paymentData])
      }

      alert('Purchase complete! Stock and supplier balance updated.')
      clearCart()
      fetchData()
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        console.log('Purchases: Intercepted offline failure, routing to local queue...')
        const offlineId = crypto.randomUUID()
        const offlinePurchaseData = { ...purchaseData, id: offlineId }
        await db.purchases.add(offlinePurchaseData)
        await addToSyncQueue('purchases', 'INSERT', offlinePurchaseData)

        const items = cart.map(i => ({
          purchase_id: offlineId,
          product_id: i.id,
          product_name: i.name,
          quantity: i.qty,
          unit_price: i.purchase_price,
          total_price: i.purchase_price * i.qty
        }))
        await db.purchase_items.bulkPut(items)
        await addToSyncQueue('purchase_items', 'INSERT', items)

        for (const item of cart) {
          const newStock = item.stock_quantity + item.qty
          await db.products.update(item.id, { stock_quantity: newStock, cost_price: item.purchase_price })
          await addToSyncQueue('products', 'UPDATE', { id: item.id, stock_quantity: newStock, cost_price: item.purchase_price })
        }

        if (paymentType === 'credit') {
          const supplier = suppliers.find(s => String(s.id) === String(supplierId))
          const newBalance = (supplier?.outstanding_balance || 0) + total
          await db.suppliers.update(supplierId, { outstanding_balance: newBalance })
          await addToSyncQueue('suppliers', 'UPDATE', { id: supplierId, outstanding_balance: newBalance })
        } else if (paymentType === 'cash' && total > 0) {
          const paymentData = {
            shop_id: user.shop_id,
            supplier_id: supplierId,
            amount: total,
            payment_type: 'payment',
            note: `Cash Paid for Purchase PR-${String(offlineId).slice(-6)}`
          }
          await db.supplier_payments.add(paymentData)
          await addToSyncQueue('supplier_payments', 'INSERT', paymentData)
        }

        alert('Offline mode: Purchase saved locally. Will sync automatically when online. 🔄')
        clearCart()
        fetchData()
      } else {
        alert('Error: ' + err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const filteredProducts = products.filter(p =>
    (p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.brand || '').toLowerCase().includes(search.toLowerCase())) &&
    (selectedBrand ? String(p.brand) === String(selectedBrand) : true)
  )

  if (!hasFeature('purchases')) return <UpgradeWall feature="purchases" />

  return (
    <div className="flex flex-col md:flex-row gap-4 overflow-hidden" style={{ height: 'calc(100vh - 112px)' }}>

      {/* LEFT: Products */}
      <div className="flex-1 flex flex-col gap-3 min-w-0">

        {/* Header */}
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800">📥 Stock Purchase</h1>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">{cart.length} items in cart</span>
        </div>

        {/* Search + Filters */}
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="🔍 Search products / brands..."
            className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            value={selectedBrand}
            onChange={e => setSelectedBrand(e.target.value)}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none"
          >
            <option value="">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          {(search || selectedBrand) && (
            <button
              onClick={() => { setSearch(''); setSelectedBrand('') }}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm transition"
            >
              Reset
            </button>
          )}
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 overflow-y-auto flex-1 content-start">
          {filteredProducts.length === 0 && <p className="text-gray-400 col-span-3 text-center py-10">No products found</p>}
          {filteredProducts.map(p => (
            <div key={p.id}
              className="bg-white rounded-xl shadow-sm p-3 text-left hover:shadow-md hover:bg-blue-50 transition border border-transparent hover:border-blue-300 h-fit group relative"
            >
              <button
                onClick={() => addToCart(p)}
                className="w-full text-left"
              >
                <p className="font-semibold text-gray-800 text-sm leading-tight group-hover:text-blue-700">{p.name}</p>
                {p.brand && <p className="text-xs text-gray-400">{p.brand}</p>}
                <div className="flex justify-between items-end mt-2">
                  <p className="text-xs font-bold text-green-600">Stock: {p.stock_quantity}</p>
                  <p className="text-xs text-gray-500">Cost: Rs.{p.cost_price}</p>
                </div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openQuickView(p) }}
                className="absolute top-2 right-2 w-6 h-6 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-full text-xs font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                title="Quick View"
              >
                👁
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile Cart Floating Badge */}
      {cart.length > 0 && (
        <button
          onClick={() => setShowMobileCart(true)}
          className="md:hidden fixed bottom-5 right-5 z-40 bg-green-600 text-white rounded-full w-16 h-16 flex flex-col items-center justify-center shadow-2xl hover:bg-green-700 transition active:scale-95"
        >
          <span className="text-lg">🛒</span>
          <span className="text-[10px] font-black">{cart.length}</span>
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center">Rs.{total.toFixed(0)}</span>
        </button>
      )}

      {/* Mobile overlay backdrop */}
      {showMobileCart && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setShowMobileCart(false)} />
      )}

      {/* RIGHT: Cart */}
      <div className={`${showMobileCart ? 'fixed inset-0 z-50 w-full flex' : 'hidden md:flex'} md:static md:w-96 flex-col gap-2 bg-white rounded-xl shadow-lg p-4 h-[calc(100vh-80px)] md:h-full border border-gray-100 overflow-hidden`}>

        {/* Mobile close button */}
        <button onClick={() => setShowMobileCart(false)} className="md:hidden self-end text-gray-400 hover:text-gray-700 text-2xl font-bold mb-1">✕</button>

        {/* Cart Header */}
        <h2 className="text-base font-bold text-gray-800 border-b pb-2 shrink-0 flex justify-between items-center">
          <span>🛒 Purchase Cart</span>
          <div className="flex gap-1">
            {heldPurchases.length > 0 && (
              <button
                onClick={() => setShowHeldPurchases(true)}
                className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-bold uppercase hover:bg-orange-200 transition"
              >
                ⏸️ Held ({heldPurchases.length})
              </button>
            )}
          </div>
        </h2>

        {/* Supplier */}
        <select
          className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shrink-0"
          value={supplierId}
          onChange={e => setSupplierId(e.target.value)}
        >
          <option value="">Select Supplier (Vendor)</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name} {s.outstanding_balance > 0 ? `(Bal: Rs.${s.outstanding_balance})` : ''}</option>
          ))}
        </select>

        {/* Payment Type */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setPaymentType('cash')}
            className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition ${paymentType === 'cash' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}
          >
            💵 Cash Paid
          </button>
          <button
            onClick={() => setPaymentType('credit')}
            className={`flex-1 py-1.5 rounded-lg font-bold text-xs transition ${paymentType === 'credit' ? 'bg-orange-500 text-white shadow-md' : 'bg-gray-100 text-gray-600'}`}
          >
            📒 Credit (Udhaar)
          </button>
        </div>

        {/* Cart Items — scrollable */}
        <div className="flex-1 overflow-y-auto min-h-0 space-y-1 pr-1 custom-scrollbar">
          {cart.length === 0 && <p className="text-gray-400 text-xs text-center py-8">Products select karein ←</p>}
          {cart.map(item => (
            <div key={item.id} className="bg-gray-50 rounded-lg p-2 border border-gray-100">
              <div className="flex items-center gap-1">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{item.name}</p>
                  {item.brand && <p className="text-[10px] text-gray-400">{item.brand}</p>}
                </div>
                <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-600 font-bold pl-1 text-sm">×</button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                {/* Qty Controls */}
                <div className="flex items-center bg-white border border-gray-200 rounded overflow-hidden">
                  <button
                    onClick={() => decrementQty(item.id)}
                    className="px-2 py-0.5 text-gray-500 hover:bg-gray-100 text-xs font-bold transition"
                  >−</button>
                  <input
                    type="number"
                    value={item.qty}
                    onChange={e => updateQty(item.id, e.target.value)}
                    className="w-10 text-center text-xs font-bold outline-none border-x border-gray-200"
                    min="1"
                  />
                  <button
                    onClick={() => incrementQty(item.id)}
                    className="px-2 py-0.5 text-gray-500 hover:bg-gray-100 text-xs font-bold transition"
                  >+</button>
                </div>
                {/* Price */}
                <div className="flex-1 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1 bg-white border border-gray-200 rounded px-1">
                    <span className="text-[10px] text-gray-400">Rate</span>
                    <input
                      type="number"
                      value={item.purchase_price}
                      onChange={e => updatePrice(item.id, e.target.value)}
                      className={`w-full text-xs font-bold outline-none ${item.purchase_price > (item.cost_price || 0) ? 'text-red-600' : item.purchase_price < (item.cost_price || 0) ? 'text-green-600' : 'text-blue-600'}`}
                    />
                  </div>
                  <p className="text-[8px] text-gray-400">Prev Cost: Rs.{item.cost_price || 0}</p>
                </div>
              </div>
              <p className="text-right text-[10px] font-bold text-gray-500 mt-0.5">Total: Rs. {(item.purchase_price * item.qty).toLocaleString()}</p>
            </div>
          ))}
        </div>

        {/* Bottom section — fixed */}
        <div className="bg-gray-50 rounded-lg p-2 border-t shrink-0 space-y-1 mt-auto">
          {/* Totals & Discount Mini-Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span><span>Rs.{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-gray-600">Disc (Rs):</label>
                <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} className="w-16 px-1 border rounded text-right outline-none" min="0" placeholder="0" />
              </div>
            </div>
            <div className="flex flex-col justify-end text-right border-l pl-2 border-gray-200">
              <div className="text-gray-500 text-[10px] uppercase">Net Total</div>
              <div className="font-black text-lg text-gray-800 leading-none">Rs.{total.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex gap-1 pt-1">
            <button onClick={handleHoldPurchase} disabled={cart.length === 0} className="px-2 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-bold disabled:opacity-30">⏸️</button>
            <button onClick={clearCart} disabled={cart.length === 0} className="px-2 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-xs font-bold disabled:opacity-30">🗑️</button>
            <button onClick={handleCompletePurchase} disabled={saving || cart.length === 0} className="flex-1 py-1.5 bg-blue-600 text-white font-bold rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Processing...' : '✅ Save Purchase'}
            </button>
          </div>
        </div>
      </div>

      {/* Quick View Modal */}
      {quickViewProduct && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setQuickViewProduct(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h3 className="text-lg font-bold text-gray-800">📋 Product Details & Price History</h3>
              <button onClick={() => setQuickViewProduct(null)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3">
              <div>
                <p className="text-sm text-gray-500">Product Name</p>
                <p className="font-bold text-gray-800">{quickViewProduct.name}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-sm text-gray-500">Brand</p>
                  <p className="font-medium text-gray-700">{quickViewProduct.brand || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Stock</p>
                  <p className={`font-bold ${quickViewProduct.stock_quantity <= 5 ? 'text-red-600' : 'text-green-600'}`}>{quickViewProduct.stock_quantity}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">C. Rate</p>
                  <p className="font-bold text-purple-600">{quickViewProduct.c_rate || 0}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-blue-500 uppercase font-bold">Current Cost</p>
                  <p className="font-bold text-blue-700 text-lg">Rs. {quickViewProduct.cost_price || 0}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-2 text-center">
                  <p className="text-[10px] text-green-500 uppercase font-bold">Sale Price</p>
                  <p className="font-bold text-green-700 text-lg">Rs. {quickViewProduct.sale_price || 0}</p>
                </div>
              </div>

              {/* Purchase Price History */}
              <div className="border-t pt-3">
                <h4 className="font-bold text-gray-700 text-sm mb-2">📊 Purchase Price History</h4>
                {loadingHistory ? (
                  <p className="text-center text-gray-400 text-xs py-4">Loading history...</p>
                ) : priceHistory.length === 0 ? (
                  <p className="text-center text-gray-400 text-xs py-4 italic">No previous purchases found for this product.</p>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-3 py-2 text-left text-gray-500 font-bold">Date</th>
                          <th className="px-3 py-2 text-left text-gray-500 font-bold">Supplier</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-bold">Rate</th>
                          <th className="px-3 py-2 text-right text-gray-500 font-bold">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {priceHistory.map((h, idx) => (
                          <tr key={idx} className={`hover:bg-gray-50 ${idx === 0 ? 'bg-yellow-50 font-semibold' : ''}`}>
                            <td className="px-3 py-1.5 text-gray-600">{h.date ? new Date(h.date).toLocaleDateString('en-PK') : '-'}</td>
                            <td className="px-3 py-1.5 text-gray-600 truncate max-w-[100px]">{h.supplier}</td>
                            <td className={`px-3 py-1.5 text-right font-bold ${idx > 0 && h.price !== priceHistory[idx - 1]?.price ? 'text-orange-600' : 'text-gray-800'}`}>Rs. {h.price}</td>
                            <td className="px-3 py-1.5 text-right text-gray-500">{h.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => { addToCart(quickViewProduct); setQuickViewProduct(null) }}
              className="w-full mt-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md transition shrink-0"
            >
              + Add to Purchase Cart
            </button>
          </div>
        </div>
      )}

      {/* Held Purchases Modal */}
      {showHeldPurchases && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setShowHeldPurchases(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-800">⏸️ Held Purchases</h3>
              <button onClick={() => setShowHeldPurchases(false)} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="overflow-y-auto space-y-3 flex-1">
              {heldPurchases.length === 0 && <p className="text-gray-400 text-center py-8">No held purchases</p>}
              {heldPurchases.map(held => {
                const sup = suppliers.find(s => String(s.id) === String(held.supplier_id))
                return (
                  <div key={held.id} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-xs text-gray-500">{new Date(held.saved_at).toLocaleString()}</p>
                      <p className="font-bold text-gray-800">Rs. {held.total?.toLocaleString()}</p>
                    </div>
                    {sup && <p className="text-xs text-gray-600 mb-1">Supplier: {sup.name}</p>}
                    <p className="text-xs text-gray-400">{held.items?.length} items</p>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => handleResumePurchase(held)}
                        className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition">
                        ▶ Resume
                      </button>
                      <button onClick={() => handleDeleteHeld(held.id)}
                        className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-xs font-bold transition">
                        🗑
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Purchases
