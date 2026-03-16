import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'
import { db } from '../services/db'
import { hashPassword } from '../utils/authUtils'
import { motion, AnimatePresence } from 'framer-motion'
import { Store, ShieldCheck, Zap, PhoneCall, Eye, EyeOff } from 'lucide-react'

function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const logoUrl = '/edgex_pos_logo_platform.png'
  const platformName = 'EdgeX Digital'

  const { login, impersonate } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // Handle cross-port impersonation via URL
  useEffect(() => {
    const impId = searchParams.get('impersonateId')
    if (impId) {
      const shopName = searchParams.get('shopName') || 'Impersonated Shop'
      const logoUrl = searchParams.get('logoUrl') || ''
      impersonate(impId, { name: shopName, logo_url: logoUrl })

      // Clear URL params so they don't persist
      setSearchParams({})
      navigate('/dashboard', { replace: true })
    }
  }, [searchParams, impersonate, navigate, setSearchParams])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const hashedPassword = await hashPassword(password)

      // Try online login first
      const { data, error: dbError } = await supabase
        .from('users')
        .select('*')
        .or(`username.eq.${username},email.eq.${username}`)
        .eq('password', hashedPassword)
        .eq('is_active', true)
        .single()

      if (dbError || !data) {
        if (dbError && dbError.message.includes('multiple rows')) {
          setError('Iss username ke kaayi accounts hain. Meharbani karke Email se login karein.')
        } else {
          setError('Username ya password galat hai!')
        }
        setLoading(false)
        return
      }

      // Securely fetch Shop Config (Status, Limits, etc.) via RPC
      const { data: shopConfig, error: shopError } = await supabase
        .rpc('get_shop_config', { p_shop_id: data.shop_id })

      if (shopError) {
        throw shopError
      }

      if (shopConfig.status === 'suspended') {
        setError('Your account has been suspended. Please contact administrator.')
        setLoading(false)
        return
      }

      // Store plan limits for enforcement
      localStorage.setItem('plan_limits', JSON.stringify({
        product_limit: shopConfig.product_limit || 100,
        user_limit: shopConfig.user_limit || 3,
        plan_name: shopConfig.plan_name || 'TRIAL'
      }))

      // Save user to local DB for future offline logins
      try {
        await db.users.put(data)
      } catch (_) { /* ignore local DB errors */ }

      // Update last active timestamps
      try {
        const now = new Date().toISOString()
        await supabase.from('users').update({ last_sign_in_at: now }).eq('id', data.id)
        if (data.shop_id) {
          await supabase.from('shops').update({ last_sign_in_at: now }).eq('id', data.shop_id)
        }
      } catch (tsError) {
        console.warn('Silent fail: could not update last login timestamp', tsError)
      }

      login({
        id: data.id,
        username: data.username,
        role: data.role,
        shop_id: data.shop_id,
        permissions: data.permissions || []
      })
      navigate('/dashboard')
    } catch (networkErr) {
      // Offline — try local DB fallback
      console.log('Online login failed, trying offline fallback...', networkErr)
      try {
        const localUser = await db.users
          .where('username').equals(username)
          .first()

        if (localUser && localUser.password === hashedPassword && localUser.is_active !== false) {
          // In offline mode, we can't fetch the latest shop status, but we should check if we cached it.
          // For now, if they are offline, we allow it based on their last known local DB state.
          // True enforcement happens when they come online.
          login({
            id: localUser.id,
            username: localUser.username,
            role: localUser.role,
            shop_id: localUser.shop_id,
            permissions: localUser.permissions || []
          })
          navigate('/dashboard')
        } else {
          setError('Offline mode: Username ya password galat hai! Pehle online login karein taake credentials save ho sakein.')
        }
      } catch (localErr) {
        console.error('Offline login error:', localErr)
        setError('Offline login fail ho gaya. Pehle internet connect karke ek baar login karein.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Left Side - Branding & Features (Hidden on Mobile) */}
      <div className="hidden lg:flex w-1/2 bg-[url('/inventory-bg.png')] bg-cover bg-left relative p-12 flex-col justify-between overflow-hidden">
        {/* Dark Overlay for Text Legibility */}
        <div className="absolute inset-0 bg-slate-900/60 z-0" />

        {/* Background Gradients (Over the overlay for dramatic effect) */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-emerald-600/20 rounded-full blur-3xl translate-y-1/3 -translate-x-1/3" />

        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-3 mb-16"
          >
            <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 p-2 shadow-xl flex items-center justify-center overflow-hidden">
              <img src="/edgex_pos_logo_platform.png" alt="EdgeX Digital" className="max-w-full max-h-full object-contain drop-shadow-md" />
            </div>
            <span className="text-2xl font-black text-white tracking-widest uppercase">EdgeX Digital</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="max-w-xl"
          >
            <h1 className="text-5xl font-black text-white leading-tight mb-6">
              Smart Retail Management
              <span className="block text-blue-500">Simplified.</span>
            </h1>
            <p className="text-lg text-slate-400 mb-12">
              The all-in-one point of sale system designed to scale your business, manage inventory, and boost sales.
            </p>

            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <Zap className="text-blue-400" size={20} />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Lightning Fast</h3>
                  <p className="text-sm text-slate-400">Offline-first local database</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <ShieldCheck className="text-emerald-400" size={20} />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Bank-Level Security</h3>
                  <p className="text-sm text-slate-400">Role-based access & encryption</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.6 }}
          className="relative z-10"
        >
          <p className="text-sm text-slate-500 font-medium">
            Developed with <span className="text-red-500">❤︎</span> by EdgeX Digital & Babar Joya
          </p>
          <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <PhoneCall size={14} className="text-slate-400" />
            <span className="font-mono text-sm text-slate-300">Support: 0301-2616367</span>
          </div>
        </motion.div>
      </div>

      {/* Right Side - Login Form (Dark Mode Glassmorphic) */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-slate-900 relative border-l border-slate-800">
        {/* Subtle right side glow */}
        <div className="absolute top-1/4 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10"
        >
          {/* Mobile Header (Only visible on small screens) */}
          <div className="lg:hidden text-center mb-10 flex flex-col items-center">
            <div className="w-20 h-20 mb-4 rounded-xl border border-slate-700 p-1 bg-slate-800 shadow-sm flex items-center justify-center overflow-hidden">
              <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain" />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight uppercase">{platformName}</h1>
          </div>

          {/* Desktop Logo */}
          <div className="hidden lg:flex flex-col items-center mb-10">
            <div className="w-28 h-28 mb-4 rounded-2xl border-2 border-slate-700 p-2 bg-slate-800/50 backdrop-blur-md shadow-2xl flex items-center justify-center overflow-hidden">
              <img src={logoUrl} alt={platformName} className="max-w-full max-h-full object-contain drop-shadow-lg" />
            </div>
          </div>

          <div className="mb-10 text-center lg:text-left">
            <h2 className="text-3xl font-bold text-white mb-2">Welcome Back</h2>
            <p className="text-slate-400">Please sign in to your dashboard</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Email or Username</label>
              <input
                type="text"
                placeholder="Enter email or username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-5 py-4 bg-slate-800/50 border border-slate-700 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-slate-800 transition-all shadow-inner"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-5 py-4 bg-slate-800/50 border border-slate-700 text-white placeholder-slate-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 focus:bg-slate-800 transition-all shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="overflow-hidden"
                >
                  <p className="text-red-600 text-sm font-medium bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                    {error}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-blue-600/30 active:scale-[0.98] flex justify-center items-center h-14"
            >
              {loading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  className="w-6 h-6 border-2 border-white/20 border-t-white rounded-full"
                />
              ) : (
                'Sign In to Dashboard'
              )}
            </button>
          </form>

          <div className="mt-10 lg:hidden text-center">
            <div className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-slate-800/50 rounded-xl border border-slate-700">
              <PhoneCall size={16} className="text-slate-400" />
              <span className="font-mono font-bold text-slate-400">Support: 0301-2616367</span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default Login