// ============================================================================
// "Try demo" — a full shop that lives only on this device.
//  - Uses its own local database (SanitaryPOS_Demo), so a real shop's saved
//    data and unsent changes on the same device are never touched.
//  - Never talks to the server (supabase.js blocks requests, sync is paused).
//  - Logging out deletes the demo database; the next demo starts fresh.
// ============================================================================

import Dexie from 'dexie'
import { DEMO_FLAG, DEMO_SEEDED, DEMO_SHOP_ID, DEMO_DB_NAME, isDemoMode } from '../utils/demoFlag'
import { buildDemoData } from './demoData'

export { isDemoMode, DEMO_SHOP_ID }

export const DEMO_USER = { id: 'demo-owner', username: 'Demo Owner', email: '', role: 'admin', shop_id: DEMO_SHOP_ID, permissions: [], isDemo: true }

const demoKeys = () => [
  DEMO_FLAG, DEMO_SEEDED,
  `shop_name_${DEMO_SHOP_ID}`, `shop_logo_${DEMO_SHOP_ID}`, `shop_settings_${DEMO_SHOP_ID}`,
  `plan_limits_${DEMO_SHOP_ID}`, `plan_features_${DEMO_SHOP_ID}`, 'edgex_sync_discarded_demo',
]

// Login page button: switch this tab to demo mode and reload into the dashboard
export async function startDemo() {
  // Leftovers from an earlier demo (e.g. the tab was closed without logging out)
  await wipeDemoStorage()
  const settings = { business_type: 'sanitary', wholesale_enabled: true, bill_qr: true, theme_mode: 'light', owner_whatsapp: '' }
  localStorage.setItem(`shop_name_${DEMO_SHOP_ID}`, 'Demo Sanitary Store')
  localStorage.setItem(`shop_settings_${DEMO_SHOP_ID}`, JSON.stringify(settings))
  localStorage.setItem(`plan_limits_${DEMO_SHOP_ID}`, JSON.stringify({ product_limit: 500, user_limit: 5, plan_name: 'DEMO' }))
  localStorage.setItem(`plan_features_${DEMO_SHOP_ID}`, JSON.stringify({}))
  localStorage.setItem('user', JSON.stringify(DEMO_USER))
  localStorage.setItem(DEMO_FLAG, '1')
  window.location.assign('/dashboard')
}

// App start (main.jsx, before the first render): fill the demo database once
export async function ensureDemoSeeded(db) {
  if (!isDemoMode()) return
  // Demo flag without a demo login (storage partly cleared): leave demo mode
  let user = null
  try { user = JSON.parse(localStorage.getItem('user') || 'null') } catch { /* ignore */ }
  if (!user?.isDemo) { await wipeDemoStorage(); window.location.replace('/'); return }
  if (localStorage.getItem(DEMO_SEEDED) === '1' && (await db.products.count()) > 0) return

  const d = buildDemoData(new Date())
  await db.transaction('rw', [db.shops, db.users, db.categories, db.brands, db.products, db.customers, db.suppliers, db.sales, db.sale_items, db.customer_payments, db.supplier_payments, db.purchases, db.purchase_items, db.expenses], async () => {
    await db.shops.put(d.shop)
    await db.users.bulkPut(d.users)
    await db.categories.bulkPut(d.categories)
    await db.brands.bulkPut(d.brands)
    await db.products.bulkPut(d.products)
    await db.customers.bulkPut(d.customers)
    await db.suppliers.bulkPut(d.suppliers)
    await db.sales.bulkPut(d.sales)
    await db.sale_items.bulkPut(d.sale_items)
    await db.customer_payments.bulkPut(d.customer_payments)
    await db.supplier_payments.bulkPut(d.supplier_payments)
    await db.purchases.bulkPut(d.purchases)
    await db.purchase_items.bulkPut(d.purchase_items)
    await db.expenses.bulkPut(d.expenses)
  })
  localStorage.setItem(DEMO_SEEDED, '1')
}

// Remove every trace of the demo from this device (real shop data is untouched)
export async function wipeDemoStorage() {
  for (const k of demoKeys()) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null')
    if (u?.isDemo) localStorage.removeItem('user')
  } catch { /* ignore */ }
  try {
    for (const k of Object.keys(sessionStorage)) if (k.includes(String(DEMO_SHOP_ID))) sessionStorage.removeItem(k)
  } catch { /* ignore */ }
  try { await Dexie.delete(DEMO_DB_NAME) } catch { /* ignore */ }
}

// Logout from the demo: wipe and reload, so the real local database opens again
export async function endDemo(db) {
  try { db?.close() } catch { /* ignore */ }
  await wipeDemoStorage()
  window.location.replace('/')
}
