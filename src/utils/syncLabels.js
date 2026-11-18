// ============================================================================
// Plain-language labels for items in the offline sync queue (Sync status page).
// Pure functions — no database access — so they are easy to test.
// ============================================================================

const TABLE_LABELS = {
  sales: 'Sale', sale_items: 'Sale item', purchases: 'Purchase', purchase_items: 'Purchase item',
  customers: 'Customer', customer_payments: 'Customer payment', suppliers: 'Supplier',
  supplier_payments: 'Supplier payment', products: 'Product', expenses: 'Expense', brands: 'Brand',
  units: 'Unit', shops: 'Shop settings', audit_logs: 'Activity log', categories: 'Category',
  cash_shifts: 'Shift close',
}
const TX_LABELS = {
  complete_sale: 'Sale (bill)', complete_purchase: 'Purchase (bill)',
  process_sale_return: 'Sale return', process_purchase_return: 'Purchase return',
}
const RPC_LABELS = {
  adjust_product_stock: 'Stock change', adjust_customer_balance: 'Customer balance change',
  adjust_supplier_balance: 'Supplier balance change',
}
const ACTION_LABELS = { INSERT: 'New', UPDATE: 'Edit', DELETE: 'Delete', TX: '', RPC: '' }

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const money = (v) => `Rs. ${Math.round(Number(v) || 0).toLocaleString()}`

// { title, detail, amount } for one queued item
export function describeSyncItem(item) {
  const { table, action } = item || {}
  const data = item?.data || {}
  if (action === 'TX') {
    const p = data.params || {}
    const head = p.p_sale || p.p_purchase || {}
    const lines = Array.isArray(p.p_items) ? p.p_items.length : null
    const amount = num(head.total_amount ?? p.p_refund_total ?? p.p_total)
    const who = head.customer_name || head.supplier_name || ''
    return {
      title: TX_LABELS[table] || table,
      detail: [who, lines != null ? `${lines} item${lines === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '),
      amount,
    }
  }
  if (action === 'RPC') {
    const delta = num(data.p_delta)
    return { title: RPC_LABELS[table] || table, detail: delta != null ? `${delta > 0 ? '+' : ''}${delta}` : '', amount: null }
  }
  const rows = Array.isArray(data) ? data : [data]
  const first = rows[0] || {}
  const name = first.name || first.product_name || first.customer_name || first.supplier_name || first.description || first.username || first.note || ''
  const amount = num(first.amount ?? first.total_amount ?? first.paid_amount ?? first.counted_cash)
  const base = TABLE_LABELS[table] || table
  return {
    title: ACTION_LABELS[action] ? `${ACTION_LABELS[action]} ${base.toLowerCase()}` : base,
    detail: [name, rows.length > 1 ? `${rows.length} rows` : ''].filter(Boolean).join(' · '),
    amount,
  }
}

// Why it failed, in the shopkeeper's words, plus what to do
export function explainSyncError(message = '', { failed = false, waiting = false } = {}) {
  const m = String(message || '')
  if (waiting) return { text: 'Waiting for an earlier change to send first.', hint: 'Nothing to do — it goes automatically.' }
  if (!m) return { text: failed ? 'Stopped after several tries.' : 'Waiting to send.', hint: failed ? 'Tap Retry when online.' : 'Sends automatically when online.' }
  if (/Failed to fetch|NetworkError|Load failed|timeout/i.test(m)) return { text: 'No internet connection when it tried.', hint: 'Tap Retry when the internet is back.' }
  if (/duplicate key|23505|already exists/i.test(m)) return { text: 'This is already on the server.', hint: 'Safe to Discard.' }
  if (/42501|permission|not allowed|row-level security|JWT|session/i.test(m)) return { text: 'The server did not allow it (login expired or no permission).', hint: 'Log out and in again, then Retry.' }
  if (/column .* does not exist|PGRST204|PGRST205|42P01|42703|function .* does not exist|schema cache/i.test(m)) return { text: 'The database needs an update for this.', hint: 'Ask EdgeX support to run the latest database update, then Retry.' }
  if (/invalid input syntax|22P02|23502|null value|23503|foreign key/i.test(m)) return { text: 'Some details were missing or did not match a record on the server.', hint: 'Copy details and send them to EdgeX support.' }
  if (/stock|insufficient|negative/i.test(m)) return { text: 'Stock rule stopped it on the server.', hint: 'Check the product stock, then Retry.' }
  return { text: m.length > 140 ? m.slice(0, 140) + '…' : m, hint: failed ? 'Retry, or copy details for EdgeX support.' : 'It will try again automatically.' }
}

export const formatSyncAmount = (a) => (a == null ? '' : money(a))
