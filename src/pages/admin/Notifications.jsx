import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bell, Send, Users, Clock, AlertTriangle, CheckCircle2, Trash2, EyeOff, Search, RefreshCw } from 'lucide-react'
import { adminDb } from '../../services/adminApi'
import { logAction } from '../../services/auditService'
import {
  NOTIFICATION_TEMPLATES, NOTIFICATION_CATEGORIES, BUY_PLAN_PATH, SUPPORT_WHATSAPP_URL,
  daysUntil, daysText, formatDate, isTrialShop, planNameOf, renderTemplate, templateVars, isSafeCtaUrl,
} from '../../utils/shopNotifications'

const AUDIENCES = [
  { id: 'trial_ending', label: 'Trial ending soon', hint: 'Trial shops whose trial ends within the next N days', icon: Clock },
  { id: 'trial_expired', label: 'Trial expired', hint: 'Trial shops whose trial end date has passed', icon: AlertTriangle },
  { id: 'payment_due', label: 'Paid plan due / overdue', hint: 'Paid shops whose billing date is within N days or past', icon: Clock },
  { id: 'all_trial', label: 'All trial shops', hint: 'Every shop still on the Trial plan', icon: Users },
  { id: 'specific', label: 'Pick shops', hint: 'Choose shops by hand', icon: Users },
  { id: 'all', label: 'All shops', hint: 'One global message every shop sees', icon: Bell },
]

const TYPE_STYLES = {
  info: 'bg-blue-600 text-white',
  success: 'bg-green-600 text-white',
  warning: 'bg-orange-500 text-white',
  error: 'bg-red-600 text-white',
}

const CATEGORY_BADGE = {
  general: 'bg-slate-100 text-slate-600',
  trial_ending: 'bg-orange-100 text-orange-700',
  trial_expired: 'bg-red-100 text-red-700',
  payment_due: 'bg-amber-100 text-amber-700',
  plan_upgrade: 'bg-blue-100 text-blue-700',
}

const templateById = (id) => NOTIFICATION_TEMPLATES.find(t => t.id === id) || NOTIFICATION_TEMPLATES[0]

function formFromTemplate(t) {
  return {
    templateId: t.id,
    category: t.category,
    type: t.type,
    title: t.title,
    message: t.message,
    ctaLabel: t.ctaLabel,
    ctaMode: t.ctaMode,
    ctaUrl: '',
    showPopup: t.showPopup,
    dismissible: true,
    expiry: t.expiry,
    expiryDays: 7,
  }
}

