import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: false, // We handle sessions manually
        autoRefreshToken: false
    },
    global: {
        headers: {
            'x-application-name': 'edgex-pos'
        }
    }
})

// ============================================================================
// RLS SESSION MANAGER - Industry Standard Implementation
// ============================================================================

class RLSSessionManager {
    constructor() {
        this.sessionRestored = false
        this.restorePromise = null
    }

    /**
     * Restore RLS session from localStorage
     * This is called automatically on app load and after login
     */
    async restore() {
        // Prevent multiple simultaneous restore calls
        if (this.restorePromise) {
            return this.restorePromise
        }

        this.restorePromise = this._doRestore()
        const result = await this.restorePromise
        this.restorePromise = null
        return result
    }

    async _doRestore() {
        try {
            const userStr = localStorage.getItem('user')
            if (!userStr) {
                this.sessionRestored = false
                return { success: false, reason: 'no_user' }
            }

            const user = JSON.parse(userStr)

            // Validate user data
            if (!user.id || !user.shop_id || !user.role) {
                console.warn('⚠️ Incomplete user data in localStorage')
                this.sessionRestored = false
                return { success: false, reason: 'invalid_user_data' }
            }

            // Set RLS session claims
            const { error } = await supabase.rpc('set_custom_claims', {
                user_id: user.id,
                shop_id: user.shop_id,
                user_role: user.role
            })

            if (error) {
                console.error('❌ Failed to restore RLS session:', error.message)
                this.sessionRestored = false
                return { success: false, reason: 'rpc_error', error }
            }

            this.sessionRestored = true
            console.log('✅ RLS session restored:', {
                shop_id: user.shop_id,
                role: user.role,
                user_id: user.id.substring(0, 8) + '...'
            })

            return { success: true, user }
        } catch (err) {
            console.error('❌ Error restoring RLS session:', err)
            this.sessionRestored = false
            return { success: false, reason: 'exception', error: err }
        }
    }

    /**
     * Set session claims after login
     */
    async setSession(user) {
        try {
            const { error } = await supabase.rpc('set_custom_claims', {
                user_id: user.id,
                shop_id: user.shop_id,
                user_role: user.role
            })

            if (error) {
                console.error('❌ Failed to set session:', error)
                return { success: false, error }
            }

            this.sessionRestored = true
            return { success: true }
        } catch (err) {
            console.error('❌ Error setting session:', err)
            return { success: false, error: err }
        }
    }

    /**
     * Clear session on logout
     */
    clear() {
        this.sessionRestored = false
    }

    /**
     * Check if session is currently active
     */
    async isActive() {
        try {
            const { data, error } = await supabase.rpc('current_shop_id')
            return !error && data !== null
        } catch {
            return false
        }
    }

    /**
     * Ensure session is restored before a critical operation
     */
    async ensureSession() {
        if (this.sessionRestored) {
            return { success: true }
        }
        return await this.restore()
    }
}

export const rlsSession = new RLSSessionManager()

// ============================================================================
// SUPABASE WRAPPER WITH AUTOMATIC RLS SESSION
// ============================================================================

/**
 * Enhanced Supabase client that automatically ensures RLS session
 * Use this for all database operations in your app
 */
export const db = {
    /**
     * SELECT with automatic session check
     */
    async select(table, query = '*', options = {}) {
        await rlsSession.ensureSession()

        let builder = supabase.from(table).select(query)

        if (options.filter) {
            Object.entries(options.filter).forEach(([key, value]) => {
                builder = builder.eq(key, value)
            })
        }

        if (options.order) {
            builder = builder.order(options.order.column, { ascending: options.order.ascending })
        }

        if (options.limit) {
            builder = builder.limit(options.limit)
        }

        return builder
    },

    /**
     * INSERT with automatic shop_id injection and session check
     */
    async insert(table, data, options = {}) {
        await rlsSession.ensureSession()

        const user = JSON.parse(localStorage.getItem('user') || '{}')

        // Auto-inject shop_id if not present (except for superadmin-only tables)
        const superadminTables = ['subscription_plans', 'announcements', 'email_templates']
        const shouldInjectShopId = !superadminTables.includes(table) && user.shop_id && !data.shop_id

        const insertData = shouldInjectShopId
            ? { ...data, shop_id: user.shop_id }
            : data

        return supabase.from(table).insert(insertData).select()
    },

    /**
     * UPDATE with automatic session check
     */
    async update(table, id, data) {
        await rlsSession.ensureSession()
        return supabase.from(table).update(data).eq('id', id).select()
    },

    /**
     * DELETE with automatic session check
     */
    async delete(table, id) {
        await rlsSession.ensureSession()
        return supabase.from(table).delete().eq('id', id)
    },

    /**
     * RPC call with automatic session check
     */
    async rpc(functionName, params = {}) {
        // Don't check session for session management functions themselves
        const sessionFunctions = ['secure_login', 'set_custom_claims', 'current_shop_id', 'current_role']
        if (!sessionFunctions.includes(functionName)) {
            await rlsSession.ensureSession()
        }

        return supabase.rpc(functionName, params)
    }
}

// Auto-restore session when module loads
if (typeof window !== 'undefined') {
    // Restore immediately
    rlsSession.restore()

    // Re-restore on visibility change (user comes back to tab)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            rlsSession.restore()
        }
    })

    // Re-restore on focus (extra safety)
    window.addEventListener('focus', () => {
        rlsSession.restore()
    })
}

// Named exports for backward compatibility
export { supabase as default }
export const restoreRLSSession = () => rlsSession.restore()