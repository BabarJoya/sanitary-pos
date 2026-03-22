import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'

function CustomerLedgerOverview() {
    const { user } = useAuth()
    const [customers, setCustomers] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    useEffect(() => {
        if (user?.shop_id) fetchCustomers()
    }, [user?.shop_id])

    const fetchCustomers = async () => {
        setLoading(true)
        try {
            if (!navigator.onLine) throw new Error('Offline')
            const { data, error } = await supabase
                .from('customers')
                .select('id, name, phone, address, outstanding_balance, created_at')
                .eq('shop_id', user.shop_id)
                .order('outstanding_balance', { ascending: false })

            if (error) throw error
            setCustomers(data || [])
        } catch (e) {
            try {
                const local = await db.customers.toArray()
                const shopCustomers = local
                    .filter(c => String(c.shop_id) === String(user.shop_id))
                    .sort((a, b) => (b.outstanding_balance || 0) - (a.outstanding_balance || 0))
                setCustomers(shopCustomers)
            } catch (_) { setCustomers([]) }
        } finally {
            setLoading(false)
        }
    }

    const filtered = customers.filter(c =>
        (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.phone || '').includes(search)
    )

    const totalReceivable = customers.reduce((sum, c) => sum + (c.outstanding_balance || 0), 0)
    const customersWithBalance = customers.filter(c => (c.outstanding_balance || 0) > 0)

    if (loading) return <div className="p-8 text-center text-gray-500">Loading customer ledger...</div>

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">📒 Customer Ledger</h1>
                    <p className="text-gray-500 text-sm mt-1">Accounts receivable overview — all customer balances</p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Receivable</p>
                    <p className={`text-2xl font-bold ${totalReceivable > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Rs. {totalReceivable.toLocaleString()}
                    </p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Customers with Dues</p>
                    <p className="text-2xl font-bold text-orange-600">{customersWithBalance.length}</p>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">Total Customers</p>
                    <p className="text-2xl font-bold text-blue-600">{customers.length}</p>
                </div>
            </div>

            {/* Search */}
            <div className="mb-4">
                <input
                    type="text"
                    placeholder="Search by name or phone..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full sm:w-80 px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
            </div>

            {/* Customer List */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-4 sm:px-6 py-4 text-left font-semibold text-gray-600">Customer</th>
                                <th className="px-4 sm:px-6 py-4 text-left font-semibold text-gray-600 hidden sm:table-cell">Phone</th>
                                <th className="px-4 sm:px-6 py-4 text-right font-semibold text-gray-600">Balance</th>
                                <th className="px-4 sm:px-6 py-4 text-center font-semibold text-gray-600">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan="4" className="px-6 py-12 text-center text-gray-400">
                                        {search ? 'No customers match your search.' : 'No customers found.'}
                                    </td>
                                </tr>
                            )}
                            {filtered.map(c => (
                                <tr key={c.id} className="hover:bg-gray-50 transition">
                                    <td className="px-4 sm:px-6 py-4">
                                        <div className="font-medium text-gray-800">{c.name}</div>
                                        <div className="text-xs text-gray-400 sm:hidden">{c.phone || '-'}</div>
                                    </td>
                                    <td className="px-4 sm:px-6 py-4 text-gray-500 hidden sm:table-cell">{c.phone || '-'}</td>
                                    <td className="px-4 sm:px-6 py-4 text-right">
                                        <span className={`font-bold ${(c.outstanding_balance || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                            Rs. {(c.outstanding_balance || 0).toLocaleString()}
                                        </span>
                                    </td>
                                    <td className="px-4 sm:px-6 py-4 text-center">
                                        <Link
                                            to={`/customers/${c.id}`}
                                            className="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition"
                                        >
                                            View Ledger →
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

export default CustomerLedgerOverview
