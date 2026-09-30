import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const serviceRoleKey = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY

export const supabaseAdmin = globalThis.__supabaseAdmin || (serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    storageKey: 'edgex-admin-auth-token',
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
    storage: {
      getItem: () => null,
      setItem: () => { },
      removeItem: () => { }
    }
  }
}) : null)

if (import.meta.env.DEV) {
  globalThis.__supabaseAdmin = supabaseAdmin
}

export default supabaseAdmin
