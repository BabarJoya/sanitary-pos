import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, restoreFromTrash, addToSyncQueue } from '../services/db'
import PasswordModal from '../components/PasswordModal'

function TrashBin() {
    const { user } = useAuth()
    const [trashItems, setTrashItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [selected, setSelected] = useState([])
    const [filterTable, setFilterTable] = useState('')
    const [showPasswordModal, setShowPasswordModal] = useState(false)
    const [pendingAction, setPendingAction] = useState(null)

    useEffect(() => {
        fetchTrash()
    }, [])

    const fetchTrash = async () => {
        setLoading(true)
        try {
            const all = await db.trash.toArray()
            const sid = String(user.shop_id)
            const filtered = all
                .filter(x => String(x.shop_id) === sid)
                .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at))
            setTrashItems(filtered)
        } catch (err) {
            console.error('Trash fetch error:', err)
        } finally {
            setLoading(false)
        }
    }

    const getItemLabel = (item) => {
        const d = item.data
        if (d?.name) return d.name
        if (d?.product_name) return d.product_name
        if (d?.note) return d.note
        if (d?.category) return `${d.category} - Rs. ${d.amount}`
        return `#${String(item.original_id).slice(-8)}`
    }

    const tableLabels = {
        products: '📦 Product',
        suppliers: '🚚 Supplier',
        customers: '👥 Customer',
        expenses: '💸 Expense',
        purchases: '🛒 Purchase',
        sales: '📜 Sale',
        purchase_items: '📋 Purchase Item',
        sale_items: '📋 Sale Item'
    }

    const handleRestore = async (items) => {
        try {
            for (const item of items) {
                // Restore to local DB
                await restoreFromTrash(item)

                // Try to restore to Supabase
                if (navigator.onLine) {
                    try {
                        await supabase.from(item.original_table).upsert([item.data])
                    } catch (e) {
                        await addToSyncQueue(item.original_table, 'INSERT', item.data)
                    }
                } else {
                    await addToSyncQueue(item.original_table, 'INSERT', item.data)
                }
            }

            alert(`✅ ${items.length} item(s) restored successfully!`)
            setSelected([])
            fetchTrash()
        } catch (err) {
            alert('Restore failed: ' + err.message)
        }
    }

    const handlePermanentDelete = async (items) => {
        try {
            for (const item of items) {
                await db.trash.delete(item.id)
            }
            alert(`🗑️ ${items.length} item(s) permanently deleted!`)
            setSelected([])
            fetchTrash()
        } catch (err) {
            alert('Delete failed: ' + err.message)
        }
    }

    const requestPasswordAction = (action, items) => {
        setPendingAction({ action, items })
        setShowPasswordModal(true)
    }

    const onPasswordConfirm = () => {
        setShowPasswordModal(false)
        if (pendingAction?.action === 'delete') {
            handlePermanentDelete(pendingAction.items)
        } else if (pendingAction?.action === 'restore') {
            handleRestore(pendingAction.items)
        }
        setPendingAction(null)
    }

    const toggleSelect = (id) => {
        setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }

    const toggleSelectAll = () => {
        if (selected.length === filtered.length) {
            setSelected([])
        } else {
            setSelected(filtered.map(x => x.id))
        }
    }

    const filtered = trashItems.filter(x => filterTable ? x.original_table === filterTable : true)

    const uniqueTables = [...new Set(trashItems.map(x => x.original_table))]

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">🗑️ Trash Bin</h1>
                    <p className="text-gray-500 text-sm">Deleted items can be restored or permanently removed</p>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                    <select
                        className="px-4 py-2 border rounded-lg outline-none text-sm"
                        value={filterTable}
                        onChange={e => setFilterTable(e.target.value)}
                    >
                        <option value="">All Types ({trashItems.length})</option>
                        {uniqueTables.map(t => (
                            <option key={t} value={t}>{tableLabels[t] || t} ({trashItems.filter(x => x.original_table === t).length})</option>
                        ))}
                    </select>

                    {selected.length > 0 && (
                        <>
                            <button
                                onClick={() => {
                                    const items = filtered.filter(x => selected.includes(x.id))
                                    handleRestore(items)
                                }}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-bold text-sm"
                            >
                                ♻️ Restore Selected ({selected.length})
                            </button>
                            <button
                                onClick={() => {
                                    const items = filtered.filter(x => selected.includes(x.id))
                                    requestPasswordAction('delete', items)
                                }}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition font-bold text-sm"
                            >
                                🔥 Delete Forever ({selected.length})
                            </button>
                        </>
                    )}

                    {trashItems.length > 0 && (
                        <button
                            onClick={() => requestPasswordAction('delete', trashItems)}
                            className="px-4 py-2 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg transition font-bold text-sm"
                        >
                            Empty Trash
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="px-4 py-3 w-10">
                                    <input
                                        type="checkbox"
                                        checked={selected.length === filtered.length && filtered.length > 0}
                                        onChange={toggleSelectAll}
                                        className="w-4 h-4 rounded"
                                    />
                                </th>
                                <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Type</th>
                                <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Name / Description</th>
                                <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase">Deleted On</th>
                                <th className="px-4 py-3 text-xs font-bold text-gray-500 uppercase text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan="5" className="px-6 py-12 text-center text-gray-400">Loading trash...</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan="5" className="px-6 py-12 text-center text-gray-400 italic">
                                    {trashItems.length === 0 ? '🎉 Trash is empty! No deleted items.' : 'No items match the filter.'}
                                </td></tr>
                            ) : filtered.map(item => (
                                <tr key={item.id} className="hover:bg-gray-50 transition">
                                    <td className="px-4 py-3">
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(item.id)}
                                            onChange={() => toggleSelect(item.id)}
                                            className="w-4 h-4 rounded"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold uppercase">
                                            {tableLabels[item.original_table] || item.original_table}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 font-medium text-gray-800">{getItemLabel(item)}</td>
                                    <td className="px-4 py-3 text-sm text-gray-500">
                                        {new Date(item.deleted_at).toLocaleString('en-PK')}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex justify-center gap-2">
                                            <button
                                                onClick={() => handleRestore([item])}
                                                className="px-3 py-1 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-xs font-bold transition"
                                            >
                                                ♻️ Restore
                                            </button>
                                            <button
                                                onClick={() => requestPasswordAction('delete', [item])}
                                                className="px-3 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg text-xs font-bold transition"
                                            >
                                                🔥 Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showPasswordModal && (
                <PasswordModal
                    title="Confirm Action"
                    message="Enter your password to proceed with this critical operation"
                    onConfirm={onPasswordConfirm}
                    onCancel={() => { setShowPasswordModal(false); setPendingAction(null) }}
                />
            )}
        </div>
    )
}

export default TrashBin
