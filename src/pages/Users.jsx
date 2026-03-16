import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { hashPassword } from '../utils/authUtils'

function Users() {
  const { user } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'cashier', is_active: true, permissions: [] })

  const [limits] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('plan_limits') || '{"user_limit": 2, "plan_name": "TRIAL"}')
    } catch {
      return { user_limit: 2, plan_name: 'TRIAL' }
    }
  })

  const AVAILABLE_MODULES = [
    { id: 'pos', label: 'POS Billing' },
    { id: 'products', label: 'Products' },
    { id: 'categories', label: 'Categories' },
    { id: 'suppliers', label: 'Suppliers' },
    { id: 'customers', label: 'Customers' },
    { id: 'sales', label: 'Sales History' },
    { id: 'purchase-history', label: 'Purchase History' },
    { id: 'expenses', label: 'Expenses' },
    { id: 'purchases', label: 'Purchases' },
    { id: 'inventory', label: 'Stock Inventory' },
    { id: 'reports', label: 'Reports' }
  ]

  useEffect(() => {
    if (user?.shop_id) fetchUsers()
  }, [user?.shop_id])

  const fetchUsers = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline');
      const fetchPromise = supabase
        .from('users')
        .select('id, username, email, role, is_active, created_at, permissions')
        .eq('shop_id', user.shop_id)
        .neq('role', 'superadmin')
        .order('created_at', { ascending: false })

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])

      if (error) throw error
      if (data) {
        setUsers(data)
        const cleanData = JSON.parse(JSON.stringify(data))
        await db.users.bulkPut(cleanData)
      }
    } catch (e) {
      console.log('Users: Fetching from local DB (Offline Fallback)')
      try {
        const localData = await db.users.toArray()
        const sorted = localData.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        setUsers(sorted.filter(x => String(x.shop_id) === String(user.shop_id)))
      } catch (err) { console.error('Local DB Users Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (u) => {
    setForm({
      username: u.username,
      email: u.email || '',
      password: '',
      role: u.role,
      is_active: u.is_active,
      permissions: u.permissions || []
    })
    setEditingId(u.id)
    setShowForm(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)

    if (editingId) {
      const updateData = { username: form.username, email: form.email, role: form.role, is_active: form.is_active, permissions: form.permissions }
      if (form.password) updateData.password = await hashPassword(form.password)
      const { error } = await supabase.from('users').update(updateData).eq('id', editingId)
      if (error) { alert('Error: ' + error.message) }
      else { setEditingId(null); setForm({ username: '', email: '', password: '', role: 'cashier', is_active: true, permissions: [] }); setShowForm(false); fetchUsers() }
    } else {
      // Dynamic Limit Enforcement
      if (users.length >= (limits.user_limit || 2)) {
        alert(`Limit Reached! Aapka ${limits.plan_name || 'TRIAL'} plan sirf ${limits.user_limit || 2} staff accounts ki ijazat deta hai. Meharbani karke Superadmin se plan upgrade karwayein.`)
        setSaving(false)
        return
      }
      if (!form.password) { alert('Password zaroori hai!'); setSaving(false); return }
      const hashedPassword = await hashPassword(form.password)
      const { error } = await supabase.from('users').insert([{ ...form, password: hashedPassword, shop_id: user.shop_id }])
      if (error) { alert('Error: ' + error.message) }
      else { setForm({ username: '', email: '', password: '', role: 'cashier', is_active: true, permissions: [] }); setShowForm(false); fetchUsers() }
    }
    setSaving(false)
  }

  const toggleActive = async (u) => {
    await supabase.from('users').update({ is_active: !u.is_active }).eq('id', u.id)
    fetchUsers()
  }

  const handleDelete = async (id) => {
    if (id === user.id) { alert('Aap apna khud ka account delete nahi kar sakte!'); return }
    if (!confirm('Is user ko delete karo?')) return
    await supabase.from('users').delete().eq('id', id)
    fetchUsers()
  }

  const handleCancel = () => {
    setShowForm(false); setEditingId(null)
    setForm({ username: '', email: '', password: '', role: 'cashier', is_active: true, permissions: [] })
  }

  const togglePermission = (moduleId) => {
    setForm(prev => {
      if (prev.permissions.includes(moduleId)) {
        return { ...prev, permissions: prev.permissions.filter(id => id !== moduleId) }
      } else {
        return { ...prev, permissions: [...prev.permissions, moduleId] }
      }
    })
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">👨‍💼 Users</h1>
          <p className="text-sm text-gray-500 mt-1">
            Shop Limit ({limits.plan_name || 'TRIAL'}):
            <span className={users.length >= (limits.user_limit || 2) ? 'text-red-500 font-bold ml-1' : 'text-blue-600 font-bold ml-1'}>
              {users.length} / {limits.user_limit || 2}
            </span> users
          </p>
        </div>
        <button
          onClick={() => {
            if (!showForm && users.length >= (limits.user_limit || 2) && !editingId) {
              alert(`Plan Limit! Aapka current plan max ${limits.user_limit || 2} users allow karta hai.`)
              return
            }
            setShowForm(!showForm)
          }}
          className={`px-4 py-2 text-white rounded-lg transition ${users.length >= (limits.user_limit || 2) && !showForm && !editingId ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}>
          {showForm ? 'Cancel' : '+ Add User'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow p-6 mb-6 max-w-lg">
          <h2 className="font-semibold text-gray-700 mb-4">{editingId ? 'Edit User' : 'New User'}</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-gray-700 font-medium mb-1">Username *</label>
              <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                required className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. cashier1" />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Email *</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                required className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. ali@shop.com" />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">
                Password {editingId && <span className="text-gray-400 text-xs">(khali chhorein agar change nahi karna)</span>}
              </label>
              <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={editingId ? 'Naya password (optional)' : 'Password'} />
            </div>
            <div>
              <label className="block text-gray-700 font-medium mb-1">Role</label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
                <option value="accountant">Accountant</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {/* Custom Permissions */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mt-4">
              <label className="block text-gray-800 font-bold mb-3">Allowed Modules (Custom Permissions)</label>
              {form.role === 'admin' ? (
                <div className="text-sm text-blue-600 bg-blue-50 p-3 rounded-lg border border-blue-100 italic">
                  Admins implicitly have full access to all modules natively. Custom restrictions are ignored.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {AVAILABLE_MODULES.map(mod => (
                    <label key={mod.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={form.permissions.includes(mod.id)}
                        onChange={() => togglePermission(mod.id)}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 font-medium group-hover:text-blue-600 transition-colors">
                        {mod.label}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input type="checkbox" id="is_active" checked={form.is_active}
                onChange={e => setForm({ ...form, is_active: e.target.checked })}
                className="w-4 h-4 text-blue-600" />
              <label htmlFor="is_active" className="text-gray-700 font-medium">Active (login kar sakta hai)</label>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50">
                {saving ? 'Saving...' : editingId ? 'Update User' : 'Save User'}
              </button>
              <button type="button" onClick={handleCancel}
                className="px-6 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? <p className="text-gray-500">Loading...</p> : users.length === 0 ? (
        <div className="text-center py-12"><p className="text-gray-400 text-lg">No users yet</p></div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User Info</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-800">
                      {u.username} {u.id === user.id && <span className="text-xs text-blue-500 font-normal ml-1">(You)</span>}
                    </div>
                    {u.email && <div className="text-xs text-gray-500 mt-0.5">{u.email}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button onClick={() => toggleActive(u)}
                      className={`px-2 py-1 rounded-full text-xs font-medium cursor-pointer ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.is_active ? '✅ Active' : '❌ Inactive'}
                    </button>
                  </td>
                  <td className="px-6 py-4 flex gap-3">
                    <button onClick={() => handleEdit(u)} className="text-blue-500 hover:text-blue-700 text-sm font-medium">Edit</button>
                    <button onClick={() => handleDelete(u.id)} className="text-red-500 hover:text-red-700 text-sm font-medium">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default Users