import { useEffect, useState } from 'react'
import { supabaseAdmin } from '../services/supabase'

function SupportTickets() {
    const [tickets, setTickets] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchTickets()
    }, [])

    const fetchTickets = async () => {
        try {
            const { data, error } = await supabaseAdmin
                .from('support_tickets')
                .select('*, shops(name)')
                .order('created_at', { ascending: false })

            if (error) throw error
            setTickets(data || [])
        } catch (err) {
            console.error('Fetch tickets error:', err)
        } finally {
            setLoading(false)
        }
    }

    const updateStatus = async (id, status) => {
        try {
            const { error } = await supabaseAdmin
                .from('support_tickets')
                .update({ status })
                .eq('id', id)

            if (error) throw error
            fetchTickets()
        } catch (err) {
            alert('Fail to update status: ' + err.message)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">🆘 Support Tickets</h1>
                    <p className="text-slate-500">Manage help requests from shops</p>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b">
                        <tr>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Shop</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Issue</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            <tr><td colSpan="4" className="px-6 py-10 text-center text-slate-400">Loading tickets...</td></tr>
                        ) : tickets.length === 0 ? (
                            <tr><td colSpan="4" className="px-6 py-10 text-center text-slate-400 font-medium">No tickets found. Good job! ✅</td></tr>
                        ) : tickets.map(t => (
                            <tr key={t.id} className="hover:bg-slate-50 transition">
                                <td className="px-6 py-4">
                                    <p className="font-bold text-slate-800">{t.shops?.name}</p>
                                    <p className="text-[10px] text-slate-400 font-mono italic">{new Date(t.created_at).toLocaleString()}</p>
                                </td>
                                <td className="px-6 py-4">
                                    <p className="font-bold text-slate-700">{t.subject}</p>
                                    <p className="text-xs text-slate-500 max-w-md line-clamp-2">{t.message}</p>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${t.status === 'open' ? 'bg-red-100 text-red-600' :
                                            t.status === 'in_progress' ? 'bg-blue-100 text-blue-600' :
                                                'bg-green-100 text-green-600'
                                        }`}>
                                        {t.status.replace('_', ' ')}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right space-x-2">
                                    {t.status === 'open' && (
                                        <button
                                            onClick={() => updateStatus(t.id, 'in_progress')}
                                            className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-bold uppercase hover:bg-blue-600 hover:text-white transition"
                                        >
                                            Start Work
                                        </button>
                                    )}
                                    {t.status !== 'closed' && (
                                        <button
                                            onClick={() => updateStatus(t.id, 'closed')}
                                            className="px-2 py-1 bg-green-50 text-green-600 rounded text-[10px] font-bold uppercase hover:bg-green-600 hover:text-white transition"
                                        >
                                            Close
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}

export default SupportTickets
