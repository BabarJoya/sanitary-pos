import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue, moveToTrash } from '../services/db'
import PasswordModal from '../components/PasswordModal'

function Expenses() {
  const { user } = useAuth()
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)

  const [form, setForm] = useState({ category: 'Misc', amount: '', note: '' })
  const [summary, setSummary] = useState({ today: 0, monthly: 0 })
  const [selected, setSelected] = useState([])
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState([])

  const categories = ['Rent', 'Electricity', 'Tea/Food', 'Salary', 'Misc', 'Repairing', 'Transport']

  useEffect(() => {
    if (user?.shop_id) fetchExpenses()
  }, [user?.shop_id])

  const fetchExpenses = async () => {
    setLoading(true)
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = supabase
        .from('expenses')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        setExpenses(data)
        calculateSummary(data)
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.expenses.bulkPut(cleanData)
      }
    } catch (e) {
      console.log('Expenses: Fetching from local DB (Offline Fallback)')
      try {
        const localData = await db.expenses.toArray()
        const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        const filtered = sorted.filter(x => String(x.shop_id) === String(user.shop_id))
        setExpenses(filtered)
        calculateSummary(filtered)
      } catch (err) { console.error('Local DB Expenses Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const calculateSummary = (data) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

    const todayTotal = data
      .filter(e => new Date(e.created_at) >= today)
      .reduce((sum, e) => sum + Number(e.amount), 0)

    const monthlyTotal = data
      .filter(e => new Date(e.created_at) >= firstOfMonth)
      .reduce((sum, e) => sum + Number(e.amount), 0)

    setSummary({ today: todayTotal, monthly: monthlyTotal })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    const payload = {
      ...form,
      amount: parseFloat(form.amount),
      shop_id: user.shop_id
    }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')

      if (editingId) {
        const { error } = await supabase.from('expenses').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('expenses').insert([payload])
        if (error) throw error
      }
      setEditingId(null)
      setForm({ category: 'Misc', amount: '', note: '' })
      setShowForm(false)
      fetchExpenses()
    } catch (error) {
      const errMsg = error?.message || String(error)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        const offlineData = editingId ? { ...payload, id: editingId } : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }
        const action = editingId ? 'UPDATE' : 'INSERT'
        await addToSyncQueue('expenses', action, offlineData)
        if (editingId) {
          await db.expenses.update(editingId, offlineData)
        } else {
          await db.expenses.add(offlineData)
        }
        setEditingId(null)
        setForm({ category: 'Misc', amount: '', note: '' })
        setShowForm(false)
        fetchExpenses()
        alert('Offline mode: Saved locally. Will sync automatically when online. 🔄')
      } else {
        alert(error.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (exp) => {
    setForm({ category: exp.category, amount: exp.amount, note: exp.note || '' })
    setEditingId(exp.id)
    setShowForm(true)
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
      const item = expenses.find(e => e.id === id)
      if (!item) continue

      try {
        if (navigator.onLine) {
          const { error } = await supabase.from('expenses').delete().eq('id', id)
          if (error) {
            console.error('Delete failed:', error)
            failCount++
            continue
          }
        } else {
          await addToSyncQueue('expenses', 'DELETE', { id })
        }

        await moveToTrash('expenses', id, item, user.id, user.shop_id)
        await db.expenses.delete(id)
        successfulIds.push(id)
        successCount++
      } catch (err) {
        console.error('Delete error:', err)
        failCount++
      }
    }

    setExpenses(prev => prev.filter(e => !successfulIds.includes(e.id)))
    setSelected([])

    if (failCount > 0) {
      alert(`⚠️ Partially completed.\n✅ Deleted: ${successCount}\n❌ Failed: ${failCount}`)
    } else if (successCount > 0) {
      alert(`🗑️ ${successCount} expense(s) moved to Trash!`)
    }
    fetchExpenses()
  }

  const toggleSelect = (id) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const toggleSelectAll = () => {
    if (selected.length === expenses.length) {
      setSelected([])
    } else {
      setSelected(expenses.map(x => x.id))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">💸 Expenses</h1>
          <p className="text-gray-500 text-sm">Track your daily business expenditures</p>
        </div>
        <div className="flex gap-4 w-full sm:w-auto overflow-x-auto pb-1 items-center flex-wrap">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Today</p>
            <p className="text-xl font-bold text-red-600">Rs. {summary.today.toLocaleString()}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 text-center min-w-[120px]">
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">This Month</p>
            <p className="text-xl font-bold text-gray-800">Rs. {summary.monthly.toLocaleString()}</p>
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => requestDelete(selected)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl transition font-bold text-sm"
            >
              🗑️ Delete Selected ({selected.length})
            </button>
          )}
          <button
            onClick={() => { setShowForm(!showForm); setEditingId(null); setForm({ category: 'Misc', amount: '', note: '' }) }}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition shadow-lg shadow-blue-100 font-bold"
          >
            {showForm ? 'Cancel' : '+ Add Expense'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-2xl shadow-xl p-6 border border-blue-50 max-w-xl mx-auto md:mx-0">
          <h2 className="font-bold text-gray-800 mb-4">{editingId ? 'Edit Expense' : 'New Expense'}</h2>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (Rs.)</label>
              <input
                type="number"
                required
                value={form.amount}
                onChange={e => setForm({ ...form, amount: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="0.00"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Note / Description</label>
              <textarea
                value={form.note}
                onChange={e => setForm({ ...form, note: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Description of expenditure..."
                rows="2"
              ></textarea>
            </div>
            <div className="md:col-span-2 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingId ? 'Update Expense' : 'Save Expense'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    checked={selected.length === expenses.length && expenses.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded"
                  />
                </th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Date</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap">Category</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase whitespace-nowrap min-w-[150px]">Description</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-right whitespace-nowrap">Amount</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase text-center whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-400">Loading expenses...</td></tr>
              ) : expenses.length === 0 ? (
                <tr><td colSpan="6" className="px-6 py-12 text-center text-gray-400 italic">No expenses recorded yet.</td></tr>
              ) : expenses.map(exp => (
                <tr key={exp.id} className={`hover:bg-gray-50 transition group ${selected.includes(exp.id) ? 'bg-blue-50' : ''}`}>
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selected.includes(exp.id)}
                      onChange={() => toggleSelect(exp.id)}
                      className="w-4 h-4 rounded"
                    />
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{new Date(exp.created_at).toLocaleDateString('en-PK')}</td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-bold uppercase">
                      {exp.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 italic">{exp.note || '-'}</td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">Rs. {exp.amount.toLocaleString()}</td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex justify-center gap-3 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => handleEdit(exp)} className="text-blue-500 hover:text-blue-700 font-bold text-sm">Edit</button>
                      <button onClick={() => requestDelete([exp.id])} className="text-red-500 hover:text-red-700 font-bold text-sm">Delete</button>
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
          title="Delete Expense(s)"
          message={`${pendingDeleteIds.length} item(s) will be moved to Trash`}
          onConfirm={executeDelete}
          onCancel={() => { setShowPasswordModal(false); setPendingDeleteIds([]) }}
        />
      )}
    </div>
  )
}

export default Expenses
