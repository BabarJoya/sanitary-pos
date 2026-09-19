import { createContext, useState, useContext, useEffect } from 'react'
import { db } from '../services/db'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })

  const [originalUser, setOriginalUser] = useState(() => {
    const saved = localStorage.getItem('originalUser')
    return saved ? JSON.parse(saved) : null
  })

  // On every app load: if user is logged in but user_pw_hash is missing
  // (e.g. existing session before this feature was added), try to restore
  // the hash from IndexedDB so PasswordModal works without re-login.
  useEffect(() => {
    const restoreHash = async () => {
      if (!user?.id || user.role === 'superadmin') return
      if (localStorage.getItem('user_pw_hash')) return // already cached
      try {
        const localUser = await db.users.get(user.id)
        if (localUser?.password) {
          localStorage.setItem('user_pw_hash', localUser.password)
        }
      } catch (_) { /* IndexedDB might be empty — user must re-login once */ }
    }
    restoreHash()
  }, [user?.id, user?.role])

  const login = (userData) => {
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
    if (userData.role === 'superadmin') {
      localStorage.setItem('superadmin_session', JSON.stringify(userData))
    }
  }

  const impersonate = (shopId, shopData) => {
    setOriginalUser(user)
    localStorage.setItem('originalUser', JSON.stringify(user))

    const impersonatedUser = {
      id: `impersonated-${shopId}`,
      username: `Superadmin (${shopData.name})`,
      role: 'admin',
      shop_id: String(shopId),
      isImpersonating: true
    }

    setUser(impersonatedUser)
    localStorage.setItem('user', JSON.stringify(impersonatedUser))
    localStorage.setItem(`shop_name_${shopId}`, shopData.name)
    if (shopData.logo_url) {
      localStorage.setItem(`shop_logo_${shopId}`, shopData.logo_url)
    } else {
      localStorage.removeItem(`shop_logo_${shopId}`)
    }
  }

  const stopImpersonating = () => {
    if (originalUser) {
      const currentShopId = user?.shop_id
      const restored = { ...originalUser }
      delete restored.isImpersonating

      setUser(restored)
      localStorage.setItem('user', JSON.stringify(restored))
      setOriginalUser(null)
      localStorage.removeItem('originalUser')
      if (currentShopId) {
        localStorage.removeItem(`shop_name_${currentShopId}`)
        localStorage.removeItem(`shop_logo_${currentShopId}`)
      }
      return restored
    }
    return null
  }

  const logout = () => {
    setUser(null)
    setOriginalUser(null)
    localStorage.removeItem('user')
    localStorage.removeItem('originalUser')
    localStorage.removeItem('user_pw_hash')
    localStorage.removeItem('session_token')
    localStorage.removeItem('superadmin_session')
  }

  return (
    <AuthContext.Provider value={{ user, originalUser, login, logout, impersonate, stopImpersonating }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
