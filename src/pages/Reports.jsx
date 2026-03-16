import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { db } from '../services/db'

function Reports() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('month') // today, week, month, all

  const [stats, setStats] = useState({
    grossSales: 0,
    costOfSales: 0,
    grossProfit: 0,
    expenses: 0,
    netProfit: 0,
    totalDiscount: 0,
    purchases: 0
  })

  const [topProducts, setTopProducts] = useState([])
  const [expenseBreakdown, setExpenseBreakdown] = useState([])
  const [salesTrend, setSalesTrend] = useState([])
  const [categoryData, setCategoryData] = useState([])

  useEffect(() => {
    if (user?.shop_id) fetchReportData()
  }, [range, user?.shop_id])

  const fetchReportData = async () => {
    setLoading(true)

    let startDate = new Date()
    startDate.setHours(0, 0, 0, 0)

    if (range === 'week') startDate.setDate(startDate.getDate() - 7)
    else if (range === 'month') startDate.setDate(1) // First of current month
    else if (range === 'year') startDate = new Date(new Date().getFullYear(), 0, 1) // First of current year
    else if (range === 'all') startDate = new Date(2000, 0, 1)

    const startISO = startDate.toISOString()

    try {
      if (!navigator.onLine) throw new Error('Offline')

      // Parallel fetching
      const fetchPromise = Promise.all([
        supabase.from('sales').select('*').eq('shop_id', user.shop_id).eq('sale_type', 'sale').gte('created_at', startISO),
        supabase.from('sale_items').select('*, sales!inner(created_at, sale_type, shop_id)').eq('sales.shop_id', user.shop_id).eq('sales.sale_type', 'sale').gte('sales.created_at', startISO),
        supabase.from('expenses').select('*').eq('shop_id', user.shop_id).gte('created_at', startISO),
        supabase.from('purchases').select('*').eq('shop_id', user.shop_id).gte('created_at', startISO)
      ])

      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const [salesRes, itemsRes, expensesRes, purchasesRes] = await Promise.race([fetchPromise, timeoutPromise])

      const sales = salesRes.data || []
      const items = itemsRes.data || []
      const expenses = expensesRes.data || []
      const purchases = purchasesRes.data || []

      // Cache for offline use
      if (salesRes.data) await db.sales.bulkPut(JSON.parse(JSON.stringify(salesRes.data)))
      if (itemsRes.data) await db.sale_items.bulkPut(JSON.parse(JSON.stringify(itemsRes.data)))
      if (expensesRes.data) await db.expenses.bulkPut(JSON.parse(JSON.stringify(expensesRes.data)))
      if (purchasesRes.data) await db.purchases.bulkPut(JSON.parse(JSON.stringify(purchasesRes.data)))

      // Calculations
      const grossSales = sales.reduce((sum, s) => sum + Number(s.total_amount), 0)
      const totalDiscount = sales.reduce((sum, s) => sum + Number(s.discount || 0), 0)

      // Net Sales (sales after individual items, but here total_amount usually includes items - discounts)
      // Actually in our POS, total_amount is sum(item_totals) and then we subtract a global discount.
      const netSalesValue = grossSales - totalDiscount

      const costOfSales = items.reduce((sum, i) => {
        const qty = Number(i.quantity) - Number(i.returned_qty || 0)
        return sum + (Number(i.cost_price || 0) * qty)
      }, 0)

      const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
      const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.total_amount), 0)

      const grossProfit = netSalesValue - costOfSales
      const netProfit = grossProfit - totalExpenses

      setStats({
        grossSales,
        costOfSales,
        grossProfit,
        expenses: totalExpenses,
        netProfit,
        totalDiscount,
        purchases: totalPurchases
      })

      // Top Products
      const prodMap = {}
      items.forEach(i => {
        const qty = Number(i.quantity) - Number(i.returned_qty || 0)
        if (qty <= 0) return
        if (!prodMap[i.product_name]) prodMap[i.product_name] = { name: i.product_name, qty: 0, revenue: 0 }
        prodMap[i.product_name].qty += qty
        prodMap[i.product_name].revenue += (qty * Number(i.unit_price))
      })
      const sortedProds = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5)
      setTopProducts(sortedProds)

      // Expense Breakdown
      const expMap = {}
      expenses.forEach(e => {
        if (!expMap[e.category]) expMap[e.category] = 0
        expMap[e.category] += Number(e.amount)
      })
      setExpenseBreakdown(Object.entries(expMap).map(([cat, val]) => ({ cat, val })).sort((a, b) => b.val - a.val))

      // Sales Trend (Line Chart)
      const trendMap = {}
      sales.forEach(s => {
        const date = new Date(s.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })
        trendMap[date] = (trendMap[date] || 0) + Number(s.total_amount)
      })
      setSalesTrend(Object.entries(trendMap).map(([date, amount]) => ({ date, amount })))

      // Category Distribution (Pie Chart)
      const catMap = {}
      items.forEach(i => {
        const catName = i.products?.categories?.name || 'Uncategorized'
        const profit = (Number(i.unit_price) - Number(i.cost_price || 0)) * (Number(i.quantity) - Number(i.returned_qty || 0))
        catMap[catName] = (catMap[catName] || 0) + profit
      })
      setCategoryData(Object.entries(catMap).map(([name, value]) => ({ name, value })).filter(c => c.value > 0))
    } catch (e) {
      console.log('Reports: Offline mode, calculating from local DB...')
      try {
        const sid = String(user.shop_id)
        const [lSales, lItems, lExpenses, lPurchases, lProducts, lCats] = await Promise.all([
          db.sales.toArray(),
          db.sale_items.toArray(),
          db.expenses.toArray(),
          db.purchases.toArray(),
          db.products.toArray(),
          db.categories.toArray()
        ])

        const sales = lSales.filter(x => String(x.shop_id) === sid && x.sale_type === 'sale' && new Date(x.created_at) >= startDate)
        const saleIds = new Set(sales.map(s => s.id))
        const items = lItems.filter(i => saleIds.has(i.sale_id))
        const expenses = lExpenses.filter(x => String(x.shop_id) === sid && new Date(x.created_at) >= startDate)
        const purchases = lPurchases.filter(x => String(x.shop_id) === sid && new Date(x.created_at) >= startDate)

        // Totals
        const grossSales = sales.reduce((sum, s) => sum + Number(s.total_amount), 0)
        const totalDiscount = sales.reduce((sum, s) => sum + Number(s.discount || 0), 0)
        const netSalesValue = grossSales - totalDiscount
        const costOfSales = items.reduce((sum, i) => sum + (Number(i.cost_price || 0) * (Number(i.quantity) - Number(i.returned_qty || 0))), 0)
        const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
        const totalPurchases = purchases.reduce((sum, p) => sum + Number(p.total_amount), 0)

        setStats({
          grossSales, costOfSales, grossProfit: netSalesValue - costOfSales,
          expenses: totalExpenses, netProfit: (netSalesValue - costOfSales) - totalExpenses,
          totalDiscount, purchases: totalPurchases
        })

        // Top Products
        const prodMap = {}
        items.forEach(i => {
          const qty = Number(i.quantity) - Number(i.returned_qty || 0)
          if (qty <= 0) return
          if (!prodMap[i.product_name]) prodMap[i.product_name] = { name: i.product_name, qty: 0, revenue: 0 }
          prodMap[i.product_name].qty += qty
          prodMap[i.product_name].revenue += (qty * Number(i.unit_price))
        })
        setTopProducts(Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 5))

        // Expenses
        const expMap = {}
        expenses.forEach(e => {
          if (!expMap[e.category]) expMap[e.category] = 0
          expMap[e.category] += Number(e.amount)
        })
        setExpenseBreakdown(Object.entries(expMap).map(([cat, val]) => ({ cat, val })).sort((a, b) => b.val - a.val))

        // Category Pie
        const catMap = {}
        items.forEach(i => {
          const prod = lProducts.find(p => p.id === i.product_id)
          const cat = lCats.find(c => c.id === prod?.category_id)
          const catName = cat?.name || 'Uncategorized'
          const profit = (Number(i.unit_price) - Number(i.cost_price || 0)) * (Number(i.quantity) - Number(i.returned_qty || 0))
          catMap[catName] = (catMap[catName] || 0) + profit
        })
        setCategoryData(Object.entries(catMap).map(([name, value]) => ({ name, value })).filter(c => c.value > 0))

        // Trend
        const trendMap = {}
        sales.forEach(s => {
          const date = new Date(s.created_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })
          trendMap[date] = (trendMap[date] || 0) + Number(s.total_amount)
        })
        setSalesTrend(Object.entries(trendMap).map(([date, amount]) => ({ date, amount })))

      } catch (err) {
        console.error('Final Reports Fallback Error:', err)
      } finally {
        setLoading(false)
      }
    } finally {
      setLoading(false)
    }
  }

  const handlePrintSummary = () => {
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>Business Report - ${range.toUpperCase()}</title>
      <style>
        body { font-family: sans-serif; padding: 30px; line-height: 1.6; }
        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 20px; }
        .stat-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .stat-item { border: 1px solid #ddd; padding: 15px; border-radius: 8px; }
        .stat-label { color: #666; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .stat-value { font-size: 20px; font-weight: bold; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border-bottom: 1px solid #eee; padding: 12px; text-align: left; }
        th { color: #666; font-size: 12px; }
        .total-box { background: #f9f9f9; padding: 20px; border-radius: 8px; margin-top: 20px; border: 1px solid #eee; }
        .total-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
        .final-profit { border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; font-size: 22px; font-weight: bold; }
      </style></head><body>
      <div class="header">
        <h1>Business Performance Report</h1>
        <p>Period: ${range.toUpperCase()} | Date: ${new Date().toLocaleDateString()}</p>
      </div>

      <div class="stat-grid">
        <div class="stat-item">
          <div class="stat-label">Gross Sales</div>
          <div class="stat-value">Rs. ${stats.grossSales.toLocaleString()}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Total Discounts</div>
          <div class="stat-value">Rs. ${stats.totalDiscount.toLocaleString()}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Cost of Goods Sold</div>
          <div class="stat-value">Rs. ${stats.costOfSales.toLocaleString()}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Operating Expenses</div>
          <div class="stat-value">Rs. ${stats.expenses.toLocaleString()}</div>
        </div>
      </div>

      <div class="total-box">
        <div class="total-row"><span>Gross Profit</span><span>Rs. ${stats.grossProfit.toLocaleString()}</span></div>
        <div class="total-row"><span>Purchases (Stock In)</span><span>Rs. ${stats.purchases.toLocaleString()}</span></div>
        <div class="final-profit"><span>Net Business Profit:</span><span>Rs. ${stats.netProfit.toLocaleString()}</span></div>
      </div>

      <h2>Top Products</h2>
      <table>
        <thead><tr><th>Product Name</th><th>Qty</th><th>Revenue</th></tr></thead>
        <tbody>
          ${topProducts.map(p => `<tr><td>${p.name}</td><td>${p.qty}</td><td>Rs. ${p.revenue.toLocaleString()}</td></tr>`).join('')}
        </tbody>
      </table>
      </body></html>
    `)
    win.document.close()
    win.print()
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">📊 Business Analytics</h1>
          <p className="text-gray-500 text-sm">Profit, Loss and Sales performance</p>
        </div>
        <div className="flex bg-white rounded-xl shadow-sm border p-1">
          {['today', 'week', 'month', 'year', 'all'].map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition ${range === r ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={handlePrintSummary}
          className="ml-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition font-bold text-sm shadow-sm flex items-center gap-2"
        >
          🖨️ Print Summary
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-gray-400 animate-pulse text-lg">Calculating statistics...</div>
      ) : (
        <>
          {/* Main Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Gross Sales" value={stats.grossSales} sub={`Disc: Rs. ${stats.totalDiscount}`} color="blue" />
            <StatCard title="Cost of Goods" value={stats.costOfSales} sub="Purchase value of sold items" color="orange" />
            <StatCard title="Gross Profit" value={stats.grossProfit} sub="Sales - Cost of Goods" color="emerald" />
            <StatCard title="Net Profit" value={stats.netProfit} sub="Gross Profit - Expenses" color="indigo" highlight />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales Trend Chart */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
                Sales Trend
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={salesTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      itemStyle={{ color: '#2563eb', fontWeight: 'bold' }}
                    />
                    <Line type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={3} dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Category Pie Chart */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                <span className="w-2 h-6 bg-purple-600 rounded-full"></span>
                Profit by Category
              </h3>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'][index % 5]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Net Breakdown */}
            <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-bold text-gray-800 mb-6 flex items-center gap-2">
                <span className="w-2 h-6 bg-blue-600 rounded-full"></span>
                Detailed Summary
              </h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-dashed">
                  <span className="text-gray-600">Total Sales (Inc. Discount)</span>
                  <span className="font-bold">Rs. {stats.grossSales.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-dashed">
                  <span className="text-gray-600">Total Discounts Given</span>
                  <span className="font-bold text-red-500">- Rs. {stats.totalDiscount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-dashed">
                  <span className="text-gray-600 font-bold">Net Sales Value</span>
                  <span className="font-bold text-blue-600">Rs. {(stats.grossSales - stats.totalDiscount).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-dashed">
                  <span className="text-gray-600">Cost of Goods Sold (COGS)</span>
                  <span className="font-bold text-orange-600">- Rs. {stats.costOfSales.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-dashed">
                  <span className="text-gray-600 font-bold text-lg">Gross Profit</span>
                  <span className="font-bold text-emerald-600 text-lg">Rs. {stats.grossProfit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pb-2 border-b border-dashed">
                  <span className="text-gray-600">Total Operating Expenses</span>
                  <span className="font-bold text-red-500">- Rs. {stats.expenses.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pt-2">
                  <span className="text-xl font-black text-gray-800 uppercase tracking-tight">Net Business Profit</span>
                  <span className={`text-2xl font-black ${stats.netProfit >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    Rs. {stats.netProfit.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Expenses Side */}
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="font-bold text-gray-800 mb-4">Expense Breakdown</h3>
                <div className="space-y-3">
                  {expenseBreakdown.map(e => (
                    <div key={e.cat} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 font-medium">{e.cat}</span>
                        <span className="font-bold">Rs. {e.val.toLocaleString()}</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-400"
                          style={{ width: `${(e.val / stats.expenses) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  ))}
                  {expenseBreakdown.length === 0 && <p className="text-center text-gray-400 py-4 text-sm italic">No expenses in this period</p>}
                </div>
              </div>

              <div className="bg-blue-600 rounded-2xl shadow-lg p-6 text-white">
                <h3 className="font-bold mb-1">New Purchases</h3>
                <p className="text-xs text-blue-100 mb-4">Inventory added in this period</p>
                <p className="text-2xl font-black">Rs. {stats.purchases.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Top Products */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-bold text-gray-800 mb-6">Top Selling Products (by Revenue)</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-widest border-b">
                    <th className="pb-3">Product Name</th>
                    <th className="pb-3 text-center">Qty Sold</th>
                    <th className="pb-3 text-right">Revenue</th>
                    <th className="pb-3 text-right">Weightage</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {topProducts.map(p => (
                    <tr key={p.name} className="hover:bg-gray-50 group transition">
                      <td className="py-4 font-bold text-gray-700">{p.name}</td>
                      <td className="py-4 text-center font-medium text-gray-500">{p.qty}</td>
                      <td className="py-4 text-right font-black text-gray-800">Rs. {p.revenue.toLocaleString()}</td>
                      <td className="py-4 text-right">
                        <span className="px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-bold rounded">
                          {((p.revenue / (stats.grossSales || 1)) * 100).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                  {topProducts.length === 0 && <tr><td colSpan="4" className="py-10 text-center text-gray-400 italic">No sales recorded</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ title, value, sub, color, highlight }) {
  const colors = {
    blue: 'border-blue-100 text-blue-600',
    orange: 'border-orange-100 text-orange-600',
    emerald: 'border-emerald-100 text-emerald-600',
    indigo: 'border-indigo-100 text-indigo-700 bg-indigo-50'
  }

  return (
    <div className={`bg-white p-5 rounded-2xl shadow-sm border ${colors[color] || 'border-gray-100'} ${highlight ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}>
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">{title}</p>
      <p className="text-2xl font-black">Rs. {value.toLocaleString()}</p>
      <p className="text-[10px] text-gray-400 mt-1 font-medium">{sub}</p>
    </div>
  )
}

export default Reports
