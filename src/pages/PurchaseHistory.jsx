import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import { recordAuditLog } from '../services/auditService'
import PasswordModal from '../components/PasswordModal'
import * as XLSX from 'xlsx'

function PurchaseHistory() {
    const { user } = useAuth()
    const [purchases, setPurchases] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedPurchase, setSelectedPurchase] = useState(null)
    const [purchaseItems, setPurchaseItems] = useState([])
    const [loadingItems, setLoadingItems] = useState(false)
    const [search, setSearch] = useState('')
    const [filterType, setFilterType] = useState('')
    const [paymentFilter, setPaymentFilter] = useState('all')
    const [dateFilter, setDateFilter] = useState('')
    const [selected, setSelected] = useState([])
    const [showPasswordModal, setShowPasswordModal] = useState(false)
    const [pendingDeleteIds, setPendingDeleteIds] = useState([])

    const [shopSettings, setShopSettings] = useState({})

    // Return feature state
    const [returnQtys, setReturnQtys] = useState({})
    const [returning, setReturning] = useState(false)

    useEffect(() => {
        if (user?.shop_id) {
            fetchPurchases()
            fetchShopSettings()
        }
    }, [user?.shop_id])

    const fetchShopSettings = async () => {
        try {
            if (!navigator.onLine) throw new Error('Offline')
            const { data } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
            if (data) setShopSettings(data)
        } catch (e) {
            console.log('PurchaseHistory: Using cached settings')
        }
    }

    const fetchPurchases = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline');
            const fetchPromise = supabase
                .from('purchases')
                .select('*, suppliers(name)')
                .eq('shop_id', user.shop_id)
                .order('created_at', { ascending: false })

            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

            const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

            if (error) throw error
            if (data) {
                const cleanData = JSON.parse(JSON.stringify(data))
                await db.purchases.bulkPut(cleanData)
            }

            // Always render from local DB to include pending items
            const localData = await db.purchases.toArray()
            const sid = String(user.shop_id)
            const filtered = localData.filter(x => String(x.shop_id) === sid)
            const sorted = filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            setPurchases(sorted)
        } catch (e) {
            console.log('Purchases: Fetching from local DB (Offline Fallback)')
            try {
                const localData = await db.purchases.toArray()
                const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                setPurchases(sorted.filter(x => String(x.shop_id) === String(user.shop_id)))
            } catch (err) { console.error('Local DB PurchaseHistory Error:', err) }
        } finally {
            setLoading(false)
        }
    }

    const openPurchase = async (purchase) => {
        setSelectedPurchase(purchase)
        setReturnQtys({})
        setLoadingItems(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')
            const fetchPromise = supabase
                .from('purchase_items')
                .select('*, products(name, stock_quantity)')
                .eq('purchase_id', purchase.id)

            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

            if (error) throw error
            if (data) {
                const cleanData = JSON.parse(JSON.stringify(data))
                await db.purchase_items.bulkPut(cleanData)
            }

            // Render from local for consistency
            const localItems = await db.purchase_items.where({ purchase_id: purchase.id }).toArray()
            setPurchaseItems(localItems)
        } catch (e) {
            console.log('Purchase Items: Fetching from local DB')
            const localItems = await db.purchase_items.where({ purchase_id: purchase.id }).toArray().catch(() => [])
            if (localItems.length === 0) {
                const all = await db.purchase_items.toArray()
                setPurchaseItems(all.filter(i => i.purchase_id === purchase.id))
            } else {
                setPurchaseItems(localItems)
            }
        }
        setLoadingItems(false)
    }

    // Handle purchase return (supplier return / stock out)
    const handleReturn = async () => {
        const itemsToReturn = purchaseItems.filter(i => returnQtys[i.id] > 0)
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

                // Update returned_qty on purchase_item
                await supabase.from('purchase_items')
                    .update({ returned_qty: (item.returned_qty || 0) + returnQty })
                    .eq('id', item.id)

                // Reduce stock — fetch live stock first
                const { data: liveProduct } = await supabase.from('products').select('stock_quantity').eq('id', item.product_id).single()
                const currentStock = liveProduct?.stock_quantity ?? 0
                const newStock = Math.max(0, currentStock - returnQty)
                await supabase.from('products')
                    .update({ stock_quantity: newStock })
                    .eq('id', item.product_id)
                // Keep local DB in sync
                await db.products.update(item.product_id, { stock_quantity: newStock })
            }

            // Update purchase record total
            const newPurchaseTotal = Math.max(0, (selectedPurchase.total_amount || 0) - totalReturnAmount)
            await supabase.from('purchases').update({ total_amount: newPurchaseTotal }).eq('id', selectedPurchase.id)

            // If credit purchase, reduce supplier balance
            if (selectedPurchase.payment_type === 'credit' && selectedPurchase.supplier_id) {
                const { data: sup } = await supabase.from('suppliers').select('outstanding_balance').eq('id', selectedPurchase.supplier_id).single()
                const newBal = Math.max(0, (sup?.outstanding_balance || 0) - totalReturnAmount)
                await supabase.from('suppliers').update({ outstanding_balance: newBal }).eq('id', selectedPurchase.supplier_id)

                // Log payment return in supplier_payments
                await supabase.from('supplier_payments').insert([{
                    shop_id: user.shop_id,
                    supplier_id: selectedPurchase.supplier_id,
                    amount: -totalReturnAmount,
                    payment_type: 'return',
                    note: `Return from Purchase PR-${String(selectedPurchase.id).slice(-6)}`
                }])
            }

            // Audit Log
            recordAuditLog(
                'PURCHASE_RETURN',
                'purchases',
                selectedPurchase.id,
                {
                    purchase: selectedPurchase.id,
                    returned_amount: totalReturnAmount,
                    items: itemsToReturn.map(it => ({ name: it.product_name, qty: returnQtys[it.id] }))
                },
                user.id,
                user.shop_id
            )

            alert('Return successful! Purchase invoice updated.')
            setReturning(false)
            setReturnQtys({})

            // Re-fetch updated purchase
            const { data: updatedPurchase } = await supabase.from('purchases').select('*, suppliers(name)').eq('id', selectedPurchase.id).single()
            if (updatedPurchase) setSelectedPurchase(updatedPurchase)
            fetchPurchases()
        } catch (err) {
            const errMsg = err?.message || String(err)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                // OFFLINE RETURN LOGIC
                totalReturnAmount = 0
                for (const item of itemsToReturn) {
                    const returnQty = parseInt(returnQtys[item.id]) || 0
                    totalReturnAmount += item.unit_price * returnQty

                    // 1. Update local purchase_item
                    const newRetQty = (item.returned_qty || 0) + returnQty
                    await db.purchase_items.update(item.id, { returned_qty: newRetQty })
                    await db.sync_queue.add({ table: 'purchase_items', action: 'UPDATE', data: { id: item.id, returned_qty: newRetQty }, timestamp: new Date().toISOString() })

                    // 2. Update local stock (subtract for purchase return)
                    const localProd = await db.products.get(item.product_id)
                    const newStock = Math.max(0, (localProd?.stock_quantity || 0) - returnQty)
                    await db.products.update(item.product_id, { stock_quantity: newStock })
                    await db.sync_queue.add({ table: 'products', action: 'UPDATE', data: { id: item.product_id, stock_quantity: newStock }, timestamp: new Date().toISOString() })
                }

                // Update local purchase total
                const newPurchaseTotal = Math.max(0, (selectedPurchase.total_amount || 0) - totalReturnAmount)
                await db.purchases.update(selectedPurchase.id, { total_amount: newPurchaseTotal })
                await db.sync_queue.add({ table: 'purchases', action: 'UPDATE', data: { id: selectedPurchase.id, total_amount: newPurchaseTotal }, timestamp: new Date().toISOString() })

                alert('Offline mode: Return processed locally. Stock and Invoice updated! 🔄')
                setReturning(false)
                setReturnQtys({})
                setSelectedPurchase({ ...selectedPurchase, total_amount: newPurchaseTotal })
                fetchPurchases()
            } else {
                alert('Error processing return: ' + errMsg)
                setReturning(false)
            }
        }
    }

    const handleExport = () => {
        const data = filtered.map(p => ({
            'ID': `PR-${String(p.id).slice(-6)}`,
            'Supplier': p.suppliers?.name || 'Unknown',
            'Total Amount': p.total_amount,
            'Paid Amount': p.paid_amount,
            'Payment Type': p.payment_type.toUpperCase(),
            'Date': new Date(p.created_at).toLocaleDateString('en-PK')
        }))
        const ws = XLSX.utils.json_to_sheet(data)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Purchases')
        XLSX.writeFile(wb, `PurchaseHistory_${new Date().toISOString().slice(0, 10)}.xlsx`)
    }

    const printPurchase = (p, items) => {
        const isThermal = shopSettings.print_size === 'thermal'

        const win = window.open('', '_blank')
        win.document.write(`
      <html><head><title>Purchase Invoice</title>
      <style>
        body { font-family: ${isThermal ? 'monospace' : "'Segoe UI', sans-serif"}; width: ${isThermal ? '320px' : '794px'}; margin: auto; padding: 20px; font-size: 13px; border: ${isThermal ? 'none' : '1px solid #eee'}; }
        h2, p.center { text-align: center; margin: 2px 0; }
        hr { border-top: 1px dashed #000; margin: 6px 0; }
        table { width: 100%; border-collapse: collapse; }
        td, th { padding: ${isThermal ? '5px 0' : '10px'}; vertical-align: top; }
        .right { text-align: right; } .bold { font-weight: bold; }
        .logo { display: block; margin: 0 auto 10px; max-width: 100px; }
        ${!isThermal ? `
          table { border: 1px solid #ddd; }
          th, td { border: 1px solid #ddd; }
        ` : ''}
      </style></head><body>
      ${shopSettings.logo_url ? `<img src="${shopSettings.logo_url}" class="logo" />` : ''}
      <h2>${shopSettings.name || 'Sanitary POS'}</h2>
      <p class="center">${shopSettings.address || ''}</p>
      <p class="center">Phone: ${shopSettings.phone || ''}</p>
      <hr/>
      <p>Purchase Invoice #: PR-${String(p.id).slice(-8)}</p>
      <p>Supplier: ${p.suppliers?.name || 'Unknown'}</p>
      <p>Date: ${new Date(p.created_at).toLocaleString('en-PK')}</p>
      <p>Payment: ${p.payment_type?.toUpperCase()}</p>
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
          <tr style="border: none;"><td style="border: none;" class="bold">TOTAL</td><td class="right bold" style="border: none;">Rs. ${Number(p.total_amount).toFixed(0)}</td></tr>
          ${p.paid_amount != null ? `<tr style="border: none;"><td style="border: none;">Paid</td><td class="right" style="border: none;">Rs. ${Number(p.paid_amount).toFixed(0)}</td></tr>` : ''}
        </table>
      </div>
      <hr/>
      <p class="center" style="font-size: 14px; margin-top: 10px; color: #888;">Computer Generated Purchase Record</p>
      </body></html>
    `)
        win.document.close(); win.print()
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
            const item = purchases.find(p => p.id === id)
            if (!item) continue
            try {
                if (navigator.onLine) {
                    const { error } = await supabase.from('purchases').delete().eq('id', id)
                    if (error) {
                        console.error('Delete failed:', error)
                        failCount++
                        continue
                    }
                } else {
                    await addToSyncQueue('purchases', 'DELETE', { id })
                }

                await moveToTrash('purchases', id, item, user.id, user.shop_id)
                await db.purchases.delete(id)
                successfulIds.push(id)
                successCount++
            } catch (err) {
                console.error('Delete error:', err)
                failCount++
            }
        }

        setPurchases(prev => prev.filter(p => !successfulIds.includes(p.id)))
        setSelected([])

        if (failCount > 0) {
            alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}\n\nNote: Failed items may be linked to specific ledger entries that blocked deletion.`)
        } else if (successCount > 0) {
            alert(`🗑️ ${successCount} purchase(s) moved to Trash!`)
        }
        fetchPurchases()
    }

    const toggleSelect = (id) => {
        setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }

    const toggleSelectAll = () => {
        if (selected.length === filtered.length) setSelected([])
        else setSelected(filtered.map(x => x.id))
    }

    const filtered = purchases.filter(p => {
        const matchSearch = (p.suppliers?.name || '').toLowerCase().includes(search.toLowerCase()) ||
            String(p.id).toLowerCase().includes(search.toLowerCase())
        const matchType = filterType ? p.payment_type === filterType : true
        return matchSearch && matchType
    })

    // Summary stats
    const totalPurchaseValue = filtered.reduce((sum, p) => sum + Number(p.total_amount || 0), 0)
    const cashCount = filtered.filter(p => p.payment_type === 'cash').length
    const creditCount = filtered.filter(p => p.payment_type === 'credit').length

    return (
        <>
            <div>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">📦 Purchase History</h1>
                        <p className="text-gray-500 text-sm">View and manage previous stock-in records</p>
                    </div>
                    <div className="flex gap-3 items-center overflow-x-auto pb-1 max-w-full">
                        {/* Summary cards */}
                        <div className="bg-white px-4 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[100px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Total</p>
                            <p className="text-sm font-bold text-blue-600">Rs. {totalPurchaseValue.toLocaleString()}</p>
                        </div>
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[100px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Cash</p>
                            <p className="text-sm font-bold text-green-600">{cashCount}</p>
                        </div>
                        <div className="bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 text-center min-w-[100px]">
                            <p className="text-[10px] text-gray-400 font-bold uppercase">Credit</p>
                            <p className="text-sm font-bold text-orange-600">{creditCount}</p>
                        </div>
                    </div>
                    {selected.length > 0 && (
                        <button onClick={() => requestDelete(selected)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm">
                            🗑️ Delete Selected ({selected.length})
                        </button>
                    )}
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col sm:flex-row gap-4 items-start sm:items-center flex-wrap">
                    <input
                        type="text"
                        placeholder="Search PR- ID or Supplier..."
                        className="flex-1 px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none w-full sm:w-auto"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-1 items-center">
                        <select
                            className="px-4 py-2 border rounded-lg outline-none flex-shrink-0"
                            value={paymentFilter}
                            onChange={e => setPaymentFilter(e.target.value)}
                        >
                            <option value="all">All Payments</option>
                            <option value="cash">Cash Only</option>
                            <option value="credit">Credit Only</option>
                        </select>
                        <input
                            type="date"
                            className="px-4 py-2 border rounded-lg outline-none w-[140px] flex-shrink-0"
                            value={dateFilter}
                            onChange={e => setDateFilter(e.target.value)}
                        />
                        <button
                            onClick={handleExport}
                            className="px-4 py-2 bg-green-50 text-green-700 hover:bg-green-100 font-bold rounded-lg border border-green-200 transition text-sm flex-shrink-0"
                        >
                            📤 Export Excel
                        </button>
                        <button
                            onClick={fetchPurchases}
                            className="p-2 text-gray-400 hover:text-blue-600 transition flex-shrink-0"
                            title="Refresh Data"
                        >
                            🔄
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className="text-gray-500 italic">Loading purchase records...</p>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12"><p className="text-gray-400 text-lg">No purchases found.</p></div>
                ) : (
                    <div className="bg-white rounded-xl shadow overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-4 py-4 w-10"><input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleSelectAll} className="w-4 h-4 rounded" /></th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Invoice ID</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Supplier</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Total</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Payment</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Date</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filtered.map(p => (
                                        <tr key={p.id} className={`hover:bg-gray-50 transition ${selected.includes(p.id) ? 'bg-blue-50' : ''}`}>
                                            <td className="px-4 py-3"><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleSelect(p.id)} className="w-4 h-4 rounded" /></td>
                                            <td className="px-4 py-3 font-mono text-xs text-blue-600 font-bold">PR-{String(p.id).slice(-6)}</td>
                                            <td className="px-4 py-3 text-gray-800 font-medium">{p.suppliers?.name || <span className="text-gray-400 italic">Unknown</span>}</td>
                                            <td className="px-4 py-3 font-medium text-gray-800">
                                                Rs. {Number(p.total_amount).toLocaleString()}
                                                {p.paid_amount != null && Number(p.paid_amount) < Number(p.total_amount) && (
                                                    <span className="text-xs text-orange-500 ml-1">(Paid: {Number(p.paid_amount).toLocaleString()})</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-1">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium w-fit ${p.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                        {p.payment_type === 'cash' ? '💵 Cash' : '📒 Credit/Udhaar'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-gray-500 text-sm">{new Date(p.created_at).toLocaleDateString('en-PK')}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-2">
                                                    <button onClick={() => openPurchase(p)}
                                                        className="text-blue-500 hover:text-blue-700 text-sm font-medium">View</button>
                                                    <button onClick={() => requestDelete([p.id])}
                                                        className="text-red-500 hover:text-red-700 text-sm font-medium">Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Detail Modal */}
                {selectedPurchase && (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-[640px] max-h-[90vh] overflow-y-auto">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-800">
                                        Purchase Invoice PR-{String(selectedPurchase.id).slice(-8)}
                                    </h2>
                                    <p className="text-sm text-gray-500">
                                        {new Date(selectedPurchase.created_at).toLocaleString('en-PK')} |
                                        {' '}{selectedPurchase.suppliers?.name || 'Unknown'} |
                                        <span className={selectedPurchase.payment_type === 'cash' ? ' text-green-600' : ' text-orange-600'}>
                                            {' '}{selectedPurchase.payment_type?.toUpperCase()}
                                        </span>
                                    </p>
                                </div>
                                <button onClick={() => setSelectedPurchase(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
                            </div>

                            {/* Info Grid */}
                            <div className="grid grid-cols-2 gap-4 mb-4 bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm">
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Supplier</span> <b>{selectedPurchase.suppliers?.name || 'Unknown'}</b></p>
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Date</span> <b>{new Date(selectedPurchase.created_at).toLocaleString('en-PK')}</b></p>
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Total Amount</span> <b className="text-lg">Rs. {Number(selectedPurchase.total_amount).toLocaleString()}</b></p>
                                <p><span className="text-gray-400 font-medium uppercase text-[10px] block">Payment Type</span> <b className="uppercase">{selectedPurchase.payment_type}</b>
                                    {selectedPurchase.paid_amount != null && <span className="text-xs text-gray-400 ml-2">(Paid: Rs. {Number(selectedPurchase.paid_amount).toLocaleString()})</span>}
                                </p>
                            </div>

                            {loadingItems ? (
                                <p className="text-center py-8 text-gray-500">Loading items...</p>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <table className="w-full mb-6">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Product</th>
                                                    <th className="px-4 py-3 text-right text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Qty</th>
                                                    <th className="px-4 py-3 text-right text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Rate</th>
                                                    <th className="px-4 py-3 text-right text-xs text-gray-500 uppercase font-bold whitespace-nowrap">Amount</th>
                                                    <th className="px-4 py-3 text-center text-xs text-gray-500 uppercase font-bold bg-orange-50 whitespace-nowrap">Ret. Qty</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {purchaseItems.map((item, idx) => {
                                                    const maxReturn = item.quantity - (item.returned_qty || 0)
                                                    return (
                                                        <tr key={idx} className="hover:bg-gray-50">
                                                            <td className="px-4 py-3 text-gray-800 whitespace-nowrap">{item.product_name}</td>
                                                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                                                                {item.quantity}
                                                                {item.returned_qty > 0 && <span className="text-xs text-red-500 ml-1 block">(-{item.returned_qty} ret)</span>}
                                                            </td>
                                                            <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">Rs. {Number(item.unit_price).toFixed(0)}</td>
                                                            <td className="px-4 py-3 text-right font-medium text-gray-800 whitespace-nowrap">Rs. {Number(item.total_price || item.line_total).toFixed(0)}</td>
                                                            <td className="px-4 py-3 text-center align-middle whitespace-nowrap">
                                                                {maxReturn > 0 ? (
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max={maxReturn}
                                                                        value={returnQtys[item.id] || ''}
                                                                        onChange={e => setReturnQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                                        className="w-16 border rounded px-2 py-1 text-center text-sm shadow-inner"
                                                                        placeholder="0"
                                                                    />
                                                                ) : (
                                                                    <span className="text-xs text-gray-400 italic">Fully Ret</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-t border-gray-100 pt-4 mt-4 gap-4">
                                        <div className="text-sm">
                                            <p className="text-gray-500">Total Amount: <b className="text-gray-800 text-lg">Rs. {Number(selectedPurchase.total_amount).toLocaleString()}</b></p>
                                            {selectedPurchase.paid_amount != null && <p className="text-gray-500">Paid Amount: <b className="text-gray-800">Rs. {Number(selectedPurchase.paid_amount).toLocaleString()}</b></p>}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button onClick={() => printPurchase(selectedPurchase, purchaseItems)}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition">
                                                🖨️ Print Invoice
                                            </button>
                                            <button onClick={handleReturn} disabled={returning}
                                                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm transition disabled:opacity-50">
                                                {returning ? 'Processing...' : '↩️ Process Return'}
                                            </button>
                                            <button onClick={() => setSelectedPurchase(null)}
                                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">
                                                Close
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {
                showPasswordModal && (
                    <PasswordModal
                        title="Delete Purchase(s)"
                        message={`${pendingDeleteIds.length} purchase(s) will be moved to Trash`}
                        onConfirm={executeDelete}
                        onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
                    />
                )
            }
        </>
    )
}

export default PurchaseHistory
