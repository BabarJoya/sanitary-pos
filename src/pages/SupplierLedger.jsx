import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'

function SupplierLedger() {
    const { id } = useParams()
    const { user } = useAuth()
    const navigate = useNavigate()

    const [supplier, setSupplier] = useState(null)
    const [loading, setLoading] = useState(true)
    const [ledger, setLedger] = useState([])
    const [showPaymentModal, setShowPaymentModal] = useState(false)
    const [paymentAmount, setPaymentAmount] = useState('')
    const [paymentNote, setPaymentNote] = useState('')
    const [saving, setSaving] = useState(false)
    const [expandedBill, setExpandedBill] = useState(null)

    useEffect(() => {
        if (id && user?.shop_id) fetchSupplierData()
    }, [id, user?.shop_id])

    const fetchSupplierData = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')

            const fetchPromise = Promise.all([
                supabase.from('suppliers').select('*').eq('id', id).single(),
                supabase.from('purchases').select('*, purchase_items(*)').eq('supplier_id', id).order('created_at', { ascending: true }),
                supabase.from('supplier_payments').select('*').eq('supplier_id', id)
            ])
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            const [supRes, purchasesRes, paymentsRes] = await Promise.race([fetchPromise, timeoutPromise])

            setSupplier(supRes.data)

            const purchases = purchasesRes.data
            const payments = paymentsRes.data

            // 4. Combine into Ledger
            const combined = [
                ...(purchases || []).map(p => ({
                    id: p.id,
                    date: p.created_at,
                    type: 'purchase',
                    payment_type: p.payment_type,
                    amount: p.total_amount,
                    note: `Bill #${String(p.id).slice(-8)}`,
                    items: p.purchase_items || []
                })),
                ...(payments || []).map(p => ({
                    id: p.id,
                    date: p.created_at,
                    type: p.payment_type === 'return' ? 'return' : 'payment',
                    amount: p.amount,
                    note: p.note || 'Cash Payment',
                }))
            ]

            // Sort by date
            combined.sort((a, b) => new Date(a.date) - new Date(b.date))

            // Calculate running balance
            let running = 0
            const withBalance = combined.map(item => {
                // A purchase means we bought stock, increasing our debt to the supplier (+)
                if (item.type === 'purchase') {
                    running += item.amount
                }
                // A payment means we paid the supplier, decreasing our debt (-)
                // A return means we returned stock, decreasing our debt (-)
                else {
                    running -= Math.abs(item.amount)
                }

                return { ...item, balance: running }
            })

            setLedger(withBalance.reverse())
        } catch (e) {
            console.log('SupplierLedger: Reconstructing from local DB (Offline)')
            try {
                const sid = String(user.shop_id)
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

                const combined = [
                    ...myPurchases.map(p => ({
                        id: p.id,
                        date: p.created_at,
                        type: 'purchase',
                        payment_type: p.payment_type,
                        amount: p.total_amount,
                        note: `Bill #${String(p.id).slice(-8)}`,
                        items: lItems.filter(i => i.purchase_id === p.id)
                    })),
                    ...myPayments.map(p => ({
                        id: p.id,
                        date: p.created_at,
                        type: p.payment_type === 'return' ? 'return' : 'payment',
                        amount: p.amount,
                        note: p.note || 'Cash Payment',
                    }))
                ]

                combined.sort((a, b) => new Date(a.date) - new Date(b.date))
                let running = 0
                const withBalance = combined.map(item => {
                    if (item.type === 'purchase') {
                        running += item.amount
                    } else {
                        running -= Math.abs(item.amount)
                    }
                    return { ...item, balance: running }
                })
                setLedger(withBalance.reverse())
            } catch (err) { console.error('Final SupplierLedger Fallback Error:', err) }
        } finally {
            setLoading(false)
        }
    }

    const handleAddPayment = async (e) => {
        e.preventDefault()
        if (!paymentAmount || parseFloat(paymentAmount) <= 0) return

        setSaving(true)
        const amount = parseFloat(paymentAmount)

        try {
            if (!navigator.onLine) throw new TypeError('Failed to fetch')

            // 1. Insert payment record
            const { error: pError } = await supabase.from('supplier_payments').insert([{
                shop_id: user.shop_id,
                supplier_id: id,
                amount: amount,
                payment_type: 'payment',
                note: paymentNote || 'Cash Paid to Supplier'
            }])

            if (pError) throw pError

            // 2. Update supplier balance
            const newBalance = Math.max(0, (supplier.outstanding_balance || 0) - amount)
            const { error: sError } = await supabase.from('suppliers').update({ outstanding_balance: newBalance }).eq('id', id)
            if (sError) throw sError

            alert('Payment recorded successfully! ✅')
            setPaymentAmount('')
            setPaymentNote('')
            setShowPaymentModal(false)
            fetchSupplierData()
        } catch (error) {
            const errMsg = error?.message || String(error)
            if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
                const paymentId = crypto.randomUUID()
                const paymentData = {
                    id: paymentId,
                    shop_id: user.shop_id,
                    supplier_id: id,
                    amount: amount,
                    payment_type: 'payment',
                    note: (paymentNote || 'Cash Paid to Supplier') + ' (Offline)',
                    created_at: new Date().toISOString()
                }

                // 1. Record payment locally
                await db.supplier_payments.add(paymentData)
                await db.sync_queue.add({ table: 'supplier_payments', action: 'INSERT', data: paymentData, timestamp: paymentData.created_at })

                // 2. Update local balance
                const newBal = Math.max(0, (supplier?.outstanding_balance || 0) - amount)
                await db.suppliers.update(id, { outstanding_balance: newBal })
                await db.sync_queue.add({ table: 'suppliers', action: 'UPDATE', data: { id, outstanding_balance: newBal }, timestamp: paymentData.created_at })

                alert('Offline mode: Payment saved locally. Will sync when online! 🔄')
                setPaymentAmount('')
                setPaymentNote('')
                setShowPaymentModal(false)
                setSupplier({ ...supplier, outstanding_balance: newBal })
                fetchSupplierData()
            } else {
                alert('Error: ' + errMsg)
            }
        } finally {
            setSaving(false)
        }
    }

    if (loading) return <div className="p-8">Loading ledger...</div>
    if (!supplier) return <div className="p-8 text-red-500">Supplier not found!</div>

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <button onClick={() => navigate('/suppliers')} className="text-blue-500 mb-2 hover:underline text-sm font-semibold">← Back to Suppliers</button>
                    <h1 className="text-3xl font-bold text-gray-800">{supplier.name}</h1>
                    <p className="text-gray-500">{supplier.phone} | {supplier.address}</p>
                </div>
                <div className="w-full sm:w-auto text-left sm:text-right flex flex-col sm:items-end gap-3">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex-1 w-full sm:w-auto">
                        <p className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Total Debt (Payable)</p>
                        <p className={`text-3xl font-bold ${supplier.outstanding_balance > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                            Rs. {supplier.outstanding_balance || 0}
                        </p>
                    </div>
                    <button
                        onClick={() => setShowPaymentModal(true)}
                        className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-semibold shadow-lg">
                        💸 Record Payment
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 whitespace-nowrap">Date</th>
                                <th className="px-6 py-4 text-left font-semibold text-gray-600 min-w-[200px]">Description</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Debit (Purchase)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Credit (Payment)</th>
                                <th className="px-6 py-4 text-right font-semibold text-gray-600 whitespace-nowrap">Balance</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {ledger.map((item, idx) => (
                                <React.Fragment key={idx}>
                                    <tr className="hover:bg-gray-50 transition font-medium">
                                        <td className="px-6 py-4 text-gray-500 font-normal">{new Date(item.date).toLocaleDateString('en-PK')}</td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-gray-800">{item.note}</span>
                                                    {item.type === 'purchase' && (
                                                        <button
                                                            onClick={() => setExpandedBill(expandedBill === item.id ? null : item.id)}
                                                            className="text-[10px] text-blue-600 hover:text-blue-800 font-bold uppercase tracking-tighter"
                                                        >
                                                            {expandedBill === item.id ? 'Collapse ▲' : 'Details ▼'}
                                                        </button>
                                                    )}
                                                </div>
                                                {item.type === 'return' && <span className="w-fit px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] uppercase font-bold mt-1">Return</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right text-orange-600 font-medium">
                                            {item.type === 'purchase' ? `+ Rs. ${item.amount.toLocaleString()}` : ''}
                                        </td>
                                        <td className="px-6 py-4 text-right text-green-600 font-medium">
                                            {item.type !== 'purchase' ? `- Rs. ${Math.abs(item.amount).toLocaleString()}` : ''}
                                        </td>
                                        <td className="px-6 py-4 text-right font-bold text-gray-900">
                                            Rs. {item.balance.toLocaleString()}
                                        </td>
                                    </tr>
                                    {item.type === 'purchase' && expandedBill === item.id && (
                                        <tr className="bg-orange-50/50 border-b border-gray-100">
                                            <td colSpan="5" className="px-6 py-3">
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex items-center gap-2">
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
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                            {ledger.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-gray-400">No transactions found for this supplier.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Payment Modal */}
            {
                showPaymentModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">Record Payment to Supplier</h2>
                            <form onSubmit={handleAddPayment} className="space-y-4">
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1">Amount Paid (Rs.)</label>
                                    <input
                                        type="number"
                                        autoFocus
                                        required
                                        value={paymentAmount}
                                        onChange={e => setPaymentAmount(e.target.value)}
                                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 font-medium mb-1">Note (Optional)</label>
                                    <textarea
                                        value={paymentNote}
                                        onChange={e => setPaymentNote(e.target.value)}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="e.g. Paid via Cash / Cheque #..."
                                        rows="2"
                                    ></textarea>
                                </div>
                                <div className="flex gap-3 pt-2">
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-50">
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

export default SupplierLedger
