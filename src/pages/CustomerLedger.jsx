import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import * as XLSX from 'xlsx'

function CustomerLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

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
    const [selectedRows, setSelectedRows] = useState([])
    const importRef = useRef()

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

            if (!custRes.data) { setLoading(false); return }
            setCustomer(custRes.data)

            const sales = salesRes.error ? [] : (salesRes.data || [])
            const payments = paymentsRes.error ? [] : (paymentsRes.data || [])

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
                    source: 'payment'
                }))
            ]

            combined.sort((a, b) => new Date(a.date) - new Date(b.date))

            let running = 0
            const withBalance = combined.map(item => {
                if (item.type === 'sale') {
                    const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                    if (owed > 0) running += owed
                } else if (item.payment_type === 'refund') {
                    // no change
                } else if (item.payment_type === 'debit') {
                    running += Number(item.amount)
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

            setLedger(withBalance.reverse())
        } catch (e) {
            console.log('CustomerLedger: Reconstructing from local DB (Offline)')
            try {
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
                        source: 'payment'
                    }))
                ]

                combined.sort((a, b) => new Date(a.date) - new Date(b.date))
                let running = 0
                const withBalance = combined.map(item => {
                    if (item.type === 'sale') {
                        const owed = Math.max(0, item.amount - (item.paid_amount || 0))
                        if (owed > 0) running += owed
                    } else if (item.payment_type === 'refund') {
                        // no change
                    } else if (item.payment_type === 'debit') {
                        running += Number(item.amount)
                    } else {
                        running -= Math.abs(item.amount)
                    }
                    return { ...item, balance: running }
                })
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

    const resetTxForm = () => {
        setTxForm({
            date: new Date().toISOString().slice(0, 10),
            bill_number: '',
            sale_amount: '',
            payment_amount: '',
            details: '',
            payment_mode: 'cash',
            transaction_ref: '',
            note: ''
        })
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
            note: txForm.note.trim() || null,
            created_at: now
        }
        const insertRows = []
        if (saleAmt > 0) insertRows.push({ ...commonFields, amount: saleAmt, payment_type: 'debit', note: commonFields.note || 'Manual Sale Entry' })
        if (payAmt > 0) insertRows.push({ ...commonFields, amount: payAmt, payment_type: 'payment', note: commonFields.note || 'Cash Received' })

        try {
            if (!navigator.onLine) throw new TypeError('Failed to fetch')
            const { error } = await supabase.from('customer_payments').insert(insertRows)
            if (error) throw error
            const newBalance = Math.max(0, (customer.outstanding_balance || 0) + saleAmt - payAmt)
            try {
                await supabase.from('customers').update({ outstanding_balance: newBalance }).eq('id', id)
                setCustomer(c => c ? { ...c, outstanding_balance: newBalance } : c)
            } catch (_) {}
            resetTxForm()
            fetchCustomerData()
        } catch (err) {
            const errMsg = err?.message || String(err)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                for (const row of insertRows) {
                    const rowId = crypto.randomUUID()
                    const offlineRow = { ...row, id: rowId }
                    await db.customer_payments.add(offlineRow)
                    await db.sync_queue.add({ table: 'customer_payments', action: 'INSERT', data: offlineRow, timestamp: now })
                }
                const newBal = Math.max(0, (customer?.outstanding_balance || 0) + saleAmt - payAmt)
                await db.customers.update(id, { outstanding_balance: newBal })
                await db.sync_queue.add({ table: 'customers', action: 'UPDATE', data: { id, outstanding_balance: newBal }, timestamp: now })
                setCustomer(c => c ? { ...c, outstanding_balance: newBal } : c)
                alert('Offline mode: Transaction saved locally. Will sync when online! 🔄')
                resetTxForm()
                fetchCustomerData()
            } else {
                alert('Error: ' + errMsg)
            }
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteTransaction = async (item) => {
        if (item.type === 'sale') return
        if (!confirm('Kya aap yeh transaction delete karna chahte hain?')) return

        try {
            let newBalance = customer.outstanding_balance || 0
            if (item.payment_type === 'refund') {
                // no change
            } else if (item.payment_type === 'debit') {
                newBalance = Math.max(0, newBalance - Number(item.amount))
            } else {
                newBalance = newBalance + Math.abs(item.amount)
            }

            if (!navigator.onLine) throw new TypeError('Failed to fetch')
            const { error } = await supabase.from('customer_payments').delete().eq('id', item.id)
            if (error) throw error
            try {
                await supabase.from('customers').update({ outstanding_balance: newBalance }).eq('id', id)
                setCustomer(c => c ? { ...c, outstanding_balance: newBalance } : c)
            } catch (_) {}
            fetchCustomerData()
        } catch (err) {
            const errMsg = err?.message || String(err)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                await db.customer_payments.delete(item.id)
                await db.sync_queue.add({ table: 'customer_payments', action: 'DELETE', data: { id: item.id }, timestamp: new Date().toISOString() })
                alert('Offline mode: Deletion queued. Will sync when online.')
                fetchCustomerData()
            } else {
                alert('Error: ' + errMsg)
            }
        }
    }

    const handleExport = () => {
        const customerName = customer?.name || 'Customer'
        const rows = [...ledger].reverse().map((item, idx) => ({
            'Sr#': idx + 1,
            'Date': new Date(item.date).toLocaleDateString('en-PK'),
            'Bill #': item.bill_number || '',
            'Description': item.note || '',
            'Type': item.type === 'sale' ? 'Sale' : item.type === 'debit' ? 'Manual Debit' : item.type === 'return' ? 'Return' : 'Payment',
            'Debit (Sale)': (item.type === 'sale' || item.type === 'debit') ? Number(item.amount) : '',
            'Credit (Payment)': (item.type === 'payment' || item.type === 'return') ? Number(item.amount) : '',
            'Balance': Number(item.balance),
            'Details': item.details || '',
            'Payment Mode': item.payment_mode || '',
            'Transaction Ref': item.transaction_ref || ''
        }))

        const ws = XLSX.utils.json_to_sheet(rows)
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
        XLSX.writeFile(wb, `${customerName}_ledger.xlsx`)
    }

    const handleImport = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        e.target.value = ''

        try {
            const data = await file.arrayBuffer()
            const wb = XLSX.read(data, { cellDates: true })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws, { cellDates: true })

            if (!rows.length) return alert('File mein koi data nahi mila.')

            const parseDate = (val) => {
                if (!val) return new Date().toISOString()
                if (val instanceof Date) return val.toISOString()
                if (typeof val === 'number') {
                    const excelEpoch = new Date(1899, 11, 30)
                    return new Date(excelEpoch.getTime() + val * 86400000).toISOString()
                }
                const d = new Date(val)
                return isNaN(d) ? new Date().toISOString() : d.toISOString()
            }

            const insertRows = []
            let totalDebit = 0
            let totalCredit = 0

            for (const row of rows) {
                const dateStr = parseDate(row['Date'])
                const debit = parseFloat(row['Debit (Sale)']) || 0
                const credit = parseFloat(row['Credit (Payment)']) || 0
                const bill = String(row['Bill #'] || '').trim() || null
                const details = String(row['Details'] || '').trim() || null
                const payMode = String(row['Payment Mode'] || '').trim() || null
                const txRef = String(row['Transaction Ref'] || '').trim() || null
                const desc = String(row['Description'] || '').trim() || null

                const common = {
                    shop_id: user.shop_id,
                    customer_id: id,
                    bill_number: bill,
                    details,
                    payment_mode: payMode,
                    transaction_ref: txRef,
                    created_at: dateStr
                }
                if (debit > 0) {
                    insertRows.push({ ...common, amount: debit, payment_type: 'debit', note: desc || 'Imported Debit' })
                    totalDebit += debit
                }
                if (credit > 0) {
                    insertRows.push({ ...common, amount: credit, payment_type: 'payment', note: desc || 'Imported Payment' })
                    totalCredit += credit
                }
            }

            if (!insertRows.length) return alert('Koi valid debit/credit rows nahi milein.')

            if (!confirm(`${insertRows.length} transactions import ki jayengi. Kya confirm karte hain?`)) return

            if (!navigator.onLine) {
                for (const row of insertRows) {
                    const rowId = crypto.randomUUID()
                    const offlineRow = { ...row, id: rowId }
                    await db.customer_payments.add(offlineRow)
                    await db.sync_queue.add({ table: 'customer_payments', action: 'INSERT', data: offlineRow, timestamp: row.created_at })
                }
                const newBal = Math.max(0, (customer?.outstanding_balance || 0) + totalDebit - totalCredit)
                await db.customers.update(id, { outstanding_balance: newBal })
                setCustomer(c => c ? { ...c, outstanding_balance: newBal } : c)
                alert('Offline: Import queued locally!')
                fetchCustomerData()
                return
            }

            const { error } = await supabase.from('customer_payments').insert(insertRows)
            if (error) throw error
            const newBal = Math.max(0, (customer?.outstanding_balance || 0) + totalDebit - totalCredit)
            try {
                await supabase.from('customers').update({ outstanding_balance: newBal }).eq('id', id)
                setCustomer(c => c ? { ...c, outstanding_balance: newBal } : c)
            } catch (_) {}
            alert(`${insertRows.length} transactions imported successfully!`)
            fetchCustomerData()
        } catch (err) {
            alert('Import Error: ' + (err?.message || String(err)))
        }
    }

    if (loading) return <div className="p-8">Loading ledger...</div>
    if (!customer) return <div className="p-8 text-red-500">Customer not found!</div>

    const saleAmt = parseFloat(txForm.sale_amount) || 0
    const payAmt = parseFloat(txForm.payment_amount) || 0
    const prevBal = customer.outstanding_balance || 0
    const newPreviewBal = prevBal + saleAmt - payAmt

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
                    <div className="flex flex-wrap gap-2 justify-end">
                        {customer.phone && (
                            <button
                                onClick={async () => {
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
                                    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank')
                                }}
                                className="px-4 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition font-semibold shadow-lg flex items-center gap-2"
                            >
                                <span>💬</span> WhatsApp
                            </button>
                        )}
                        <button
                            onClick={handleExport}
                            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition font-semibold shadow-lg flex items-center gap-2"
                        >
                            📥 Export Excel
                        </button>
                        <button
                            onClick={() => importRef.current?.click()}
                            className="px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition font-semibold shadow-lg flex items-center gap-2"
                        >
                            📤 Import Excel
                        </button>
                        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
                        <button
                            onClick={() => setShowTxModal(true)}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold shadow-lg flex items-center gap-2">
                            ➕ Add Transaction
                        </button>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 min-w-[220px]">Description</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Debit (Sale)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Credit (Payment)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Balance</th>
                                <th className="px-6 py-4 text-center font-semibold text-gray-600 whitespace-nowrap">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                        {ledger.length === 0 && (
                            <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-400 text-sm">No transactions found for this customer.</td></tr>
                        )}
                        {ledger.map((item, idx) => (
                            <React.Fragment key={idx}>
                                <tr className="hover:bg-gray-50 transition">
                                    <td className="px-6 py-4 text-gray-500 font-normal whitespace-nowrap">{new Date(item.date).toLocaleDateString('en-PK')}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-gray-800">{item.note}</span>
                                                {item.type === 'sale' && (
                                                    <button
                                                        onClick={() => setExpandedSale(expandedSale === item.id ? null : item.id)}
                                                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter"
                                                    >
                                                        {expandedSale === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                    </button>
                                                )}
                                                {item.type === 'debit' && (
                                                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold uppercase">Manual Sale</span>
                                                )}
                                            </div>
                                            {item.bill_number && (
                                                <span className="text-[11px] text-blue-700 font-semibold">Bill #{item.bill_number}</span>
                                            )}
                                            {item.details && (
                                                <span className="text-[11px] text-gray-500">{item.details}</span>
                                            )}
                                            <div className="flex flex-wrap gap-1">
                                                {item.type === 'return' && <span className="w-fit px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] uppercase font-bold">Return</span>}
                                                {item.payment_mode && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-semibold capitalize">{item.payment_mode}</span>}
                                                {item.transaction_ref && <span className="text-[10px] text-gray-400">Ref: {item.transaction_ref}</span>}
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
                                        Rs. {Number(item.balance).toFixed(0)}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {item.source === 'payment' && (
                                            <button
                                                onClick={() => handleDeleteTransaction(item)}
                                                className="text-red-400 hover:text-red-600 text-xs font-semibold px-2 py-1 rounded hover:bg-red-50 transition"
                                            >
                                                Delete
                                            </button>
                                        )}
                                    </td>
                                </tr>
                                {item.type === 'sale' && expandedSale === item.id && (
                                    <tr className="bg-blue-50/50 border-b border-gray-100">
                                        <td colSpan="6" className="px-6 py-3">
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

            {/* Add Transaction Modal */}
            {showTxModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <h2 className="text-xl font-bold text-gray-800 mb-5">Add Transaction</h2>
                        <form onSubmit={handleAddTransaction} className="space-y-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Date</label>
                                    <input
                                        type="date"
                                        value={txForm.date}
                                        onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Bill # (Optional)</label>
                                    <input
                                        type="text"
                                        value={txForm.bill_number}
                                        onChange={e => setTxForm(f => ({ ...f, bill_number: e.target.value }))}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        placeholder="INV-001"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-orange-700 font-semibold mb-1 text-sm">Sale Amount / Debit (Rs.)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={txForm.sale_amount}
                                        onChange={e => setTxForm(f => ({ ...f, sale_amount: e.target.value }))}
                                        className="w-full px-3 py-2.5 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none text-sm"
                                        placeholder="Kitna maal becha (Rs.)"
                                    />
                                </div>
                                <div>
                                    <label className="block text-green-700 font-semibold mb-1 text-sm">Payment Received / Credit (Rs.)</label>
                                    <input
                                        type="number"
                                        min="0"
                                        value={txForm.payment_amount}
                                        onChange={e => setTxForm(f => ({ ...f, payment_amount: e.target.value }))}
                                        className="w-full px-3 py-2.5 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-400 outline-none text-sm"
                                        placeholder="Kitni payment ayi (Rs.)"
                                    />
                                </div>
                            </div>

                            {/* Balance Preview */}
                            <div className="bg-gray-50 rounded-xl p-3 border border-gray-200 text-sm space-y-1">
                                <div className="flex justify-between text-gray-600">
                                    <span>Previous Balance:</span>
                                    <span className="font-semibold">Rs. {prevBal.toLocaleString()}</span>
                                </div>
                                {saleAmt > 0 && (
                                    <div className="flex justify-between text-orange-600">
                                        <span>+ Sale (Debit):</span>
                                        <span className="font-semibold">Rs. {saleAmt.toLocaleString()}</span>
                                    </div>
                                )}
                                {payAmt > 0 && (
                                    <div className="flex justify-between text-green-600">
                                        <span>− Payment (Credit):</span>
                                        <span className="font-semibold">Rs. {payAmt.toLocaleString()}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-bold text-gray-800 border-t pt-1 mt-1">
                                    <span>New Balance:</span>
                                    <span className={newPreviewBal > 0 ? 'text-red-600' : 'text-green-600'}>Rs. {newPreviewBal.toLocaleString()}</span>
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-700 font-medium mb-1 text-sm">Details (Optional)</label>
                                <textarea
                                    value={txForm.details}
                                    onChange={e => setTxForm(f => ({ ...f, details: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    placeholder="Saman ki tafseel ya bill link..."
                                    rows="2"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Payment Mode</label>
                                    <select
                                        value={txForm.payment_mode}
                                        onChange={e => setTxForm(f => ({ ...f, payment_mode: e.target.value }))}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    >
                                        <option value="cash">Cash</option>
                                        <option value="bank">Bank Transfer</option>
                                        <option value="cheque">Cheque</option>
                                        <option value="online">Online/JazzCash</option>
                                        <option value="other">Other</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1 text-sm">Transaction Ref (Optional)</label>
                                    <input
                                        type="text"
                                        value={txForm.transaction_ref}
                                        onChange={e => setTxForm(f => ({ ...f, transaction_ref: e.target.value }))}
                                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        placeholder="Cheque # / Transaction ID"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-gray-700 font-medium mb-1 text-sm">Note (Optional)</label>
                                <textarea
                                    value={txForm.note}
                                    onChange={e => setTxForm(f => ({ ...f, note: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                    placeholder="Additional notes..."
                                    rows="2"
                                />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50">
                                    {saving ? 'Saving...' : 'Save Transaction'}
                                </button>
                                <button
                                    type="button"
                                    onClick={resetTxForm}
                                    className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg transition">
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default CustomerLedger
