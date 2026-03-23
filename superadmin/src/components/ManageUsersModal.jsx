import { useState, useEffect } from 'react'
import { supabaseAdmin } from '../services/supabase'
import { logAction } from '../services/auditService'
import { useAuth } from '../context/AuthContext'
import { hashPassword } from '../utils/authUtils'
import {
  X, Users, Plus, Edit2, Trash2, Save, XCircle,
  AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, User
} from 'lucide-react'

const EMPTY_FORM = { username: '', email: '', password: '', role: 'cashier', is_active: true }

export default function ManageUsersModal({ shop, onClose }) {
  const { user: adminUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // form state — null = closed, 'add' = new user, id = editing user
  const [formMode, setFormMode] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [showPass, setShowPass] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => { if (shop) fetchUsers() }, [shop])

  const fetchUsers = async () => {
    if (!supabaseAdmin) return
    setLoading(true)
    try {
      const { data, error: err } = await supabaseAdmin
        .from('users')
        .select('id, username, email, role, is_active, created_at, last_sign_in_at')
        .eq('shop_id', shop.id)
        .order('role')
      if (err) throw err
      setUsers(data)
    } catch (e) {
      setError('Failed to load users: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const flash = (msg, isError = false) => {
    if (isError) { setError(msg); setSuccessMsg('') }
    else { setSuccessMsg(msg); setError('') }
    setTimeout(() => { setError(''); setSuccessMsg('') }, 4000)
  }

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setShowPass(false)
    setFormMode('add')
  }

  const openEdit = (u) => {
    setForm({ username: u.username, email: u.email || '', password: '', role: u.role, is_active: u.is_active })
    setShowPass(false)
    setFormMode(u.id)
  }

  const closeForm = () => { setFormMode(null); setForm(EMPTY_FORM) }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!form.username.trim()) { flash('Username is required.', true); return }
    if (formMode === 'add' && !form.password.trim()) { flash('Password is required for new user.', true); return }
    if (form.password && form.password.length < 4) { flash('Password must be at least 4 characters.', true); return }

    setSaving(true)
    try {
      if (formMode === 'add') {
        // Check username uniqueness within shop
        const { data: existing } = await supabaseAdmin
          .from('users').select('id').eq('shop_id', shop.id).ilike('username', form.username.trim()).maybeSingle()
        if (existing) { flash('Username already exists in this shop.', true); setSaving(false); return }

        const hashed = await hashPassword(form.password)
        const { error: insErr } = await supabaseAdmin.from('users').insert([{
          shop_id: shop.id,
          username: form.username.trim(),
          email: form.email.trim() || null,
          password: hashed,
          role: form.role,
          is_active: form.is_active,
        }])
        if (insErr) throw insErr

        await logAction({
          actor_id: adminUser?.id, actor_email: adminUser?.email || adminUser?.username,
          action_type: 'CREATE_USER', target_type: 'USER',
          details: { username: form.username, role: form.role, shop_name: shop.name }
        })
        flash(`User "${form.username}" created successfully.`)
      } else {
        // Edit existing user
        const updateData = {
          username: form.username.trim(),
          email: form.email.trim() || null,
          role: form.role,
          is_active: form.is_active,
        }
        if (form.password.trim()) {
          updateData.password = await hashPassword(form.password)
        }
        const { error: updErr } = await supabaseAdmin.from('users').update(updateData).eq('id', formMode)
        if (updErr) throw updErr

        await logAction({
          actor_id: adminUser?.id, actor_email: adminUser?.email || adminUser?.username,
          action_type: 'UPDATE_USER', target_type: 'USER', target_id: formMode,
          details: { username: form.username, passwordChanged: !!form.password, shop_name: shop.name }
        })
        flash(`User "${form.username}" updated successfully.`)
      }
      closeForm()
      fetchUsers()
    } catch (e) {
      flash('Error: ' + e.message, true)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (u) => {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    setDeletingId(u.id)
    try {
      const { error: delErr } = await supabaseAdmin.from('users').delete().eq('id', u.id)
      if (delErr) throw delErr
      await logAction({
        actor_id: adminUser?.id, actor_email: adminUser?.email || adminUser?.username,
        action_type: 'DELETE_USER', target_type: 'USER', target_id: u.id,
        details: { username: u.username, shop_name: shop.name }
      })
      flash(`User "${u.username}" deleted.`)
      fetchUsers()
    } catch (e) {
      flash('Delete failed: ' + e.message, true)
    } finally {
      setDeletingId(null)
    }
  }

  const toggleActive = async (u) => {
    try {
      const { error: e } = await supabaseAdmin.from('users').update({ is_active: !u.is_active }).eq('id', u.id)
      if (e) throw e
      flash(`${u.username} ${!u.is_active ? 'activated' : 'deactivated'}.`)
      fetchUsers()
    } catch (e) {
      flash('Failed: ' + e.message, true)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">

        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <div>
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <Users size={20} className="text-blue-500" />
              Manage Users
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">{shop.name} · {users.length} staff</p>
          </div>
          <div className="flex items-center gap-2">
            {formMode === null && (
              <button onClick={openAdd}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition active:scale-95 shadow-md shadow-blue-500/20">
                <Plus size={14} /> Add User
              </button>
            )}
            <button onClick={onClose}
              className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-white transition">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Alerts */}
        {(error || successMsg) && (
          <div className={`mx-5 mt-4 p-3 rounded-xl text-sm font-bold flex items-center gap-2 ${error ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
            {error ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
            {error || successMsg}
          </div>
        )}

        {/* Add / Edit Form */}
        {formMode !== null && (
          <form onSubmit={handleSave} className="mx-5 mt-4 p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 shrink-0">
            <p className="text-xs font-black text-slate-500 uppercase tracking-wider">
              {formMode === 'add' ? '➕ New User' : '✏️ Edit User'}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Username */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">Username *</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type="text" required value={form.username}
                    onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                    placeholder="e.g. cashier1"
                    className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">Email (optional)</label>
                <input
                  type="email" value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="e.g. cashier@shop.com"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">
                  Password {formMode === 'add' ? '*' : '(leave blank to keep)'}
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-2.5 text-slate-400" size={14} />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder={formMode === 'add' ? 'Min. 4 characters' : 'New password (optional)'}
                    className="w-full pl-8 pr-9 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600">
                    {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Role */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500">Role *</label>
                <select value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="cashier">Cashier</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            {/* Active toggle */}
            <label className="flex items-center gap-2 cursor-pointer w-fit">
              <input type="checkbox" checked={form.is_active}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-600" />
              <span className="text-xs font-bold text-slate-600">Active (can log in)</span>
            </label>

            {/* Buttons */}
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition disabled:opacity-50 active:scale-95">
                <Save size={14} /> {saving ? 'Saving…' : formMode === 'add' ? 'Create User' : 'Save Changes'}
              </button>
              <button type="button" onClick={closeForm}
                className="flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-bold rounded-xl hover:bg-slate-50 transition active:scale-95">
                <XCircle size={14} /> Cancel
              </button>
            </div>
          </form>
        )}

        {/* Users List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {loading ? (
            <div className="py-10 text-center text-slate-400 font-bold animate-pulse">Loading users…</div>
          ) : users.length === 0 ? (
            <div className="py-10 text-center">
              <Users size={36} className="mx-auto text-slate-200 mb-2" />
              <p className="text-slate-400 font-bold text-sm">No users yet.</p>
              <p className="text-slate-400 text-xs mt-1">Click <strong>Add User</strong> to create the first staff account.</p>
            </div>
          ) : (
            users.map(u => (
              <div key={u.id}
                className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-all ${formMode === u.id ? 'border-blue-300 bg-blue-50' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-slate-800 text-sm">{u.username}</p>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {u.role}
                    </span>
                    {!u.is_active && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-red-100 text-red-600">
                        Inactive
                      </span>
                    )}
                  </div>
                  {u.email && <p className="text-xs text-slate-500 mt-0.5 truncate">{u.email}</p>}
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">
                    {u.last_sign_in_at
                      ? 'Last login: ' + new Date(u.last_sign_in_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                      : 'Never logged in'}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  <button onClick={() => toggleActive(u)}
                    title={u.is_active ? 'Deactivate' : 'Activate'}
                    className={`p-1.5 rounded-lg border text-xs font-bold transition active:scale-95 ${u.is_active ? 'border-orange-200 text-orange-500 hover:bg-orange-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                    {u.is_active ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                  </button>
                  <button onClick={() => openEdit(u)}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-100 transition active:scale-95">
                    <Edit2 size={13} /> Edit
                  </button>
                  <button onClick={() => handleDelete(u)} disabled={deletingId === u.id}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-red-200 text-red-500 text-xs font-bold rounded-lg hover:bg-red-50 transition active:scale-95 disabled:opacity-50">
                    <Trash2 size={13} /> {deletingId === u.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 shrink-0 flex justify-between items-center">
          <p className="text-xs text-slate-400">{users.length} user{users.length !== 1 ? 's' : ''} in this shop</p>
          <button onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
