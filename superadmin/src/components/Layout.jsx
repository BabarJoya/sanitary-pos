import { useAuth } from '../context/AuthContext'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Store, LogOut, ShieldAlert, CreditCard, Activity, Send, Zap, LifeBuoy, TrendingUp } from 'lucide-react'

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()

  const navItems = [
    { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={20} /> },
    { name: 'Analytics & Growth', path: '/analytics', icon: <TrendingUp size={20} /> },
    { name: 'Manage Shops', path: '/shops', icon: <Store size={20} /> },
    { name: 'Billing & Subs', path: '/subscriptions', icon: <CreditCard size={20} /> },
    { name: 'Subscription Plans', path: '/plans', icon: <Zap size={20} /> },
    { name: 'Support Tickets', path: '/tickets', icon: <LifeBuoy size={20} /> },
    { name: 'System Logs', path: '/audit-logs', icon: <Activity size={20} /> },
    { name: 'Email Broadcasts', path: '/broadcast', icon: <Send size={20} /> },
  ]

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6">
          <div className="flex items-center gap-3 text-white mb-2">
            <div className="bg-blue-600 p-2 rounded-lg">
              <ShieldAlert size={24} />
            </div>
            <div>
              <h1 className="font-black text-lg leading-tight uppercase tracking-wider">Superadmin</h1>
              <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">Global Control</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm transition-all ${location.pathname === item.path
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
            >
              {item.icon}
              {item.name}
            </Link>
          ))}
        </nav>

        <div className="p-4 mt-auto">
          <div className="bg-slate-800 rounded-xl p-4 mb-3 border border-slate-700">
            <p className="text-xs text-slate-400 font-bold uppercase mb-1">Signed in as</p>
            <p className="text-sm text-white font-medium truncate">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-500/10 hover:bg-red-500 hover:text-white text-red-400 rounded-xl font-bold text-sm transition"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-100 flex items-center px-8 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">
            {navItems.find(i => i.path === location.pathname)?.name || 'Dashboard'}
          </h2>
        </header>

        <main className="flex-1 overflow-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
