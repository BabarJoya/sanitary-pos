// ============================================================================
// Data-integrity helpers shared by POS, Purchases, Sales returns and ledgers.
//
// - toIntId / isTempId: offline-created records carry UUID ids until they sync.
//   Never parseInt() a UUID: parseInt('7c9e...') === 7 links data to record #7.
// - adjustStock / adjustCustomerBalance / adjustSupplierBalance: apply a
//   *change* atomically in the database (sql/data_integrity_migration.sql)
//   instead of writing a total computed from stale browser data. Offline (or
//   when the target record is not synced yet) the change is queued and replayed
//   by syncService as the same atomic call.
// ============================================================================
import { supabase } from './supabase'
import { db, addToSyncQueue } from './db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isTempId = (v) => typeof v === 'string' && UUID_RE.test(v.trim())

// Strict integer id: '12' → 12, 12 → 12, UUID / '' / null → null
export function toIntId(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null
  const s = String(v ?? '').trim()
  return /^\d+$/.test(s) ? parseInt(s, 10) : null
}

// supabase-js reports network failures as an error object (it does not throw)
export function isNetworkError(err) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = String(err?.message || err || '')
  return /Failed to fetch|NetworkError|Load failed|network request failed|fetch failed/i.test(msg)
}

// Function not deployed yet (migration not run) → PostgREST PGRST202 / Postgres 42883
const isMissingFunction = (err) => err && (err.code === 'PGRST202' || err.code === '42883')

const RPC_TARGETS = {
  adjust_product_stock:    { table: 'products',  column: 'stock_quantity',      idParam: 'p_product_id' },
  adjust_customer_balance: { table: 'customers', column: 'outstanding_balance', idParam: 'p_customer_id' },
  adjust_supplier_balance: { table: 'suppliers', column: 'outstanding_balance', idParam: 'p_supplier_id' },
}

async function getLocal(table, id) {
  return (await db[table].get(id)) || (toIntId(id) != null ? await db[table].get(toIntId(id)) : undefined)
}

// Apply the same delta to the local IndexedDB copy so screens update instantly
export async function applyLocalDelta(table, column, id, delta) {
  try {
    const rec = await getLocal(table, id)
    if (!rec) return
    await db[table].update(rec.id, { [column]: (Number(rec[column]) || 0) + delta })
  } catch (e) {
    console.warn(`integrity: local ${table}.${column} update failed`, e)
  }
}

/**
 * Run an atomic delta RPC online. Used by both the app and the sync queue.
 * Returns { ok: true } on success, { ok: false, network: true } when it
 * should be retried later, or { ok: false, error } for a hard failure.
 */
export async function runDeltaRpc(fn, params) {
  const target = RPC_TARGETS[fn]
  if (!target) return { ok: false, error: new Error(`Unknown delta function ${fn}`) }
  const delta = Number(params.p_delta) || 0
  const id = toIntId(params[target.idParam])
  if (id == null) return { ok: false, error: new Error(`${fn}: record not synced yet`), pendingRef: true }
  if (delta === 0) return { ok: true }

  const { error } = await supabase.rpc(fn, { [target.idParam]: id, p_delta: delta })
  if (!error) return { ok: true }
  if (isNetworkError(error)) return { ok: false, network: true, error }

  if (isMissingFunction(error)) {
    // Database not migrated yet: best effort read-live-then-write (still racy,
    // but never based on stale browser data). Run sql/data_integrity_migration.sql.
    console.warn(`${fn} missing — run sql/data_integrity_migration.sql. Using fallback update.`)
    const { data, error: readErr } = await supabase.from(target.table).select(target.column).eq('id', id).maybeSingle()
    if (readErr) return { ok: false, network: isNetworkError(readErr), error: readErr }
    if (!data) return { ok: false, error: new Error(`${target.table} ${id} not found`) }
    const next = (Number(data[target.column]) || 0) + delta
    const { error: writeErr } = await supabase.from(target.table).update({ [target.column]: next }).eq('id', id)
    if (writeErr) return { ok: false, network: isNetworkError(writeErr), error: writeErr }
    return { ok: true }
  }
  return { ok: false, error }
}

// Online when possible, otherwise queued. Local copy is always updated once.
async function adjust(fn, id, delta) {
  const target = RPC_TARGETS[fn]
  const d = Number(delta) || 0
  if (!d || id == null || id === '') return { ok: true }
  const params = { [target.idParam]: id, p_delta: d }

  let result = { ok: false, network: true }
  if (navigator.onLine && !isTempId(String(id))) {
    result = await runDeltaRpc(fn, params)
  }
  if (!result.ok && (result.network || isTempId(String(id)))) {
    await addToSyncQueue(fn, 'RPC', params)
    result = { ok: true, queued: true }
  }
  if (result.ok) await applyLocalDelta(target.table, target.column, id, d)
  return result
}

export const adjustStock = (productId, delta) => adjust('adjust_product_stock', productId, delta)
export const adjustCustomerBalance = (customerId, delta) => adjust('adjust_customer_balance', customerId, delta)
export const adjustSupplierBalance = (supplierId, delta) => adjust('adjust_supplier_balance', supplierId, delta)

// Unique-violation on client_ref means the row already exists (earlier attempt
// reached the server). Fetch it instead of creating a duplicate.
export async function findByClientRef(table, clientRef) {
  if (!clientRef) return null
  const { data } = await supabase.from(table).select('*').eq('client_ref', clientRef).maybeSingle()
  return data || null
}

// Strip columns an un-migrated database does not have yet (PGRST204 / 42703)
export const isMissingColumn = (err) => err && (err.code === 'PGRST204' || err.code === '42703')
