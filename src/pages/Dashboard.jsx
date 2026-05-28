import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { printHTML } from '../utils/printUtils'

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

function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    todaySales: 0,
    todayProfit: 0,
    todayCashSales: 0,
    todayCreditSales: 0,
    monthlySales: 0,
    totalReceivables: 0,
    lowStockCount: 0,
    productCount: 0,
    planInfo: null,
    topDebtors: []
  })
  const [dailyTarget, setDailyTarget] = useState(() => Number(localStorage.getItem('daily_sales_target') || 0))
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [showEOD, setShowEOD] = useState(false)
  const [eodData, setEodData] = useState(null)
  const [eodLoading, setEodLoading] = useState(false)

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
        supabase.from('sales').select('total_amount, discount, payment_type, sale_items(cost_price, quantity, returned_qty)').eq('shop_id', user.shop_id).eq('sale_type', 'sale').gte('created_at', today.toISOString()),
        supabase.from('sales').select('total_amount, discount').eq('shop_id', user.shop_id).eq('sale_type', 'sale').gte('created_at', firstDayOfMonth.toISOString()),
        supabase.from('customers').select('id, name, outstanding_balance').eq('shop_id', user.shop_id),
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

      // Log non-critical errors but don't throw — use empty arrays as fallback
      if (todayRes.error) console.warn('Dashboard: todaySales fetch error', todayRes.error.message)
      if (monthRes.error) console.warn('Dashboard: monthlySales fetch error', monthRes.error.message)
      if (custRes.error) console.warn('Dashboard: customers fetch error', custRes.error.message)

      const todaySalesList = todayRes.data || []
      const todayTotal = todaySalesList.reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const todayCOGS = todaySalesList.reduce((sum, s) =>
        sum + (s.sale_items || []).reduce((iSum, i) => {
          const netQty = Math.max(0, Number(i.quantity || 0) - Number(i.returned_qty || 0))
          return iSum + Number(i.cost_price || 0) * netQty
        }, 0), 0)
      const todayCashSales = todaySalesList.filter(s => s.payment_type === 'cash').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const todayCreditSales = todaySalesList.filter(s => s.payment_type !== 'cash').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const monthlyTotal = (monthRes.data || []).reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)
      const totalReceivables = (custRes.data || []).reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0)
      const productList = prodRes.data || []

      const custList = custRes.data || []
      setStats({
        todaySales: todayTotal,
        todayProfit: todayTotal - todayCOGS,
        todayCashSales,
        todayCreditSales,
        monthlySales: monthlyTotal,
        totalReceivables,
        lowStockCount: productList.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10)).length,
        productCount: productList.length,
        planInfo: config,
        topDebtors: custList.filter(c => Number(c.outstanding_balance) > 0).sort((a, b) => b.outstanding_balance - a.outstanding_balance).slice(0, 5)
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

        // Estimate today's profit from local sale_items
        const todaySaleIds = tSales.map(s => s.id)
        const lItems = await db.sale_items.toArray().catch(() => [])
        const todayItems = lItems.filter(i => todaySaleIds.includes(i.sale_id))
        const todayCOGSOffline = todayItems.reduce((sum, i) => {
          const netQty = Math.max(0, Number(i.quantity || 0) - Number(i.returned_qty || 0))
          return sum + Number(i.cost_price || 0) * netQty
        }, 0)
        const tTotalSales = tSales.reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0)

        setStats({
          todaySales: tTotalSales,
          todayProfit: tTotalSales - todayCOGSOffline,
          todayCashSales: tSales.filter(s => s.payment_type === 'cash').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0),
          todayCreditSales: tSales.filter(s => s.payment_type !== 'cash').reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0),
          monthlySales: mSales.reduce((sum, s) => sum + (Number(s.total_amount) - Number(s.discount || 0)), 0),
          totalReceivables: myCustomers.reduce((sum, c) => sum + Number(c.outstanding_balance || 0), 0),
          lowStockCount: myProducts.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10)).length,
          productCount: myProducts.length,
          planInfo: {
            plan_name: limits.plan_name || 'OFFLINE',
            product_limit: limits.product_limit || 100
          },
          topDebtors: myCustomers.filter(c => Number(c.outstanding_balance) > 0).sort((a, b) => b.outstanding_balance - a.outstanding_balance).slice(0, 5)
        })
      } catch (localError) {
        console.error('Final Dashboard Fallback Error:', localError)
      }
    } finally {
      setLoading(false)
    }
  }

  const openEOD = async () => {
    setEodLoading(true)
    setShowEOD(true)
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const [expRes, purRes] = await Promise.all([
        supabase.from('expenses').select('amount').eq('shop_id', user.shop_id).gte('created_at', today.toISOString()),
        supabase.from('purchases').select('total_amount, payment_type').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())
      ])
      const todayExpenses = (expRes.data || []).reduce((s, e) => s + Number(e.amount || 0), 0)
      const todayCashPurchases = (purRes.data || []).filter(p => p.payment_type === 'cash').reduce((s, p) => s + Number(p.total_amount || 0), 0)
      const todayCreditPurchases = (purRes.data || []).filter(p => p.payment_type !== 'cash').reduce((s, p) => s + Number(p.total_amount || 0), 0)
      setEodData({
        cashSales: stats.todayCashSales,
        creditSales: stats.todayCreditSales,
        totalSales: stats.todaySales,
        profit: stats.todayProfit,
        expenses: todayExpenses,
        cashPurchases: todayCashPurchases,
        creditPurchases: todayCreditPurchases,
        netCash: stats.todayCashSales - todayExpenses - todayCashPurchases
      })
    } catch (e) {
      console.error('EOD fetch error:', e)
    } finally {
      setEodLoading(false)
    }
  }

  const shareEODWhatsApp = () => {
    const d = eodData
    if (!d) return
    const dateStr = new Date().toLocaleDateString('en-PK')
    const sid = user?.shop_id
    const shopName = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'My Shop'
    const msg =
      `🌙 *End of Day — ${dateStr}*\n*${shopName}*\n\n` +
      `💵 Cash Sales: Rs. ${d.cashSales.toLocaleString()}\n` +
      `📒 Credit: Rs. ${d.creditSales.toLocaleString()}\n` +
      `📊 Total Sales: Rs. ${d.totalSales.toLocaleString()}\n\n` +
      `💸 Expenses: Rs. ${d.expenses.toLocaleString()}\n` +
      `📦 Cash Purchases: Rs. ${d.cashPurchases.toLocaleString()}\n\n` +
      `📈 Gross Profit: Rs. ${d.profit.toLocaleString()}\n` +
      `💰 *Net Cash: Rs. ${d.netCash.toLocaleString()}*`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank')
  }

  const printEOD = () => {
    const d = eodData
    if (!d) return
    const dateStr = new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    printHTML(`<html><head><title>End of Day Report</title>
      <style>
        @page{size:80mm auto;margin:2mm}
        *{box-sizing:border-box}
        body{font-family:monospace;width:302px;margin:0 auto;padding:12px 8px;font-size:13px;}
        h2,p.center{text-align:center;margin:2px 0;}
        hr{border-top:1px dashed #000;margin:8px 0;}
        .row{display:flex;justify-content:space-between;padding:4px 0;}
        .bold{font-weight:bold;} .green{color:green;} .red{color:red;} .blue{color:blue;}
      </style></head><body>
      <h2>🌙 End of Day Report</h2>
      <p class="center">${dateStr}</p>
      <hr/>
      <p class="center bold">SALES SUMMARY</p>
      <div class="row"><span>💵 Cash Sales</span><span class="green bold">Rs. ${d.cashSales.toLocaleString()}</span></div>
      <div class="row"><span>📒 Credit (Udhaar)</span><span class="red bold">Rs. ${d.creditSales.toLocaleString()}</span></div>
      <div class="row bold"><span>Total Sales</span><span>Rs. ${d.totalSales.toLocaleString()}</span></div>
      <hr/>
      <p class="center bold">EXPENSES &amp; PURCHASES</p>
      <div class="row"><span>💸 Expenses</span><span class="red">Rs. ${d.expenses.toLocaleString()}</span></div>
      <div class="row"><span>📦 Cash Purchases</span><span class="red">Rs. ${d.cashPurchases.toLocaleString()}</span></div>
      <div class="row"><span>📦 Credit Purchases</span><span>Rs. ${d.creditPurchases.toLocaleString()}</span></div>
      <hr/>
      <div class="row bold"><span>📈 Gross Profit</span><span class="${d.profit >= 0 ? 'green' : 'red'}">Rs. ${d.profit.toLocaleString()}</span></div>
      <div class="row bold" style="font-size:15px;"><span>💰 Net Cash</span><span class="${d.netCash >= 0 ? 'green' : 'red'}">Rs. ${d.netCash.toLocaleString()}</span></div>
      <hr/>
      <p class="center" style="font-size:11px;color:#888;">Generated: ${new Date().toLocaleTimeString('en-PK')}</p>
      </body></html>`)
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Assalam-o-Alaikum, {user.username}! 👋</h1>
          <p className="text-gray-500 mt-1">Today's Summary</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openEOD}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition shadow"
            title="End of Day Summary"
          >
            🌙 Close Day
          </button>
          <button
            onClick={fetchDashboardStats}
            className="p-2 text-gray-400 hover:text-blue-600 transition"
            title="Refresh Stats"
          >
            🔄
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-32 bg-gray-100 rounded-2xl"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            title="Today's Sales (Rs)"
            value={stats.todaySales}
            icon="💰"
            color="text-green-600 bg-green-600"
            subValue="Today"
          />
          <StatCard
            title="Today's Profit (Rs)"
            value={stats.todayProfit}
            icon="📈"
            color="text-emerald-600 bg-emerald-600"
            subValue="Gross"
          />
          <StatCard
            title="Monthly Sales (Rs)"
            value={stats.monthlySales}
            icon="🗓️"
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

      {/* Today's cash vs credit breakdown */}
      {!loading && (stats.todayCashSales > 0 || stats.todayCreditSales > 0) && (
        <div className="flex gap-3 mt-3">
          <div className="flex-1 bg-green-50 border border-green-100 rounded-xl px-4 py-2 flex justify-between items-center">
            <span className="text-sm font-medium text-green-700">💵 Cash Sales</span>
            <span className="font-bold text-green-700">Rs. {stats.todayCashSales.toLocaleString()}</span>
          </div>
          <div className="flex-1 bg-orange-50 border border-orange-100 rounded-xl px-4 py-2 flex justify-between items-center">
            <span className="text-sm font-medium text-orange-700">📒 Credit (Udhaar)</span>
            <span className="font-bold text-orange-700">Rs. {stats.todayCreditSales.toLocaleString()}</span>
          </div>
        </div>
      )}


      {/* Daily Sales Target */}
      <div className="mt-6 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <span className="font-bold text-gray-700 text-sm">Daily Sales Target</span>
          </div>
          {!editingTarget ? (
            <button onClick={() => { setEditingTarget(true); setTargetInput(String(dailyTarget || '')) }}
              className="text-xs text-blue-500 hover:text-blue-700 font-semibold">
              {dailyTarget ? '✏️ Edit' : '+ Set Target'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input type="number" value={targetInput} onChange={e => setTargetInput(e.target.value)}
                className="w-28 px-2 py-1 border rounded-lg text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 50000" autoFocus />
              <button onClick={() => { const t = Number(targetInput) || 0; setDailyTarget(t); localStorage.setItem('daily_sales_target', t); setEditingTarget(false) }}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg font-bold">Save</button>
              <button onClick={() => setEditingTarget(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}
        </div>
        {dailyTarget > 0 ? (() => {
          const pct = Math.min(100, (stats.todaySales / dailyTarget) * 100)
          const color = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-blue-500' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400'
          return (
            <>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className={`h-3 rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between mt-1 text-xs text-gray-500">
                <span>Rs. {stats.todaySales.toLocaleString()} achieved</span>
                <span className={`font-bold ${pct >= 100 ? 'text-green-600' : 'text-gray-600'}`}>
                  {pct >= 100 ? '🎉 Target Hit!' : `${pct.toFixed(0)}% — Rs. ${(dailyTarget - stats.todaySales).toLocaleString()} remaining`}
                </span>
              </div>
            </>
          )
        })() : (
          <p className="text-xs text-gray-400 italic">No target set. Click "+ Set Target" to add a daily goal.</p>
        )}
      </div>

      {/* Top Debtors */}
      {stats.topDebtors.length > 0 && (
        <div className="mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">📒</span>
              <span className="font-bold text-gray-700 text-sm">Top Debtors</span>
            </div>
            <Link to="/customer-ledger" className="text-xs text-blue-500 hover:text-blue-700 font-semibold">View All →</Link>
          </div>
          <div className="space-y-2">
            {stats.topDebtors.map((c, i) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center justify-between hover:bg-gray-50 rounded-lg px-2 py-1.5 transition group">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-gray-300 w-4">{i + 1}</span>
                  <span className="text-sm font-medium text-gray-700 group-hover:text-blue-600">{c.name}</span>
                </div>
                <span className="text-sm font-bold text-red-500">Rs. {Number(c.outstanding_balance).toLocaleString()}</span>
              </Link>
            ))}
          </div>
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

      {/* EOD Modal */}
      {showEOD && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start sm:items-center justify-center z-50 overflow-y-auto py-4 px-2 sm:px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-800">🌙 End of Day Summary</h2>
                <button onClick={() => setShowEOD(false)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
              </div>
              <p className="text-sm text-gray-500 mt-1">{new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

            {eodLoading ? (
              <div className="p-8 text-center text-gray-400">Loading summary...</div>
            ) : eodData ? (
              <div className="p-6 space-y-4">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Sales</p>
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-gray-600">💵 Cash Sales</span><span className="font-bold text-green-600">Rs. {eodData.cashSales.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">📒 Credit (Udhaar)</span><span className="font-bold text-orange-500">Rs. {eodData.creditSales.toLocaleString()}</span></div>
                    <div className="flex justify-between border-t pt-2"><span className="font-semibold text-gray-800">Total Sales</span><span className="font-bold text-gray-800">Rs. {eodData.totalSales.toLocaleString()}</span></div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Outflows</p>
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-gray-600">💸 Expenses</span><span className="font-bold text-red-500">Rs. {eodData.expenses.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">📦 Cash Purchases</span><span className="font-bold text-red-500">Rs. {eodData.cashPurchases.toLocaleString()}</span></div>
                    {eodData.creditPurchases > 0 && <div className="flex justify-between"><span className="text-gray-600">📦 Credit Purchases</span><span className="font-medium text-gray-500">Rs. {eodData.creditPurchases.toLocaleString()}</span></div>}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 border border-gray-100">
                  <div className="flex justify-between">
                    <span className="font-semibold text-gray-700">📈 Gross Profit</span>
                    <span className={`font-bold text-lg ${eodData.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>Rs. {eodData.profit.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-bold text-gray-800">💰 Net Cash in Hand</span>
                    <span className={`font-black text-xl ${eodData.netCash >= 0 ? 'text-green-600' : 'text-red-600'}`}>Rs. {eodData.netCash.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ) : <div className="p-8 text-center text-red-400">Could not load data.</div>}

            <div className="p-4 border-t border-gray-100 flex gap-3">
              {eodData && <button onClick={printEOD} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition">🖨️ Print</button>}
              {eodData && <button onClick={shareEODWhatsApp} className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition">📱 WhatsApp</button>}
              <button onClick={() => setShowEOD(false)} className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard