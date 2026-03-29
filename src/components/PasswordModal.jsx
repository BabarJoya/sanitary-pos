import { useState } from 'react'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { useAuth } from '../context/AuthContext'
import { hashPassword } from '../utils/authUtils'

function PasswordModal({ title, message, onConfirm, onCancel, checkboxLabel, checkboxChecked, onCheckboxChange }) {
    const { user } = useAuth()
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [verifying, setVerifying] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!password.trim()) { setError('Password is required'); return }
        setVerifying(true)
        setError('')

        try {
            const hashed = await hashPassword(password)

            // ── Check 1: localStorage cached hash (fastest, set at login) ──
            const cachedHash = localStorage.getItem('user_pw_hash')
            if (cachedHash && cachedHash === hashed) {
                onConfirm()
                return
            }

            // ── Check 2: Dexie IndexedDB (offline cache from last login) ──
            try {
                const localUser = await db.users.get(user?.id)
                if (localUser?.password === hashed) {
                    localStorage.setItem('user_pw_hash', hashed) // re-cache
                    onConfirm()
                    return
                }
            } catch (_) { /* ignore */ }

            // ── Check 3: secure_login RPC — same function used by Login page ──
            // This bypasses RLS entirely and works for any existing session
            if (navigator.onLine && user?.username) {
                try {
                    const { data: result } = await supabase.rpc('secure_login', {
                        p_username: user.username,
                        p_password_hash: hashed
                    })
                    if (result && result.success && result.user?.id) {
                        // Cache for next time so future checks are instant
                        localStorage.setItem('user_pw_hash', hashed)
                        try { await db.users.put({ id: result.user.id, username: result.user.username, password: hashed, shop_id: result.user.shop_id, role: result.user.role, is_active: true }) } catch (_) {}
                        onConfirm()
                        return
                    }
                } catch (_) { /* RPC failed — treat as wrong password */ }
            }

            // All checks failed
            setError('Incorrect password! ❌')
        } catch (err) {
            setError('Verification failed: ' + (err.message || String(err)))
        } finally {
            setVerifying(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] p-4">
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm animate-[fadeIn_0.2s_ease-out]">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <span className="text-lg">🔒</span>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">{title || 'Password Required'}</h2>
                        <p className="text-xs text-gray-500">{message || 'Enter your password to proceed'}</p>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <input
                            type="password"
                            autoFocus
                            required
                            value={password}
                            onChange={e => { setPassword(e.target.value); setError('') }}
                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 outline-none text-lg"
                            placeholder="Enter your password..."
                        />
                        {error && (
                            <p className="text-red-500 text-sm mt-2 font-medium">{error}</p>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button
                            type="submit"
                            disabled={verifying}
                            className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition disabled:opacity-50"
                        >
                            {verifying ? 'Verifying...' : 'Confirm'}
                        </button>
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition"
                        >
                            Cancel
                        </button>
                    </div>
                    {checkboxLabel && (
                        <div className="pt-2 border-t mt-4">
                            <label className="flex items-center gap-3 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={checkboxChecked}
                                    onChange={(e) => onCheckboxChange && onCheckboxChange(e.target.checked)}
                                    className="w-5 h-5 rounded border-gray-300 text-red-600 focus:ring-red-500 accent-red-600"
                                />
                                <span className="text-sm font-bold text-red-600 select-none group-hover:text-red-700 transition">
                                    {checkboxLabel}
                                </span>
                            </label>
                        </div>
                    )}
                </form>
            </div>
        </div>
    )
}

export default PasswordModal
