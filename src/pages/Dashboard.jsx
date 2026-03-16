import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'

function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    todaySales: 0,
    monthlySales: 0,
    totalReceivables: 0,
    lowStockCount: 0,
    productCount: 0,
    planInfo: null
  })

  useEffect(() => {
    if (user?.shop_id) fetchDashboardStats()
  }, [user?.shop_id])

  const fetchDashboardStats = async () => {
    setLoading(true)
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

      const fetchPromise = Promise.all([
        supabase.from('sales').select('total_amount, discount').eq('shop_id', user.shop_id).eq('sale_type', 'sale').gte('created_at', today.toISOString()),
        supabase.from('sales').select('total_amount, discount').eq('shop_id', user.shop_id).eq('sale_type', 'sale').gte('created_at', firstDayOfMonth.toISOString()),
        supabase.from('customers').select('outstanding_balance').eq('shop_id', user.shop_id),
        supabase.from('products').select('id, stock_quantity, low_stock_threshold').eq('shop_id', user.shop_id),
        supabase.rpc('get_shop_config', { p_shop_id: user.shop_id })
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000))
      const [todayRes, monthRes, custRes, prodRes, shopConfigRes] = await Promise.race([fetchPromise, timeoutPromise])

      const config = shopConfigRes.data || {}
      if (config.status === 'suspended' && !user.isImpersonating) {
        alert('Aap ka account fee na-adaiyegy ki wajah se muattal (suspended) kar diya gaya hai. Log out kiya ja raha hai.')
        logout()
        navigate('/')
        return
      }

      // Update local limits cache
      localStorage.setItem('plan_limits', JSON.stringify({
        product_limit: config.product_limit || 100,
        user_limit: config.user_limit || 3,
        plan_name: config.plan_name || 'TRIAL'
      }))

      if (todayRes.error || monthRes.error || custRes.error) throw new Error('Fetch failed')

      const todayTotal = (todayRes.data || []).reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const monthlyTotal = (monthRes.data || []).reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const totalReceivables = (custRes.data || []).reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0)
      const productList = prodRes.data || []

      setStats({
        todaySales: todayTotal,
        monthlySales: monthlyTotal,
        totalReceivables,
        lowStockCount: productList.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10)).length,
        productCount: productList.length,
        planInfo: config
      })
    } catch (err) {
      console.log('Dashboard: Calculating stats from local DB (Offline)')
      try {
        const sid = String(user.shop_id)
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

        const [lSales, lCustomers, lProducts] = await Promise.all([
          db.sales.where('shop_id').equals(parseInt(sid) || sid).toArray().catch(() => db.sales.toArray()),
          db.customers.where('shop_id').equals(parseInt(sid) || sid).toArray().catch(() => db.customers.toArray()),
          db.products.where('shop_id').equals(parseInt(sid) || sid).toArray().catch(() => db.products.toArray())
        ])

        const limits = JSON.parse(localStorage.getItem('plan_limits') || '{}')

        // Safe filtering
        const mySales = lSales.filter(x => String(x.shop_id) === sid && x.sale_type === 'sale')
        const myCustomers = lCustomers.filter(x => String(x.shop_id) === sid)
        const myProducts = lProducts.filter(x => String(x.shop_id) === sid)

        const tSales = mySales.filter(s => new Date(s.created_at) >= today)
        const mSales = mySales.filter(s => new Date(s.created_at) >= firstDayOfMonth)

        setStats({
          todaySales: tSales.reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0),
          monthlySales: mSales.reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0),
          totalReceivables: myCustomers.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0),
          lowStockCount: myProducts.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10)).length,
          productCount: myProducts.length,
          planInfo: {
            plan_name: limits.plan_name || 'OFFLINE',
            product_limit: limits.product_limit || 100
          }
        })
      } catch (localError) {
        console.error('Final Dashboard Fallback Error:', localError)
      }
    } finally {
      setLoading(false)
    }
  }

  const StatCard = ({ title, value, icon, color, subValue }) => (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-xl ${color} bg-opacity-10 text-xl`}>
          {icon}
        </div>
        {subValue && <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{subValue}</span>}
      </div>
      <h3 className="text-gray-500 text-sm font-medium">{title}</h3>
      <p className="text-2xl font-bold text-gray-800 mt-1">
        {typeof value === 'number' && title.includes('Rs') ? `Rs. ${value.toLocaleString()}` : value}
      </p>
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Assalam-o-Alaikum, {user.username}! 👋</h1>
          <p className="text-gray-500 mt-1">Today's Summary</p>
        </div>
        <button
          onClick={fetchDashboardStats}
          className="p-2 text-gray-400 hover:text-blue-600 transition"
          title="Refresh Stats"
        >
          🔄
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-2xl"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Today's Sales (Rs)"
            value={stats.todaySales}
            icon="💰"
            color="text-green-600 bg-green-600"
            subValue="Today"
          />
          <StatCard
            title="Monthly Sales (Rs)"
            value={stats.monthlySales}
            icon="📈"
            color="text-blue-600 bg-blue-600"
            subValue="This Month"
          />
          <StatCard
            title="Total Receivables (Rs)"
            value={stats.totalReceivables}
            icon="📒"
            color="text-orange-600 bg-orange-600"
            subValue="Pending"
          />
          <StatCard
            title="Low Stock Products"
            value={stats.lowStockCount}
            icon="⚠️"
            color="text-red-600 bg-red-600"
            subValue="Alert"
          />
        </div>
      )}


      <div className="mt-10">
        <h2 className="text-xl font-bold text-gray-800 mb-6">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/pos" className="flex flex-col items-center p-6 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition shadow-lg shadow-blue-200">
            <span className="text-3xl mb-2">🛒</span>
            <span className="font-bold">New Sale</span>
          </Link>
          <Link to="/customers" className="flex flex-col items-center p-6 bg-white border border-gray-200 text-gray-700 rounded-2xl hover:bg-gray-50 transition shadow-sm">
            <span className="text-3xl mb-2">👥</span>
            <span className="font-bold">Customers</span>
          </Link>
          <Link to="/sales" className="flex flex-col items-center p-6 bg-white border border-gray-200 text-gray-700 rounded-2xl hover:bg-gray-50 transition shadow-sm">
            <span className="text-3xl mb-2">📜</span>
            <span className="font-bold">Sales History</span>
          </Link>
          <Link to="/products" className="flex flex-col items-center p-6 bg-white border border-gray-200 text-gray-700 rounded-2xl hover:bg-gray-50 transition shadow-sm">
            <span className="text-3xl mb-2">📦</span>
            <span className="font-bold">Inventory</span>
          </Link>
        </div>
      </div>

      {/* Visual background element */}
      <div className="fixed top-0 right-0 -z-10 opacity-5 pointer-events-none">
        <span className="text-[400px]">🔧</span>
      </div>
    </div>
  )
}

export default Dashboard