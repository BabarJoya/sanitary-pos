import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'

const STATUS_STEPS = ['open', 'in_progress', 'closed']
const STATUS_LABEL = { open: 'Submitted', in_progress: 'Working...', closed: 'Resolved' }
const STATUS_ICON  = { open: '📩', in_progress: '🔧', closed: '✅' }
const STATUS_BADGE = {
  open:        'bg-yellow-100 text-yellow-700 border-yellow-200',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  closed:      'bg-green-100 text-green-700 border-green-200',
}

function TicketTimeline({ status }) {
  const activeIdx = STATUS_STEPS.indexOf(status)
  return (
    <div className="flex items-center">
      {STATUS_STEPS.map((step, i) => {
        const done     = i <= activeIdx
        const isActive = i === activeIdx
        return (
          <div key={step} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all
                ${isActive && step !== 'closed'
                  ? 'bg-blue-600 border-blue-600 text-white scale-110 shadow-md shadow-blue-200'
                  : done
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'bg-gray-100 border-gray-200 text-gray-300'}`}>
                {done ? (isActive && step !== 'closed' ? '●' : '✓') : i + 1}
              </div>
              <span className={`text-[9px] mt-1 font-bold uppercase tracking-wide whitespace-nowrap
                ${isActive ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-300'}`}>
                {STATUS_LABEL[step]}
              </span>
            </div>
            {i < STATUS_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mb-4 mx-1 rounded ${i < activeIdx ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Support() {
  const { user } = useAuth()

  // Ticket list state
  const [tickets, setTickets]           = useState([])
  const [loadingTickets, setLoadingTickets] = useState(true)

  // Form state
  const [showForm, setShowForm]   = useState(false)
  const [subject, setSubject]     = useState('')
  const [message, setMessage]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  useEffect(() => {
    fetchMyTickets()
  }, [])

  const fetchMyTickets = async () => {
    setLoadingTickets(true)
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('shop_id', user.shop_id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setTickets(data || [])
    } catch (err) {
      console.error('Fetch tickets error:', err)
    } finally {
      setLoadingTickets(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { error } = await supabase.from('support_tickets').insert([{
        shop_id: user.shop_id,
        subject,
        message,
        status: 'open',
      }])
      if (error) throw error
      setSubmitted(true)
      setSubject('')
      setMessage('')
      fetchMyTickets()
    } catch (err) {
      alert('Failed to send ticket: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const openNewTicket = () => {
    setShowForm(true)
    setSubmitted(false)
  }

  const inProgressCount = tickets.filter(t => t.status === 'in_progress').length

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">🆘 Help & Support</h1>
          <p className="text-gray-500 text-sm mt-0.5">Ticket submit karein ya apna status check karein.</p>
        </div>
        {!showForm && (
          <button
            onClick={openNewTicket}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-lg shadow-blue-100 transition whitespace-nowrap"
          >
            + New Ticket
          </button>
        )}
      </div>

      {/* In-progress alert banner */}
      {inProgressCount > 0 && !showForm && (
        <div className="bg-blue-600 text-white rounded-2xl p-4 flex items-center gap-3 shadow-lg shadow-blue-200">
          <span className="text-2xl animate-bounce">🔧</span>
          <div>
            <p className="font-bold">
              {inProgressCount} ticket{inProgressCount > 1 ? 's' : ''} par kaam ho raha hai!
            </p>
            <p className="text-blue-100 text-xs mt-0.5">
              Hamari team neeche active ticket{inProgressCount > 1 ? 's' : ''} par kaam kar rahi hai. Jald hal hoga.
            </p>
          </div>
        </div>
      )}

      {/* New Ticket Form */}
      {showForm && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          {submitted ? (
            <div className="text-center py-6">
              <div className="text-5xl mb-3">✅</div>
              <h2 className="text-xl font-bold text-green-800 mb-1">Ticket Submit Ho Gaya!</h2>
              <p className="text-green-600 text-sm mb-6">Hamari team jald hi kaam shuru karegi. Neeche apna status track kar saktay hain.</p>
              <button
                onClick={() => { setSubmitted(false); setShowForm(false) }}
                className="px-6 py-2 bg-green-600 text-white rounded-xl font-bold text-sm"
              >
                OK, Dekhein Tickets ↓
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-gray-800">New Support Ticket</h2>
                <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕ Cancel</button>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Unwan (Subject) *</label>
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
                <label className="block text-sm font-bold text-gray-700 mb-1">Message *</label>
                <textarea
                  required
                  rows="4"
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Apni mushkil tafseel se bayan karein..."
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                />
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 flex items-center gap-3">
                <span className="text-lg">📞</span>
                <div>
                  <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Urgent Support?</p>
                  <p className="text-blue-600 font-bold text-sm">Babar Joya: 0301-2616367</p>
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-100 transition disabled:opacity-50"
              >
                {submitting ? 'Bheja ja raha hai...' : 'Ticket Submit Karein'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Tickets List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-gray-800">
            📋 Meri Tickets
            {tickets.length > 0 && (
              <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-xs font-bold">{tickets.length}</span>
            )}
          </h2>
          <button onClick={fetchMyTickets} className="text-xs text-blue-500 hover:text-blue-700 font-bold">⟳ Refresh</button>
        </div>

        {loadingTickets ? (
          <div className="text-center text-gray-400 py-10">
            <div className="text-3xl mb-2 animate-pulse">🔄</div>
            <p>Tickets load ho rahi hain...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-bold text-gray-700">Koi ticket nahi hai!</p>
            <p className="text-gray-400 text-sm mt-1">Koi masla ho to upar "+ New Ticket" press karein.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tickets.map(t => (
              <div
                key={t.id}
                className={`bg-white rounded-2xl border shadow-sm p-5 transition
                  ${t.status === 'in_progress' ? 'border-blue-300 ring-2 ring-blue-100' :
                    t.status === 'closed'       ? 'border-green-200 opacity-80' :
                                                  'border-gray-100'}`}
              >
                {/* Ticket header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 leading-tight">{t.subject}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5 font-mono">
                      #{String(t.id).slice(-6).toUpperCase()} · {new Date(t.created_at).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-[11px] font-bold border flex-shrink-0 ${STATUS_BADGE[t.status]}`}>
                    {STATUS_ICON[t.status]} {STATUS_LABEL[t.status]}
                  </span>
                </div>

                {/* Original message */}
                <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3 mb-4 line-clamp-2 italic">
                  "{t.message}"
                </p>

                {/* Status timeline */}
                <TicketTimeline status={t.status} />

                {/* Status-specific banners */}
                {t.status === 'in_progress' && (
                  <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex items-start gap-3">
                    <span className="text-xl animate-pulse mt-0.5">🔧</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-blue-700 text-sm font-bold">Hamari team kaam kar rahi hai!</p>
                      <p className="text-blue-500 text-xs mt-0.5">Is ticket par actively kaam ho raha hai. Thodi dair mein hal ho jayega.</p>
                      {t.admin_reply && (
                        <div className="mt-2 bg-white border border-blue-200 rounded-lg px-3 py-2">
                          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-1">💬 Support Team:</p>
                          <p className="text-sm text-gray-700">{t.admin_reply}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {t.status === 'closed' && (
                  <div className="mt-4 bg-green-50 border border-green-100 rounded-xl px-4 py-3 flex items-start gap-3">
                    <span className="text-xl mt-0.5">✅</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-green-700 text-sm font-bold">Ticket hal ho gaya!</p>
                      <p className="text-green-500 text-xs mt-0.5">Agar masla dobara aaye to naya ticket submit karein.</p>
                      {t.admin_reply && (
                        <div className="mt-2 bg-white border border-green-200 rounded-lg px-3 py-2">
                          <p className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-1">💬 Support Team:</p>
                          <p className="text-sm text-gray-700">{t.admin_reply}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {t.status === 'open' && (
                  <div className="mt-4 bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 flex items-center gap-3">
                    <span className="text-xl">⏳</span>
                    <div>
                      <p className="text-yellow-700 text-sm font-bold">Queue mein hai</p>
                      <p className="text-yellow-500 text-xs mt-0.5">Hamari team ne ticket receive kar li hai. Jald kaam shuru hoga.</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contact card (bottom) */}
      {!showForm && (
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl p-5 flex items-center gap-4 shadow-lg shadow-blue-200">
          <span className="text-3xl">📞</span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-100">Urgent / Direct Support</p>
            <p className="text-lg font-black">Babar Joya: 0301-2616367</p>
            <p className="text-blue-200 text-xs mt-0.5">Zabardast mushkil ho to seedha call karein.</p>
          </div>
        </div>
      )}

    </div>
  )
}

export default Support
