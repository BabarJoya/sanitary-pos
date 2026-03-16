import { useAuth } from '../context/AuthContext'
import { useNavigate, Link, useLocation } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '../services/supabase'

function Layout({ children }) {
  const { user, logout, stopImpersonating } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [lowStock, setLowStock] = useState([])
  const [shopName, setShopName] = useState(localStorage.getItem('shop_name') || 'EDGEX POS')
  const [shopLogo, setShopLogo] = useState('')
  const [announcements, setAnnouncements] = useState([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserDropdown, setShowUserDropdown] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [planInfo, setPlanInfo] = useState(null)
  const [productCount, setProductCount] = useState(0)
  const dropdownRef = useRef(null)
  const userDropdownRef = useRef(null)

  useEffect(() => {
    fetchLowStock()
    fetchShopName()
    fetchAnnouncements()
    fetchPlanInfo()
    const interval = setInterval(() => {
      fetchLowStock()
      fetchShopName()
      fetchAnnouncements()
      fetchPlanInfo()
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [user.shop_id])

  const fetchShopName = async () => {
    if (!user?.shop_id) return
    try {
      const { data } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      if (data?.name) {
        setShopName(data.name)
        localStorage.setItem('shop_name', data.name)
        if (data.logo_url) {
          setShopLogo(data.logo_url)
          localStorage.setItem('shop_logo', data.logo_url)
        }
      } else {
        // Safe fallback if shop data is missing or empty
        const cachedName = localStorage.getItem('shop_name')
        if (cachedName) setShopName(cachedName)
      }
    } catch (e) {
      // Fallback to cached values
      const cachedName = localStorage.getItem('shop_name')
      if (cachedName) setShopName(cachedName)
    }
  }

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowNotifications(false)
      }
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
        setShowUserDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const fetchLowStock = async () => {
    if (!user?.shop_id) return
    const { data } = await supabase
      .from('products')
      .select('name, stock_quantity, low_stock_threshold')
      .eq('shop_id', user.shop_id)

    if (data) {
      const filtered = data.filter(p => Number(p.stock_quantity) <= Number(p.low_stock_threshold || 10))
      setLowStock(filtered)
    }
  }

  const fetchAnnouncements = async () => {
    try {
      const { data } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })

      if (data) setAnnouncements(data)
    } catch (e) {
      console.error('Failed to fetch announcements')
    }
  }

  const fetchPlanInfo = async () => {
    if (!user?.shop_id) return
    try {
      const { data, error } = await supabase.rpc('get_shop_config', { p_shop_id: user.shop_id })
      if (!error && data) {
        setPlanInfo(data)
        // Also fetch product count
        const { count } = await supabase.from('products').select('*', { count: 'exact', head: true }).eq('shop_id', user.shop_id)
        setProductCount(count || 0)
      }
    } catch (e) {
      console.error('Plan Fetch Error', e)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/')
  }

  const hasAccess = (moduleName, allowedRoles) => {
    if (user.role === 'admin' || user.role === 'superadmin') return true
    if (user.permissions && Array.isArray(user.permissions)) {
      return user.permissions.includes(moduleName)
    }
    return allowedRoles.includes(user.role)
  }

  const pageTitle = location.pathname.split('/').pop().replace('-', ' ').toUpperCase() || 'DASHBOARD'

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden text-gray-800">

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed md:static inset-y-0 left-0 w-64 bg-gray-900 text-white flex flex-col shrink-0 z-50 shadow-2xl transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Logo */}
        <div className="p-6 border-b border-gray-800 flex items-center gap-3">
          {shopLogo ? (
            <div className="w-10 h-10 rounded-lg bg-white overflow-hidden flex-shrink-0 flex items-center justify-center p-0.5">
              <img src={shopLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
            </div>
          ) : (
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg shadow-lg shadow-blue-900 flex-shrink-0">
              {shopName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm font-black tracking-tighter leading-none uppercase truncate w-32">{shopName}</h1>
            <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mt-0.5">Control Panel</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 overflow-y-auto custom-scrollbar">
          <ul className="space-y-1">
            <NavHeader label="Main" />
            <NavItem to="/dashboard" icon="📊" label="Dashboard" active={location.pathname === '/dashboard'} onClick={() => setSidebarOpen(false)} />
            {hasAccess('pos', ['admin', 'manager', 'cashier']) && (
              <NavItem to="/pos" icon="🛒" label="POS Billing" active={location.pathname === '/pos'} onClick={() => setSidebarOpen(false)} />
            )}

            <NavHeader label="Inventory & Products" />
            {hasAccess('products', ['admin', 'manager']) && (
              <NavItem to="/products" icon="📦" label="Products" active={location.pathname === '/products'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('categories', ['admin', 'manager']) && (
              <NavItem to="/categories" icon="🗂️" label="Categories" active={location.pathname === '/categories'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('brands', ['admin', 'manager']) && (
              <NavItem to="/brands" icon="🏷️" label="Brands" active={location.pathname === '/brands'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('inventory', ['admin', 'manager', 'accountant']) && (
              <NavItem to="/inventory" icon="📋" label="Stock Inventory" active={location.pathname === '/inventory'} onClick={() => setSidebarOpen(false)} />
            )}

            <NavHeader label="Sales & Customers" />
            {hasAccess('customers', ['admin', 'manager', 'cashier']) && (
              <NavItem to="/customers" icon="👥" label="Customers" active={location.pathname === '/customers'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('customers', ['admin', 'manager', 'cashier']) && (
              <NavItem to="/whatsapp" icon="📲" label="WhatsApp Reminders" active={location.pathname === '/whatsapp'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('sales', ['admin', 'manager', 'accountant']) && (
              <NavItem to="/sales" icon="💰" label="Sales History" active={location.pathname === '/sales'} onClick={() => setSidebarOpen(false)} />
            )}

            <NavHeader label="Procurement" />
            {hasAccess('suppliers', ['admin', 'manager']) && (
              <NavItem to="/suppliers" icon="🚚" label="Suppliers" active={location.pathname === '/suppliers'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('purchases', ['admin', 'manager']) && (
              <NavItem to="/purchases" icon="🛍️" label="Purchases" active={location.pathname === '/purchases'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('purchase-history', ['admin', 'manager', 'accountant']) && (
              <NavItem to="/purchase-history" icon="📜" label="Purchase History" active={location.pathname === '/purchase-history'} onClick={() => setSidebarOpen(false)} />
            )}

            <NavHeader label="Accounts & Admin" />
            {hasAccess('expenses', ['admin']) && (
              <NavItem to="/expenses" icon="💸" label="Expenses" active={location.pathname === '/expenses'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('reports', ['admin', 'manager', 'accountant']) && (
              <NavItem to="/reports" icon="📈" label="Reports" active={location.pathname === '/reports'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('users', ['admin']) && (
              <NavItem to="/users" icon="👨‍💼" label="Manage Users" active={location.pathname === '/users'} onClick={() => setSidebarOpen(false)} />
            )}

            <NavHeader label="Settings & System" />
            {hasAccess('settings', ['admin']) && (
              <NavItem to="/settings" icon="⚙️" label="Settings" active={location.pathname === '/settings'} onClick={() => setSidebarOpen(false)} />
            )}
            {hasAccess('trash', ['admin']) && (
              <NavItem to="/trash" icon="🗑️" label="Trash Bin" active={location.pathname === '/trash'} onClick={() => setSidebarOpen(false)} />
            )}
            <NavItem to="/support" icon="🆘" label="Help & Support" active={location.pathname === '/support'} onClick={() => setSidebarOpen(false)} />
          </ul>
        </nav>

        {/* Credits */}
        <div className="p-4 border-t border-gray-800 bg-gray-900/50 flex flex-col gap-3">
          <div className="text-center px-1">
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Developed with <span className="text-red-500">❤︎</span> by</p>
            <p className="text-xs text-gray-300 font-semibold leading-tight">EdgeX Digital<br />& Babar Joya</p>
            <p className="text-[10px] font-mono text-gray-400 mt-1">📞 0301-2616367</p>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">

        {/* Top Header */}
        <header className="h-16 bg-white border-b border-gray-200 px-4 md:px-6 flex items-center justify-between shrink-0 shadow-sm z-20">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="md:hidden w-8 h-8 flex items-center justify-center text-xl cursor-pointer hover:bg-gray-100 rounded-lg transition">☰</button>
            <div className="flex flex-col">
              <span className="text-gray-900 font-black tracking-tight text-sm sm:text-lg leading-none truncate max-w-[150px] sm:max-w-[300px]">{shopName}</span>
              <span className="text-gray-400 font-bold tracking-tight text-[10px] uppercase mt-0.5">{pageTitle}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Status Indicator */}
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${isOnline ? 'bg-green-50 text-green-600 border border-green-100' : 'bg-orange-50 text-orange-600 border border-orange-100 animate-pulse'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-orange-500'}`}></span>
              {isOnline ? 'System Online' : 'Offline Mode'}
            </div>

            {/* Notification Bell */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className={`p-2 rounded-full transition relative group ${showNotifications ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                <div className={`${lowStock.length > 0 ? 'animate-bounce-slow' : ''}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                {lowStock.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-600 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-white ring-1 ring-red-100">
                    {lowStock.length}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 mt-3 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 origin-top-right">
                  <div className="p-4 bg-gray-50 border-b flex justify-between items-center">
                    <h3 className="font-bold text-gray-800">Alerts</h3>
                    <span className="text-[10px] font-black text-white bg-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">{lowStock.length} Now</span>
                  </div>
                  <div className="max-h-96 overflow-y-auto custom-scrollbar">
                    {lowStock.length === 0 ? (
                      <div className="p-10 text-center">
                        <span className="text-4xl mb-2 block">✅</span>
                        <p className="text-sm text-gray-500 font-medium">Stock levels are perfect!</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        <p className="px-4 py-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-red-50/50">Low Stock 🚩</p>
                        {lowStock.map((p, i) => (
                          <div key={i} className="p-4 hover:bg-gray-50 transition flex justify-between items-center">
                            <div className="flex-1 pr-4">
                              <p className="text-sm font-bold text-gray-800 truncate">{p.name}</p>
                              <p className="text-xs text-red-500 font-medium">Only {p.stock_quantity} remaining</p>
                            </div>
                            <Link to="/inventory" onClick={() => setShowNotifications(false)} className="px-3 py-1 bg-blue-50 text-blue-600 rounded text-[10px] font-black hover:bg-blue-600 hover:text-white transition uppercase">Restock</Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {lowStock.length > 0 && (
                    <div className="p-3 bg-gray-50 border-t text-center">
                      <Link to="/inventory" onClick={() => setShowNotifications(false)} className="text-xs font-bold text-gray-400 hover:text-blue-600 transition">Go to Inventory Management →</Link>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-gray-200"></div>

            <div className="flex items-center gap-3 relative" ref={userDropdownRef}>
              <div className="text-right hidden sm:block">
                <p className="text-sm font-black text-gray-800 leading-none">{user?.username}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">{user?.role}</p>
              </div>
              <button
                onClick={() => setShowUserDropdown(!showUserDropdown)}
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-black shadow-lg shadow-blue-100 ring-4 ring-blue-50 focus:outline-none focus:ring-blue-200 transition hover:scale-105"
              >
                {user?.username?.charAt(0).toUpperCase()}
              </button>

              {/* User Dropdown */}
              {showUserDropdown && (
                <div className="absolute top-[120%] right-0 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden z-50 origin-top-right">
                  <div className="p-4 border-b border-gray-50 block sm:hidden">
                    <p className="text-sm font-black text-gray-800 leading-none">{user?.username}</p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase mt-1">{user?.role}</p>
                  </div>
                  <div className="p-2">
                    {user?.isImpersonating && (
                      <button
                        onClick={() => {
                          stopImpersonating()
                          const superadminUrl = import.meta.env.VITE_SUPERADMIN_URL || 'http://localhost:5173'
                          window.location.href = `${superadminUrl}/shops` // Redirect to superadmin
                        }}
                        className="w-full text-left px-3 py-2.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg font-bold flex items-center gap-2 transition mb-1"
                      >
                        <span>🔙</span> Exit Shop
                      </button>
                    )}
                    <button
                      onClick={handleLogout}
                      className="w-full text-left px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-lg font-bold flex items-center gap-2 transition"
                    >
                      <span>🚪</span> Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Impersonation Banner */}
        {user?.isImpersonating && (
          <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between text-sm shadow-inner z-10 shrink-0">
            <div className="flex items-center gap-2 font-bold">
              <span className="animate-pulse">🕵️‍♂️</span>
              <span>SUPERADMIN MODE: You are currently viewing {shopName}'s POS system.</span>
            </div>
            <button
              onClick={() => {
                const superadminUrl = import.meta.env.VITE_SUPERADMIN_URL || 'http://localhost:5173'
                window.location.href = `${superadminUrl}/shops`
              }}
              className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-black uppercase tracking-wider transition"
            >
              Exit to Superadmin
            </button>
          </div>
        )}

        {/* Global Announcements Banner */}
        {announcements.length > 0 && (
          <div className="flex flex-col shrink-0">
            {announcements.map(ann => (
              <div
                key={ann.id}
                className={`px-4 py-2 flex items-center justify-between text-sm shadow-sm z-10 ${ann.type === 'error' ? 'bg-red-600 text-white' :
                  ann.type === 'warning' ? 'bg-orange-500 text-white' :
                    ann.type === 'success' ? 'bg-emerald-600 text-white' :
                      'bg-blue-600 text-white'
                  }`}
              >
                <div className="flex items-center gap-2 font-medium">
                  <span className="animate-pulse">📢</span>
                  <span>{ann.message}</span>
                </div>
                <button
                  onClick={() => setAnnouncements(announcements.filter(a => a.id !== ann.id))}
                  className="p-1 hover:bg-black/10 rounded-full transition"
                  title="Dismiss"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 custom-scrollbar relative">
          <div className="mx-auto w-full h-full p-4 md:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .animate-bounce-slow { animation: bounce-slow 2s infinite; }
      `}</style>
    </div>
  )
}

function NavHeader({ label }) {
  return (
    <li className="pt-4 pb-1 px-4">
      <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">{label}</span>
    </li>
  )
}

function NavItem({ to, icon, label, active, onClick }) {
  return (
    <li>
      <Link
        to={to}
        onClick={onClick}
        className={`flex items-center gap-3 px-4 py-3 rounded-xl transition font-bold text-sm ${active
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40 translate-x-1'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white active:scale-95'
          }`}
      >
        <span className="text-xl">{icon}</span>
        <span>{label}</span>
      </Link>
    </li>
  )
}

export default Layout
