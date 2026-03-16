import { createContext, useState, useContext } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })

  // To track the superadmin user when they impersonate a shop
  const [originalUser, setOriginalUser] = useState(() => {
    const saved = localStorage.getItem('originalUser')
    return saved ? JSON.parse(saved) : null
  })

  const login = (userData) => {
    setUser(userData)
    localStorage.setItem('user', JSON.stringify(userData))
  }

  const impersonate = (shopId, shopData) => {
    // Save the current superadmin
    setOriginalUser(user)
    localStorage.setItem('originalUser', JSON.stringify(user))

    // Create a fake admin session for that shop
    const impersonatedUser = {
      id: `impersonated-${shopId}`,
      username: `Superadmin (${shopData.name})`,
      role: 'admin',
      shop_id: shopId,
      isImpersonating: true
    }

    setUser(impersonatedUser)
    localStorage.setItem('user', JSON.stringify(impersonatedUser))
    localStorage.setItem('shop_name', shopData.name)
    if (shopData.logo_url) {
      localStorage.setItem('shop_logo', shopData.logo_url)
    } else {
      localStorage.removeItem('shop_logo')
    }
  }

  const stopImpersonating = () => {
    if (originalUser) {
      setUser(originalUser)
      localStorage.setItem('user', JSON.stringify(originalUser))
      setOriginalUser(null)
      localStorage.removeItem('originalUser')
      localStorage.removeItem('shop_name')
      localStorage.removeItem('shop_logo')
    }
  }

  const logout = () => {
    setUser(null)
    setOriginalUser(null)
    localStorage.removeItem('user')
    localStorage.removeItem('originalUser')
    localStorage.removeItem('shop_name')
    localStorage.removeItem('shop_logo')
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
