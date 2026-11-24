// ============================================================================
// Demo mode switch ("Try demo" on the login page). Read by db.js (which local
// database to open), supabase.js (no server calls) and syncService (no upload).
// No imports, so any module can use it without import cycles.
// ============================================================================

export const DEMO_FLAG = 'edgex_demo_mode'
export const DEMO_SEEDED = 'edgex_demo_seeded'
export const DEMO_SHOP_ID = 900001
export const DEMO_DB_NAME = 'SanitaryPOS_Demo'

export function isDemoMode() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(DEMO_FLAG) === '1' } catch { return false }
}
