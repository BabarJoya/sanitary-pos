import { useState, useEffect } from 'react'
import { supabaseAdmin } from '../services/supabase'
import { X, Users, Key, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { logAction } from '../services/auditService'
import { useAuth } from '../context/AuthContext'
import { hashPassword } from '../utils/authUtils'

export default function ManageUsersModal({ shop, onClose }) {
    const { user: adminUser } = useAuth()
    const [loading, setLoading] = useState(true)
    const [users, setUsers] = useState([])
    const [error, setError] = useState('')
    const [successMsg, setSuccessMsg] = useState('')

    useEffect(() => {
        if (shop) fetchUsers()
    }, [shop])

    const fetchUsers = async () => {
        if (!supabaseAdmin) return
        setLoading(true)
        try {
            const { data, error: fetchError } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('shop_id', shop.id)
                .order('role', { ascending: true })

            if (fetchError) throw fetchError
            setUsers(data)
        } catch (err) {
            setError('Failed to load users: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const handleResetPassword = async (user) => {
        const newPassword = prompt(`Enter new password for ${user.username} (or leave blank for '123456'):`)
        if (newPassword === null) return // Cancelled

        const finalPassword = newPassword.trim() || '123456'

        setError('')
        setSuccessMsg('')

        try {
            const hashedPassword = await hashPassword(finalPassword)
            const { error: updateError } = await supabaseAdmin
                .from('users')
                .update({ password: hashedPassword })
                .eq('id', user.id)

            if (updateError) throw updateError

            // Note: If they use Supabase Auth for Admin users, we should ideally trigger an admin.updateUserById here too.
            // But for Cashiers, they only exist in the abstract 'users' table.

            await logAction({
                actor_id: adminUser?.id,
                actor_email: adminUser?.email || adminUser?.username,
                action_type: 'RESET_STAFF_PASSWORD',
                target_type: 'USER',
                target_id: user.id,
                details: { username: user.username, shop_name: shop.name }
            })

            setSuccessMsg(`Password for ${user.username} reset to: ${finalPassword}`)
            fetchUsers()
        } catch (err) {
            setError('Failed to reset password: ' + err.message)
        }
    }

    return (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <Users className="text-blue-500" size={24} />
                            Manage Users: {shop.name}
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">View staff and reset lost passwords.</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    {error && <div className="p-3 mb-4 bg-red-50 text-red-600 rounded-xl text-sm font-bold flex items-center gap-2"><AlertTriangle size={18} /> {error}</div>}
                    {successMsg && <div className="p-3 mb-4 bg-emerald-50 text-emerald-600 rounded-xl text-sm font-bold flex items-center gap-2"><CheckCircle2 size={18} /> {successMsg}</div>}

                    {loading ? (
                        <div className="p-8 text-center text-slate-400 font-bold animate-pulse">Loading users...</div>
                    ) : users.length === 0 ? (
                        <div className="p-8 text-center text-slate-400 font-bold">No users found for this shop.</div>
                    ) : (
                        <div className="space-y-3">
                            {users.map(u => (
                                <div key={u.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="font-bold text-slate-800">{u.username}</p>
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {u.role}
                                            </span>
                                        </div>
                                        {u.email && <p className="text-xs text-slate-500 mt-0.5">{u.email}</p>}
                                        <p className="text-[10px] text-slate-400 mt-1 font-mono">
                                            Last Active: {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Never'}
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => handleResetPassword(u)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 transition-all shadow-sm"
                                    >
                                        <Key size={14} /> Reset Password
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
