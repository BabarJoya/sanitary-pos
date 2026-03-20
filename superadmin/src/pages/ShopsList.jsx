import { useState, useEffect } from 'react'
import { supabase, supabaseAdmin } from '../services/supabase'
import { Search, Plus, CheckCircle2, XCircle, AlertTriangle, ExternalLink, Edit, Users, FileText } from 'lucide-react'
import CreateShopModal from '../components/CreateShopModal'
import EditShopModal from '../components/EditShopModal'
import ManageUsersModal from '../components/ManageUsersModal'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { logAction } from '../services/auditService'
import * as XLSX from 'xlsx'

export default function ShopsList() {
  const navigate = useNavigate()
  const { impersonate, user } = useAuth()
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingShop, setEditingShop] = useState(null)
  const [managingUsersShop, setManagingUsersShop] = useState(null)

  useEffect(() => {
    fetchShops()
  }, [])

  const fetchShops = async () => {
    if (!supabaseAdmin) {
      setErrorMsg('Service Role Key required. Add VITE_SUPABASE_SERVICE_ROLE_KEY to .env')
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // 1. Fetch shops
      const { data: shopsData, error: shopsError } = await supabaseAdmin
        .from('shops')
        .select('*, subscription_plans(name)')
        .order('created_at', { ascending: false })

      if (shopsError) throw shopsError

      // 2. Fetch user counts per shop
      const { data: userCounts, error: countsError } = await supabaseAdmin
        .from('users')
        .select('shop_id')

      if (countsError) throw countsError

      const countsMap = {}
      userCounts.forEach(u => {
        if (u.shop_id) {
          countsMap[u.shop_id] = (countsMap[u.shop_id] || 0) + 1
        }
      })

      const finalShops = shopsData.map(shop => ({
        ...shop,
        userCount: countsMap[shop.id] || 0
      }))

      setShops(finalShops)
    } catch (error) {
      console.error('Fetch error:', error)
      setErrorMsg('Failed to load shops. Check if subscription_plans table exists. Error: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleStatus = async (id, currentStatus) => {
    if (!supabaseAdmin) return
    const newStatus = currentStatus === 'active' ? 'suspended' : 'active'
    if (!confirm(`Are you sure you want to ${newStatus} this shop?`)) return

    const { error } = await supabaseAdmin
      .from('shops')
      .update({ status: newStatus })
      .eq('id', id)

    if (error) {
      alert('Failed to update status')
    } else {
      // Log the action
      await logAction({
        actor_id: user?.id,
        actor_email: user?.email || user?.username,
        action_type: newStatus === 'active' ? 'ACTIVATE_SHOP' : 'SUSPEND_SHOP',
        target_type: 'SHOP',
        target_id: id,
        details: { previousStatus: currentStatus, newStatus }
      })

      fetchShops()
    }
  }

  const handleImpersonate = async (shop) => {
    if (confirm(`Login as ${shop.name}? You will be temporarily signed out of the Superadmin portal.`)) {
      // Log the impersonation action
      await logAction({
        actor_id: user?.id,
        actor_email: user?.email || user?.username,
        action_type: 'IMPERSONATE_SHOP',
        target_type: 'SHOP',
        target_id: shop.id,
        details: { shopName: shop.name }
      })

      impersonate(shop.id, shop)
      const params = new URLSearchParams({
        impersonateId: shop.id,
        shopName: shop.name || '',
        logoUrl: shop.logo_url || ''
      }).toString()
      const posUrl = import.meta.env.VITE_POS_URL || 'http://localhost:5174'
      window.location.href = `${posUrl}/?${params}`
    }
  }

  const handleExport = () => {
    const dataToExport = filtered.map(shop => ({
      'Shop ID': shop.id,
      'Name': shop.name,
      'Phone': shop.phone || 'N/A',
      'Email': shop.email || 'N/A',
      'Address': shop.address || 'N/A',
      'Status': shop.status || 'active',
      'Joined Date': new Date(shop.created_at).toLocaleDateString(),
      'User Count': shop.userCount || 0,
      'Next Billing': shop.next_billing_date || 'N/A',
      'Notes': shop.notes || ''
    }))

    const ws = XLSX.utils.json_to_sheet(dataToExport)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Shops')
    XLSX.writeFile(wb, `EdgeX_Shops_Export_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const filtered = shops.filter(s => s.name?.toLowerCase().includes(search.toLowerCase()) || s.phone?.includes(search))

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Search shops by name or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl shadow-sm hover:bg-slate-50 transition-all active:scale-95 text-sm"
          >
            <FileText size={18} className="text-emerald-500" />
            Export
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 transition-all active:scale-95 text-sm"
          >
            <Plus size={18} />
            New Shop
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-50 text-red-600 p-4 border border-red-200 rounded-xl flex items-center gap-2 font-bold text-sm">
          <AlertTriangle size={20} />
          {errorMsg}
        </div>
      )}

      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-bold">
                <th className="p-4 pl-6">ID</th>
                <th className="p-4">Business Detail</th>
                <th className="p-4 hidden lg:table-cell">Location</th>
                <th className="p-4 text-center">Users</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-center hidden lg:table-cell">Joined</th>
                <th className="p-4 text-center hidden xl:table-cell">Last Active</th>
                <th className="p-4 text-right pr-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr><td colSpan="8" className="p-8 text-center text-slate-400">Loading tenants...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan="8" className="p-8 text-center text-slate-400">No shops found.</td></tr>
              ) : (
                filtered.map(shop => (
                  <tr key={shop.id} className="hover:bg-slate-50/50 transition">
                    <td className="p-4 pl-6 font-mono text-xs text-slate-400">#{shop.id}</td>
                    <td className="p-4">
                      <p className="font-bold text-slate-800">{shop.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{shop.phone || 'No phone'}</p>
                      <p className="text-[10px] text-blue-600 mt-0.5 font-mono truncate max-w-[150px]" title={shop.email}>{shop.email || 'No email'}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {(shop.subscription_plans?.name || shop.subscription_plan) ? (
                          <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-amber-200">
                            {shop.subscription_plans?.name || shop.subscription_plan}
                          </span>
                        ) : (
                          <span className="text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-red-200 flex items-center gap-1">
                            <AlertTriangle size={9} /> No Plan
                          </span>
                        )}
                      </div>
                      {shop.notes && <p className="text-[10px] text-slate-400 mt-1 italic line-clamp-2" title={shop.notes}>📝 {shop.notes}</p>}
                    </td>
                    <td className="p-4 text-slate-600 max-w-[180px] truncate hidden lg:table-cell" title={shop.address}>{shop.address || '-'}</td>
                    <td className="p-4 text-center">
                      <span className="bg-blue-50 text-blue-600 font-bold px-2.5 py-1 rounded-lg text-xs">{shop.userCount || 0}</span>
                    </td>
                    <td className="p-4 text-center">
                      {shop.status === 'active' || !shop.status ? (
                        <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 font-bold px-2.5 py-1 rounded-full text-xs">
                          <CheckCircle2 size={12} /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 font-bold px-2.5 py-1 rounded-full text-xs">
                          <XCircle size={12} /> Suspended
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-center text-slate-500 text-xs hidden lg:table-cell">
                      {new Date(shop.created_at).toLocaleDateString()}
                    </td>
                    <td className="p-4 text-center text-slate-500 text-xs font-mono hidden xl:table-cell">
                      {shop.last_sign_in_at ? new Date(shop.last_sign_in_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Never'}
                    </td>
                    <td className="p-4 pr-6 text-right">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        <button onClick={() => setManagingUsersShop(shop)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition flex items-center gap-1">
                          <Users size={13} /> Users
                        </button>
                        <button onClick={() => setEditingShop(shop)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition flex items-center gap-1">
                          <Edit size={13} /> Edit
                        </button>
                        <button onClick={() => handleImpersonate(shop)} className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition flex items-center gap-1">
                          <ExternalLink size={13} /> Login
                        </button>
                        <button
                          onClick={() => toggleStatus(shop.id, shop.status || 'active')}
                          className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition ${shop.status === 'active' || !shop.status ? 'border-orange-200 text-orange-600 hover:bg-orange-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}
                        >
                          {shop.status === 'active' || !shop.status ? 'Suspend' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="bg-white rounded-2xl p-6 text-center text-slate-400 shadow-sm border border-slate-200">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 text-center text-slate-400 shadow-sm border border-slate-200">No shops found.</div>
        ) : (
          filtered.map(shop => {
            const planName = shop.subscription_plans?.name || shop.subscription_plan || null
            const isActive = shop.status === 'active' || !shop.status
            return (
              <div key={shop.id} className={`bg-white rounded-2xl shadow-sm border p-4 space-y-3 ${!planName ? 'border-red-200' : 'border-slate-200'}`}>

                {/* No-plan warning banner */}
                {!planName && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 font-bold">
                    <AlertTriangle size={13} />
                    No subscription plan assigned — tap Edit to assign one.
                  </div>
                )}

                {/* Header row */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-black text-slate-800 text-base leading-tight truncate">{shop.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{shop.phone || 'No phone'}</p>
                    <p className="text-[10px] text-blue-600 font-mono truncate">{shop.email || 'No email'}</p>
                    {shop.address && <p className="text-[10px] text-slate-400 mt-0.5 truncate">📍 {shop.address}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-600 font-bold px-2 py-0.5 rounded-full text-xs">
                        <CheckCircle2 size={11} /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-red-50 text-red-600 font-bold px-2 py-0.5 rounded-full text-xs">
                        <XCircle size={11} /> Suspended
                      </span>
                    )}
                    {planName ? (
                      <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-black uppercase border border-amber-200">
                        {planName}
                      </span>
                    ) : (
                      <span className="text-[9px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded font-black uppercase border border-red-200">
                        No Plan
                      </span>
                    )}
                  </div>
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2 text-[10px] text-slate-400 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-100 flex-wrap">
                  <span className="font-mono font-bold text-slate-500">#{shop.id}</span>
                  <span>·</span>
                  <span><span className="font-bold text-slate-600">{shop.userCount || 0}</span> staff</span>
                  <span>·</span>
                  <span>Joined {new Date(shop.created_at).toLocaleDateString()}</span>
                  {shop.next_billing_date && (
                    <>
                      <span>·</span>
                      <span>Bill: {new Date(shop.next_billing_date).toLocaleDateString()}</span>
                    </>
                  )}
                </div>

                {shop.notes && (
                  <p className="text-[10px] text-slate-400 italic border-l-2 border-slate-200 pl-2 line-clamp-2">
                    📝 {shop.notes}
                  </p>
                )}

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setManagingUsersShop(shop)}
                    className="text-xs font-bold py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-95 transition flex items-center justify-center gap-1.5">
                    <Users size={14} /> Manage Users
                  </button>
                  <button onClick={() => setEditingShop(shop)}
                    className="text-xs font-bold py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-95 transition flex items-center justify-center gap-1.5">
                    <Edit size={14} /> Edit Details
                  </button>
                  <button onClick={() => handleImpersonate(shop)}
                    className="text-xs font-bold py-2.5 rounded-xl border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-95 transition flex items-center justify-center gap-1.5">
                    <ExternalLink size={14} /> Login as Shop
                  </button>
                  <button
                    onClick={() => toggleStatus(shop.id, shop.status || 'active')}
                    className={`text-xs font-bold py-2.5 rounded-xl border active:scale-95 transition flex items-center justify-center gap-1.5 ${
                      isActive ? 'border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                    }`}
                  >
                    {isActive ? <><XCircle size={14} /> Suspend</> : <><CheckCircle2 size={14} /> Activate</>}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {isModalOpen && (
        <CreateShopModal onClose={() => setIsModalOpen(false)} onCreated={fetchShops} />
      )}
      {editingShop && (
        <EditShopModal shop={editingShop} onClose={() => setEditingShop(null)} onUpdated={fetchShops} />
      )}
      {managingUsersShop && (
        <ManageUsersModal shop={managingUsersShop} onClose={() => setManagingUsersShop(null)} />
      )}
    </div>
  )
}
