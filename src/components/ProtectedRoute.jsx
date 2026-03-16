import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../services/supabase'
import { useEffect, useState } from 'react'

function ProtectedRoute({ children, allowedRoles, requiredModule }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [isChecking, setIsChecking] = useState(true)
  const [isSuspended, setIsSuspended] = useState(false)

  useEffect(() => {
    let isMounted = true;

    async function checkStatus() {
      if (!user?.shop_id || user.role === 'superadmin') {
        if (isMounted) setIsChecking(false);
        return;
      }

      try {
        if (!navigator.onLine) {
          // If offline, let them proceed (Login checked local DB already) if they are currently logged in.
          // However if we had a cached status we could check here too.
          if (isMounted) setIsChecking(false);
          return;
        }

        const { data, error } = await supabase
          .rpc('get_shop_status', { p_shop_id: user.shop_id })

        if (error) throw error

        if (isMounted) {
          if (!user.isImpersonating && data === 'suspended') {
            setIsSuspended(true)
          }
          setIsChecking(false)
        }
      } catch (err) {
        if (isMounted) setIsChecking(false)
      }
    }

    checkStatus()

    return () => {
      isMounted = false;
    }
  }, [user])

  if (!user) return <Navigate to="/" />

  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (isSuspended) {
    alert('Aap ka account fee na-adaiyegy ki wajah se muattal (suspended) kar diya gaya hai. Baraye meharbani support se rabta karein: 0301-2616367')
    logout()
    return <Navigate to="/" />
  }

  // Admins bypass all module restrictions (but not suspensions, except superadmin)
  if (user.role === 'admin' || user.role === 'superadmin') return children

  // Check if user has specific module permissions assigned.
  // If not, fall back to the legacy allowedRoles behavior.
  const hasLegacyRole = allowedRoles ? allowedRoles.includes(user.role) : true
  const hasPermission = user.permissions && Array.isArray(user.permissions) && requiredModule
    ? user.permissions.includes(requiredModule)
    : hasLegacyRole

  if (!hasPermission) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-4xl mb-3">🚫</p>
          <h2 className="text-xl font-bold text-gray-700">Access Denied</h2>
          <p className="text-gray-400 mt-1">Aap ka is page tak access nahi hai.</p>
        </div>
      </div>
    )
  }

  return children
}

export default ProtectedRoute