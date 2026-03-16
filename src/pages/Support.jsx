import { useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'

function Support() {
    const { user } = useAuth()
    const [subject, setSubject] = useState('')
    const [message, setMessage] = useState('')
    const [loading, setLoading] = useState(false)
    const [success, setSuccess] = useState(false)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        try {
            const { error } = await supabase.from('support_tickets').insert([
                {
                    shop_id: user.shop_id,
                    subject,
                    message,
                    status: 'open'
                }
            ])
            if (error) throw error
            setSuccess(true)
            setSubject('')
            setMessage('')
        } catch (err) {
            alert('Failed to send ticket: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-2xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-800 mb-2">🆘 Help & Support</h1>
            <p className="text-gray-500 mb-8">Hamari team se rabta karne ke liye niche form bharein.</p>

            {success ? (
                <div className="bg-green-50 border border-green-200 p-8 rounded-2xl text-center">
                    <div className="text-4xl mb-4">✅</div>
                    <h2 className="text-xl font-bold text-green-800 mb-2">Ticket Musool Ho Gaya!</h2>
                    <p className="text-green-600 mb-6">Hamari team jald hi aap se rabta karegi. Shukriya!</p>
                    <button
                        onClick={() => setSuccess(false)}
                        className="px-6 py-2 bg-green-600 text-white rounded-lg font-bold"
                    >
                        Naya Ticket Bheinjein
                    </button>
                </div>
            ) : (
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Unwan (Subject) *</label>
                            <input
                                type="text"
                                required
                                value={subject}
                                onChange={e => setSubject(e.target.value)}
                                placeholder="e.g. Printer connection issue"
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-gray-700 mb-2">Message *</label>
                            <textarea
                                required
                                rows="5"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder="Apni mushkil tafseel se bayan karein..."
                                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                            ></textarea>
                        </div>

                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
                            <span className="text-xl">📞</span>
                            <div>
                                <p className="text-xs font-bold text-blue-800 uppercase tracking-wider">Urgent Support?</p>
                                <p className="text-blue-600 font-bold">Babar Joya: 0301-2616367</p>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-100 transition disabled:opacity-50"
                        >
                            {loading ? 'Bheja ja raha hai...' : 'Ticket Submit Karein'}
                        </button>
                    </form>
                </div>
            )}
        </div>
    )
}

export default Support
