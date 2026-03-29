import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { generateOutstandingPDF, shareOrDownloadPDF } from '../utils/pdfShare'

function CustomerLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

    const [customer, setCustomer] = useState(null)
    const [loading, setLoading] = useState(true)
    const [ledger, setLedger] = useState([])
    const [showPaymentModal, setShowPaymentModal] = useState(false)
    const [paymentAmount, setPaymentAmount] = useState('')
    const [paymentNote, setPaymentNote] = useState('')
    const [saving, setSaving] = useState(false)
    const [expandedSale, setExpandedSale] = useState(null)
    const [lastPayment, setLastPayment] = useState(null) // for print voucher after recording
    const [selectedIds, setSelectedIds] = useState(new Set())

    useEffect(() => {
        if (id && user?.shop_id) fetchCustomerData()
    }, [id, user?.shop_id])

    const fetchCustomerData = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')

            const fetchPromise = Promise.all([
                supabase.from('customers').select('*').eq('id', id).eq('shop_id', user.shop_id).maybeSingle(),
                supabase.from('sales').select('*, sale_items(*)').eq('customer_id', id).eq('shop_id', user.shop_id).order('created_at', { ascending: true }),
                supabase.from('customer_payments').select('*').eq('customer_id', id).eq('shop_id', user.shop_id)
            ])
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            const [custRes, salesRes, paymentsRes] = await Promise.race([fetchPromise, timeoutPromise])

            // If customer not found, show not-found screen
            if (!custRes.data) { setLoading(false); return }
            setCustomer(custRes.data)

            const sales = salesRes.error ? [] : (salesRes.data || [])
            const payments = paymentsRes.error ? [] : (paymentsRes.data || [])

            // 4. Combine into Ledger
            const combined = [
                ...(sales || []).map(s => ({
                    id: s.id,
                    date: s.created_at,
                    type: 'sale',
                    payment_type: s.payment_type,
                    amount: s.total_amount - (s.discount || 0),
                    paid_amount: s.paid_amount || 0,
                    note: `Invoice #${String(s.id).slice(-8)}`,
                    items: s.sale_items || []
                })),
                ...(payments || []).map(p => ({
                    id: p.id,
                    date: p.created_at,
                    type: p.payment_type === 'return' ? 'return' : 'payment',
                    payment_type: p.payment_type,
                    amount: p.amount,
                    note: p.note || 'Cash Payment',
                }))
            ]

            // Sort by date
            combined.sort((a, b) => new Date(a.date) - new Date(b.date))

            // Calculate running balance
            let running = 0
            const withBalance = combined.map(item => {
                if (item.type === 'sale') {
                    // Add only the unpaid portion (handles credit, partial, split)
                    const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                    if (owed > 0) running += owed
                } else {
                    // 'refund' = cash was given back, no balance change; payments/returns reduce balance
                    if (item.payment_type !== 'refund') {
                        running -= Math.abs(item.amount)
                    }
                }
                return { ...item, balance: running }
            })

            // If customer has outstanding balance but no transactions explain it,
            // add an "Opening Balance" entry so the ledger isn't confusingly empty
            const ob = custRes.data.outstanding_balance || 0
            if (withBalance.length === 0 && ob !== 0) {
                withBalance.push({
                    id: 'opening',
                    date: custRes.data.created_at || new Date().toISOString(),
                    type: 'sale',
                    payment_type: 'credit',
                    amount: Math.abs(ob),
                    note: 'Opening Balance (previous dues)',
                    items: [],
                    balance: ob
                })
            }

            setLedger(withBalance.reverse()) // newest first for display
        } catch (e) {
            console.log('CustomerLedger: Reconstructing from local DB (Offline)')
            try {
                const sid = String(user.shop_id)
                const [lCusts, lSales, lItems, lPayments] = await Promise.all([
                    db.customers.toArray(),
                    db.sales.toArray(),
                    db.sale_items.toArray(),
                    db.customer_payments.toArray()
                ])

                const cust = lCusts.find(c => String(c.id) === String(id))
                if (cust) setCustomer(cust)

                const mySales = lSales.filter(s => String(s.customer_id) === String(id))
                const myPayments = lPayments.filter(p => String(p.customer_id) === String(id))

                const combined = [
                    ...mySales.map(s => ({
                        id: s.id,
                        date: s.created_at,
                        type: 'sale',
                        payment_type: s.payment_type,
                        amount: s.total_amount - (s.discount || 0),
                        paid_amount: s.paid_amount || 0,
                        note: `Invoice #${String(s.id).slice(-8)}`,
                        items: lItems.filter(i => i.sale_id === s.id)
                    })),
                    ...myPayments.map(p => ({
                        id: p.id,
                        date: p.created_at,
                        type: p.payment_type === 'return' ? 'return' : 'payment',
                        payment_type: p.payment_type,
                        amount: p.amount,
                        note: p.note || 'Cash Payment',
                    }))
                ]

                combined.sort((a, b) => new Date(a.date) - new Date(b.date))
                let running = 0
                const withBalance = combined.map(item => {
                    if (item.type === 'sale') {
                        const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                        if (owed > 0) running += owed
                    } else {
                        if (item.payment_type !== 'refund') {
                            running -= Math.abs(item.amount)
                        }
                    }
                    return { ...item, balance: running }
                })
                // Opening balance if no transactions but customer has dues
                const cOb = cust?.outstanding_balance || 0
                if (withBalance.length === 0 && cOb !== 0) {
                    withBalance.push({
                        id: 'opening', date: cust?.created_at || new Date().toISOString(),
                        type: 'sale', payment_type: 'credit', amount: Math.abs(cOb),
                        note: 'Opening Balance (previous dues)', items: [], balance: cOb
                    })
                }
                setLedger(withBalance.reverse())
            } catch (err) { console.error('Final CustomerLedger Fallback Error:', err) }
        } finally {
            setLoading(false)
        }
    }

    const printPaymentVoucher = (amount, note, date) => {
        const shopName = JSON.parse(localStorage.getItem('plan_limits') || '{}').shop_name || 'Our Shop'
        const cachedShopName = localStorage.getItem('shop_name') || shopName
        const win = window.open('', '_blank')
        win.document.write(`<html><head><title>Payment Receipt</title>
        <style>
          body{font-family:monospace;width:320px;margin:auto;padding:20px;font-size:13px;}
          h2,p.c{text-align:center;margin:3px 0;}
          hr{border-top:1px dashed #000;margin:8px 0;}
          .row{display:flex;justify-content:space-between;padding:3px 0;}
          .bold{font-weight:bold;}
        </style></head><body>
        <h2>${cachedShopName}</h2>
        <p class="c bold" style="font-size:15px;">PAYMENT RECEIPT</p>
        <hr/>
        <div class="row"><span>Customer:</span><span class="bold">${customer.name}</span></div>
        <div class="row"><span>Phone:</span><span>${customer.phone || '-'}</span></div>
        <div class="row"><span>Date:</span><span>${new Date(date || Date.now()).toLocaleString('en-PK')}</span></div>
        <hr/>
        <div class="row bold" style="font-size:16px;"><span>Amount Received</span><span>Rs. ${Number(amount).toLocaleString()}</span></div>
        ${note ? `<div class="row"><span>Note:</span><span>${note}</span></div>` : ''}
        <hr/>
        <div class="row"><span>Remaining Balance:</span><span class="bold">Rs. ${Math.max(0, (customer.outstanding_balance || 0) - Number(amount)).toLocaleString()}</span></div>
        <hr/>
        <p class="c" style="font-size:11px;color:#888;">Thank you! Payment received in full.</p>
        </body></html>`)
        win.document.close(); win.print()
    }

    const handleAddPayment = async (e) => {
        e.preventDefault()
        if (!paymentAmount || parseFloat(paymentAmount) <= 0) return

        setSaving(true)
        const amount = parseFloat(paymentAmount)

        try {
            if (!navigator.onLine) throw new TypeError('Failed to fetch')

            // 1. Insert payment record
            const { error: pError } = await supabase.from('customer_payments').insert([{
                shop_id: user.shop_id,
                customer_id: id,
                amount: amount,
                payment_type: 'payment',
                note: paymentNote || 'Cash Received'
            }])

            if (pError) throw pError

            // 2. Update customer balance
            const newBalance = Math.max(0, (customer.outstanding_balance || 0) - amount)
            const { error: cError } = await supabase.from('customers').update({ outstanding_balance: newBalance }).eq('id', id)
            if (cError) throw cError

            setLastPayment({ amount, note: paymentNote || 'Cash Received', date: new Date().toISOString() })
            setPaymentAmount('')
            setPaymentNote('')
            setShowPaymentModal(false)
            fetchCustomerData()
        } catch (error) {
            const errMsg = error?.message || String(error)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                const paymentId = crypto.randomUUID()
                const paymentData = {
                    id: paymentId,
                    shop_id: user.shop_id,
                    customer_id: id,
                    amount: amount,
                    payment_type: 'payment',
                    note: (paymentNote || 'Cash Received') + ' (Offline)',
                    created_at: new Date().toISOString()
                }

                // 1. Record payment locally
                await db.customer_payments.add(paymentData)
                await db.sync_queue.add({ table: 'customer_payments', action: 'INSERT', data: paymentData, timestamp: paymentData.created_at })

                // 2. Update local balance
                const newBal = Math.max(0, (customer?.outstanding_balance || 0) - amount)
                await db.customers.update(id, { outstanding_balance: newBal })
                await db.sync_queue.add({ table: 'customers', action: 'UPDATE', data: { id, outstanding_balance: newBal }, timestamp: paymentData.created_at })

                setLastPayment({ amount, note: (paymentNote || 'Cash Received') + ' (Offline)', date: paymentData.created_at })
                setPaymentAmount('')
                setPaymentNote('')
                setShowPaymentModal(false)
                setCustomer({ ...customer, outstanding_balance: newBal })
                fetchCustomerData()
            } else {
                alert('Error: ' + errMsg)
            }
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteTransaction = async (item) => {
        if (item.id === 'opening') { alert('Opening balance entry directly delete nahi ho sakti.'); return }
        const label = item.type === 'sale' ? 'Sale/Invoice' : item.type === 'payment' ? 'Payment' : 'Return'
        if (!confirm(`Yeh transaction delete karein?\n\nType: ${label}\nAmount: Rs. ${Number(item.amount).toLocaleString()}\nNote: ${item.note}\n\nCustomer ka outstanding balance bhi adjust ho ga.`)) return

        try {
            let newBalance = customer.outstanding_balance || 0

            if (item.type === 'sale') {
                // Cascade: delete sale_items first, then sale
                if (navigator.onLine) {
                    await supabase.from('sale_items').delete().eq('sale_id', item.id)
                    const { error } = await supabase.from('sales').delete().eq('id', item.id)
                    if (error) throw error
                } else {
                    const lItems = await db.sale_items.toArray()
                    const toDelIds = lItems.filter(i => String(i.sale_id) === String(item.id)).map(i => i.id)
                    await db.sale_items.bulkDelete(toDelIds)
                    await db.sales.delete(item.id)
                    await db.sync_queue.add({ table: 'sales', action: 'DELETE', data: { id: item.id }, timestamp: new Date().toISOString() })
                }
                // Reverse: sale was adding unpaid portion to balance
                const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                newBalance = Math.max(0, newBalance - owed)
            } else {
                // payment or return — delete from customer_payments
                if (navigator.onLine) {
                    const { error } = await supabase.from('customer_payments').delete().eq('id', item.id)
                    if (error) throw error
                } else {
                    await db.customer_payments.delete(item.id)
                    await db.sync_queue.add({ table: 'customer_payments', action: 'DELETE', data: { id: item.id }, timestamp: new Date().toISOString() })
                }
                // Reverse: payment/return was reducing balance, so deleting it adds back
                if (item.payment_type !== 'refund') {
                    newBalance = newBalance + Math.abs(item.amount)
                }
            }

            // Update customer outstanding balance (skip gracefully if customer no longer exists)
            try {
                if (navigator.onLine) {
                    await supabase.from('customers').update({ outstanding_balance: Math.max(0, newBalance) }).eq('id', id)
                } else {
                    await db.customers.update(parseInt(id), { outstanding_balance: Math.max(0, newBalance) })
                }
                setCustomer(c => c ? ({ ...c, outstanding_balance: Math.max(0, newBalance) }) : c)
            } catch (_) { /* customer may already be deleted — ignore */ }
            fetchCustomerData()
        } catch (err) {
            alert('Delete nahi hua: ' + err.message)
        }
    }

    const selectableItems = ledger.filter(item => item.id !== 'opening')
    const allSelected = selectableItems.length > 0 && selectableItems.every(item => selectedIds.has(item.id))

    const toggleSelect = (itemId) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            next.has(itemId) ? next.delete(itemId) : next.add(itemId)
            return next
        })
    }
    const toggleSelectAll = () => {
        if (allSelected) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(selectableItems.map(i => i.id)))
        }
    }

    const handleBulkDelete = async () => {
        const toDelete = ledger.filter(item => selectedIds.has(item.id) && item.id !== 'opening')
        if (!toDelete.length) return
        if (!confirm(`${toDelete.length} transactions delete karein?\n\nCustomer ka outstanding balance bhi adjust ho ga.`)) return

        let newBalance = customer.outstanding_balance || 0
        try {
            for (const item of toDelete) {
                if (item.type === 'sale') {
                    if (navigator.onLine) {
                        await supabase.from('sale_items').delete().eq('sale_id', item.id)
                        await supabase.from('sales').delete().eq('id', item.id)
                    } else {
                        const lItems = await db.sale_items.toArray()
                        const toDelIds = lItems.filter(i => String(i.sale_id) === String(item.id)).map(i => i.id)
                        await db.sale_items.bulkDelete(toDelIds)
                        await db.sales.delete(item.id)
                        await db.sync_queue.add({ table: 'sales', action: 'DELETE', data: { id: item.id }, timestamp: new Date().toISOString() })
                    }
                    const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                    newBalance = Math.max(0, newBalance - owed)
                } else {
                    if (navigator.onLine) {
                        await supabase.from('customer_payments').delete().eq('id', item.id)
                    } else {
                        await db.customer_payments.delete(item.id)
                        await db.sync_queue.add({ table: 'customer_payments', action: 'DELETE', data: { id: item.id }, timestamp: new Date().toISOString() })
                    }
                    if (item.payment_type !== 'refund') newBalance = newBalance + Math.abs(item.amount)
                }
            }
            try {
                if (navigator.onLine) {
                    await supabase.from('customers').update({ outstanding_balance: Math.max(0, newBalance) }).eq('id', id)
                } else {
                    await db.customers.update(parseInt(id), { outstanding_balance: Math.max(0, newBalance) })
                }
                setCustomer(c => c ? ({ ...c, outstanding_balance: Math.max(0, newBalance) }) : c)
            } catch (_) { /* customer may already be deleted — ignore */ }
            setSelectedIds(new Set())
            fetchCustomerData()
        } catch (err) {
            alert('Kuch entries delete nahi huin: ' + err.message)
            fetchCustomerData()
        }
    }

    if (loading) return <div className="p-8">Loading ledger...</div>
    if (!customer) return <div className="p-8 text-red-500">Customer not found!</div>

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <button onClick={() => navigate('/customers')} className="text-blue-500 mb-2 hover:underline text-sm font-semibold">← Back to Customers</button>
                    <h1 className="text-3xl font-bold text-gray-800">{customer.name}</h1>
                    <p className="text-gray-500">{customer.phone} | {customer.address}</p>
                </div>
                <div className="w-full sm:w-auto text-left sm:text-right flex flex-col sm:items-end gap-3">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-1 w-full sm:w-auto">
                        <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Total Outstanding</p>
                        <p className={`text-3xl font-bold ${customer.outstanding_balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            Rs. {customer.outstanding_balance || 0}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {customer.phone && (
                            <button
                                onClick={async (e) => {
                                    const btn = e.currentTarget
                                    btn.disabled = true
                                    btn.innerHTML = '⏳ Generating PDF...'
                                    try {
                                        const { data: shop } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
                                        const phone = customer.phone.replace(/[^0-9]/g, '')
                                        let formattedPhone = phone
                                        if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                                        else if (phone.length === 10) formattedPhone = '92' + phone

                                        const template = shop?.wa_reminder_template || "Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!"
                                        const msg = template
                                            .replace(/\[Name\]/g, customer.name)
                                            .replace(/\[Amount\]/g, (customer.outstanding_balance || 0).toLocaleString())
                                            .replace(/\[Shop Name\]/g, shop?.name || 'our shop')

                                        const pdfBlob = generateOutstandingPDF(customer, ledger, shop?.name || 'Shop')
                                        await shareOrDownloadPDF(pdfBlob, `outstanding-${customer.name.replace(/\s+/g, '-')}.pdf`, formattedPhone, msg)
                                    } catch (err) {
                                        console.error('Outstanding PDF failed:', err)
                                        const phone = customer.phone.replace(/[^0-9]/g, '')
                                        let formattedPhone = phone
                                        if (phone.startsWith('03')) formattedPhone = '92' + phone.substring(1)
                                        else if (phone.length === 10) formattedPhone = '92' + phone
                                        const msg = `${customer.name} — Outstanding: Rs. ${(customer.outstanding_balance || 0).toLocaleString()}`
                                        window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
                                    } finally {
                                        btn.disabled = false
                                        btn.innerHTML = '<span>💬</span> WhatsApp Reminder'
                                    }
                                }}
                                className="w-full sm:w-auto px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition font-semibold shadow-lg flex items-center justify-center gap-2"
                            >
                                <span>💬</span> WhatsApp Reminder
                            </button>
                        )}
                        <button
                            onClick={() => setShowPaymentModal(true)}
                            className="w-full sm:w-auto px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-semibold shadow-lg">
                            💸 Add Payment
                        </button>
                    </div>
                </div>
            </div>

            {selectedIds.size > 0 && (
                <div className="mb-3 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <span className="text-sm font-bold text-red-700">{selectedIds.size} selected</span>
                    <button
                        onClick={handleBulkDelete}
                        className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold transition"
                    >🗑️ Delete Selected</button>
                    <button
                        onClick={() => setSelectedIds(new Set())}
                        className="px-3 py-1.5 bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg text-sm transition"
                    >✕ Clear</button>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-4 py-4 w-10">
                                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                                        className="w-4 h-4 rounded cursor-pointer" />
                                </th>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 min-w-[200px]">Description</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Debit (Sale)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Credit (Payment)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Balance</th>
                                <th className="px-4 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                        {ledger.length === 0 && (
                            <tr><td colSpan="7" className="px-6 py-12 text-center text-gray-400 text-sm">No transactions found for this customer.</td></tr>
                        )}
                        {ledger.map((item, idx) => (
                            <React.Fragment key={idx}>
                                <tr className={`hover:bg-gray-50 transition ${selectedIds.has(item.id) ? 'bg-red-50/40' : ''}`}>
                                    <td className="px-4 py-4">
                                        {item.id !== 'opening' && (
                                            <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)}
                                                className="w-4 h-4 rounded cursor-pointer" />
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-gray-500 font-normal">{new Date(item.date).toLocaleDateString('en-PK')}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-800">{item.note}</span>
                                                {item.type === 'sale' && (
                                                    <button
                                                        onClick={() => setExpandedSale(expandedSale === item.id ? null : item.id)}
                                                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter"
                                                    >
                                                        {expandedSale === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                    </button>
                                                )}
                                            </div>
                                            {item.type === 'payment' && (
                                                <button
                                                    onClick={() => printPaymentVoucher(item.amount, item.note, item.date)}
                                                    className="text-[10px] text-gray-400 hover:text-green-600 font-medium mt-0.5 transition"
                                                    title="Print Payment Voucher"
                                                >🖨️ Print Voucher</button>
                                            )}
                                            {item.type === 'return' && <span className="w-fit px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] uppercase font-bold mt-1">Return</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right text-red-600 font-medium font-semibold">
                                        {item.type === 'sale' ? `+ Rs. ${item.amount.toFixed(0)}` : ''}
                                    </td>
                                    <td className="px-6 py-4 text-right text-green-600 font-medium font-semibold">
                                        {item.type !== 'sale' ? `- Rs. ${Math.abs(item.amount).toFixed(0)}` : ''}
                                    </td>
                                    <td className="px-6 py-4 text-right font-bold text-gray-900">
                                        Rs. {item.balance.toFixed(0)}
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        {item.id !== 'opening' && (
                                            <button
                                                onClick={() => handleDeleteTransaction(item)}
                                                title="Delete transaction"
                                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition text-xs"
                                            >🗑️</button>
                                        )}
                                    </td>
                                </tr>
                                {item.type === 'sale' && expandedSale === item.id && (
                                    <tr className="bg-blue-50/50 border-b border-gray-100">
                                        <td colSpan="7" className="px-6 py-3">
                                            <div className="flex flex-col gap-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Payment:</span>
                                                    <span className={`px-3 py-0.5 rounded-full text-[10px] font-bold uppercase ${item.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                                                        {item.payment_type}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                    {(item.items || []).map((it, iidx) => (
                                                        <div key={iidx} className="flex justify-between text-xs bg-white/60 p-2 rounded-lg border border-blue-100/50 shadow-sm">
                                                            <span className="text-gray-700 font-medium">{it.product_name}</span>
                                                            <span className="text-gray-500 font-semibold">Rs.{it.unit_price} × {it.quantity}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
                </div>
            </div>

            {/* Payment Success Banner */}
            {lastPayment && (
                <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-4 animate-bounce-once max-w-sm">
                    <div>
                        <p className="font-bold text-sm">✅ Payment Recorded!</p>
                        <p className="text-xs opacity-90">Rs. {Number(lastPayment.amount).toLocaleString()} — {lastPayment.note}</p>
                    </div>
                    <button
                        onClick={() => printPaymentVoucher(lastPayment.amount, lastPayment.note, lastPayment.date)}
                        className="bg-white text-green-700 font-bold text-xs px-3 py-2 rounded-xl hover:bg-green-50 transition whitespace-nowrap"
                    >
                        🖨️ Print
                    </button>
                    <button onClick={() => setLastPayment(null)} className="text-white/70 hover:text-white text-lg leading-none ml-1">×</button>
                </div>
            )}

            {/* Payment Modal */}
            {
                showPaymentModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">Receive Payment</h2>
                            <form onSubmit={handleAddPayment} className="space-y-4">
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1">Amount Received (Rs.)</label>
                                    <input
                                        type="number"
                                        autoFocus
                                        required
                                        value={paymentAmount}
                                        onChange={e => setPaymentAmount(e.target.value)}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1">Note (Optional)</label>
                                    <textarea
                                        value={paymentNote}
                                        onChange={e => setPaymentNote(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                                        placeholder="Payment detail..."
                                        rows="2"
                                    ></textarea>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition disabled:opacity-50">
                                        {saving ? 'Processing...' : 'Confirm Payment'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowPaymentModal(false)}
                                        className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition">
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </div >
    )
}

export default CustomerLedger
