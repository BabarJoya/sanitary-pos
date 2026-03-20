import { useState, useEffect } from 'react'
import { supabase, supabaseAdmin } from '../services/supabase'
import { X, Store, User, Mail, Key, Zap, AlertTriangle } from 'lucide-react'
import { hashPassword } from '../utils/authUtils'

export default function CreateShopModal({ onClose, onCreated }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form State
  const [shopName, setShopName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerUsername, setOwnerUsername] = useState('')
  const [ownerPassword, setOwnerPassword] = useState('')
  const [selectedPlanId, setSelectedPlanId] = useState('')

  // Plans
  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(true)

  useEffect(() => {
    fetchPlans()
  }, [])

  const fetchPlans = async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from('subscription_plans')
        .select('id, name, price, billing_cycle')
        .order('price', { ascending: true })
      if (!error) setPlans(data || [])
    } catch (err) {
      console.error('Failed to load plans:', err)
    } finally {
      setPlansLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!supabaseAdmin) {
      setError("Setup Error: Missing VITE_SUPABASE_SERVICE_ROLE_KEY in .env file. Cannot create users without it.")
      return
    }
    if (!selectedPlanId) {
      setError('Please select a subscription plan for this shop.')
      return
    }

    setError('')
    setLoading(true)

    try {
      // 1. Create the Shop with plan_id
      const { data: shopData, error: shopError } = await supabaseAdmin
        .from('shops')
        .insert([{ name: shopName, phone, address, email: ownerEmail, status: 'active', plan_id: selectedPlanId }])
        .select()
        .single()

      if (shopError) throw new Error('Failed to create shop: ' + shopError.message)

      // 2. Create the Owner Auth User via Admin API
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        user_metadata: {
          role: 'admin',
          shop_id: shopData.id
        }
      })

      if (authError) {
        // Rollback shop if user creation fails
        await supabaseAdmin.from('shops').delete().eq('id', shopData.id)
        throw new Error('Failed to create user account: ' + authError.message)
      }

      // 3. Ensure the public users table is updated
      const hashedPassword = await hashPassword(ownerPassword)
      const { error: profileError } = await supabaseAdmin
        .from('users')
        .insert([{
          id: authData.user.id,
          username: ownerUsername || ownerEmail.split('@')[0],
          email: ownerEmail,
          password: hashedPassword,
          role: 'admin',
          shop_id: shopData.id,
          is_active: true
        }])

      if (profileError) {
        console.warn('Profile update warning:', profileError)
      }

      onCreated()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const selectedPlan = plans.find(p => p.id === selectedPlanId)

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Register New Tenant</h2>
            <p className="text-xs text-slate-500">Create a shop and its owner account instantly.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-xl shadow-sm border border-slate-200">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium border border-red-100 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Subscription Plan — first & required */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100">
              <Zap size={18} className="text-amber-500" /> Subscription Plan <span className="text-red-500 text-xs font-bold ml-1">Required</span>
            </h3>
            {plansLoading ? (
              <div className="text-xs text-slate-400 py-2">Loading plans...</div>
            ) : plans.length === 0 ? (
              <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-xs border border-amber-200 font-medium">
                No plans found. Please create a plan in <strong>Subscription Plans</strong> first.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {plans.map(plan => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`text-left p-3 rounded-xl border-2 transition-all ${
                      selectedPlanId === plan.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                    }`}
                  >
                    <p className={`font-bold text-sm ${selectedPlanId === plan.id ? 'text-blue-700' : 'text-slate-800'}`}>
                      {plan.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Rs. {plan.price?.toLocaleString()} / {plan.billing_cycle || 'month'}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {selectedPlan && (
              <p className="text-xs text-blue-600 font-bold mt-2">
                ✓ Selected: {selectedPlan.name} — Rs. {selectedPlan.price?.toLocaleString()}/{selectedPlan.billing_cycle || 'month'}
              </p>
            )}
          </div>

          {/* Shop Details */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100">
              <Store size={18} className="text-blue-500" /> Business Details
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Shop/Business Name</label>
                <input required type="text" value={shopName} onChange={e => setShopName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone Number</label>
                  <input type="text" value={phone} onChange={e => setPhone(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">City/Address</label>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                </div>
              </div>
            </div>
          </div>

          {/* Owner Account Details */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-4 pb-2 border-b border-slate-100">
              <User size={18} className="text-purple-500" /> Owner Account Setup
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Owner Email (Login ID)</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 text-slate-400" size={16} />
                    <input required type="email" value={ownerEmail}
                      onChange={e => {
                        setOwnerEmail(e.target.value)
                        if (!ownerUsername) setOwnerUsername(e.target.value.split('@')[0])
                      }}
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Preferred Username</label>
                  <input required type="text" value={ownerUsername} onChange={e => setOwnerUsername(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                    placeholder="e.g. shop_admin" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Temporary Password</label>
                <div className="relative">
                  <Key className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input required type="text" value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Provide this to the client. They can change it later.</p>
              </div>
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} disabled={loading}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={loading || !selectedPlanId || plans.length === 0}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-lg shadow-lg shadow-blue-500/30 transition disabled:opacity-50">
              {loading ? 'Creating Tenant...' : 'Initialize Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
