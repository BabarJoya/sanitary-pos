import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'

function SupplierLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()
    const importRef = useRef()

    const [supplier, setSupplier] = useState(null)
    const [loading, setLoading] = useState(true)
    const [ledger, setLedger] = useState([])
    const [showModal, setShowModal] = useState(false)
    const [saving, setSaving] = useState(false)
    const [expandedBill, setExpandedBill] = useState(null)

    // Transaction entry form
    const [txForm, setTxForm] = useState({
        bill_number: '',
        date: new Date().toISOString().slice(0, 10),
        purchase_amount: '',   // debit — total products purchased
        paid_amount: '',       // credit — amount paid now
        note: ''
    })

    useEffect(() => {
        if (id && user?.shop_id) fetchSupplierData()
    }, [id, user?.shop_id])

    const fetchSupplierData = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')

            const fetchPromise = Promise.all([
                supabase.from('suppliers').select('*').eq('id', id).maybeSingle(),
                supabase.from('purchases').select('*, purchase_items(*)').eq('supplier_id', id).order('created_at', { ascending: true }),
                supabase.from('supplier_payments').select('*').eq('supplier_id', id)
            ])
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            const [supRes, purchasesRes, paymentsRes] = await Promise.race([fetchPromise, timeoutPromise])

            setSupplier(supRes.data)
            buildLedger(purchasesRes.data || [], paymentsRes.data || [])
        } catch (e) {
            console.log('SupplierLedger: Reconstructing from local DB (Offline)')
            try {
                const [lSups, lPurchases, lItems, lPayments] = await Promise.all([
                    db.suppliers.toArray(),
                    db.purchases.toArray(),
                    db.purchase_items.toArray(),
                    db.supplier_payments.toArray()
                ])
                const sup = lSups.find(s => String(s.id) === String(id))
                if (sup) setSupplier(sup)
                const myPurchases = lPurchases.filter(p => String(p.supplier_id) === String(id))
                const myPayments = lPayments.filter(p => String(p.supplier_id) === String(id))
                buildLedger(
                    myPurchases.map(p => ({ ...p, purchase_items: lItems.filter(i => i.purchase_id === p.id) })),
                    myPayments
                )
            } catch (err) { console.error('SupplierLedger Fallback Error:', err) }
        } finally { setLoading(false) }
    }

    const buildLedger = (purchases, payments) => {
        const combined = [
            ...purchases.map(p => ({
                id: p.id,
                date: p.created_at,
                type: 'purchase',
                payment_type: p.payment_type,
                bill_number: '',
                amount: p.total_amount,
                note: `Bill #${String(p.id).slice(-8)}`,
                items: p.purchase_items || []
            })),
            ...payments.map(p => ({
                id: p.id,
                date: p.created_at,
                type: p.payment_type === 'debit' ? 'debit' : p.payment_type === 'return' ? 'return' : 'payment',
                bill_number: p.bill_number || '',
                amount: p.amount,
                note: p.note || (p.payment_type === 'debit' ? 'Manual Purchase Entry' : 'Cash Payment'),
                items: []
            }))
        ]
        combined.sort((a, b) => new Date(a.date) - new Date(b.date))

        let running = 0
        const withBalance = combined.map(item => {
            if (item.type === 'purchase' || item.type === 'debit') running += Number(item.amount)
            else running -= Math.abs(Number(item.amount))
            return { ...item, balance: running }
        })
        setLedger(withBalance.reverse())
    }

    // ── Computed preview for transaction entry ──────────────────────────────────
    const prevBalance = ledger.length > 0 ? ledger[0].balance : (supplier?.outstanding_balance || 0)
    const purchaseAmt = parseFloat(txForm.purchase_amount) || 0
    const paidAmt = parseFloat(txForm.paid_amount) || 0
    const newBalance = prevBalance + purchaseAmt - paidAmt

    // ── Submit transaction ──────────────────────────────────────────────────────
    const handleSubmitTransaction = async (e) => {
        e.preventDefault()
        if (purchaseAmt === 0 && paidAmt === 0) {
            alert('Purchase amount ya paid amount mein se koi ek lazmi hai.')
            return
        }

        setSaving(true)
        const now = txForm.date ? new Date(txForm.date + 'T12:00:00').toISOString() : new Date().toISOString()

        try {
            if (!navigator.onLine) throw new TypeError('Failed to fetch')

            const insertRows = []

            // Debit row (purchase)
            if (purchaseAmt > 0) {
                insertRows.push({
                    shop_id: user.shop_id,
                    supplier_id: id,
                    amount: purchaseAmt,
                    payment_type: 'debit',
                    bill_number: txForm.bill_number.trim() || null,
                    note: txForm.note.trim() || 'Purchase Entry',
                    created_at: now
                })
            }

            // Credit row (payment)
            if (paidAmt > 0) {
                insertRows.push({
                    shop_id: user.shop_id,
                    supplier_id: id,
                    amount: paidAmt,
                    payment_type: 'payment',
                    bill_number: txForm.bill_number.trim() || null,
                    note: txForm.note.trim() || 'Payment to Supplier',
                    created_at: now
                })
            }

            const { error: pErr } = await supabase.from('supplier_payments').insert(insertRows)
            if (pErr) throw pErr

            const { error: sErr } = await supabase.from('suppliers').update({ outstanding_balance: newBalance }).eq('id', id)
            if (sErr) throw sErr

            alert('Transaction save ho gaya! ✅')
            resetForm()
            fetchSupplierData()
        } catch (error) {
            const errMsg = error?.message || String(error)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                // Offline: save to local DB
                for (const row of (purchaseAmt > 0 ? [{ ...row, payment_type: 'debit', amount: purchaseAmt }] : [])) {
                    const rec = { ...row, id: crypto.randomUUID(), created_at: now }
                    await db.supplier_payments.add(rec)
                    await db.sync_queue.add({ table: 'supplier_payments', action: 'INSERT', data: rec, timestamp: now })
                }
                if (purchaseAmt > 0) {
                    const rec = { id: crypto.randomUUID(), shop_id: user.shop_id, supplier_id: id, amount: purchaseAmt, payment_type: 'debit', bill_number: txForm.bill_number.trim() || null, note: txForm.note.trim() || 'Purchase Entry', created_at: now }
                    await db.supplier_payments.add(rec)
                    await db.sync_queue.add({ table: 'supplier_payments', action: 'INSERT', data: rec, timestamp: now })
                }
                if (paidAmt > 0) {
                    const rec = { id: crypto.randomUUID(), shop_id: user.shop_id, supplier_id: id, amount: paidAmt, payment_type: 'payment', bill_number: txForm.bill_number.trim() || null, note: txForm.note.trim() || 'Payment to Supplier', created_at: now }
                    await db.supplier_payments.add(rec)
                    await db.sync_queue.add({ table: 'supplier_payments', action: 'INSERT', data: rec, timestamp: now })
                }
                await db.suppliers.update(id, { outstanding_balance: newBalance })
                await db.sync_queue.add({ table: 'suppliers', action: 'UPDATE', data: { id, outstanding_balance: newBalance }, timestamp: now })
                setSupplier(s => ({ ...s, outstanding_balance: newBalance }))
                alert('Offline mode: Transaction locally save ho gaya. Online hone pr sync hoga! 🔄')
                resetForm()
                fetchSupplierData()
            } else {
                alert('Error: ' + errMsg)
            }
        } finally { setSaving(false) }
    }

    const resetForm = () => {
        setTxForm({ bill_number: '', date: new Date().toISOString().slice(0, 10), purchase_amount: '', paid_amount: '', note: '' })
        setShowModal(false)
    }

    // ── Delete Transaction ──────────────────────────────────────────────────────
    const handleDeleteTransaction = async (item) => {
        if (item.type === 'purchase') {
            alert('Purchase orders directly delete nahi ho sakty. Purchase History sy delete karein.')
            return
        }
        const typeLabel = (item.type === 'debit') ? 'Purchase/Debit' : item.type === 'payment' ? 'Payment' : 'Return'
        const confirmed = window.confirm(
            `Kya aap yeh transaction delete karna chahte hain?\n\nType: ${typeLabel}\nAmount: Rs. ${Number(item.amount).toLocaleString()}\nNote: ${item.note}\n\nSupplier balance bhi adjust ho ga.`
        )
        if (!confirmed) return

        // Reverse the balance effect: debit → subtract, payment/return → add back
        const balanceEffect = (item.type === 'debit') ? -Number(item.amount) : +Math.abs(Number(item.amount))
        const newBalance = (supplier?.outstanding_balance || 0) + balanceEffect

        try {
            if (navigator.onLine) {
                const { error } = await supabase.from('supplier_payments').delete().eq('id', item.id)
                if (error) throw error
                await supabase.from('suppliers').update({ outstanding_balance: newBalance }).eq('id', id)
            } else {
                await db.supplier_payments.delete(item.id)
                await db.sync_queue.add({ table: 'supplier_payments', action: 'DELETE', data: { id: item.id }, timestamp: new Date().toISOString() })
                await db.suppliers.update(id, { outstanding_balance: newBalance })
            }
            setSupplier(s => ({ ...s, outstanding_balance: newBalance }))
            fetchSupplierData()
        } catch (err) {
            alert('Delete nahi hua: ' + err.message)
        }
    }

    // ── Excel Export ────────────────────────────────────────────────────────────
    const handleExport = () => {
        const rows = [...ledger].reverse().map((item, idx) => ({
            'Sr#': idx + 1,
            'Date': new Date(item.date).toLocaleDateString('en-PK'),
            'Bill #': item.bill_number || (item.type === 'purchase' ? String(item.id).slice(-8) : ''),
            'Description': item.note,
            'Type': item.type === 'purchase' || item.type === 'debit' ? 'Purchase/Debit' : item.type === 'payment' ? 'Payment' : 'Return',
            'Debit (Purchase)': (item.type === 'purchase' || item.type === 'debit') ? Number(item.amount) : '',
            'Credit (Payment)': (item.type !== 'purchase' && item.type !== 'debit') ? Math.abs(Number(item.amount)) : '',
            'Balance': Number(item.balance)
        }))
        const ws = XLSX.utils.json_to_sheet(rows)
        ws['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
        const safeName = (supplier?.name || 'supplier').replace(/[^a-z0-9]/gi, '_')
        XLSX.writeFile(wb, `${safeName}_ledger.xlsx`)
    }

    // ── Excel Import ────────────────────────────────────────────────────────────
    const handleImport = async (e) => {
        const file = e.target.files[0]
        e.target.value = ''
        if (!file) return

        try {
            const data = await file.arrayBuffer()
            const wb = XLSX.read(data)
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws)

            if (!rows.length) { alert('File mein koi data nahi mila.'); return }

            const confirmed = window.confirm(`${rows.length} transactions import karein?`)
            if (!confirmed) return

            const insertRows = []
            let balanceDelta = 0

            for (const row of rows) {
                const debit = parseFloat(row['Debit (Purchase)'] ?? row['Debit'] ?? row['debit'] ?? 0) || 0
                const credit = parseFloat(row['Credit (Payment)'] ?? row['Credit'] ?? row['credit'] ?? 0) || 0
                const dateVal = row['Date'] || row['date'] || new Date().toLocaleDateString('en-PK')
                const billNo = String(row['Bill #'] ?? row['bill_number'] ?? '').trim() || null
                const note = String(row['Description'] ?? row['Note'] ?? row['note'] ?? '').trim()

                let parsedDate
                try { parsedDate = new Date(dateVal).toISOString() } catch { parsedDate = new Date().toISOString() }

                if (debit > 0) {
                    insertRows.push({ shop_id: user.shop_id, supplier_id: id, amount: debit, payment_type: 'debit', bill_number: billNo, note: note || 'Imported Purchase', created_at: parsedDate })
                    balanceDelta += debit
                }
                if (credit > 0) {
                    insertRows.push({ shop_id: user.shop_id, supplier_id: id, amount: credit, payment_type: 'payment', bill_number: billNo, note: note || 'Imported Payment', created_at: parsedDate })
                    balanceDelta -= credit
                }
            }

            if (!insertRows.length) { alert('Koi valid row nahi mili (Debit/Credit columns check karein).'); return }

            if (navigator.onLine) {
                const { error } = await supabase.from('supplier_payments').insert(insertRows)
                if (error) throw error
                const newBal = (supplier?.outstanding_balance || 0) + balanceDelta
                await supabase.from('suppliers').update({ outstanding_balance: newBal }).eq('id', id)
            } else {
                for (const row of insertRows) {
                    const rec = { ...row, id: crypto.randomUUID() }
                    await db.supplier_payments.add(rec)
                    await db.sync_queue.add({ table: 'supplier_payments', action: 'INSERT', data: rec, timestamp: rec.created_at })
                }
                const newBal = (supplier?.outstanding_balance || 0) + balanceDelta
                await db.suppliers.update(id, { outstanding_balance: newBal })
            }

            alert(`${insertRows.length} entries import ho gayi! ✅`)
            fetchSupplierData()
        } catch (err) {
            console.error('Import error:', err)
            alert('Import failed: ' + err.message)
        }
    }

    if (!hasFeature('supplier_ledger')) return <UpgradeWall feature="supplier_ledger" />
    if (loading) return <div className="p-8">Loading ledger...</div>
    if (!supplier) return <div className="p-8 text-red-500">Supplier not found!</div>

    const currentBalance = supplier.outstanding_balance || 0

    return (
        <div>
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <button onClick={() => navigate('/suppliers')} className="text-blue-500 mb-2 hover:underline text-sm font-semibold">← Back to Suppliers</button>
                    <h1 className="text-3xl font-bold text-gray-800">{supplier.name}</h1>
                    <p className="text-gray-500 text-sm">{supplier.phone}{supplier.address ? ' | ' + supplier.address : ''}</p>
                </div>
                <div className="w-full sm:w-auto flex flex-col sm:items-end gap-3">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 w-full sm:w-auto text-center sm:text-right">
                        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Payable Balance</p>
                        <p className={`text-3xl font-bold ${currentBalance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            Rs. {Number(currentBalance).toLocaleString()}
                        </p>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                        <button onClick={handleExport}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition">
                            📥 Export Excel
                        </button>
                        <button onClick={() => importRef.current?.click()}
                            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-semibold transition">
                            📤 Import Excel
                        </button>
                        <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
                        <button onClick={() => setShowModal(true)}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm shadow transition">
                            ➕ Add Transaction
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Ledger Table ── */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-5 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                                <th className="px-5 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Bill #</th>
                                <th className="px-5 py-4 text-left font-semibold text-gray-600 min-w-[160px]">Description</th>
                                <th className="px-5 py-4 text-right font-semibold text-orange-500 whitespace-nowrap">Debit (Purchase)</th>
                                <th className="px-5 py-4 text-right font-semibold text-green-600 whitespace-nowrap">Credit (Payment)</th>
                                <th className="px-5 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Balance</th>
                                <th className="px-3 py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {ledger.map((item, idx) => (
                                <React.Fragment key={idx}>
                                    <tr className="hover:bg-gray-50 transition">
                                        <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{new Date(item.date).toLocaleDateString('en-PK')}</td>
                                        <td className="px-5 py-3 whitespace-nowrap">
                                            {item.bill_number
                                                ? <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono font-bold">{item.bill_number}</span>
                                                : item.type === 'purchase'
                                                    ? <span className="text-xs text-gray-400 font-mono">{String(item.id).slice(-8)}</span>
                                                    : <span className="text-gray-300">—</span>}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium text-gray-800">{item.note}</span>
                                                {item.type === 'purchase' && (
                                                    <button onClick={() => setExpandedBill(expandedBill === item.id ? null : item.id)}
                                                        className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter">
                                                        {expandedBill === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                    </button>
                                                )}
                                            </div>
                                            {item.type === 'return' && <span className="w-fit px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] uppercase font-bold mt-1 block">Return</span>}
                                            {item.type === 'debit' && <span className="w-fit px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-[10px] uppercase font-bold mt-1 block">Manual Entry</span>}
                                        </td>
                                        <td className="px-5 py-3 text-right text-orange-600 font-semibold whitespace-nowrap">
                                            {(item.type === 'purchase' || item.type === 'debit') ? `+ Rs. ${Number(item.amount).toLocaleString()}` : ''}
                                        </td>
                                        <td className="px-5 py-3 text-right text-green-600 font-semibold whitespace-nowrap">
                                            {(item.type !== 'purchase' && item.type !== 'debit') ? `- Rs. ${Math.abs(Number(item.amount)).toLocaleString()}` : ''}
                                        </td>
                                        <td className="px-5 py-3 text-right font-bold whitespace-nowrap">
                                            <span className={item.balance > 0 ? 'text-red-600' : 'text-green-700'}>
                                                Rs. {Number(item.balance).toLocaleString()}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 text-right">
                                            {item.type !== 'purchase' && (
                                                <button onClick={() => handleDeleteTransaction(item)}
                                                    title="Delete transaction"
                                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition text-xs">
                                                    🗑️
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                    {item.type === 'purchase' && expandedBill === item.id && (
                                        <tr className="bg-orange-50/50 border-b border-gray-100">
                                            <td colSpan="7" className="px-5 py-3">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Payment:</span>
                                                    <span className={`px-3 py-0.5 rounded-full text-[10px] font-bold uppercase ${item.payment_type === 'cash' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                                                        {item.payment_type}
                                                    </span>
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                    {(item.items || []).map((it, iidx) => (
                                                        <div key={iidx} className="flex justify-between text-xs bg-white/60 p-2 rounded-lg border border-orange-100/50 shadow-sm">
                                                            <span className="text-gray-700 font-medium">{it.product_name}</span>
                                                            <span className="text-gray-500 font-semibold">Rs.{it.unit_price} × {it.quantity}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                            {ledger.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
                                        Koi transaction nahi mili. "Add Transaction" se pehli entry karein.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Add Transaction Modal ── */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                        <h2 className="text-xl font-bold text-gray-800 mb-1">➕ Add Transaction</h2>
                        <p className="text-xs text-gray-400 mb-4">Purchase aur payment ek saath darj kar saktay hain</p>

                        <form onSubmit={handleSubmitTransaction} className="space-y-4">

                            {/* Date + Bill # */}
                            <div className="grid grid-cols-2 gap-3">
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

                            {/* Purchase Amount (Debit) */}
                            <div>
                                <label className="block font-semibold mb-1 text-sm text-orange-600">
                                    📦 Total Purchase Amount (Debit)
                                </label>
                                <input type="number" min="0" step="any" value={txForm.purchase_amount}
                                    onChange={e => setTxForm(f => ({ ...f, purchase_amount: e.target.value }))}
                                    className="w-full px-4 py-2.5 border border-orange-200 bg-orange-50 rounded-lg focus:ring-2 focus:ring-orange-400 outline-none text-sm"
                                    placeholder="0  — kitna maal liya (Rs.)" />
                                <p className="text-xs text-gray-400 mt-0.5">Supplier sy jo maal purchase kiya uski total value</p>
                            </div>

                            {/* Paid Amount (Credit) */}
                            <div>
                                <label className="block font-semibold mb-1 text-sm text-green-600">
                                    💵 Amount Paid (Credit)
                                </label>
                                <input type="number" min="0" step="any" value={txForm.paid_amount}
                                    onChange={e => setTxForm(f => ({ ...f, paid_amount: e.target.value }))}
                                    className="w-full px-4 py-2.5 border border-green-200 bg-green-50 rounded-lg focus:ring-2 focus:ring-green-400 outline-none text-sm"
                                    placeholder="0  — kitna paisa diya (Rs.)" />
                                <p className="text-xs text-gray-400 mt-0.5">Supplier ko abhi kitni payment ki</p>
                            </div>

                            {/* Balance Preview */}
                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                                <p className="text-xs text-gray-500 uppercase font-bold tracking-wide mb-2">Balance Calculation</p>
                                <div className="flex flex-col gap-1 text-sm">
                                    <div className="flex justify-between text-gray-600">
                                        <span>Previous Balance</span>
                                        <span className="font-semibold">Rs. {Number(prevBalance).toLocaleString()}</span>
                                    </div>
                                    {purchaseAmt > 0 && (
                                        <div className="flex justify-between text-orange-600">
                                            <span>+ Purchase (Debit)</span>
                                            <span className="font-semibold">Rs. {purchaseAmt.toLocaleString()}</span>
                                        </div>
                                    )}
                                    {paidAmt > 0 && (
                                        <div className="flex justify-between text-green-600">
                                            <span>− Payment (Credit)</span>
                                            <span className="font-semibold">Rs. {paidAmt.toLocaleString()}</span>
                                        </div>
                                    )}
                                    <div className="border-t border-gray-300 mt-1 pt-1 flex justify-between font-bold text-base">
                                        <span className="text-gray-800">New Balance</span>
                                        <span className={newBalance > 0 ? 'text-red-600' : 'text-green-700'}>
                                            Rs. {newBalance.toLocaleString()}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Note */}
                            <div>
                                <label className="block text-gray-700 font-medium mb-1 text-sm">Note (Optional)</label>
                                <textarea rows="2" value={txForm.note}
                                    onChange={e => setTxForm(f => ({ ...f, note: e.target.value }))}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none"
                                    placeholder="e.g. Paid via Cash / Cheque #..." />
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button type="submit" disabled={saving}
                                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50">
                                    {saving ? 'Saving...' : '✅ Save Transaction'}
                                </button>
                                <button type="button" onClick={resetForm}
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

export default SupplierLedger
