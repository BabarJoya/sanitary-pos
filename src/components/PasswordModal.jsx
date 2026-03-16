import { useState } from 'react'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { useAuth } from '../context/AuthContext'

function PasswordModal({ title, message, onConfirm, onCancel }) {
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
            // Try online verification first
            if (navigator.onLine) {
                const { data, error: authErr } = await supabase
                    .from('users')
                    .select('id')
                    .eq('id', user.id)
                    .eq('password', password)
                    .single()

                if (authErr || !data) {
                    setError('Incorrect password! ❌')
                    setVerifying(false)
                    return
                }
            } else {
                // Offline: check from local DB
                const localUser = await db.users.get(user.id)
                if (!localUser || localUser.password !== password) {
                    setError('Incorrect password! ❌')
                    setVerifying(false)
                    return
                }
            }

            onConfirm()
        } catch (err) {
            // Fallback to local DB if online check fails
            try {
                const localUser = await db.users.get(user.id)
                if (!localUser || localUser.password !== password) {
                    setError('Incorrect password! ❌')
                    setVerifying(false)
                    return
                }
                onConfirm()
            } catch (e2) {
                setError('Verification failed: ' + (e2.message || String(e2)))
            }
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
                </form>
            </div>
        </div>
    )
}

export default PasswordModal
