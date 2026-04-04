import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { generateOutstandingPDF, shareOrDownloadPDF } from '../utils/pdfShare'

function CustomerLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

    const importRef = useRef()
    const [customer, setCustomer] = useState(null)
    const [loading, setLoading] = useState(true)
    const [ledger, setLedger] = useState([])
    const [showTxModal, setShowTxModal] = useState(false)
    const [txForm, setTxForm] = useState({
        date: new Date().toISOString().slice(0, 10),
        bill_number: '',
        sale_amount: '',
        payment_amount: '',
        details: '',
        payment_mode: 'cash',
        transaction_ref: '',
        note: ''
    })
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
                    type: p.payment_type === 'return' ? 'return' : p.payment_type === 'debit' ? 'debit' : 'payment',
                    payment_type: p.payment_type,
                    amount: p.amount,
                    note: p.note || 'Cash Payment',
                    bill_number: p.bill_number || null,
                    details: p.details || null,
                    payment_mode: p.payment_mode || null,
                    transaction_ref: p.transaction_ref || null,
                }))
            ]

            // Sort by date
            combined.sort((a, b) => new Date(a.date) - new Date(b.date))

            // Calculate running balance
            let running = 0
            const withBalance = combined.map(item => {
                if (item.type === 'sale') {
                    const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                    if (owed > 0) running += owed
                } else if (item.type === 'debit') {
                    running += Number(item.amount)
                } else if (item.payment_type === 'refund') {
                    // cash refund — no balance change
                } else {
                    running -= Math.abs(item.amount)
                }
                return { ...item, balance: running }
            })

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
                        type: p.payment_type === 'return' ? 'return' : p.payment_type === 'debit' ? 'debit' : 'payment',
                        payment_type: p.payment_type,
                        amount: p.amount,
                        note: p.note || 'Cash Payment',
                        bill_number: p.bill_number || null,
                        details: p.details || null,
                        payment_mode: p.payment_mode || null,
                        transaction_ref: p.transaction_ref || null,
                    }))
                ]

                combined.sort((a, b) => new Date(a.date) - new Date(b.date))
                let running = 0
                const withBalance = combined.map(item => {
                    if (item.type === 'sale') {
                        const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                        if (owed > 0) running += owed
                    } else if (item.type === 'debit') {
                        running += Number(item.amount)
                    } else if (item.payment_type === 'refund') {
                        // no balance change
                    } else {
                        running -= Math.abs(item.amount)
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

    // ── Excel Export ──────────────────────────────────────────────────────────
    const handleExport = () => {
        if (!ledger.length) return alert('Koi transaction nahi hai export karne ke liye.')
        const rows = [...ledger].reverse().map((item, idx) => ({
            'Sr#': idx + 1,
            'Date': new Date(item.date).toLocaleDateString('en-PK'),
            'Bill #': item.bill_number || (item.type === 'sale' ? `INV-${String(item.id).slice(-8)}` : ''),
            'Description': item.note,
            'Type': item.type === 'sale' ? 'Sale' : item.type === 'debit' ? 'Manual Sale' : item.type === 'return' ? 'Return' : 'Payment',
            'Debit (Sale)': (item.type === 'sale' || item.type === 'debit') ? Number(item.amount) : '',
            'Credit (Payment)': (item.type === 'payment' || item.type === 'return') ? Math.abs(Number(item.amount)) : '',
            'Balance': Number(item.balance),
            'Details': item.details || '',
            'Payment Mode': item.payment_mode || '',
            'Transaction Ref': item.transaction_ref || '',
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 14 }, { wch: 18 }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
        const safeName = (customer?.name || 'customer').replace(/[^a-z0-9]/gi, '_')
        XLSX.writeFile(wb, `${safeName}_ledger.xlsx`)
    }

    // ── Excel Import ──────────────────────────────────────────────────────────
    const handleImport = async (e) => {
        const file = e.target.files[0]
        e.target.value = ''
        if (!file) return

        try {
            const data = await file.arrayBuffer()
            const wb = XLSX.read(data, { cellDates: true })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd' })

            if (!rows.length) { alert('File mein koi data nahi mila.'); return }

            const confirmed = window.confirm(`${rows.length} transactions import karein?\n\nNote: "Debit (Sale)" column se sale entries aur "Credit (Payment)" column se payment entries banegi.`)
            if (!confirmed) return

            const insertRows = []
            let balanceDelta = 0

            for (const row of rows) {
                const debit = parseFloat(row['Debit (Sale)'] ?? row['Debit'] ?? row['debit'] ?? 0) || 0
                const credit = parseFloat(row['Credit (Payment)'] ?? row['Credit'] ?? row['credit'] ?? 0) || 0
                const dateVal = row['Date'] || row['date'] || new Date().toLocaleDateString('en-PK')
                const billNo = String(row['Bill #'] ?? row['bill_number'] ?? '').trim() || null
                const note = String(row['Description'] ?? row['Note'] ?? row['note'] ?? '').trim()
                const details = String(row['Details'] ?? row['details'] ?? '').trim() || null
                const paymentMode = String(row['Payment Mode'] ?? row['payment_mode'] ?? '').trim() || null
                const txRef = String(row['Transaction Ref'] ?? row['transaction_ref'] ?? '').trim() || null

                let parsedDate
                try {
                    if (dateVal instanceof Date && !isNaN(dateVal)) {
                        parsedDate = dateVal.toISOString()
                    } else if (typeof dateVal === 'number') {
                        parsedDate = new Date(Math.round((dateVal - 25569) * 86400 * 1000)).toISOString()
                    } else {
                        parsedDate = new Date(dateVal).toISOString()
                    }
                } catch { parsedDate = new Date().toISOString() }

                const common = { shop_id: user.shop_id, customer_id: id, bill_number: billNo, details, payment_mode: paymentMode, transaction_ref: txRef, created_at: parsedDate }
                if (debit > 0) {
                    insertRows.push({ ...common, amount: debit, payment_type: 'debit', note: note || 'Imported Sale Entry' })
                    balanceDelta += debit
                }
                if (credit > 0) {
                    insertRows.push({ ...common, amount: credit, payment_type: 'payment', note: note || 'Imported Payment' })
                    balanceDelta -= credit
                }
            }

            if (!insertRows.length) { alert('Koi valid row nahi mili (Debit/Credit columns check karein).'); return }

            if (navigator.onLine) {
                const { error } = await supabase.from('customer_payments').insert(insertRows)
                if (error) throw error
                const newBal = Math.max(0, (customer?.outstanding_balance || 0) + balanceDelta)
                try {
                    await supabase.from('customers').update({ outstanding_balance: newBal }).eq('id', id)
                    setCustomer(c => c ? { ...c, outstanding_balance: newBal } : c)
                } catch (_) {}
            } else {
                for (const row of insertRows) {
                    const rec = { ...row, id: crypto.randomUUID() }
                    await db.customer_payments.add(rec)
                    await db.sync_queue.add({ table: 'customer_payments', action: 'INSERT', data: rec, timestamp: rec.created_at })
                }
                const newBal = Math.max(0, (customer?.outstanding_balance || 0) + balanceDelta)
                await db.customers.update(parseInt(id), { outstanding_balance: newBal })
                setCustomer(c => c ? { ...c, outstanding_balance: newBal } : c)
            }

            alert(`${insertRows.length} entries import ho gayi! ✅`)
            fetchCustomerData()
        } catch (err) {
            console.error('Import error:', err)
            alert('Import failed: ' + err.message)
        }
    }

    const resetTxForm = () => {
        setTxForm({ date: new Date().toISOString().slice(0, 10), bill_number: '', sale_amount: '', payment_amount: '', details: '', payment_mode: 'cash', transaction_ref: '', note: '' })
        setShowTxModal(false)
    }

    const handleAddTransaction = async (e) => {
        e.preventDefault()
        const saleAmt = parseFloat(txForm.sale_amount) || 0
        const payAmt = parseFloat(txForm.payment_amount) || 0
        if (saleAmt === 0 && payAmt === 0) return alert('Sale amount ya payment amount mein se koi ek lazmi hai.')
        setSaving(true)
        const now = txForm.date ? new Date(txForm.date + 'T12:00:00').toISOString() : new Date().toISOString()
        const commonFields = {
            shop_id: user.shop_id,
            customer_id: id,
            bill_number: txForm.bill_number.trim() || null,
            details: txForm.details.trim() || null,
            payment_mode: txForm.payment_mode || null,
            transaction_ref: txForm.transaction_ref.trim() || null,
            created_at: now
        }
        const insertRows = []
        if (saleAmt > 0) insertRows.push({ ...commonFields, amount: saleAmt, payment_type: 'debit', note: txForm.note.trim() || 'Manual Sale Entry' })
        if (payAmt > 0) insertRows.push({ ...commonFields, amount: payAmt, payment_type: 'payment', note: txForm.note.trim() || 'Cash Received' })

        try {
            if (!navigator.onLine) throw new TypeError('Failed to fetch')
            const { error } = await supabase.from('customer_payments').insert(insertRows)
            if (error) throw error
            const newBalance = Math.max(0, (customer.outstanding_balance || 0) + saleAmt - payAmt)
            try {
                await supabase.from('customers').update({ outstanding_balance: newBalance }).eq('id', id)
                setCustomer(c => c ? { ...c, outstanding_balance: newBalance } : c)
            } catch (_) {}
            if (payAmt > 0) setLastPayment({ amount: payAmt, note: txForm.note.trim() || 'Cash Received', date: now })
            resetTxForm()
            fetchCustomerData()
        } catch (error) {
            const errMsg = error?.message || String(error)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                const ts = new Date().toISOString()
                for (const row of insertRows) {
                    const rec = { ...row, id: crypto.randomUUID() }
                    await db.customer_payments.add(rec)
                    await db.sync_queue.add({ table: 'customer_payments', action: 'INSERT', data: rec, timestamp: ts })
                }
                const newBal = Math.max(0, (customer.outstanding_balance || 0) + saleAmt - payAmt)
                await db.customers.update(parseInt(id), { outstanding_balance: newBal })
                await db.sync_queue.add({ table: 'customers', action: 'UPDATE', data: { id, outstanding_balance: newBal }, timestamp: ts })
                setCustomer(c => c ? { ...c, outstanding_balance: newBal } : c)
                if (payAmt > 0) setLastPayment({ amount: payAmt, note: txForm.note.trim() || 'Cash Received', date: ts })
                resetTxForm()
                fetchCustomerData()
                alert('Offline mode: Transaction locally save ho gaya. Online hone par sync hoga! 🔄')
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
                // Reverse balance effect
                if (item.payment_type === 'refund') {
                    // no change
                } else if (item.payment_type === 'debit') {
                    newBalance = Math.max(0, newBalance - Number(item.amount))
                } else {
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
                    if (item.payment_type === 'refund') { /* no change */ }
                    else if (item.payment_type === 'debit') { newBalance = Math.max(0, newBalance - Number(item.amount)) }
                    else { newBalance = newBalance + Math.abs(item.amount) }
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
                    <div className="flex gap-2 flex-wrap justify-end">
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
                            onClick={() => setShowTxModal(true)}
                            className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold shadow-lg">
                            ➕ Add Transaction
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
                                        <div className="flex flex-col gap-0.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-gray-800">{item.note}</span>
                                                {item.bill_number && (
                                                    <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-bold">Bill #{item.bill_number}</span>
                                                )}
                                                {item.type === 'sale' && (
                                                    <button
                                                        onClick={() => setExpandedSale(expandedSale === item.id ? null : item.id)}
                                                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter"
                                                    >
                                                        {expandedSale === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                    </button>
                                                )}
                                            </div>
                                            {item.details && <span className="text-xs text-gray-500 truncate max-w-xs">{item.details}</span>}
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {item.payment_mode && (
                                                    <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-semibold capitalize">{item.payment_mode}</span>
                                                )}
                                                {item.transaction_ref && (
                                                    <span className="text-[10px] text-gray-400">Ref: {item.transaction_ref}</span>
                                                )}
                                                {item.type === 'payment' && (
                                                    <button
                                                        onClick={() => printPaymentVoucher(item.amount, item.note, item.date)}
                                                        className="text-[10px] text-gray-400 hover:text-green-600 font-medium transition"
                                                        title="Print Payment Voucher"
                                                    >🖨️ Print</button>
                                                )}
                                                {item.type === 'return' && <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] uppercase font-bold">Return</span>}
                                                {item.type === 'debit' && <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] uppercase font-bold">Manual Sale</span>}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right text-red-600 font-semibold">
                                        {(item.type === 'sale' || item.type === 'debit') ? `+ Rs. ${Number(item.amount).toFixed(0)}` : ''}
                                    </td>
                                    <td className="px-6 py-4 text-right text-green-600 font-semibold">
                                        {(item.type === 'payment' || item.type === 'return') ? `- Rs. ${Math.abs(item.amount).toFixed(0)}` : ''}
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

            {/* Add Transaction Modal */}
            {showTxModal && (() => {
                const prevBalance = ledger.length > 0 ? ledger[0].balance : (customer?.outstanding_balance || 0)
                const saleAmt = parseFloat(txForm.sale_amount) || 0
                const payAmt = parseFloat(txForm.payment_amount) || 0
                const newBalance = prevBalance + saleAmt - payAmt
                return (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold text-gray-800 mb-1">➕ Add Transaction</h2>
                            <p className="text-xs text-gray-400 mb-4">Sale aur payment ek saath ya alag alag darj karein</p>
                            <form onSubmit={handleAddTransaction} className="space-y-4">

                                {/* Date + Bill # */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-gray-700 font-medium mb-1 text-sm">Date</label>
                                        <input type="date" value={txForm.date}
                                            onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 font-medium mb-1 text-sm">Bill # (Optional)</label>
                                        <input type="text" value={txForm.bill_number}
                                            onChange={e => setTxForm(f => ({ ...f, bill_number: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                            placeholder="e.g. INV-001" />
                                    </div>
                                </div>

                                {/* Sale Amount (Debit) */}
                                <div>
                                    <label className="block font-semibold mb-1 text-sm text-orange-600">🛒 Sale Amount / Debit</label>
                                    <input type="number" min="0" step="any" value={txForm.sale_amount}
                                        onChange={e => setTxForm(f => ({ ...f, sale_amount: e.target.value }))}
                                        className="w-full px-4 py-2.5 border border-orange-200 bg-orange-50 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none text-sm"
                                        placeholder="0  — kitna maal becha (Rs.)" />
                                    <p className="text-xs text-gray-400 mt-0.5">Customer ko jo maal diya uski value</p>
                                </div>

                                {/* Payment Received (Credit) */}
                                <div>
                                    <label className="block font-semibold mb-1 text-sm text-green-600">💵 Payment Received / Credit</label>
                                    <input type="number" min="0" step="any" value={txForm.payment_amount}
                                        onChange={e => setTxForm(f => ({ ...f, payment_amount: e.target.value }))}
                                        className="w-full px-4 py-2.5 border border-green-200 bg-green-50 rounded-lg focus:ring-2 focus:ring-green-400 outline-none text-sm"
                                        placeholder="0  — kitni payment ayi (Rs.)" />
                                    <p className="text-xs text-gray-400 mt-0.5">Customer sy jo payment mili</p>
                                </div>

                                {/* Balance Preview */}
                                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                                    <p className="text-xs text-gray-500 uppercase font-bold tracking-wide mb-2">Balance Calculation</p>
                                    <div className="flex flex-col gap-1 text-sm">
                                        <div className="flex justify-between text-gray-600">
                                            <span>Previous Balance</span>
                                            <span className="font-semibold">Rs. {Number(prevBalance).toLocaleString()}</span>
                                        </div>
                                        {saleAmt > 0 && (
                                            <div className="flex justify-between text-orange-600">
                                                <span>+ Sale (Debit)</span>
                                                <span className="font-semibold">Rs. {saleAmt.toLocaleString()}</span>
                                            </div>
                                        )}
                                        {payAmt > 0 && (
                                            <div className="flex justify-between text-green-600">
                                                <span>− Payment (Credit)</span>
                                                <span className="font-semibold">Rs. {payAmt.toLocaleString()}</span>
                                            </div>
                                        )}
                                        <div className="border-t border-gray-300 mt-1 pt-1 flex justify-between font-bold text-base">
                                            <span className="text-gray-800">New Balance</span>
                                            <span className={newBalance > 0 ? 'text-red-600' : 'text-green-700'}>Rs. {newBalance.toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Details */}
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Details (Optional)</label>
                                    <textarea rows="2" value={txForm.details}
                                        onChange={e => setTxForm(f => ({ ...f, details: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                                        placeholder="Saman ki tafseel ya bill link..." />
                                </div>

                                {/* Payment Mode + Transaction Ref */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-gray-700 font-medium mb-1 text-sm">Payment Mode</label>
                                        <select value={txForm.payment_mode}
                                            onChange={e => setTxForm(f => ({ ...f, payment_mode: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white">
                                            <option value="cash">Cash</option>
                                            <option value="bank">Bank Transfer</option>
                                            <option value="cheque">Cheque</option>
                                            <option value="online">Online/JazzCash</option>
                                            <option value="other">Other</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-gray-700 font-medium mb-1 text-sm">Transaction Ref</label>
                                        <input type="text" value={txForm.transaction_ref}
                                            onChange={e => setTxForm(f => ({ ...f, transaction_ref: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                            placeholder="Cheque # / Txn ID" />
                                    </div>
                                </div>

                                {/* Note */}
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Note (Optional)</label>
                                    <textarea rows="2" value={txForm.note}
                                        onChange={e => setTxForm(f => ({ ...f, note: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                                        placeholder="e.g. Advance payment / Credit sale..." />
                                </div>

                                <div className="flex gap-3 pt-1">
                                    <button type="submit" disabled={saving}
                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50">
                                        {saving ? 'Saving...' : '✅ Save Transaction'}
                                    </button>
                                    <button type="button" onClick={resetTxForm}
                                        className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition">
                                        Cancel
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            })()}
        </div >
    )
}

export default CustomerLedger