export default function Notifications() {
  const [searchParams] = useSearchParams()
  const [shops, setShops] = useState([])
  const [sent, setSent] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const initialTemplate = templateById(searchParams.get('template') || 'trial_ending')
  const initialShopId = searchParams.get('shopId')
  const [audience, setAudience] = useState(initialShopId ? 'specific' : initialTemplate.audience)
  const [withinDays, setWithinDays] = useState(7)
  const [pickedIds, setPickedIds] = useState(() => new Set(initialShopId ? [String(initialShopId)] : []))
  const [shopSearch, setShopSearch] = useState('')
  const [form, setForm] = useState(() => formFromTemplate(initialTemplate))
  const [replaceExisting, setReplaceExisting] = useState(true)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState({ text: '', type: '' })
  const [sentFilter, setSentFilter] = useState('active')

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    setLoadError('')
    const [shopRes, annRes] = await Promise.all([
      adminDb.from('shops')
        .select('id, name, phone, status, subscription_plan, next_billing_date, plan_id, subscription_plans(name)')
        .order('name', { ascending: true }),
      adminDb.from('announcements').select('*').order('created_at', { ascending: false }).limit(500),
    ])
    if (shopRes.error) setLoadError(shopRes.error.message)
    setShops(shopRes.data || [])
    setSent(annRes.data || [])
    setLoading(false)
  }

  const shopById = useMemo(() => new Map(shops.map(s => [String(s.id), s])), [shops])

  const recipients = useMemo(() => {
    const n = Number(withinDays) || 0
    switch (audience) {
      case 'trial_ending':
        return shops.filter(s => {
          const d = daysUntil(s.next_billing_date)
          return isTrialShop(s) && s.status !== 'suspended' && d !== null && d >= 0 && d <= n
        })
      case 'trial_expired':
        return shops.filter(s => {
          const d = daysUntil(s.next_billing_date)
          return isTrialShop(s) && d !== null && d < 0
        })
      case 'payment_due':
        return shops.filter(s => {
          const d = daysUntil(s.next_billing_date)
          return !isTrialShop(s) && d !== null && d <= n
        })
      case 'all_trial':
        return shops.filter(isTrialShop)
      case 'specific':
        return shops.filter(s => pickedIds.has(String(s.id)))
      default:
        return []
    }
  }, [audience, shops, withinDays, pickedIds])

  const isGlobal = audience === 'all'

  const applyTemplate = (id) => {
    const t = templateById(id)
    setForm(formFromTemplate(t))
    if (audience !== 'specific') setAudience(t.audience)
  }

  const ctaUrl = form.ctaMode === 'plan' ? BUY_PLAN_PATH
    : form.ctaMode === 'whatsapp' ? SUPPORT_WHATSAPP_URL
      : form.ctaMode === 'custom' ? form.ctaUrl.trim()
        : ''

  const expiresFor = (shop) => {
    if (form.expiry === 'never') return null
    if (form.expiry === 'billing' && shop?.next_billing_date) {
      // Keep it visible through the end date, then hide it automatically.
      const d = new Date(shop.next_billing_date)
      d.setHours(0, 0, 0, 0)
      return new Date(d.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
    }
    const days = Math.max(1, Number(form.expiryDays) || 7)
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  }

  const buildRow = (shop) => {
    const vars = shop ? templateVars(shop) : {}
    return {
      shop_id: shop ? Number(shop.id) : null,
      title: renderTemplate(form.title, vars).trim() || null,
      message: renderTemplate(form.message, vars).trim(),
      type: form.type,
      category: form.category,
      cta_label: ctaUrl ? (form.ctaLabel.trim() || 'Open') : null,
      cta_url: ctaUrl || null,
      show_popup: !!form.showPopup,
      dismissible: !!form.dismissible,
      is_active: true,
      expires_at: expiresFor(shop),
    }
  }

  const previewShop = isGlobal ? null : (recipients[0] || null)
  const preview = buildRow(previewShop)
  const usesPlaceholders = /\{\w+\}/.test(form.title + form.message)

  const handleSend = async (e) => {
    e.preventDefault()
    setStatus({ text: '', type: '' })
    if (!form.message.trim()) return setStatus({ text: 'Write a message first.', type: 'error' })
    if (ctaUrl && !isSafeCtaUrl(ctaUrl)) return setStatus({ text: 'Button link must start with / (in-app page) or https://', type: 'error' })
    if (isGlobal && usesPlaceholders) return setStatus({ text: 'Placeholders like {shop_name} only work when sending to specific shops, not "All shops".', type: 'error' })
    if (!isGlobal && recipients.length === 0) return setStatus({ text: 'No shops match this audience.', type: 'error' })

    const count = isGlobal ? 'ALL shops' : `${recipients.length} shop(s)`
    if (!confirm(`Send this notification to ${count}?`)) return

    setSending(true)
    try {
      if (!isGlobal && replaceExisting) {
        const ids = recipients.map(s => Number(s.id))
        const { error } = await adminDb.from('announcements')
          .update({ is_active: false })
          .in('shop_id', ids)
          .eq('category', form.category)
          .eq('is_active', true)
        if (error) throw error
      }

      const rows = isGlobal ? [buildRow(null)] : recipients.map(buildRow)
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await adminDb.from('announcements').insert(rows.slice(i, i + 500))
        if (error) throw error
      }

      await logAction({
        action_type: 'SEND_SHOP_NOTIFICATION',
        target_type: isGlobal ? 'ALL_SHOPS' : 'MULTIPLE_SHOPS',
        target_id: isGlobal ? 'ALL' : recipients.map(s => s.id).join(',').slice(0, 200),
        details: { audience, category: form.category, count: rows.length, title: preview.title, cta: ctaUrl || null },
      })

      setStatus({ text: `Sent to ${count}. Shops see it the next time their app refreshes (within 5 minutes, or on reload).`, type: 'success' })
      load()
    } catch (err) {
      const hint = /column|schema cache/i.test(err?.message || '') ? ' Run sql/shop_notifications_migration.sql in Supabase first.' : ''
      setStatus({ text: 'Failed to send: ' + (err?.message || 'unknown error') + hint, type: 'error' })
    } finally {
      setSending(false)
    }
  }

  const deactivate = async (ids) => {
    if (ids.length === 0) return
    const { error } = await adminDb.from('announcements').update({ is_active: false }).in('id', ids)
    if (error) return alert('Failed: ' + error.message)
    load()
  }

  const remove = async (id) => {
    if (!confirm('Delete this notification permanently?')) return
    const { error } = await adminDb.from('announcements').delete().eq('id', id)
    if (error) return alert('Failed: ' + error.message)
    load()
  }

  const now = Date.now()
  const isLive = (a) => a.is_active && (!a.expires_at || new Date(a.expires_at).getTime() > now)
  const sentRows = sent.filter(a => sentFilter === 'all' ? true : sentFilter === 'active' ? isLive(a) : (a.category || 'general') === sentFilter)

  const visibleShops = shops.filter(s => !shopSearch || s.name?.toLowerCase().includes(shopSearch.toLowerCase()) || String(s.phone || '').includes(shopSearch))

  const togglePick = (id) => setPickedIds(prev => {
    const next = new Set(prev)
    const key = String(id)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const set = (patch) => setForm(f => ({ ...f, ...patch }))

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
            <Bell className="text-blue-600" size={30} />
            Push Notifications
          </h1>
          <p className="text-slate-500 font-medium mt-1 text-sm">
            Send in-app notifications to shops: trial ending reminders, buy-plan prompts, renewals and announcements.
          </p>
        </div>
        <button onClick={load} className="self-start sm:self-auto px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-bold flex items-center gap-2 hover:bg-slate-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loadError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">Could not load shops: {loadError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Composer ───────────────────────────────────── */}
        <form onSubmit={handleSend} className="lg:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 p-5 md:p-6 space-y-6 text-sm">
          {/* Templates */}
          <div>
            <h3 className="font-bold text-slate-700 mb-2">1. Start from a template</h3>
            <div className="flex flex-wrap gap-2">
              {NOTIFICATION_TEMPLATES.map(t => (
                <button
                  type="button"
                  key={t.id}
                  onClick={() => applyTemplate(t.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${form.templateId === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Audience */}
          <div>
            <h3 className="font-bold text-slate-700 mb-2">2. Who gets it</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AUDIENCES.map(a => {
                const Icon = a.icon
                const active = audience === a.id
                return (
                  <label key={a.id} className={`cursor-pointer border rounded-xl p-3 flex gap-3 transition ${active ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:border-blue-300'}`}>
                    <input type="radio" name="audience" className="mt-1" checked={active} onChange={() => setAudience(a.id)} />
                    <span>
                      <span className="font-bold text-slate-700 flex items-center gap-1.5"><Icon size={14} /> {a.label}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{a.hint}</span>
                    </span>
                  </label>
                )
              })}
            </div>

            {(audience === 'trial_ending' || audience === 'payment_due') && (
              <label className="mt-3 flex items-center gap-2 text-slate-600 font-medium">
                Within
                <input type="number" min="0" max="60" value={withinDays} onChange={e => setWithinDays(e.target.value)} className="w-20 px-2 py-1.5 border border-slate-200 rounded-lg font-bold text-center" />
                days
              </label>
            )}

            {audience === 'specific' && (
              <div className="mt-3 border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
                  <Search size={14} className="text-slate-400" />
                  <input value={shopSearch} onChange={e => setShopSearch(e.target.value)} placeholder="Search shops by name or phone" className="flex-1 bg-transparent outline-none py-1" />
                  <span className="text-xs font-bold text-slate-500">{pickedIds.size} picked</span>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                  {visibleShops.map(s => {
                    const d = daysUntil(s.next_billing_date)
                    return (
                      <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={pickedIds.has(String(s.id))} onChange={() => togglePick(s.id)} />
                        <span className="flex-1 min-w-0">
                          <span className="block font-bold text-slate-700 truncate">{s.name}</span>
                          <span className="block text-xs text-slate-500">{planNameOf(s)} · {s.next_billing_date ? `ends ${daysText(d)}` : 'no end date'}</span>
                        </span>
                      </label>
                    )
                  })}
                  {visibleShops.length === 0 && <p className="p-4 text-center text-slate-400">No shops found</p>}
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-700">3. Message</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-bold text-slate-500 mb-1">Style</span>
                <select value={form.type} onChange={e => set({ type: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white font-medium">
                  <option value="info">Info (blue)</option>
                  <option value="warning">Warning (orange)</option>
                  <option value="error">Urgent (red)</option>
                  <option value="success">Success (green)</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-slate-500 mb-1">Category</span>
                <select value={form.category} onChange={e => set({ category: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white font-medium">
                  {Object.entries(NOTIFICATION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="block text-xs font-bold text-slate-500 mb-1">Title</span>
              <input value={form.title} onChange={e => set({ title: e.target.value })} maxLength={120} className="w-full px-3 py-2 border border-slate-200 rounded-lg font-bold" placeholder="Your free trial ends {days_text}" />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-slate-500 mb-1">Message</span>
              <textarea value={form.message} onChange={e => set({ message: e.target.value })} rows={4} maxLength={600} required className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
            </label>
            <p className="text-xs text-slate-500">
              Placeholders (filled in per shop): <code className="bg-slate-100 px-1 rounded">{'{shop_name}'}</code> <code className="bg-slate-100 px-1 rounded">{'{days_text}'}</code> <code className="bg-slate-100 px-1 rounded">{'{days_left}'}</code> <code className="bg-slate-100 px-1 rounded">{'{end_date}'}</code> <code className="bg-slate-100 px-1 rounded">{'{plan}'}</code> <code className="bg-slate-100 px-1 rounded">{'{support_phone}'}</code>
            </p>
          </div>

          {/* Button + behaviour */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-700">4. Button and behaviour</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-bold text-slate-500 mb-1">Button opens</span>
                <select value={form.ctaMode} onChange={e => set({ ctaMode: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white font-medium">
                  <option value="plan">Plan page in the POS (Settings → Plan)</option>
                  <option value="whatsapp">WhatsApp support</option>
                  <option value="custom">Custom link</option>
                  <option value="none">No button</option>
                </select>
              </label>
              {form.ctaMode !== 'none' && (
                <label className="block">
                  <span className="block text-xs font-bold text-slate-500 mb-1">Button text</span>
                  <input value={form.ctaLabel} onChange={e => set({ ctaLabel: e.target.value })} maxLength={30} className="w-full px-3 py-2 border border-slate-200 rounded-lg font-bold" placeholder="Buy Plan" />
                </label>
              )}
            </div>
            {form.ctaMode === 'custom' && (
              <input value={form.ctaUrl} onChange={e => set({ ctaUrl: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg font-mono text-xs" placeholder="/settings#plan or https://..." />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-bold text-slate-500 mb-1">Hide automatically</span>
                <select value={form.expiry} onChange={e => set({ expiry: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white font-medium">
                  <option value="billing">After the shop's trial / billing end date</option>
                  <option value="days">After a number of days</option>
                  <option value="never">Never (until removed)</option>
                </select>
              </label>
              {form.expiry === 'days' && (
                <label className="block">
                  <span className="block text-xs font-bold text-slate-500 mb-1">Days</span>
                  <input type="number" min="1" max="365" value={form.expiryDays} onChange={e => set({ expiryDays: e.target.value })} className="w-full px-3 py-2 border border-slate-200 rounded-lg font-bold" />
                </label>
              )}
            </div>

            <div className="space-y-2 pt-1">
              <label className="flex items-start gap-2 text-slate-700 font-medium cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={form.showPopup} onChange={e => set({ showPopup: e.target.checked })} />
                <span>Pop up when the shop opens the app <span className="block text-xs text-slate-500 font-normal">Shown once per device, and as a phone/desktop alert if the shop allowed alerts.</span></span>
              </label>
              <label className="flex items-start gap-2 text-slate-700 font-medium cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={form.dismissible} onChange={e => set({ dismissible: e.target.checked })} />
                <span>Shop can dismiss the banner</span>
              </label>
              {!isGlobal && (
                <label className="flex items-start gap-2 text-slate-700 font-medium cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={replaceExisting} onChange={e => setReplaceExisting(e.target.checked)} />
                  <span>Replace earlier "{NOTIFICATION_CATEGORIES[form.category] || form.category}" notifications for these shops <span className="block text-xs text-slate-500 font-normal">Avoids stacking several reminders on one shop.</span></span>
                </label>
              )}
            </div>
          </div>

          {status.text && (
            <div className={`p-3 rounded-xl flex items-start gap-2 font-medium ${status.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {status.type === 'success' ? <CheckCircle2 size={18} className="shrink-0" /> : <AlertTriangle size={18} className="shrink-0" />}
              {status.text}
            </div>
          )}

          <button type="submit" disabled={sending || loading} className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-black flex items-center justify-center gap-2 shadow-sm">
            <Send size={18} />
            {sending ? 'Sending…' : isGlobal ? 'Send to all shops' : `Send to ${recipients.length} shop${recipients.length === 1 ? '' : 's'}`}
          </button>
        </form>

        {/* ── Preview + recipients ───────────────────────── */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <h3 className="font-bold text-slate-700 mb-1 text-sm">Preview</h3>
            <p className="text-xs text-slate-500 mb-3">{previewShop ? `As ${previewShop.name} will see it` : isGlobal ? 'As every shop will see it' : 'Pick an audience with at least one shop'}</p>
            <div className={`rounded-xl px-4 py-3 text-sm ${TYPE_STYLES[preview.type] || TYPE_STYLES.info}`}>
              {preview.title && <p className="font-black">{preview.title}</p>}
              <p className="opacity-95 mt-0.5">{preview.message || 'Your message…'}</p>
              {preview.cta_url && (
                <span className="inline-block mt-2 px-3 py-1 rounded-lg bg-white/20 font-bold text-xs">{preview.cta_label} →</span>
              )}
            </div>
          </div>

          {!isGlobal && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-700 text-sm">Recipients</h3>
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{recipients.length}</span>
              </div>
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {recipients.map(s => {
                  const d = daysUntil(s.next_billing_date)
                  return (
                    <div key={s.id} className="px-5 py-2.5 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-700 truncate">{s.name}</p>
                        <p className="text-xs text-slate-500">{planNameOf(s)} · {s.status}</p>
                      </div>
                      <span className={`text-xs font-bold whitespace-nowrap ${d !== null && d < 0 ? 'text-red-600' : 'text-orange-600'}`}>
                        {s.next_billing_date ? `${formatDate(s.next_billing_date)} (${daysText(d)})` : '—'}
                      </span>
                    </div>
                  )
                })}
                {recipients.length === 0 && <p className="p-6 text-center text-slate-400 text-sm">{loading ? 'Loading…' : 'No shops match'}</p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Sent notifications ─────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="font-bold text-slate-800">Sent notifications</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={sentFilter} onChange={e => setSentFilter(e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg bg-white text-sm font-medium">
              <option value="active">Live now</option>
              <option value="all">All</option>
              {Object.entries(NOTIFICATION_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { const ids = sentRows.filter(a => a.is_active).map(a => a.id); if (ids.length && confirm(`Hide ${ids.length} notification(s) from shops?`)) deactivate(ids) }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 flex items-center gap-1.5"
            >
              <EyeOff size={14} /> Hide all shown
            </button>
          </div>
        </div>
        <div className="divide-y divide-slate-100">
          {sentRows.map(a => {
            const shop = a.shop_id ? shopById.get(String(a.shop_id)) : null
            const live = isLive(a)
            const cat = a.category || 'general'
            return (
              <div key={a.id} className="px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-800">{a.shop_id ? (shop?.name || `Shop #${a.shop_id}`) : 'All shops'}</span>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${CATEGORY_BADGE[cat] || CATEGORY_BADGE.general}`}>{NOTIFICATION_CATEGORIES[cat] || cat}</span>
                    {a.show_popup && <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">Popup</span>}
                    {!live && <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{a.is_active ? 'Expired' : 'Hidden'}</span>}
                  </div>
                  {a.title && <p className="font-bold text-slate-700 mt-1">{a.title}</p>}
                  <p className="text-slate-600 line-clamp-2">{a.message}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Sent {formatDate(a.created_at)}{a.expires_at ? ` · hides ${formatDate(a.expires_at)}` : ''}{a.cta_url ? ` · button: ${a.cta_label || 'Open'}` : ''}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {a.is_active && (
                    <button onClick={() => deactivate([a.id])} className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 flex items-center gap-1"><EyeOff size={14} /> Hide</button>
                  )}
                  <button onClick={() => remove(a.id)} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 font-bold text-xs hover:bg-red-50 flex items-center gap-1"><Trash2 size={14} /> Delete</button>
                </div>
              </div>
            )
          })}
          {sentRows.length === 0 && <p className="p-8 text-center text-slate-400 text-sm">{loading ? 'Loading…' : 'Nothing here yet'}</p>}
        </div>
      </div>
    </div>
  )
}
