import { useEffect, useMemo, useState } from 'react'
import { db } from '../services/db'
import { OUTBOX_KINDS, waUrl, logWhatsApp } from '../utils/whatsapp'

// ============================================================================
// WhatsApp Outbox: every WhatsApp message this device prepared (bills,
// reminders, statements, links, daily summary, supplier orders), newest first,
// with resend / copy / delete. Kept on this device.
// ============================================================================

const when = (iso) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
}

export default function WhatsAppOutbox({ shopId }) {
  const [rows, setRows] = useState(null)
  const [kind, setKind] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState({})
  const [copiedId, setCopiedId] = useState(null)

  const load = async () => {
    try {
      const all = await db.wa_outbox.where('shop_id').equals(shopId).toArray()
      setRows(all.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))))
    } catch {
      setRows([])
    }
  }
  useEffect(() => { load() // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter(r => (kind === 'all' || r.kind === kind) &&
      (!q || `${r.name} ${r.phone} ${r.text}`.toLowerCase().includes(q)))
  }, [rows, kind, search])

  const counts = useMemo(() => {
    const c = {}
    for (const r of rows || []) c[r.kind] = (c[r.kind] || 0) + 1
    return c
  }, [rows])

  const resend = (r) => {
    logWhatsApp({ shopId, kind: r.kind, phone: r.phone, name: r.name, text: r.text })
    window.open(waUrl(r.phone, r.text), '_blank')
    setTimeout(load, 300)
  }
  const copy = async (r) => {
    try { await navigator.clipboard.writeText(r.text); setCopiedId(r.id); setTimeout(() => setCopiedId(null), 1500) } catch { /* clipboard blocked */ }
  }
  const remove = async (r) => { await db.wa_outbox.delete(r.id); load() }
  const clearOld = async () => {
    if (!confirm('30 din se purane messages Outbox se hata dein?')) return
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    const old = (rows || []).filter(r => String(r.created_at) < cutoff).map(r => r.id)
    await db.wa_outbox.bulkDelete(old)
    load()
  }

  if (rows === null) return <p className="p-6 text-center text-fg-muted">Loading outbox…</p>

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <input className="input flex-1" placeholder="Search name, number or text" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search outbox" />
        <button type="button" onClick={clearOld} className="btn btn-secondary btn-sm shrink-0">Clear older than 30 days</button>
      </div>
      <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Message type">
        {[['all', 'All', rows.length], ...Object.entries(OUTBOX_KINDS).filter(([k]) => counts[k]).map(([k, l]) => [k, l, counts[k]])].map(([k, label, n]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`min-h-9 px-3 rounded-full text-xs font-bold border transition ${kind === k ? 'bg-primary text-white border-primary' : 'bg-surface text-fg-3 border-line hover:bg-surface-2'}`}>
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-3xl mb-2" aria-hidden="true">📭</p>
          <p className="font-bold text-fg">{rows.length === 0 ? 'No WhatsApp messages yet' : 'Nothing matches'}</p>
          <p className="text-sm text-fg-muted mt-1">Bills, reminders, statements and orders you send on WhatsApp from EdgeX appear here.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map(r => {
            const expanded = !!open[r.id]
            return (
              <li key={r.id} className="card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="badge badge-primary">{OUTBOX_KINDS[r.kind] || r.kind}</span>
                      <span className="font-semibold text-fg truncate">{r.name || (r.phone ? `+${r.phone}` : 'Contact chosen in WhatsApp')}</span>
                    </div>
                    <p className="text-xs text-fg-muted mt-0.5">{when(r.created_at)}{r.phone && r.name ? ` · +${r.phone}` : ''}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setOpen(prev => ({ ...prev, [r.id]: !expanded }))} aria-expanded={expanded}
                  className={`mt-2 w-full text-left text-sm text-fg-2 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2 ${expanded ? '' : 'line-clamp-3'}`}>
                  {r.text}
                </button>
                <div className="mt-2 flex gap-2 justify-end">
                  <button type="button" onClick={() => remove(r)} className="btn btn-ghost btn-sm text-danger-fg">Delete</button>
                  <button type="button" onClick={() => copy(r)} className="btn btn-secondary btn-sm">{copiedId === r.id ? 'Copied ✓' : 'Copy'}</button>
                  <button type="button" onClick={() => resend(r)} className="btn btn-primary btn-sm">💬 Send again</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-fg-subtle">WhatsApp opens with the message ready — you press Send there, so this list shows messages prepared on this device.</p>
    </div>
  )
}
