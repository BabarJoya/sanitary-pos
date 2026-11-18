import { useState } from 'react'
import { supabase } from '../services/supabase'
import { Modal } from './ui'

// Private statement link for one customer (sql/customer_portal_migration.sql).
// The customer opens it without logging in and sees only their own account.
const isMissingFn = (e) => e && (e.code === 'PGRST202' || e.code === '42883')
const waPhone = (p) => {
  let phone = String(p || '').replace(/[^0-9]/g, '')
  if (phone.startsWith('03')) phone = '92' + phone.slice(1)
  return phone
}

export default function CustomerLinkButton({ customer, user }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState(null) // { url, expires_at }
  const [msg, setMsg] = useState('')

  const fetchLink = async (renew = false) => {
    setBusy(true); setMsg('')
    try {
      if (!navigator.onLine) throw new Error('Internet chahiye — link banane ke liye online hon.')
      const { data, error } = await supabase.rpc('create_customer_link', { p_customer_id: customer.id, p_created_by: user?.username || null, p_renew: renew })
      if (error) {
        if (isMissingFn(error)) throw new Error('Database update needed: run sql/customer_portal_migration.sql in Supabase.')
        throw error
      }
      setLink({ url: `${window.location.origin}/c/${data.token}`, expires_at: data.expires_at })
      if (renew) setMsg('New link made. The old link no longer works.')
    } catch (err) {
      setMsg(err?.message || String(err))
      setLink(null)
    } finally {
      setBusy(false)
    }
  }

  const openPanel = () => { setOpen(true); fetchLink(false) }

  const turnOff = async () => {
    if (!confirm(`${customer.name} ka link band karein? Purana link kaam nahi karega.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('revoke_customer_link', { p_customer_id: customer.id })
    setBusy(false)
    if (error) { setMsg(error.message); return }
    setLink(null)
    setMsg('Link turned off. Make a new one any time.')
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setMsg('Link copied ✓') } catch { setMsg('Copy failed — select the link and copy it.') }
  }

  const sendWhatsApp = () => {
    const shopName = localStorage.getItem(`shop_name_${user?.shop_id}`) || 'our shop'
    const text = `Assalam-o-Alaikum ${customer.name}!\n\n${shopName} mein aap ka account (bills, payments aur baqaya) yahan dekhein:\n${link.url}\n\nYeh link sirf aap ke liye hai. Shukriya!`
    window.open(`https://wa.me/${waPhone(customer.phone)}?text=${encodeURIComponent(text)}`, '_blank')
  }

  const until = link?.expires_at ? new Date(link.expires_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : ''

  return (
    <>
      <button type="button" onClick={openPanel}
        className="w-full sm:w-auto px-4 py-2.5 bg-surface border border-line hover:bg-surface-2 text-fg-2 rounded-lg transition font-semibold flex items-center justify-center gap-1.5">
        🔗 Customer link
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`🔗 Link for ${customer.name}`}
        footer={link ? (
          <>
            <button type="button" onClick={turnOff} disabled={busy} className="btn btn-ghost text-danger-fg">Turn off link</button>
            <button type="button" onClick={() => fetchLink(true)} disabled={busy} className="btn btn-secondary">New link</button>
            <button type="button" onClick={copy} disabled={busy} className="btn btn-secondary">Copy</button>
            <button type="button" onClick={sendWhatsApp} disabled={busy} className="btn btn-primary">💬 Send on WhatsApp</button>
          </>
        ) : (
          <button type="button" onClick={() => fetchLink(false)} disabled={busy} className="btn btn-primary">Make link</button>
        )}
      >
        <div className="text-left">
        <p className="text-sm text-fg-muted">
          The customer opens this link on their phone — no login — and sees their balance, bills and payments. Nobody else's data, no cost prices.
        </p>
        {busy && <p className="mt-4 text-sm text-fg-muted">Working…</p>}
        {link && !busy && (
          <div className="mt-4">
            <label htmlFor="customer-link-url" className="text-xs font-bold uppercase text-fg-subtle">Private link</label>
            <input id="customer-link-url" readOnly value={link.url} onFocus={e => e.target.select()} className="input w-full mt-1 font-mono text-xs" />
            <p className="text-xs text-fg-subtle mt-1">Works until {until}. "New link" or "Turn off link" stops the old one at once.</p>
          </div>
        )}
        {msg && <p role="status" className="mt-3 text-sm text-fg-2">{msg}</p>}
        </div>
      </Modal>
    </>
  )
}
