import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'

function Sales() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSale, setSelectedSale] = useState(null)
  const [saleItems, setSaleItems] = useState([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnQtys, setReturnQtys] = useState({})
  const [search, setSearch] = useState('')
  const [searchDate, setSearchDate] = useState('')
  const [filterType, setFilterType] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('')
  const [refundType, setRefundType] = useState('cash') // 'cash' or 'credit'
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])

  const [shopSettings, setShopSettings] = useState({})

  useEffect(() => {
    if (user?.shop_id) {
      fetchShopSettings()
      fetchSales()
    }
  }, [user?.shop_id])

  const fetchShopSettings = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const { data } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      if (data) setShopSettings(data)
    } catch (e) {
      console.log('Sales: Using cached shop settings')
    }
  }

  const fetchSales = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = supabase
        .from('sales')
        .select('*, customers(name)')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.sales.bulkPut(cleanData)
      }

      // Always render from local DB to include pending items
      const localData = await db.sales.toArray()
      const sid = String(user.shop_id)
      const filtered = localData.filter(x => String(x.shop_id) === sid)
      const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      setSales(sorted)
    } catch (e) {
      console.log('Sales: Fetching from local DB (Offline Fallback)')
      try {
        const localData = await db.sales.toArray()
        const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        setSales(sorted.filter(x => String(x.shop_id) === String(user.shop_id)))
      } catch (err) { console.error('Local DB Sales Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const openSale = async (sale) => {
    setSelectedSale(sale)
    setReturnQtys({})
    setLoadingItems(true)
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const fetchPromise = supabase
        .from('sale_items')
        .select('*, products(name, stock_quantity)')
        .eq('sale_id', sale.id)

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.sale_items.bulkPut(cleanData)
      }

      // Render from local for consistency
      const localItems = await db.sale_items.where({ sale_id: sale.id }).toArray()
      setSaleItems(localItems)
    } catch (e) {
      console.log('Sale Items: Fetching from local DB (Offline Fallback)')
      const localItems = await db.sale_items.where({ sale_id: sale.id }).toArray().catch(() => [])
      // fallback if composite index is weird, just get all and filter
      if (localItems.length === 0) {
        const all = await db.sale_items.toArray()
        setSaleItems(all.filter(i => i.sale_id === sale.id))
      } else {
        setSaleItems(localItems)
      }
    }
    setLoadingItems(false)
  }

  // Handle return
  const handleReturn = async () => {
    const itemsToReturn = saleItems.filter(i => returnQtys[i.id] > 0)
    if (itemsToReturn.length === 0) { alert('Return karne ke liye qty enter karo!'); return }

    for (const item of itemsToReturn) {
      const returnQty = parseInt(returnQtys[item.id]) || 0
      const alreadyReturned = item.returned_qty || 0
      const maxReturn = item.quantity - alreadyReturned
      if (returnQty > maxReturn) { alert(`${item.product_name}: max ${maxReturn} return ho sakta hai`); return }
    }

    setReturning(true)
    let totalReturnAmount = 0

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      for (const item of itemsToReturn) {
        const returnQty = parseInt(returnQtys[item.id]) || 0
        const returnAmount = item.unit_price * returnQty
        totalReturnAmount += returnAmount

        // Update returned_qty on sale_item
        await supabase.from('sale_items')
          .update({ returned_qty: (item.returned_qty || 0) + returnQty })
          .eq('id', item.id)

        // Restore stock — fetch live stock first to avoid undefined/stale value
        const { data: liveProduct } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).single()
        const currentStock = liveProduct?.stock_quantity ?? 0
        const newStock = currentStock + returnQty
        await supabase.from('products')
          .update({ stock_quantity: newStock })
          .eq('id', item.product_id)
        // Keep local DB in sync
        await db.products.update(item.product_id, { stock_quantity: newStock })
      }

      // Update sale record total
      const newSaleTotal = Math.max(0, (selectedSale.total_amount || 0) - totalReturnAmount)
      await supabase.from('sales').update({ total_amount: newSaleTotal }).eq('id', selectedSale.id)

      // Process Refund
      if (refundType === 'credit' && selectedSale.customer_id) {
        const { data: cust } = await supabase.from('customers').select('outstanding_balance').eq('id', selectedSale.customer_id).single()
        const newBal = Math.max(0, (cust?.outstanding_balance || 0) - totalReturnAmount)
        await supabase.from('customers').update({ outstanding_balance: newBal }).eq('id', selectedSale.customer_id)
        await db.customers.update(selectedSale.customer_id, { outstanding_balance: newBal })

        // Log payment return in customer_payments
        await supabase.from('customer_payments').insert([{
          shop_id: user.shop_id,
          customer_id: selectedSale.customer_id,
          amount: -totalReturnAmount,
          payment_type: 'return',
          note: `Return from Invoice #${String(selectedSale.id).slice(-6)} (Credited to Balance)`
        }])
      } else {
        // Log as refund (Cash or Walk-in)
        await supabase.from('customer_payments').insert([{
          shop_id: user.shop_id,
          customer_id: selectedSale.customer_id || null,
          amount: -totalReturnAmount,
          payment_type: 'refund',
          note: `Cash Refund from Invoice #${String(selectedSale.id).slice(-6)}`
        }])
      }

      // Audit Log
      recordAuditLog(
        'SALE_RETURN',
        'sales',
        selectedSale.id,
        {
          invoice: selectedSale.id,
          returned_amount: totalReturnAmount,
          items: itemsToReturn.map(it => ({ name: it.product_name, qty: returnQtys[it.id] }))
        },
        user.id,
        user.shop_id
      )

      alert('Return successful! Invoice updated.')
      setReturning(false)
      setReturnQtys({})

      // Re-fetch online items if possible
      const { data: updatedSale } = await supabase.from('sales').select('*, customers(name)').eq('id', selectedSale.id).single()
      if (updatedSale) setSelectedSale(updatedSale)
      fetchSales()
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        // OFFLINE RETURN LOGIC
        for (const item of itemsToReturn) {
          const returnQty = parseInt(returnQtys[item.id]) || 0
          totalReturnAmount += item.unit_price * returnQty

          // 1. Update local sale_item
          const newRetQty = (item.returned_qty || 0) + returnQty
          await db.sale_items.update(item.id, { returned_qty: newRetQty })

          // 2. Queue the update
          await db.sync_queue.add({ table: 'sale_items', action: 'UPDATE', data: { id: item.id, returned_qty: newRetQty }, timestamp: new Date().toISOString() })

          // 3. Update local stock
          const localProd = await db.products.get(item.product_id)
          const newStock = (localProd?.stock_quantity || 0) + returnQty
          await db.products.update(item.product_id, { stock_quantity: newStock })
          await db.sync_queue.add({ table: 'products', action: 'UPDATE', data: { id: item.product_id, stock_quantity: newStock }, timestamp: new Date().toISOString() })
        }

        // Update local Sale total
        const newSaleTotal = Math.max(0, (selectedSale.total_amount || 0) - totalReturnAmount)
        await db.sales.update(selectedSale.id, { total_amount: newSaleTotal })
        await db.sync_queue.add({ table: 'sales', action: 'UPDATE', data: { id: selectedSale.id, total_amount: newSaleTotal }, timestamp: new Date().toISOString() })

        alert('Offline mode: Return processed locally. Stock and Invoice updated! 🔄')
        setReturning(false)
        setReturnQtys({})
        setSelectedSale({ ...selectedSale, total_amount: newSaleTotal })
        fetchSales()
      } else {
        alert('Error processing return: ' + errMsg)
        setReturning(false)
      }
    }
  }

  const printInvoice = (sale, items) => {
    const isThermal = shopSettings.print_size === 'thermal'
    const footer = sale.sale_type === 'quotation' ? shopSettings.quotation_footer : shopSettings.invoice_footer

    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Invoice</title>
      <style>
        body { font-family: monospace; width: ${isThermal ? '320px' : '794px'}; margin: auto; padding: 20px; font-size: 13px; border: ${isThermal ? 'none' : '1px solid #eee'}; }
        h2, p.center { text-align: center; margin: 2px 0; }
        hr { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; } 
        td { padding: 5px 0; vertical-align: top; }
        .right { text-align: right; } .bold { font-weight: bold; }
        .logo { display: block; margin: 0 auto 10px; max-width: 100px; }
        ${!isThermal ? `
          body { font-family: 'Segoe UI', sans-serif; }
          table { border: 1px solid #ddd; }
          th, td { border: 1px solid #ddd; padding: 10px; }
        ` : ''}
      </style></head><body>
      ${shopSettings.logo_url ? `<img src="${shopSettings.logo_url}" class="logo" />` : ''}
      <h2>${shopSettings.name || 'Sanitary POS'}</h2>
      <p class="center">${shopSettings.address || ''}</p>
      <p class="center">Phone: ${shopSettings.phone || ''}</p>
      <hr/>
      <p>${sale.sale_type === 'quotation' ? 'Quotation' : 'Invoice'} #: ${sale.sale_type === 'quotation' ? 'QT-' : ''}${String(sale.id).slice(-8)}</p>
      <p>Date: ${new Date(sale.created_at).toLocaleString('en-PK')}</p>
      <p>Customer: ${sale.customers?.name || sale.customer_name || 'Walk-in'}</p>
      <p>Payment: ${sale.payment_type?.toUpperCase()}</p>
      <hr/>
      <table>
        <thead>
          <tr><th align="left">Item</th><th align="right">Qty</th><th align="right">Rate</th><th align="right">Amt</th></tr>
        </thead>
        <tbody>
          ${items.map(i => {
      const netQty = i.quantity - (i.returned_qty || 0)
      if (netQty <= 0) return ''
      return `<tr>
              <td>${i.product_name}</td>
              <td class="right">${netQty}</td>
              <td class="right">${Number(i.unit_price).toFixed(0)}</td>
              <td class="right">${(netQty * i.unit_price).toFixed(0)}</td>
            </tr>`
    }).join('')}
        </tbody>
      </table>
      <hr/>
      <div style="width: 200px; margin-left: auto;">
        <table style="border: none;">
          <tr style="border: none;"><td style="border: none;">Subtotal</td><td class="right" style="border: none;">Rs. ${Number(sale.total_amount).toFixed(0)}</td></tr>
          ${Number(sale.discount) > 0 ? `<tr style="border: none;"><td style="border: none;">Discount</td><td class="right" style="border: none;">- Rs. ${Number(sale.discount).toFixed(0)}</td></tr>` : ''}
          <tr style="border: none;"><td class="bold" style="border: none;">TOTAL</td><td class="right bold" style="border: none;">Rs. ${Math.max(0, Number(sale.total_amount) - Number(sale.discount || 0)).toFixed(0)}</td></tr>
        </table>
      </div>
      <hr/>
      <p class="center" style="font-size: 16px; font-weight: bold; margin-top: 10px;">${footer || 'شکریہ! دوبارہ تشریف لائیں'}</p>
      </body></html>
    `)
    win.document.close(); win.print()
  }

  const filtered = sales.filter(s => {
    const matchSearch = (s.customers?.name || s.customer_name || 'walk-in').toLowerCase().includes(search.toLowerCase()) ||
      String(s.id).toLowerCase().includes(search.toLowerCase())
    const matchType = filterType ? (filterType === 'sale' || filterType === 'quotation' ? s.sale_type === filterType : s.payment_type === filterType) : true
    const matchDate = searchDate ? s.created_at.startsWith(searchDate) : true
    return matchSearch && matchType && matchDate
  })

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
      const item = sales.find(s => s.id === id)
      if (!item) continue
      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('sales').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          await addToSyncQueue('sales', 'DELETE', { id })
        }

        await moveToTrash('sales', id, item, user.id, user.shop_id)
        await db.sales.delete(id)
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    setSales(prev => prev.filter(s => !successfulIds.includes(s.id)))
    setSelected([])

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\nNote: Failed items may be linked to specific ledger entries that blocked deletion.`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} sale(s) moved to Trash!`)
    }
    fetchSales()
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selected.length === filtered.length) setSelected([])
    else setSelected(filtered.map(x => x.id))
  }

  return (
    <>
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-800">📜 Sales History</h1>
          <div className="flex gap-2 flex-wrap items-center">
            {selected.length > 0 && (
              <button onClick={() => requestDelete(selected)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm">
                🗑️ Delete Selected ({selected.length})
              </button>
            )}
          </div>
        </div>
        {/* Filters */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap">
          <div className="flex gap-4 w-full sm:w-auto">
            <input
              type="text"
              placeholder="Search invoice or customer..."
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 items-center">
            <select className="px-4 py-2 border rounded-lg outline-none flex-shrink-0" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              <option value="quotation">Quotations Only</option>
              <option value="sale">Sales Only</option>
            </select>
            <select className="px-4 py-2 border rounded-lg outline-none flex-shrink-0" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
              <option value="all">All Payments</option>
              <option value="cash">Cash Only</option>
              <option value="credit">Udhaar Only</option>
            </select>
            <input
              type="date"
              className="px-4 py-2 border rounded-lg outline-none w-[140px] flex-shrink-0"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading sales...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">No sales found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 w-10"><input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded" /></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Invoice ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Type / Payment</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filtered.map(sale => (
                    <tr key={sale.id} className={`hover:bg-gray-50 ${selected.includes(sale.id) ? 'bg-blue-50' : ''}`}>
                      <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(sale.id)} onChange={() => toggleSelect(sale.id)} className="w-4 h-4 rounded" /></td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {sale.sale_type === 'quotation' ? 'QT-' : '#'}${String(sale.id).slice(-8)}
                      </td>
                      <td className="px-4 py-3 text-gray-800">
                        {sale.customers?.name || sale.customer_name || <span className="text-gray-400 italic">Walk-in</span>}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        Rs. {(Number(sale.total_amount) - Number(sale.discount || 0)).toFixed(0)}
                        {sale.discount > 0 && <span className="text-xs text-gray-400 ml-1">(disc: {sale.discount})</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium w-fit ${sale.sale_type === 'quotation' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                            {sale.sale_type === 'quotation' ? '📄 Quotation' : '🧾 Sale'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium w-fit ${sale.payment_type === 'cash' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>
                            {sale.payment_type === 'cash' ? '💵 Cash' : '📒 Udhaar'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{new Date(sale.created_at).toLocaleDateString('en-PK')}</td>
                      <td className="px-4 py-3 flex gap-2">
                        <button onClick={() => openSale(sale)}
                          className="text-blue-500 hover:text-blue-700 text-sm font-medium">View</button>
                        <button onClick={() => requestDelete([sale.id])}
                          className="text-red-500 hover:text-red-700 text-sm font-medium">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
        }

        {/* Sale Detail Modal */}
        {
          selectedSale && (
            <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl shadow-2xl p-6 w-[600px] max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-800">
                      {selectedSale.sale_type === 'quotation' ? 'Quotation QT-' : 'Invoice #'}
                      {String(selectedSale.id).slice(-8)}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {new Date(selectedSale.created_at).toLocaleString('en-PK')} |
                      {selectedSale.customers?.name || selectedSale.customer_name || ' Walk-in'} |
                      <span className={selectedSale.payment_type === 'cash' ? ' text-green-600' : ' text-orange-600'}>
                        {' '}{selectedSale.payment_type?.toUpperCase()}
                      </span>
                    </p>
                  </div>
                  <button onClick={() => setSelectedSale(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                </div>

                {loadingItems ? <p className="text-gray-500 text-center py-8">Loading...</p> : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full mb-4 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs text-gray-500 whitespace-nowrap">Product</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Qty</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Rate</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Amount</th>
                            <th className="px-3 py-2 text-right text-xs text-gray-500 whitespace-nowrap">Returned</th>
                            <th className="px-3 py-2 text-center text-xs text-gray-500 whitespace-nowrap">Return Qty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {saleItems.map(item => {
                            const maxReturn = item.quantity - (item.returned_qty || 0)
                            return (
                              <tr key={item.id}>
                                <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{item.product_name}</td>
                                <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">{item.quantity}</td>
                                <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap">Rs. {Number(item.unit_price).toFixed(0)}</td>
                                <td className="px-3 py-2 text-right font-medium whitespace-nowrap">Rs. {Number(item.line_total || item.total_price || 0).toFixed(0)}</td>
                                <td className="px-3 py-2 text-right text-red-500 whitespace-nowrap">{item.returned_qty || 0}</td>
                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                  {maxReturn > 0 ? (
                                    <input type="number" min="0" max={maxReturn}
                                      value={returnQtys[item.id] || ''}
                                      onChange={e => setReturnQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                      className="w-16 border rounded px-2 py-1 text-center text-sm" placeholder="0" />
                                  ) : <span className="text-xs text-gray-400">Done</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex justify-between items-center border-t pt-3">
                      <div className="text-sm text-gray-600">
                        <p>Total: <b>Rs. {(Number(selectedSale.total_amount) - Number(selectedSale.discount || 0)).toFixed(0)}</b></p>
                        {selectedSale.discount > 0 && <p className="text-xs text-gray-400">Discount: Rs. {selectedSale.discount}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {selectedSale.sale_type !== 'quotation' && (
                          <div className="flex items-center gap-3 bg-gray-50 border px-3 py-1.5 rounded-lg mr-2">
                            <span className="text-[10px] font-bold text-gray-400 uppercase">Refund Type:</span>
                            <label className="flex items-center gap-1 text-sm cursor-pointer">
                              <input type="radio" checked={refundType === 'cash'} onChange={() => setRefundType('cash')} className="w-4 h-4 text-blue-600" />
                              💵 Cash
                            </label>
                            {selectedSale.customer_id && (
                              <label className="flex items-center gap-1 text-sm cursor-pointer">
                                <input type="radio" checked={refundType === 'credit'} onChange={() => setRefundType('credit')} className="w-4 h-4 text-orange-600" />
                                📒 Ledger
                              </label>
                            )}
                          </div>
                        )}
                        {selectedSale.sale_type === 'quotation' && (
                          <button onClick={() => navigate(`/pos?convertQuote=${selectedSale.id}`)}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition font-bold">
                            🛒 Convert to Sale
                          </button>
                        )}
                        <button onClick={() => printInvoice(selectedSale, saleItems)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition">
                          🖨️ Print {selectedSale.sale_type === 'quotation' ? 'Quotation' : 'Invoice'}
                        </button>
                        {selectedSale.sale_type !== 'quotation' && (
                          <button onClick={handleReturn} disabled={returning}
                            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition disabled:opacity-50">
                            {returning ? 'Processing...' : '↩️ Process Return'}
                          </button>
                        )}
                        <button onClick={() => setSelectedSale(null)}
                          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">
                          Close
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        }
      </div>

      {showPasswordModal && (
        <PasswordModal
          title="Delete Sale(s)"
          message={`${pendingDeleteIds.length} sale(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </>
  )
}

export default Sales