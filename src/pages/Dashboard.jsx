import { useEffect, useState } from 'react'
import { Modal } from '../components/ui'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { fetchAllRows } from '../services/fetchAll'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'
import { printHTML, getShopBranding } from '../utils/printUtils'
import { getShopSettings, isWholesaleEnabled } from '../utils/businessPresets'
import { summarizeSales, summarizeCashBook, isCompletedSale, periodStart, applyReturns } from '../utils/salesSummary'
import { isLowStock } from '../utils/stockRules'
import { todayLocal } from '../utils/dates'
import { useLang } from '../context/LanguageContext'
import { txMaybeAvailable } from '../services/integrity'
import { openWhatsApp } from '../utils/whatsapp'
import { can } from '../utils/permissions'
import toast from '../utils/toast'
import { toIntId } from '../services/integrity'

// Tones used by TodayTile / AttentionRow (listed so Tailwind keeps the classes):
// bg-success-soft border-success-line text-success-strong bg-primary-soft border-primary-line text-primary-strong
// bg-warning-soft border-warning-line text-warning-strong bg-info-soft border-info-line text-info-strong bg-danger-soft
// Big tappable "Today" tile
const TodayTile = ({ label, value, note, icon, tone, to, onClick }) => {
  const cls = `group text-left flex flex-col justify-between gap-3 rounded-2xl border p-4 sm:p-5 min-h-32 transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary bg-${tone}-soft border-${tone}-line`
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-bold text-${tone}-strong`}>{icon} {label}</span>
        <span className={`text-xs font-bold text-${tone}-strong opacity-60 group-hover:opacity-100`} aria-hidden="true">→</span>
      </div>
      <div>
        <p className={`text-2xl sm:text-3xl font-black tabular-nums text-${tone}-strong`}>Rs. {Math.round(Number(value) || 0).toLocaleString()}</p>
        {note && <p className={`text-xs mt-0.5 text-${tone}-strong opacity-80`}>{note}</p>}
      </div>
    </>
  )
  return to ? <Link to={to} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>
}

// One line in "Needs attention"
const AttentionRow = ({ icon, text, action, to, onClick, tone = 'warning' }) => {
  const btn = `btn btn-sm shrink-0 min-h-10 ${tone === 'danger' ? 'btn-danger' : 'btn-secondary'}`
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`flex-none h-9 w-9 rounded-xl flex items-center justify-center bg-${tone}-soft`} aria-hidden="true">{icon}</span>
      <span className="flex-1 min-w-0 text-sm text-fg-2">{text}</span>
      {action && (to ? <Link to={to} className={btn}>{action}</Link> : onClick ? <button type="button" onClick={onClick} className={btn}>{action}</button> : <span className="text-xs text-fg-muted shrink-0">{action}</span>)}
    </li>
  )
}

function Dashboard() {
  const { user, logout } = useAuth()
  const { t, lang } = useLang()
  const wholesaleEnabled = isWholesaleEnabled(getShopSettings(user?.shop_id))
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    todaySales: 0,
    todayProfit: 0,
    todayCashSales: 0,
    todayOnlineSales: 0,
    todayCreditSales: 0,
    todayWholesaleSales: 0,
    todayLinesWithoutCost: 0,
    monthlySales: 0,
    totalReceivables: 0,
    lowStockCount: 0,
    productCount: 0,
    planInfo: null,
    topDebtors: [],
    todayBills: 0,
    drawerCash: 0,
    cashOut: 0,
    recoveries: 0,
    debtorCount: 0,
  })
  // Local counts for "Needs attention" (held bills and unsynced changes on this device)
  const [localCounts, setLocalCounts] = useState({ held: 0, unsynced: 0 })
  const seeProfit = can(user, 'see_profit')
  const [dailyTarget, setDailyTarget] = useState(() => Number(localStorage.getItem('daily_sales_target') || 0))
  const [editingTarget, setEditingTarget] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [showEOD, setShowEOD] = useState(false)
  const [eodData, setEodData] = useState(null)
  const [eodLoading, setEodLoading] = useState(false)
  const [eodOpening, setEodOpening] = useState('')
  const [eodCounted, setEodCounted] = useState('')
  // Shift close saved on the server (sql/cash_shifts_migration.sql)
  const [shiftNote, setShiftNote] = useState('')
  const [savingShift, setSavingShift] = useState(false)
  const [savedShift, setSavedShift] = useState(null)
  const [recentShifts, setRecentShifts] = useState(null) // null = not available
  const [fromCache, setFromCache] = useState(false)

  useEffect(() => {
    if (user?.shop_id) fetchDashboardStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads when these inputs change; the fetch functions read current state (listing them would refetch every render)
  }, [user?.shop_id])

  useEffect(() => {
    if (!user?.shop_id) return
    let alive = true
    Promise.all([
      db.held_carts.where('shop_id').equals(user.shop_id).count().catch(() => 0),
      db.sync_queue.count().catch(() => 0),
    ]).then(([held, unsynced]) => { if (alive) setLocalCounts({ held, unsynced }) })
    return () => { alive = false }
  }, [user?.shop_id, loading])

  // Today's sale rows with what is needed for cash/online/credit and profit
  const saleCols = `id, total_amount, discount, paid_amount, payment_type, payment_details, sale_type${wholesaleEnabled ? ', price_tier' : ''}`
  const notQuotation = 'sale_type.is.null,sale_type.neq.quotation'

  const fetchDashboardStats = async () => {
    setLoading(true)
    setFromCache(false)
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const today = periodStart('today')
      const firstDayOfMonth = periodStart('month')

      const fetchPromise = Promise.all([
        fetchAllRows(() => supabase.from('sales').select(`${saleCols}, sale_items(sale_id, cost_price, quantity, returned_qty)`).eq('shop_id', user.shop_id).or(notQuotation).gte('created_at', today.toISOString())),
        fetchAllRows(() => supabase.from('sales').select('total_amount, discount, sale_type').eq('shop_id', user.shop_id).or(notQuotation).gte('created_at', firstDayOfMonth.toISOString())),
        fetchAllRows(() => supabase.from('customers').select('id, name, outstanding_balance').eq('shop_id', user.shop_id)),
        fetchAllRows(() => supabase.from('products').select('id, stock_quantity, low_stock_threshold, category_id').eq('shop_id', user.shop_id)),
        supabase.from('categories').select('id, low_stock_threshold').eq('shop_id', user.shop_id),
        supabase.rpc('get_shop_config', { p_shop_id: user.shop_id }),
        // Dated returns (empty until sql/transactions_migration.sql has run)
        (txMaybeAvailable() ? fetchAllRows(() => supabase.from('sale_returns').select('refund_total, cost_total, created_at').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())) : Promise.resolve({ data: [], error: null })),
        (txMaybeAvailable() ? fetchAllRows(() => supabase.from('sale_returns').select('refund_total, cost_total, sales!inner(created_at)').eq('shop_id', user.shop_id).gte('sales.created_at', today.toISOString())) : Promise.resolve({ data: [], error: null })),
        // Today's cash book (same sources as Close Day)
        fetchAllRows(() => supabase.from('customer_payments').select('amount, payment_type, payment_mode').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())),
        fetchAllRows(() => supabase.from('supplier_payments').select('amount, payment_type, payment_mode').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())),
        fetchAllRows(() => supabase.from('expenses').select('amount').eq('shop_id', user.shop_id).gte('created_at', today.toISOString())),
      ])

      // Mobile data can be slow: wait longer before falling back to this device's copy
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
      const [todayRes, monthRes, custRes, prodRes, catRes, shopConfigRes, retInRes, retOfRes, cpRes, spRes, expRes] = await Promise.race([fetchPromise, timeoutPromise])

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

      if (todayRes.error) throw todayRes.error
      if (monthRes.error) console.warn('Dashboard: monthlySales fetch error', monthRes.error.message)
      if (custRes.error) console.warn('Dashboard: customers fetch error', custRes.error.message)

      const todaySalesList = todayRes.data || []
      const todayItems = todaySalesList.flatMap(s => (s.sale_items || []).map(i => ({ ...i, sale_id: i.sale_id ?? s.id })))
      setStats(buildStats({
        todaySales: todaySalesList,
        todayItems,
        monthSales: monthRes.data || [],
        customers: custRes.data || [],
        products: prodRes.data || [],
        categories: catRes.data || [],
        planInfo: config,
        returnsInPeriod: retInRes.error ? [] : (retInRes.data || []),
        returnsOfSales: retOfRes.error ? [] : (retOfRes.data || []),
        customerPayments: cpRes.error ? [] : (cpRes.data || []),
        supplierPayments: spRes.error ? [] : (spRes.data || []),
        expenses: expRes.error ? [] : (expRes.data || []),
      }))
    } catch (err) {
      console.log('Dashboard: Calculating stats from local DB', err?.message)
      setFromCache(true)
      try {
        const sid = String(user.shop_id)
        const today = periodStart('today')
        const firstDayOfMonth = periodStart('month')

        const [lSales, lCustomers, lProducts, lCats, lCp, lSp, lExp] = await Promise.all([
          db.sales.toArray(),
          db.customers.toArray(),
          db.products.toArray(),
          db.categories.toArray().catch(() => []),
          db.customer_payments.toArray().catch(() => []),
          db.supplier_payments.toArray().catch(() => []),
          db.expenses.toArray().catch(() => []),
        ])
        const todayMine = (rows) => rows.filter(x => String(x.shop_id) === sid && new Date(x.created_at) >= today)
        const limits = JSON.parse(localStorage.getItem('plan_limits') || '{}')

        const mySales = lSales.filter(x => String(x.shop_id) === sid && isCompletedSale(x))
        const tSales = mySales.filter(s => new Date(s.created_at) >= today)
        const todayIds = new Set(tSales.map(s => String(s.id)))
        const lItems = await db.sale_items.toArray().catch(() => [])

        setStats(buildStats({
          todaySales: tSales,
          todayItems: lItems.filter(i => todayIds.has(String(i.sale_id))),
          monthSales: mySales.filter(s => new Date(s.created_at) >= firstDayOfMonth),
          customers: lCustomers.filter(x => String(x.shop_id) === sid),
          products: lProducts.filter(x => String(x.shop_id) === sid),
          categories: lCats.filter(x => String(x.shop_id) === sid),
          customerPayments: todayMine(lCp),
          supplierPayments: todayMine(lSp),
          expenses: todayMine(lExp),
          planInfo: {
            plan_name: limits.plan_name || 'OFFLINE',
            product_limit: limits.product_limit || 100,
            next_billing_date: limits.next_billing_date || null,
            subscription_fee: limits.subscription_fee || 0
          },
        }))
      } catch (localError) {
        console.error('Final Dashboard Fallback Error:', localError)
      }
    } finally {
      setLoading(false)
    }
  }

  const buildStats = ({ todaySales, todayItems, monthSales, customers, products, categories, planInfo, returnsInPeriod = [], returnsOfSales = [], customerPayments = [], supplierPayments = [], expenses = [] }) => {
    // Today's sales and profit count returns on the day they came back
    const t = applyReturns(summarizeSales(todaySales, todayItems), returnsOfSales, returnsInPeriod)
    const m = summarizeSales(monthSales)
    const book = summarizeCashBook({ sales: todaySales, customerPayments, supplierPayments, expenses })
    const debtors = customers.filter(c => Number(c.outstanding_balance) > 0)
    return {
      todayBills: todaySales.length,
      drawerCash: book.netCash,
      cashOut: book.cashOut,
      recoveries: book.recoveriesCash + book.recoveriesOnline,
      debtorCount: debtors.length,
      todaySales: t.net,
      todayProfit: t.profit,
      todayCashSales: t.cash,
      todayOnlineSales: t.online,
      todayCreditSales: t.credit,
      todayWholesaleSales: t.wholesaleNet,
      todayLinesWithoutCost: t.linesWithoutCost,
      monthlySales: m.net,
      totalReceivables: customers.reduce((sum, c) => sum + Math.max(0, Number(c.outstanding_balance || 0)), 0),
      lowStockCount: products.filter(p => isLowStock(p, categories)).length,
      productCount: products.length,
      planInfo,
      topDebtors: customers.filter(c => Number(c.outstanding_balance) > 0).sort((a, b) => b.outstanding_balance - a.outstanding_balance).slice(0, 5)
    }
  }

  // ── End of Day cash book ─────────────────────────────────────────────
  const openingKey = `eod_opening_${user?.shop_id}_${todayLocal()}`
  const readOpening = () => { try { return localStorage.getItem(openingKey) || '' } catch { return '' } }

  const openEOD = async () => {
    setEodLoading(true)
    setShowEOD(true)
    setEodData(null)
    setEodOpening(readOpening())
    setEodCounted('')
    setShiftNote('')
    setSavedShift(null)
    loadRecentShifts()
    const startISO = periodStart('today').toISOString()
    try {
      let sales, customerPayments, supplierPayments, expenses, purchases
      try {
        if (!navigator.onLine) throw new Error('Offline')
        const res = await Promise.all([
          fetchAllRows(() => supabase.from('sales').select(saleCols).eq('shop_id', user.shop_id).or(notQuotation).gte('created_at', startISO)),
          fetchAllRows(() => supabase.from('customer_payments').select('*').eq('shop_id', user.shop_id).gte('created_at', startISO)),
          fetchAllRows(() => supabase.from('supplier_payments').select('*').eq('shop_id', user.shop_id).gte('created_at', startISO)),
          fetchAllRows(() => supabase.from('expenses').select('amount').eq('shop_id', user.shop_id).gte('created_at', startISO)),
          fetchAllRows(() => supabase.from('purchases').select('total_amount, payment_type').eq('shop_id', user.shop_id).gte('created_at', startISO)),
        ])
        const failed = res.find(r => r.error)
        if (failed) throw failed.error
        ;[sales, customerPayments, supplierPayments, expenses, purchases] = res.map(r => r.data || [])
      } catch (onlineErr) {
        console.log('EOD: using this device\'s saved data', onlineErr?.message)
        const sid = String(user.shop_id)
        const start = periodStart('today')
        const mine = (rows) => rows.filter(x => String(x.shop_id) === sid && new Date(x.created_at) >= start)
        const [lS, lCP, lSP, lE, lP] = await Promise.all([
          db.sales.toArray(), db.customer_payments.toArray(), db.supplier_payments.toArray(), db.expenses.toArray(), db.purchases.toArray()
        ])
        sales = mine(lS); customerPayments = mine(lCP); supplierPayments = mine(lSP); expenses = mine(lE); purchases = mine(lP)
      }
      const book = summarizeCashBook({ sales, customerPayments, supplierPayments, expenses })
      setEodData({
        ...book,
        totalSales: book.sales.net,
        profit: stats.todayProfit,
        creditPurchases: purchases.filter(p => p.payment_type === 'credit').reduce((s, p) => s + Number(p.total_amount || 0), 0),
      })
    } catch (e) {
      console.error('EOD fetch error:', e)
    } finally {
      setEodLoading(false)
    }
  }

  const loadRecentShifts = async () => {
    setRecentShifts(null)
    if (!navigator.onLine) return
    try {
      const { data, error } = await supabase.from('cash_shifts')
        .select('id, shift_date, username, expected_cash, counted_cash, difference, closed_at, note')
        .eq('shop_id', user.shop_id).order('closed_at', { ascending: false }).limit(10)
      if (!error) setRecentShifts(data || [])
    } catch { /* table not created yet or offline */ }
  }

  // One row per close: who, opening, expected, counted (difference is worked out by the database)
  const saveShiftClose = async () => {
    if (!eodData || eodCounted === '') { toast.warning('Pehle drawer ka cash gin kar "Counted cash" likhein.'); return }
    setSavingShift(true)
    const row = {
      shop_id: user.shop_id,
      user_id: toIntId(user.id),
      username: user.username || user.name || '',
      shift_date: todayLocal(),
      opening_cash: Number(eodOpening || 0),
      cash_in: Number(eodData.cashIn || 0),
      cash_out: Number(eodData.cashOut || 0),
      expected_cash: Math.round(eodExpected * 100) / 100,
      counted_cash: Number(eodCounted),
      total_sales: Number(eodData.totalSales || 0),
      credit_sales: Number(eodData.salesCredit || 0),
      online_in: Number(eodData.salesOnline || 0) + Number(eodData.recoveriesOnline || 0),
      note: shiftNote.trim() || null,
      client_ref: crypto.randomUUID(),
      closed_at: new Date().toISOString(),
    }
    try {
      let offline = !navigator.onLine
      if (!offline) {
        const { error } = await supabase.from('cash_shifts').insert(row)
        if (error) {
          if (/Failed to fetch|NetworkError|Load failed/i.test(error.message || '')) offline = true
          else if (['42P01', 'PGRST205'].includes(error.code) || /cash_shifts/.test(error.message || '')) {
            toast.warning('Shift history needs a database update first (sql/cash_shifts_migration.sql). The Close Day print and WhatsApp still work.')
            return
          } else throw error
        }
      }
      if (offline) await addToSyncQueue('cash_shifts', 'INSERT', row)
      setSavedShift({ at: row.closed_at, offline })
      const diff = row.counted_cash - row.expected_cash
      toast.success(`Shift closed${Math.abs(diff) >= 1 ? ` — ${diff > 0 ? 'extra' : 'short'} Rs. ${Math.round(Math.abs(diff)).toLocaleString()}` : ' — cash matches'}${offline ? ' (saved on this device, will sync)' : ''}`)
      if (!offline) loadRecentShifts()
    } catch (e) {
      toast.error('Shift close save nahi hua: ' + (e?.message || e))
    } finally {
      setSavingShift(false)
    }
  }

  const saveOpening = (val) => {
    setEodOpening(val)
    try { localStorage.setItem(openingKey, val) } catch { /* storage unavailable */ }
  }

  const eodExpected = eodData ? Number(eodOpening || 0) + eodData.netCash : 0
  const eodDifference = eodCounted === '' ? null : Number(eodCounted) - eodExpected
  const rs = (n) => `Rs. ${Math.round(Number(n) || 0).toLocaleString()}`

  // Lines shared by the modal, the print-out and WhatsApp
  const eodLines = (d) => [
    ['section', 'CASH IN'],
    ['💵 Cash sales', d.salesCash],
    ['📥 Credit recovered (cash)', d.recoveriesCash],
    ['total', 'Cash in', d.cashIn],
    ['section', 'CASH OUT'],
    ['💸 Expenses', d.expenses],
    ['🚚 Paid to suppliers (cash)', d.supplierCash],
    ['↩️ Cash refunds', d.refunds],
    ['total', 'Cash out', d.cashOut],
    ['section', 'NOT IN DRAWER'],
    ['📱 Online / wallet sales', d.salesOnline],
    ['📱 Online recoveries', d.recoveriesOnline],
    ['📒 Credit given (unpaid)', d.salesCredit],
    ['📦 Credit purchases', d.creditPurchases],
  ]

  // Owner's WhatsApp for the daily summary: 03xx… → 923xx…; empty = choose in WhatsApp
  const ownerWhatsApp = () => {
    let phone = String(getShopSettings(user?.shop_id).owner_whatsapp || '').replace(/[^0-9]/g, '')
    if (phone.startsWith('03')) phone = '92' + phone.slice(1)
    else if (phone.length === 10 && phone.startsWith('3')) phone = '92' + phone
    return phone
  }
  const sentKey = `eod_summary_sent_${user?.shop_id}_${todayLocal()}`
  const [summarySent, setSummarySent] = useState(() => { try { return !!localStorage.getItem(sentKey) } catch { return false } })
  const markSummarySent = () => { setSummarySent(true); try { localStorage.setItem(sentKey, '1') } catch { /* storage unavailable */ } }
  // After 7 pm, remind once a day until the summary has been sent
  const showSummaryReminder = !summarySent && new Date().getHours() >= 19

  const shareEODWhatsApp = () => {
    const d = eodData
    if (!d) return
    const dateStr = new Date().toLocaleDateString('en-PK')
    const sid = user?.shop_id
    const shopName = (sid ? localStorage.getItem(`shop_name_${sid}`) : null) || 'My Shop'
    const body = eodLines(d).map(l => l[0] === 'section' ? `\n*${l[1]}*` : l[0] === 'total' ? `*${l[1]}: ${rs(l[2])}*` : `${l[0]}: ${rs(l[1])}`).join('\n')
    const msg =
      `🌙 *End of Day — ${dateStr}*\n*${shopName}*\n` +
      `\n📊 Total Sales: ${rs(d.totalSales)}\n📈 Gross Profit: ${rs(d.profit)}\n` +
      body +
      `\n\n💰 *Net Cash (today): ${rs(d.netCash)}*` +
      (eodOpening !== '' ? `\n🏁 Opening cash: ${rs(eodOpening)}\n🧮 Expected in drawer: ${rs(eodExpected)}` : '') +
      (eodDifference != null ? `\n✅ Counted: ${rs(eodCounted)} (${eodDifference >= 0 ? '+' : '−'}${rs(Math.abs(eodDifference))})` : '') +
      (stats.lowStockCount > 0 ? `\n\n⚠️ Low stock: ${stats.lowStockCount} product(s) — reorder from Inventory` : '')
    // Straight to the owner's number when set (Settings → Owner's WhatsApp)
    const owner = ownerWhatsApp()
    openWhatsApp({ shopId: user?.shop_id, kind: 'summary', phone: owner, name: 'Owner', text: msg })
    markSummarySent()
  }

  const printEOD = () => {
    const d = eodData
    if (!d) return
    const branding = getShopBranding(user?.shop_id)
    const dateStr = new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const rows = eodLines(d).map(l =>
      l[0] === 'section' ? `<hr/><p class="center bold">${l[1]}</p>`
        : l[0] === 'total' ? `<div class="row bold"><span>${l[1]}</span><span>${rs(l[2])}</span></div>`
          : `<div class="row"><span>${l[0]}</span><span>${rs(l[1])}</span></div>`).join('')
    printHTML(`<html><head><title>End of Day Report</title>
      <style>
        @page{size:80mm auto;margin:2mm}
        *{box-sizing:border-box}
        body{font-family:monospace;width:302px;margin:0 auto;padding:12px 8px;font-size:13px;}
        h2,p.center{text-align:center;margin:2px 0;}
        hr{border-top:1px dashed #000;margin:8px 0;}
        .row{display:flex;justify-content:space-between;padding:3px 0;}
        .bold{font-weight:bold;}
      </style></head><body>
      <h2>${branding.name}</h2>
      ${branding.phone ? `<p class="center" style="font-size:11px;">${branding.phone}</p>` : ''}
      ${branding.address ? `<p class="center" style="font-size:10px;color:#555;">${branding.address}</p>` : ''}
      <p class="center bold" style="font-size:13px;margin-top:4px;">END OF DAY REPORT</p>
      <p class="center">${dateStr}</p>
      <hr/>
      <div class="row bold"><span>Total Sales</span><span>${rs(d.totalSales)}</span></div>
      <div class="row"><span>Gross Profit</span><span>${rs(d.profit)}</span></div>
      ${rows}
      <hr/>
      <div class="row bold" style="font-size:15px;"><span>Net Cash (today)</span><span>${rs(d.netCash)}</span></div>
      ${eodOpening !== '' ? `<div class="row"><span>Opening cash</span><span>${rs(eodOpening)}</span></div><div class="row bold"><span>Expected in drawer</span><span>${rs(eodExpected)}</span></div>` : ''}
      ${eodDifference != null ? `<div class="row"><span>Counted</span><span>${rs(eodCounted)}</span></div><div class="row bold"><span>Difference</span><span>${eodDifference >= 0 ? '+' : '−'}${rs(Math.abs(eodDifference))}</span></div>` : ''}
      <hr/>
      <p class="center" style="font-size:11px;color:#888;">Generated: ${new Date().toLocaleTimeString('en-PK')}</p>
      </body></html>`)
  }
  const getBillingWarning = () => {
    if (!stats.planInfo || !stats.planInfo.next_billing_date) return null
    const nextBilling = new Date(stats.planInfo.next_billing_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    if (nextBilling < today) {
      const diffTime = Math.abs(today - nextBilling)
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
      const daysRemaining = 7 - diffDays
      
      if (daysRemaining > 0) {
        return {
          overdue: true,
          daysRemaining,
          dueDate: nextBilling.toLocaleDateString('en-PK', { dateStyle: 'medium' }),
          deadlineDate: new Date(nextBilling.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-PK', { dateStyle: 'medium' })
        }
      }
    }
    return null
  }

  const billingWarning = getBillingWarning()

  return (
    <div className="max-w-6xl mx-auto">
      {billingWarning && (
        <div className="mb-6 p-4 bg-warning-soft border border-warning-line rounded-2xl flex items-center justify-between shadow-sm animate-pulse">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <h4 className="font-extrabold text-warning-strong text-sm">Subscription Overdue Notice</h4>
              <p className="text-xs text-warning-strong font-semibold mt-0.5">
                Your subscription payment was due on {billingWarning.dueDate}.
                Please pay by <strong className="underline text-danger-fg">{billingWarning.deadlineDate}</strong> to avoid service suspension.
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="bg-warning text-white font-black text-[10px] px-3 py-1.5 rounded-full uppercase tracking-wider">
              {billingWarning.daysRemaining} {billingWarning.daysRemaining === 1 ? 'Day' : 'Days'} Left
            </span>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-fg">Assalam-o-Alaikum, {user.username}! 👋</h1>
          <p className="text-fg-muted mt-1" lang={lang} dir="auto">{t("Today's Summary")}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openEOD}
            className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm font-bold rounded-xl transition shadow"
            title="End of Day Summary"
          >
            🌙 <span lang={lang}>{t('Close Day')}</span>
          </button>
          <button
            onClick={fetchDashboardStats}
            className="p-2 text-fg-subtle hover:text-primary-fg transition"
            title="Refresh Stats"
          >
            🔄
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-pulse">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-surface-3 rounded-2xl"></div>
          ))}
        </div>
      ) : (
        <>
          <h2 className="sr-only">Today</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <TodayTile label="Sale today" icon="💰" tone="success" to="/sales" value={stats.todaySales}
              note={`${stats.todayBills} bill${stats.todayBills === 1 ? '' : 's'}${stats.todayOnlineSales > 0 ? ` · online Rs. ${Math.round(stats.todayOnlineSales).toLocaleString()}` : ''}`} />
            <TodayTile label="Cash in drawer" icon="💵" tone="primary" onClick={openEOD} value={stats.drawerCash}
              note={stats.cashOut > 0 ? `after Rs. ${Math.round(stats.cashOut).toLocaleString()} paid out · tap to Close Day` : 'cash sales + cash received · tap to Close Day'} />
            <TodayTile label="Udhaar given" icon="📒" tone="warning" to="/customer-ledger" value={stats.todayCreditSales}
              note="sold on credit today" />
            <TodayTile label="Payments received" icon="🤝" tone="info" to="/customer-ledger" value={stats.recoveries}
              note="from customers today" />
          </div>

          <div className={`grid gap-3 mt-3 ${seeProfit ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'}`}>
            {seeProfit && (
              <div className="bg-surface border border-line-subtle rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-fg-muted">📈 Profit today</p>
                <p className="text-lg font-bold text-fg tabular-nums">Rs. {Math.round(stats.todayProfit).toLocaleString()}</p>
              </div>
            )}
            <Link to="/reports" className="bg-surface border border-line-subtle rounded-xl px-4 py-3 hover:bg-surface-2">
              <p className="text-xs font-semibold text-fg-muted">🗓️ This month</p>
              <p className="text-lg font-bold text-fg tabular-nums">Rs. {Math.round(stats.monthlySales).toLocaleString()}</p>
            </Link>
            <Link to="/customer-ledger" className="bg-surface border border-line-subtle rounded-xl px-4 py-3 hover:bg-surface-2">
              <p className="text-xs font-semibold text-fg-muted">📒 Total udhaar to collect</p>
              <p className="text-lg font-bold text-danger-fg tabular-nums">Rs. {Math.round(stats.totalReceivables).toLocaleString()}</p>
            </Link>
            <Link to="/inventory" className={`bg-surface border border-line-subtle rounded-xl px-4 py-3 hover:bg-surface-2 ${seeProfit ? '' : 'col-span-2 md:col-span-1'}`}>
              <p className="text-xs font-semibold text-fg-muted">📦 Products</p>
              <p className="text-lg font-bold text-fg tabular-nums">{stats.productCount}{stats.lowStockCount > 0 && <span className="text-sm text-danger-fg"> · {stats.lowStockCount} low</span>}</p>
            </Link>
          </div>

          {/* Needs attention */}
          {(() => {
            const rows = []
            if (stats.lowStockCount > 0) rows.push(<AttentionRow key="low" icon="⚠️" tone="danger" to="/inventory" action="Reorder"
              text={<><b>{stats.lowStockCount}</b> product{stats.lowStockCount === 1 ? ' is' : 's are'} low on stock</>} />)
            if (stats.debtorCount > 0) rows.push(<AttentionRow key="debt" icon="📒" to="/whatsapp" action="Send reminders"
              text={<><b>{stats.debtorCount}</b> customer{stats.debtorCount === 1 ? ' owes' : 's owe'} you <b>Rs. {Math.round(stats.totalReceivables).toLocaleString()}</b></>} />)
            if (localCounts.held > 0) rows.push(<AttentionRow key="held" icon="⏸️" to="/pos" action="Open POS"
              text={<><b>{localCounts.held}</b> bill{localCounts.held === 1 ? ' is' : 's are'} on hold at the counter</>} />)
            if (localCounts.unsynced > 0) rows.push(<AttentionRow key="sync" icon="🔄" to="/sync" action="View"
              text={<><b>{localCounts.unsynced}</b> change{localCounts.unsynced === 1 ? '' : 's'} saved on this device, not yet sent to the server</>} />)
            if (stats.todayLinesWithoutCost > 0 && seeProfit) rows.push(<AttentionRow key="cost" icon="🏷️" to="/products" action="Add cost"
              text={<><b>{stats.todayLinesWithoutCost}</b> item line(s) sold today have no cost price, so profit is shown too high</>} />)
            return (
              <section className="mt-4 bg-surface rounded-2xl border border-line-subtle shadow-sm px-4 py-2" aria-labelledby="attention-title">
                <h2 id="attention-title" className="font-bold text-fg-2 text-sm pt-2">🔔 Needs attention</h2>
                {rows.length ? <ul className="divide-y divide-line-subtle">{rows}</ul>
                  : <p className="py-3 text-sm text-success-fg font-semibold">✓ All clear — nothing needs you right now.</p>}
              </section>
            )
          })()}
        </>
      )}

      {showSummaryReminder && !loading && (
        <div role="status" className="mt-3 bg-primary-soft border border-primary-line text-primary-strong rounded-xl px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>🌙 Din khatam? Aaj ka hisaab {getShopSettings(user?.shop_id).owner_whatsapp ? 'owner ko' : ''} WhatsApp par bhejein — sales, drawer ka cash, udhaar aur low stock.</span>
          <button type="button" onClick={openEOD} className="btn btn-primary btn-sm shrink-0">🌙 Close Day</button>
        </div>
      )}

      {fromCache && !loading && !user?.isDemo && (
        <div className="mt-3 bg-warning-soft border border-warning-line text-warning-strong rounded-xl px-4 py-2 text-sm flex justify-between items-center gap-3">
          <span>Figures are from this device's saved data (no connection to the server).</span>
          <button onClick={fetchDashboardStats} className="font-bold underline shrink-0">Try again</button>
        </div>
      )}

      {!loading && wholesaleEnabled && stats.todayWholesaleSales > 0 && (
        <div className="mt-3 bg-wholesale-soft border border-wholesale-line rounded-xl px-4 py-2 flex justify-between items-center">
          <span className="text-sm font-medium text-wholesale-strong">🏷️ Wholesale Sales Today</span>
          <span className="font-bold text-wholesale-strong">Rs. {stats.todayWholesaleSales.toLocaleString()}</span>
        </div>
      )}


      {/* Daily Sales Target */}
      <div className="mt-6 bg-surface rounded-2xl border border-line-subtle shadow-sm p-4">
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <span className="font-bold text-fg-2 text-sm">Daily Sales Target</span>
          </div>
          {!editingTarget ? (
            <button onClick={() => { setEditingTarget(true); setTargetInput(String(dailyTarget || '')) }}
              className="text-xs text-primary-fg hover:text-primary-strong font-semibold">
              {dailyTarget ? '✏️ Edit' : '+ Set Target'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input type="number" value={targetInput} onChange={e => setTargetInput(e.target.value)}
                className="w-28 px-2 py-1 border rounded-lg text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. 50000" autoFocus />
              <button onClick={() => { const t = Number(targetInput) || 0; setDailyTarget(t); localStorage.setItem('daily_sales_target', t); setEditingTarget(false) }}
                className="text-xs bg-primary hover:bg-primary-hover text-white px-3 py-1 rounded-lg font-bold">Save</button>
              <button onClick={() => setEditingTarget(false)} className="text-xs text-fg-subtle hover:text-fg-3">✕</button>
            </div>
          )}
        </div>
        {dailyTarget > 0 ? (() => {
          const pct = Math.min(100, (stats.todaySales / dailyTarget) * 100)
          const color = pct >= 100 ? 'bg-success' : pct >= 70 ? 'bg-primary' : pct >= 40 ? 'bg-warning' : 'bg-danger'
          return (
            <>
              <div className="w-full bg-surface-3 rounded-full h-3 overflow-hidden">
                <div className={`h-3 rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex justify-between mt-1 text-xs text-fg-muted">
                <span>Rs. {stats.todaySales.toLocaleString()} achieved</span>
                <span className={`font-bold ${pct >= 100 ? 'text-success-fg' : 'text-fg-3'}`}>
                  {pct >= 100 ? '🎉 Target Hit!' : `${pct.toFixed(0)}% — Rs. ${(dailyTarget - stats.todaySales).toLocaleString()} remaining`}
                </span>
              </div>
            </>
          )
        })() : (
          <p className="text-xs text-fg-subtle italic">No target set. Click "+ Set Target" to add a daily goal.</p>
        )}
      </div>

      {/* Top Debtors */}
      {stats.topDebtors.length > 0 && (
        <div className="mt-4 bg-surface rounded-2xl border border-line-subtle shadow-sm p-4">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">📒</span>
              <span className="font-bold text-fg-2 text-sm">Top Debtors</span>
            </div>
            <Link to="/customer-ledger" className="text-xs text-primary-fg hover:text-primary-strong font-semibold">View All →</Link>
          </div>
          <div className="space-y-2">
            {stats.topDebtors.map((c, i) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center justify-between hover:bg-surface-2 rounded-lg px-2 py-1.5 transition group">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-fg-faint w-4">{i + 1}</span>
                  <span className="text-sm font-medium text-fg-2 group-hover:text-primary-fg">{c.name}</span>
                </div>
                <span className="text-sm font-bold text-danger-fg">Rs. {Number(c.outstanding_balance).toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-10">
        <h2 className="text-xl font-bold text-fg mb-6">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/pos" className="flex flex-col items-center p-6 bg-primary text-white rounded-2xl hover:bg-primary-hover transition shadow-lg shadow-primary-line">
            <span className="text-3xl mb-2">🛒</span>
            <span className="font-bold">New Sale</span>
          </Link>
          <Link to="/customers" className="flex flex-col items-center p-6 bg-surface border border-line text-fg-2 rounded-2xl hover:bg-surface-2 transition shadow-sm">
            <span className="text-3xl mb-2">👥</span>
            <span className="font-bold">Customers</span>
          </Link>
          <Link to="/sales" className="flex flex-col items-center p-6 bg-surface border border-line text-fg-2 rounded-2xl hover:bg-surface-2 transition shadow-sm">
            <span className="text-3xl mb-2">📜</span>
            <span className="font-bold">Sales History</span>
          </Link>
          <Link to="/products" className="flex flex-col items-center p-6 bg-surface border border-line text-fg-2 rounded-2xl hover:bg-surface-2 transition shadow-sm">
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
        <Modal open onClose={() => setShowEOD(false)} title="🌙 End of Day Summary" subtitle={<>{new Date().toLocaleDateString('en-PK', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</>} maxWidth="max-w-md" dismissible={false}>
          {eodLoading ? (
              <div className="p-8 text-center text-fg-subtle">Loading summary...</div>
            ) : eodData ? (
              <div className="p-6 space-y-4 max-h-[70dvh] overflow-y-auto">
                <div className="flex justify-between"><span className="font-semibold text-fg">📊 Total Sales</span><span className="font-bold text-fg">{rs(eodData.totalSales)}</span></div>
                <div className="flex justify-between"><span className="text-fg-3">📈 Gross Profit</span><span className={`font-bold ${eodData.profit >= 0 ? 'text-success-fg' : 'text-danger-fg'}`}>{rs(eodData.profit)}</span></div>
                <div className="space-y-2">
                  {eodLines(eodData).map((l, idx) => l[0] === 'section' ? (
                    <p key={idx} className="text-xs font-bold text-fg-subtle uppercase tracking-wider pt-3">{l[1]}</p>
                  ) : l[0] === 'total' ? (
                    <div key={idx} className="flex justify-between border-t pt-2"><span className="font-semibold text-fg-2">{l[1]}</span><span className="font-bold text-fg">{rs(l[2])}</span></div>
                  ) : (
                    <div key={idx} className="flex justify-between"><span className="text-fg-3">{l[0]}</span><span className="font-medium text-fg-2">{rs(l[1])}</span></div>
                  ))}
                </div>
                <div className="bg-surface-2 rounded-xl p-4 space-y-3 border border-line-subtle">
                  <div className="flex justify-between">
                    <span className="font-bold text-fg">💰 Net Cash (today)</span>
                    <span className={`font-black text-xl ${eodData.netCash >= 0 ? 'text-success-fg' : 'text-danger-fg'}`}>{rs(eodData.netCash)}</span>
                  </div>
                  <label className="flex justify-between items-center gap-3 text-sm">
                    <span className="text-fg-3">🏁 Opening cash (subah ka cash)</span>
                    <input type="number" inputMode="decimal" min="0" value={eodOpening} onChange={e => saveOpening(e.target.value)}
                      className="input w-32 text-right" placeholder="0" />
                  </label>
                  <div className="flex justify-between text-sm"><span className="text-fg-3">🧮 Expected in drawer</span><span className="font-bold text-fg">{rs(eodExpected)}</span></div>
                  <label className="flex justify-between items-center gap-3 text-sm">
                    <span className="text-fg-3">✅ Counted cash (gin kar)</span>
                    <input type="number" inputMode="decimal" min="0" value={eodCounted} onChange={e => setEodCounted(e.target.value)}
                      className="input w-32 text-right" placeholder="0" />
                  </label>
                  {eodDifference != null && (
                    <div className={`flex justify-between font-bold ${Math.abs(eodDifference) < 1 ? 'text-success-fg' : 'text-danger-fg'}`}>
                      <span>{Math.abs(eodDifference) < 1 ? 'Cash matches ✔' : eodDifference > 0 ? 'Extra cash' : 'Cash short'}</span>
                      <span>{eodDifference >= 0 ? '+' : '−'}{rs(Math.abs(eodDifference))}</span>
                    </div>
                  )}
                  <input type="text" value={shiftNote} onChange={e => setShiftNote(e.target.value)} maxLength={200}
                    className="input w-full text-sm" placeholder="Note (optional) — e.g. Rs. 500 given to owner" aria-label="Shift note" />
                  {savedShift ? (
                    <p className="text-sm font-bold text-success-fg">✓ Shift close saved {new Date(savedShift.at).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} by {user.username}{savedShift.offline ? ' — will sync when online' : ''}</p>
                  ) : (
                    <button type="button" onClick={saveShiftClose} disabled={savingShift || eodCounted === ''} className="btn btn-primary w-full min-h-11">
                      {savingShift ? 'Saving…' : eodCounted === '' ? 'Count the cash to close the shift' : '💾 Save shift close'}
                    </button>
                  )}
                </div>
                {recentShifts && recentShifts.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-fg-subtle uppercase tracking-wider mb-1">Recent closes</p>
                    <ul className="divide-y divide-line-subtle text-sm">
                      {recentShifts.map(sh => {
                        const d = Number(sh.difference || 0)
                        return (
                          <li key={sh.id} className="flex items-center justify-between gap-2 py-1.5">
                            <span className="min-w-0 truncate text-fg-2">{new Date(sh.closed_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })} · {sh.username || '—'}{sh.note ? ` · ${sh.note}` : ''}</span>
                            <span className={`shrink-0 font-bold tabular-nums ${Math.abs(d) < 1 ? 'text-success-fg' : 'text-danger-fg'}`}>{Math.abs(d) < 1 ? '✓' : `${d > 0 ? '+' : '−'}${rs(Math.abs(d))}`}</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-fg-subtle">Expenses are counted as cash. Supplier and customer payments count as cash unless their payment mode says otherwise.</p>
              </div>
            ) : <div className="p-8 text-center text-danger-fg">Could not load data.</div>}

            <div className="p-4 border-t border-line-subtle flex gap-3">
              {eodData && <button onClick={printEOD} className="flex-1 py-2.5 bg-primary hover:bg-primary-hover text-white font-bold rounded-xl transition">🖨️ Print</button>}
              {eodData && <button onClick={shareEODWhatsApp} className="flex-1 py-2.5 bg-success hover:bg-success-hover text-white font-bold rounded-xl transition">📱 {getShopSettings(user?.shop_id).owner_whatsapp ? 'Send to owner' : 'WhatsApp'}</button>}
              <button onClick={() => setShowEOD(false)} className="flex-1 py-2.5 bg-surface-3 hover:bg-surface-4 text-fg-2 font-bold rounded-xl transition">Close</button>
            </div>
        </Modal>
      )}
    </div>
  )
}

export default Dashboard