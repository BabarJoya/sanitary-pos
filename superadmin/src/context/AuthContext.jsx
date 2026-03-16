import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, supabaseAdmin } from '../services/supabase'

const AuthContext = createContext()

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await fetchProfile(session.user)
      } else {
        setLoading(false)
      }
    }

    checkSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          await fetchProfile(session.user)
        } else {
          setUser(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (authUser) => {
    try {
      if (!supabaseAdmin) {
        throw new Error('Missing Service Role Key required for Superadmin Auth.')
      }

      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single()

      if (error) throw error

      if (data.role !== 'superadmin') {
        // Kick them out if they are not superadmin
        await supabase.auth.signOut()
        alert('Access Denied. Superadmin privileges required.')
        setUser(null)
      } else {
        setUser({ ...authUser, ...data })
      }
    } catch (err) {
      console.error('Error fetching profile:', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  const logout = async () => {
    await supabase.auth.signOut()
    setUser(null)
  }

  const impersonate = (shopId, shopData) => {
    // We create a mocked session for the POS window
    const impersonatedUser = {
      id: `impersonated-${shopId}`,
      username: `Superadmin (${shopData.name})`,
      role: 'admin',
      shop_id: shopId,
      isImpersonating: true
    }

    // POS context looks for 'user' and 'originalUser' in localstorage
    localStorage.setItem('originalUser', JSON.stringify(user)) // Save the real superadmin
    localStorage.setItem('user', JSON.stringify(impersonatedUser)) // Set the fake POS admin
    localStorage.setItem('shop_name', shopData.name)
    if (shopData.logo_url) {
      localStorage.setItem('shop_logo', shopData.logo_url)
    } else {
      localStorage.removeItem('shop_logo')
    }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, impersonate, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
