import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, supabaseAdmin } from '../services/supabase'
import { Store, Users, Activity, TrendingUp, CreditCard, DollarSign, AlertCircle, Megaphone, Trash2, Plus, Clock } from 'lucide-react'

export default function Dashboard() {
  const [stats, setStats] = useState({ shops: 0, users: 0, activeShops: 0, mrr: 0, totalRevenue: 0, overdue: 0, onTrial: 0, gmv: 0, activeToday: 0 })
  const [announcements, setAnnouncements] = useState([])
  const [upcomingRenewals, setUpcomingRenewals] = useState([])
  const [newAnnouncement, setNewAnnouncement] = useState({ message: '', type: 'info' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    if (!supabaseAdmin) {
      setError('Please add VITE_SUPABASE_SERVICE_ROLE_KEY to your .env to fetch global stats.')
      setLoading(false)
      return
    }

    try {
      const [shopsRes, usersRes, paymentsRes, salesRes] = await Promise.all([
        supabaseAdmin.from('shops').select('id, name, status, subscription_plan, subscription_fee, next_billing_date'),
        supabaseAdmin.from('users').select('id', { count: 'exact' }),
        supabaseAdmin.from('shop_payments').select('amount'),
        supabaseAdmin.from('sales').select('total_amount, created_at, shop_id')
      ])

      const shops = shopsRes.data || []
      const totalShops = shops.length
      const activeShops = shops.filter(s => s.status === 'active').length
      const totalUsers = usersRes.count || usersRes.data?.length || 0

      let mrr = 0
      let overdue = 0
      let onTrial = 0
      const today = new Date()

      shops.forEach(s => {
        if (s.status === 'active' && s.subscription_plan) {
          if (s.subscription_plan === 'monthly') mrr += Number(s.subscription_fee || 0)
          if (s.subscription_plan === 'annually') mrr += Number(s.subscription_fee || 0) / 12
          if (s.subscription_plan === 'trial') onTrial++
        }

        if (s.next_billing_date && new Date(s.next_billing_date) < today) {
          overdue++
        }
      })

      // Upcoming Renewals (Next 7 days)
      const sevenDaysFromNow = new Date()
      sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7)

      const upcoming = shops.filter(s => {
        if (!s.next_billing_date || s.status !== 'active') return false
        const expiry = new Date(s.next_billing_date)
        return expiry >= today && expiry <= sevenDaysFromNow
      }).sort((a, b) => new Date(a.next_billing_date) - new Date(b.next_billing_date))

      setUpcomingRenewals(upcoming)

      const totalRevenue = (paymentsRes.data || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)

      let gmv = 0;
      let activeShopsSet = new Set();
      const todayString = today.toISOString().split('T')[0];

      (salesRes.data || []).forEach(s => {
        gmv += Number(s.total_amount || 0);
        if (s.created_at && s.created_at.startsWith(todayString)) {
          activeShopsSet.add(s.shop_id);
        }
      });

      setStats({
        shops: totalShops,
        activeShops,
        users: totalUsers,
        mrr: Math.round(mrr),
        totalRevenue,
        overdue,
        onTrial,
        gmv: Math.round(gmv),
        activeToday: activeShopsSet.size
      })

      // Fetch Announcements
      const { data: annData } = await supabaseAdmin
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
      setAnnouncements(annData || [])

    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePostAnnouncement = async (e) => {
    e.preventDefault()
    if (!newAnnouncement.message.trim()) return

    try {
      const { error } = await supabaseAdmin.from('announcements').insert([{
        message: newAnnouncement.message,
        type: newAnnouncement.type,
        is_active: true
      }])
      if (error) throw error
      setNewAnnouncement({ message: '', type: 'info' })
      fetchStats()
    } catch (err) {
      alert('Error posting announcement: ' + err.message)
    }
  }

  const handleDeleteAnnouncement = async (id) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return
    try {
      await supabaseAdmin.from('announcements').delete().eq('id', id)
      fetchStats()
    } catch (err) {
      alert('Error deleting announcement')
    }
  }

  if (error) return <div className="p-8 text-red-600 bg-red-50 rounded-2xl font-bold">{error}</div>
  if (loading) return <div className="animate-pulse flex gap-4"><div className="h-32 w-1/4 bg-slate-200 rounded-2xl"></div></div>

  const cards = [
    { title: 'Total Registered Shops', value: stats.shops, icon: <Store size={24} className="text-blue-500" />, bg: 'bg-blue-50' },
    { title: 'Active Subscriptions', value: stats.activeShops, icon: <Activity size={24} className="text-emerald-500" />, bg: 'bg-emerald-50' },
    { title: 'Total Platform Users', value: stats.users, icon: <Users size={24} className="text-purple-500" />, bg: 'bg-purple-50' },
    { title: 'Shops Active Today', value: stats.activeToday, icon: <Activity size={24} className="text-indigo-500" />, bg: 'bg-indigo-50' },
    { title: 'Global Platform GMV', value: `Rs. ${stats.gmv.toLocaleString()}`, icon: <TrendingUp size={24} className="text-emerald-500" />, bg: 'bg-emerald-50' },
    { title: 'Clients on Trial', value: stats.onTrial, icon: <Clock size={24} className="text-orange-500" />, bg: 'bg-orange-50' },
    { title: 'Overdue Accounts', value: stats.overdue, icon: <AlertCircle size={24} className="text-red-500" />, bg: 'bg-red-50' },
    { title: 'Monthly Recurring Rev.', value: `Rs. ${stats.mrr.toLocaleString()}`, icon: <TrendingUp size={24} className="text-emerald-500" />, bg: 'bg-emerald-50' },
    { title: 'Total Revenue Collected', value: `Rs. ${stats.totalRevenue.toLocaleString()}`, icon: <DollarSign size={24} className="text-blue-500" />, bg: 'bg-blue-50' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {cards.map((c, i) => (
          <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4">
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 ${c.bg}`}>
              {c.icon}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{c.title}</p>
              <h3 className="text-3xl font-black text-slate-800 mt-1">{c.value}</h3>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-8">
        <div className="lg:col-span-4 bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Welcome, Superadmin</h2>
          <p className="text-slate-500 mb-6 text-sm">
            Manage your POS platform, monitor GMV, and handle shop subscriptions from one central dashboard.
          </p>

          <div className="bg-blue-50/50 p-6 rounded-xl border border-blue-100">
            <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2 text-sm"><Activity size={18} /> Quick Tips</h3>
            <ul className="text-xs text-blue-800 space-y-2 list-disc list-inside">
              <li>Billing stats update automatically.</li>
              <li>Past-due shops are auto-suspended.</li>
              <li>Global announcements sync to all POS screens.</li>
            </ul>
          </div>

          <Link
            to="/analytics"
            className="mt-6 flex items-center justify-center gap-2 w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-sm hover:bg-black transition-all shadow-lg shadow-slate-200"
          >
            <TrendingUp size={18} /> View Detailed Analytics
          </Link>
        </div>

        <div className="lg:col-span-3 bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
              <Clock size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Renewals</h2>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Next 7 Days</p>
            </div>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
            {upcomingRenewals.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm italic">No renewals due this week</p>
            ) : (
              upcomingRenewals.map(shop => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const expiry = new Date(shop.next_billing_date);
                const daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
                return (
                  <div key={shop.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex justify-between items-center hover:bg-slate-50 transition">
                    <div>
                      <p className="font-bold text-slate-800 text-xs">{shop.name}</p>
                      <p className="text-[9px] text-slate-500 uppercase font-black tracking-widest">{shop.subscription_plan}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-[10px] font-black ${daysLeft <= 2 ? 'text-red-500' : 'text-orange-500'}`}>
                        {daysLeft === 0 ? 'Expires Today' : `In ${daysLeft} Day${daysLeft > 1 ? 's' : ''}`}
                      </p>
                      <p className="text-[9px] text-slate-400">{expiry.toLocaleDateString()}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white rounded-2xl p-8 shadow-sm border border-slate-100 flex flex-col">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-orange-100 p-2 rounded-lg text-orange-600">
              <Megaphone size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">Global Announcements</h2>
              <p className="text-xs text-slate-500">Broadcast messages to all active client POS screens</p>
            </div>
          </div>

          <form onSubmit={handlePostAnnouncement} className="mb-6 flex gap-2">
            <select
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={newAnnouncement.type}
              onChange={e => setNewAnnouncement({ ...newAnnouncement, type: e.target.value })}
            >
              <option value="info">Info (Blue)</option>
              <option value="warning">Warning (Orange)</option>
              <option value="error">Critical (Red)</option>
              <option value="success">Success (Green)</option>
            </select>
            <input
              type="text"
              required
              className="flex-1 border border-slate-200 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Type announcement message..."
              value={newAnnouncement.message}
              onChange={e => setNewAnnouncement({ ...newAnnouncement, message: e.target.value })}
            />
            <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition">
              <Plus size={18} /> Post
            </button>
          </form>

          <div className="flex-1 overflow-y-auto min-h-[200px] border border-slate-100 rounded-xl bg-slate-50 p-4">
            {announcements.length === 0 ? (
              <p className="text-center text-slate-400 py-8 text-sm">No active announcements</p>
            ) : (
              <div className="space-y-3">
                {announcements.map(ann => (
                  <div key={ann.id} className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${ann.type === 'error' ? 'bg-red-100 text-red-700' :
                          ann.type === 'warning' ? 'bg-orange-100 text-orange-700' :
                            ann.type === 'success' ? 'bg-emerald-100 text-emerald-700' :
                              'bg-blue-100 text-blue-700'
                          }`}>
                          {ann.type}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(ann.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-slate-800">{ann.message}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteAnnouncement(ann.id)}
                      className="text-slate-400 hover:text-red-500 transition self-start p-1"
                      title="Delete Announcement"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
