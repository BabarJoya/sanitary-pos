import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db, addToSyncQueue } from '../services/db'
import PasswordModal from '../components/PasswordModal'
import * as XLSX from 'xlsx'
import { buildSalesReportHTML } from '../utils/billTemplates'
import { hasFeature } from '../utils/featureGate'

function Settings() {
  const { user } = useAuth()
  const [shop, setShop] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => {
    const saved = localStorage.getItem('shop_settings_full')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) { /* fallback */ }
    }
    return {
      name: localStorage.getItem('shop_name') || 'Sanitary POS',
      phone: '',
      address: '',
      logo_url: localStorage.getItem('shop_logo') || '',
      invoice_footer: 'شکریہ! دوبارہ تشریف لائیں',
      quotation_footer: 'یہ صرف قیمت نامہ ہے',
      print_size: 'thermal',
      print_mode: 'manual',
      wa_reminder_template: 'Hello [Name], this is a reminder from [Shop Name] regarding your outstanding balance of Rs. [Amount]. Please clear your dues at your earliest convenience. Thank you!',
      wa_bill_template: 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount]. Thank you for your business!'
    }
  })
  // Logo is managed completely separately from the rest of form state
  // so fetchShop can never accidentally overwrite it
  const LOGO_KEY = `shop_logo_${user?.shop_id || 'default'}`
  const [logoUrl, setLogoUrl] = useState(() => {
    return localStorage.getItem(LOGO_KEY) || localStorage.getItem('shop_logo') || ''
  })

  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [planInfo, setPlanInfo] = useState(null)
  const [printTemplate, setPrintTemplate] = useState(() => localStorage.getItem('print_template') || '2')
  const [reportPeriod, setReportPeriod] = useState('today')
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => {
    fetchShop()
    fetchPlanInfo()
  }, [])

  const fetchShop = async () => {
    try {
      if (!navigator.onLine) throw new Error('Offline')
      // Ensure shop_id is a number for the query
      const sid = Number(user.shop_id)
      const fetchPromise = supabase.from('shops').select('*').eq('id', sid).maybeSingle()
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
      const { data, error } = await Promise.race([fetchPromise, timeoutPromise])
      if (error) throw error

      if (data) {
        setShop(data)
        setSettingsForm(data)
        // Store in local DB for offline access
        await db.shops.put(JSON.parse(JSON.stringify(data)))
      }
    } catch (e) {
      console.log('Settings: Loading from local DB (Offline)')
      try {
        const sid = Number(user.shop_id)
        const localData = await db.shops.get(sid)
        if (localData) {
          setShop(localData)
          setSettingsForm(localData)
        }
      } catch (err) { console.error('Local Shop Fetch Error:', err) }
    } finally {
      setLoading(false)
    }
  }

  const setSettingsForm = (data) => {
    // Read the full saved settings from localStorage — this is what the user last saved.
    // We only use Supabase data to fill in values that localStorage doesn't have yet.
    let saved = {}
    try { saved = JSON.parse(localStorage.getItem('shop_settings_full') || '{}') } catch (_) {}

    setForm(prev => ({
      name:                 saved.name                 || data.name    || prev.name    || 'Sanitary POS',
      phone:                saved.phone                || data.phone   || prev.phone   || '',
      address:              saved.address              || data.address || prev.address || '',
      logo_url:             prev.logo_url, // managed by logoUrl state, never overwrite
      invoice_footer:       saved.invoice_footer       || prev.invoice_footer       || 'شکریہ! دوبارہ تشریف لائیں',
      quotation_footer:     saved.quotation_footer     || prev.quotation_footer     || 'یہ صرف قیمت نامہ ہے',
      print_size:           saved.print_size           || prev.print_size           || 'thermal',
      print_mode:           saved.print_mode           || prev.print_mode           || 'manual',
      wa_reminder_template: saved.wa_reminder_template || prev.wa_reminder_template || '',
      wa_bill_template:     saved.wa_bill_template     || prev.wa_bill_template     || '',
    }))

    // If no local logo yet, seed from Supabase
    if (data.logo_url) {
      setLogoUrl(prev => prev || data.logo_url)
    }
  }

  const fetchPlanInfo = async () => {
    // Try localStorage first for instant info
    const cached = localStorage.getItem('plan_limits')
    if (cached) {
      try {
        setPlanInfo(JSON.parse(cached))
      } catch (e) { /* ignore */ }
    }

    if (!navigator.onLine || !user?.shop_id) return
    try {
      const { data, error } = await supabase.rpc('get_shop_config', { p_shop_id: user.shop_id })
      if (!error && data) {
        setPlanInfo(data)
        localStorage.setItem('plan_limits', JSON.stringify(data))
        if (data.features) {
          localStorage.setItem('plan_features', JSON.stringify(data.features))
        }
      }
    } catch (e) {
      console.error('Settings Plan Fetch Error', e)
    }
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    setSaving(true)

    const sid = Number(user.shop_id)

    // Merge latest logo into full settings for localStorage / bill printing
    const fullSettings = { ...form, logo_url: logoUrl }

    // Save everything to localStorage immediately — this is the source of truth
    // for print preferences, WA templates, footers, print size etc.
    localStorage.setItem('shop_settings_full', JSON.stringify(fullSettings))
    localStorage.setItem('shop_name', form.name || 'Sanitary POS')

    // Only send columns that are guaranteed to exist in the shops table to Supabase.
    // Extra fields (invoice_footer, print_size, wa_templates etc.) may not be DB columns
    // — storing them in localStorage is sufficient since all features read from there.
    const supabasePayload = {
      name: form.name,
      phone: form.phone,
      address: form.address,
    }

    try {
      if (!navigator.onLine) throw new TypeError('Failed to fetch')
      const { error } = await supabase.from('shops').update(supabasePayload).eq('id', sid)
      if (error) throw error

      // Also persist full settings to Dexie for offline reads
      await db.shops.put({ ...fullSettings, id: sid })

      window.dispatchEvent(new Event('storage'))
      alert('Settings saved successfully! ✅')
    } catch (err) {
      const errMsg = err?.message || String(err)
      if (errMsg.includes('Failed to fetch') || !navigator.onLine) {
        await db.shops.put({ ...fullSettings, id: sid })
        await addToSyncQueue('shops', 'UPDATE', { id: sid, ...supabasePayload })
        window.dispatchEvent(new Event('storage'))
        alert('Offline mode: Settings saved to device. Will sync when online. 🔄')
      } else {
        alert('Save failed: ' + errMsg)
      }
    } finally {
      setSaving(false)
    }
  }

  // Compress image using canvas — reduces a 2MB photo to ~15-30KB
  const compressImage = (file) => {
    return new Promise((resolve) => {
      const img = new Image()
      const objectUrl = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(objectUrl)
        const MAX = 300
        let w = img.width
        let h = img.height
        // Scale down proportionally
        if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX }
        else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        // JPEG at 75% quality — typically 10-30KB for a logo
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.onerror = () => {
        // Fallback: read as-is if canvas fails
        const reader = new FileReader()
        reader.onload = evt => resolve(evt.target.result)
        reader.readAsDataURL(file)
      }
      img.src = objectUrl
    })
  }

  const handleLogoUpload = async (e) => {
    const sid = Number(user.shop_id)
    const file = e.target.files[0]
    if (!file) return

    setSaving(true)
    try {
      const compressed = await compressImage(file)

      // 1. Update dedicated logo state immediately — this is the single source of truth
      setLogoUrl(compressed)
      localStorage.setItem(LOGO_KEY, compressed)
      localStorage.setItem('shop_logo', compressed) // legacy key for POS/bill printing

      // 2. Keep form.logo_url in sync so bill printing works
      setForm(prev => {
        const updated = { ...prev, logo_url: compressed }
        localStorage.setItem('shop_settings_full', JSON.stringify(updated))
        return updated
      })

      // 3. Save to Dexie
      try { await db.shops.update(sid, { logo_url: compressed }) } catch (_) { /* ignore */ }

      // 4. Notify Layout (and any other listener) to refresh logo immediately
      window.dispatchEvent(new Event('storage'))

      // 5. Try Supabase (best effort — app works fine without it)
      if (navigator.onLine) {
        const { error } = await supabase.from('shops').update({ logo_url: compressed }).eq('id', sid)
        if (error) console.warn('Logo Supabase save failed (non-critical):', error.message)
      }

      alert('Logo saved! ✅')
    } catch (err) {
      console.error('Logo upload error:', err)
      alert('Logo upload failed: ' + (err?.message || String(err)))
    } finally {
      setSaving(false)
    }
  }

  const printSalesReport = async () => {
    setReportLoading(true)
    try {
      const now = new Date()
      let fromDate
      if (reportPeriod === 'today') {
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      } else if (reportPeriod === 'week') {
        const d = new Date(now); d.setDate(d.getDate() - 6); d.setHours(0,0,0,0)
        fromDate = d.toISOString()
      } else {
        const d = new Date(now.getFullYear(), now.getMonth(), 1)
        fromDate = d.toISOString()
      }

      let sales = [], saleItems = []
      if (navigator.onLine) {
        const { data: s } = await supabase.from('sales').select('*').eq('shop_id', user.shop_id).gte('created_at', fromDate).order('created_at', { ascending: false })
        sales = s || []
        if (sales.length > 0) {
          const ids = sales.map(s => s.id)
          const { data: si } = await supabase.from('sale_items').select('*').in('sale_id', ids)
          saleItems = si || []
        }
      } else {
        sales = await db.sales.where('shop_id').equals(user.shop_id).filter(s => s.created_at >= fromDate).toArray()
        const ids = sales.map(s => s.id)
        saleItems = await db.sale_items.where('sale_id').anyOf(ids).toArray()
      }

      if (sales.length === 0) {
        alert('No sales found for the selected period.')
        return
      }

      const shopSettings = { ...form, print_template: printTemplate }
      const win = window.open('', '_blank')
      win.document.write(buildSalesReportHTML(sales, saleItems, reportPeriod, shopSettings))
      win.document.close()
    } catch (err) {
      alert('Report failed: ' + err.message)
    } finally {
      setReportLoading(false)
    }
  }

  if (loading) return <div className="p-8">Loading settings...</div>

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-2xl font-bold text-gray-800">⚙️ Settings</h1>
        <span className="px-2 py-1 bg-gray-100 text-gray-400 text-[10px] font-bold uppercase rounded tracking-widest italic tracking-tighter">Shop ID: {user.shop_id}</span>
      </div>


      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b">
          <h2 className="font-bold text-gray-700">Shop Profile</h2>
          <p className="text-xs text-gray-400">This information will appear on your prints and invoices</p>
        </div>

        <form onSubmit={handleUpdate} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-600 mb-1">Store / Shop Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-lg font-medium"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-600 mb-1">Store Logo</label>
              <div className="flex gap-4 items-center">
                {/* Preview — reads from logoUrl state, never from form */}
                <div className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {logoUrl
                    ? <img src={logoUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
                    : <span className="text-2xl">🏪</span>
                  }
                </div>
                <div className="flex flex-col gap-2">
                  <input
                    type="file"
                    id="logo-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <label
                    htmlFor="logo-upload"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold cursor-pointer transition shadow-sm"
                  >
                    {saving ? '⏳ Saving...' : '📁 Upload New Logo'}
                  </label>
                  {logoUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        const sid = Number(user.shop_id)
                        setLogoUrl('')
                        localStorage.removeItem(LOGO_KEY)
                        localStorage.setItem('shop_logo', '')
                        setForm(prev => {
                          const updated = { ...prev, logo_url: '' }
                          localStorage.setItem('shop_settings_full', JSON.stringify(updated))
                          return updated
                        })
                        try { await db.shops.update(sid, { logo_url: '' }) } catch (_) { /* ignore */ }
                        if (navigator.onLine) {
                          supabase.from('shops').update({ logo_url: '' }).eq('id', sid).then(() => {})
                        }
                      }}
                      className="text-xs text-red-500 hover:text-red-700 font-bold text-left"
                    >
                      ✕ Remove Logo
                    </button>
                  )}
                  <p className="text-[10px] text-gray-400 leading-relaxed">JPG, PNG, or SVG. Saved automatically on select.</p>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-1">Contact Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={e => setForm({ ...form, phone: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. 0300-1234567"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-1">Location / City</label>
              <input
                type="text"
                value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. Sargodha, Punjab"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-1">Invoice Footer (Urdu/Eng)</label>
              <input
                type="text"
                value={form.invoice_footer}
                onChange={e => setForm({ ...form, invoice_footer: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. شکریہ! دوبارہ تشریف لائیں"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-1">Quotation Footer (Urdu/Eng)</label>
              <input
                type="text"
                value={form.quotation_footer}
                onChange={e => setForm({ ...form, quotation_footer: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. یہ صرف قیمت نامہ ہے"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-1">Print Size</label>
              <select
                value={form.print_size}
                onChange={e => setForm({ ...form, print_size: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white font-bold"
              >
                <option value="thermal">Thermal (80mm)</option>
                <option value="a4">A4 (Full Page)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-600 mb-1">Print Flow</label>
              <select
                value={form.print_mode}
                onChange={e => setForm({ ...form, print_mode: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white font-bold"
              >
                <option value="manual">Manual (Show Dialog)</option>
                <option value="auto">Auto (Print Direct)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
            <div className="md:col-span-2">
              <h3 className="text-sm font-black text-blue-600 uppercase tracking-wider mb-3">WhatsApp Messaging Templates</h3>
              <p className="text-[10px] text-gray-400 mb-4">Use [Name], [Amount], [Shop Name], and [ID] as placeholders.</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-600 mb-1">Debt Reminder Template (English)</label>
              <textarea
                value={form.wa_reminder_template}
                onChange={e => setForm({ ...form, wa_reminder_template: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm h-20"
                placeholder="Hello [Name], your balance is Rs. [Amount]..."
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-gray-600 mb-1">New Bill Template (English)</label>
              <textarea
                value={form.wa_bill_template}
                onChange={e => setForm({ ...form, wa_bill_template: e.target.value })}
                className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm h-20"
                placeholder="Hello [Name], thank you for shopping! Bill #[ID] for Rs. [Amount]..."
              />
            </div>
          </div>

          <div className="pt-4 border-t flex items-center justify-between">
            <div className="text-[10px] text-gray-400 font-medium max-w-[300px]">
              Note: Changing the shop name will affect all future invoices and quotations immediately.
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-lg shadow-blue-100 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Update Profile'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-bold text-gray-800">Data Management & Backup</h3>
            <p className="text-xs text-gray-400 mt-0.5">Import, export or reset your local store data.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hasFeature('offline_sync') && <button
              onClick={async () => {
                if (!navigator.onLine) {
                  alert('Aap abhi offline hain! Pehle internet se connect karein.');
                  return;
                }
                setSaving(true);
                try {
                  const shopEq = 'shop_id';
                  const [p, c, cu, su, sa, pu, ex, us] = await Promise.all([
                    supabase.from('products').select('*').eq(shopEq, user.shop_id),
                    supabase.from('categories').select('*').eq(shopEq, user.shop_id),
                    supabase.from('customers').select('*').eq(shopEq, user.shop_id),
                    supabase.from('suppliers').select('*').eq(shopEq, user.shop_id),
                    supabase.from('sales').select('*').eq(shopEq, user.shop_id),
                    supabase.from('purchases').select('*').eq(shopEq, user.shop_id),
                    supabase.from('expenses').select('*').eq(shopEq, user.shop_id),
                    supabase.from('users').select('*').eq(shopEq, user.shop_id)
                  ]);

                  const saleIds = sa.data ? sa.data.map(s => s.id) : [];
                  let siReq = { data: [] };
                  if (saleIds.length > 0) {
                    siReq = await supabase.from('sale_items').select('*').in('sale_id', saleIds);
                  }

                  const purchaseIds = pu.data ? pu.data.map(p => p.id) : [];
                  let piReq = { data: [] };
                  if (purchaseIds.length > 0) {
                    piReq = await supabase.from('purchase_items').select('*').in('purchase_id', purchaseIds);
                  }

                  const safePut = async (table, reqData) => {
                    if (reqData && reqData.length > 0) {
                      await db[table].clear();
                      await db[table].bulkPut(JSON.parse(JSON.stringify(reqData)));
                    }
                  };

                  await safePut('products', p.data);
                  await safePut('categories', c.data);
                  await safePut('customers', cu.data);
                  await safePut('suppliers', su.data);
                  await safePut('sales', sa.data);
                  await safePut('purchases', pu.data);
                  await safePut('expenses', ex.data);
                  await safePut('users', us.data);
                  await safePut('sale_items', siReq.data);
                  await safePut('purchase_items', piReq.data);

                  alert('Sari online data successfully local device mein save ho gayi hai! Ab aap offline aram se kaam kar sakte hain. ✅');
                } catch (e) {
                  alert('Sync failed: ' + e.message);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="px-4 py-2 border border-green-200 bg-green-50 hover:bg-green-100 text-green-700 rounded-xl transition font-bold text-sm shadow-sm disabled:opacity-50"
            >
              {saving ? '⏳ Downloading...' : '⬇️ Download All for Offline'}
            </button>}
            <button
              onClick={async () => {
                if (confirm('Local cache clear krne se data re-fetch hoga. Continue?')) {
                  await db.products.clear()
                  await db.categories.clear()
                  await db.customers.clear()
                  await db.suppliers.clear()
                  await db.sales.clear()
                  await db.sale_items.clear()
                  await db.purchases.clear()
                  await db.purchase_items.clear()
                  await db.expenses.clear()
                  await db.users.clear()
                  alert('All local cache cleared! Page refresh karein.')
                  alert('Cache reset instructions complete.')
                }
              }}
              className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl transition font-bold text-sm shadow-sm"
            >
              🧹 Clear All Cache
            </button>
            {hasFeature('offline_sync') && <button
              onClick={async () => {
                const { syncOfflineData } = await import('../services/syncService')
                await syncOfflineData()
                alert('Sync process triggered! Check status in header.')
                fetchShop()
              }}
              className="px-4 py-2 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl transition font-bold text-sm shadow-sm"
            >
              🔄 Sync Now
            </button>}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hasFeature('data_export') ? (
          <div className="p-4 bg-green-50/50 rounded-2xl border border-green-100 flex flex-col gap-3">
            <div>
              <p className="font-bold text-green-800 text-sm">Export All Data</p>
              <p className="text-[10px] text-green-600">Save a complete backup of all products, customers, and suppliers.</p>
            </div>
            <button
              onClick={async () => {
                try {
                  const data = {
                    products: await db.products.toArray(),
                    categories: await db.categories.toArray(),
                    brands: await db.brands.toArray(),
                    customers: await db.customers.toArray(),
                    suppliers: await db.suppliers.toArray(),
                    sales: await db.sales.toArray(),
                    sale_items: await db.sale_items.toArray(),
                    purchases: await db.purchases.toArray(),
                    purchase_items: await db.purchase_items.toArray(),
                    expenses: await db.expenses.toArray(),
                    users: await db.users.toArray(),
                    sync_queue: await db.sync_queue.toArray(),
                    exported_at: new Date().toISOString(),
                    shop_id: user.shop_id,
                    version: '3.0'
                  }
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `SanitaryPOS_FullBackup_${new Date().toISOString().slice(0, 10)}.json`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                  alert('Full backup downloaded! 💾 Is file ko safe rakhein.')
                } catch (err) {
                  alert('Backup failed: ' + err.message)
                }
              }}
              className="w-full py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition font-bold text-xs shadow-md"
            >
              📥 Download System Backup (.json)
            </button>

            <button
              onClick={async () => {
                try {
                  const data = {
                    Products: await db.products.toArray(),
                    Customers: await db.customers.toArray(),
                    Suppliers: await db.suppliers.toArray(),
                    Sales: await db.sales.toArray(),
                    SaleItems: await db.sale_items.toArray(),
                    Purchases: await db.purchases.toArray(),
                    Expenses: await db.expenses.toArray()
                  }

                  const workbook = XLSX.utils.book_new()

                  // Convert each table to a worksheet and append
                  for (const [sheetName, rows] of Object.entries(data)) {
                    // Only add sheet if there is data
                    if (rows.length > 0) {
                      const worksheet = XLSX.utils.json_to_sheet(rows)
                      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
                    } else {
                      // Add empty sheet so user knows it exported but was empty
                      const worksheet = XLSX.utils.json_to_sheet([{ Message: 'No data exists' }])
                      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
                    }
                  }

                  const fileName = `SanitaryPOS_ExcelReports_${new Date().toISOString().slice(0, 10)}.xlsx`
                  XLSX.writeFile(workbook, fileName)
                  alert('Excel reports generated and downloaded successfully! 📊')
                } catch (err) {
                  alert('Excel Export failed: ' + err.message)
                }
              }}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition font-bold text-xs shadow-md"
            >
              📊 Export to Excel
            </button>
          </div>
          ) : (
          <div className="p-4 bg-gray-50/50 rounded-2xl border border-gray-200 flex flex-col gap-3 opacity-60">
            <div>
              <p className="font-bold text-gray-500 text-sm flex items-center gap-2">Export All Data <span className="text-xs">🔒</span></p>
              <p className="text-[10px] text-gray-400">Upgrade your plan to enable data export and backup.</p>
            </div>
          </div>
          )}

          <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex flex-col gap-3">
            <div>
              <p className="font-bold text-blue-800 text-sm">Import / Restore Data</p>
              <p className="text-[10px] text-blue-600">Restore your database from a previous backup file.</p>
            </div>
            <div className="relative">
              <input
                type="file"
                accept=".json"
                id="import-backup"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files[0]
                  if (!file) return

                  if (!confirm('Warning: Is se apka mojooda local data replace ho jayega. Continue?')) return

                  const reader = new FileReader()
                  reader.onload = async (event) => {
                    try {
                      const data = JSON.parse(event.target.result)

                      // Basic Validation
                      if (!data.products || !data.customers) {
                        throw new Error('Invalid backup file format.')
                      }

                      // Restore tables
                      await db.transaction('rw',
                        db.products, db.categories, db.brands, db.customers, db.suppliers,
                        db.sales, db.sale_items, db.purchases, db.purchase_items,
                        db.expenses, db.users, async () => {

                          await db.products.clear()
                          await db.categories.clear()
                          await db.brands.clear()
                          await db.customers.clear()
                          await db.suppliers.clear()
                          await db.sales.clear()
                          await db.sale_items.clear()
                          await db.purchases.clear()
                          await db.purchase_items.clear()
                          await db.expenses.clear()
                          await db.users.clear()

                          if (data.products?.length) await db.products.bulkAdd(data.products)
                          if (data.categories?.length) await db.categories.bulkAdd(data.categories)
                          if (data.brands?.length) await db.brands.bulkAdd(data.brands)
                          if (data.customers?.length) await db.customers.bulkAdd(data.customers)
                          if (data.suppliers?.length) await db.suppliers.bulkAdd(data.suppliers)
                          if (data.sales?.length) await db.sales.bulkAdd(data.sales)
                          if (data.sale_items?.length) await db.sale_items.bulkAdd(data.sale_items)
                          if (data.purchases?.length) await db.purchases.bulkAdd(data.purchases)
                          if (data.purchase_items?.length) await db.purchase_items.bulkAdd(data.purchase_items)
                          if (data.expenses?.length) await db.expenses.bulkAdd(data.expenses)
                          if (data.users?.length) await db.users.bulkAdd(data.users)
                        })

                      alert('Data restored successfully! ✅ Page refresh ho raha hai.')
                      window.location.reload()
                    } catch (err) {
                      alert('Import failed: ' + err.message)
                    }
                  }
                  reader.readAsText(file)
                }}
              />
              <label
                htmlFor="import-backup"
                className="flex items-center justify-center w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-bold text-xs cursor-pointer shadow-md"
              >
                📤 Upload & Restore
              </label>
            </div>
          </div>
        </div>
      </div>


      {/* ── Billing Template Selector ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b">
          <h2 className="font-bold text-gray-700">Billing Template</h2>
          <p className="text-xs text-gray-400">Choose how your receipts and invoices look when printed. Works for both 80mm thermal and A4.</p>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { id: '1', name: 'Simple', desc: 'Minimal & clean. No logo area, compact spacing. Fast to print.', icon: '📄' },
            { id: '2', name: 'Classic', desc: 'Standard receipt style with logo, dashed lines and item table. Recommended.', icon: '🧾' },
            { id: '3', name: 'Professional', desc: 'Full invoice look — letterhead, invoice number box, PAID stamp, signature line.', icon: '📋' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setPrintTemplate(t.id); localStorage.setItem('print_template', t.id) }}
              className={`text-left p-4 rounded-xl border-2 transition ${printTemplate === t.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
            >
              <div className="text-2xl mb-2">{t.icon}</div>
              <div className="font-bold text-gray-800 flex items-center gap-2">
                {t.name}
                {printTemplate === t.id && <span className="text-[10px] font-black bg-blue-500 text-white px-2 py-0.5 rounded-full uppercase">Active</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Sales Reports ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b">
          <h2 className="font-bold text-gray-700">Print Sales Report</h2>
          <p className="text-xs text-gray-400">Generate and print a daily, weekly, or monthly sales summary with revenue breakdown.</p>
        </div>
        <div className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex gap-2 flex-wrap">
              {[
                { id: 'today', label: "📅 Today" },
                { id: 'week',  label: "📆 This Week" },
                { id: 'month', label: "🗓️ This Month" },
              ].map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setReportPeriod(p.id)}
                  className={`px-4 py-2 rounded-xl border font-bold text-sm transition ${reportPeriod === p.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={printSalesReport}
              disabled={reportLoading}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-md shadow-indigo-100 disabled:opacity-50 text-sm whitespace-nowrap"
            >
              {reportLoading ? '⏳ Loading...' : '🖨️ Print Report'}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">Report includes: total revenue, cash/card/credit breakdown, outstanding balance, discount given, and full transaction list.</p>
        </div>
      </div>

      {/* Plan & Subscription */}
      {planInfo && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-blue-50 px-6 py-4 border-b">
            <h2 className="font-bold text-blue-800">Plan & Subscription</h2>
            <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Your Current Service Tier</p>
          </div>
          <div className="p-6">
            <div className="flex flex-col md:flex-row justify-between gap-6">
              <div className="space-y-4 flex-1">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Active Plan</label>
                  <p className="text-xl font-black text-gray-800">{planInfo.plan_name} <span className="text-blue-600 italic">Tier</span></p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Product Limit</label>
                    <p className="font-bold text-gray-800">{planInfo.product_limit} items</p>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Users Limit</label>
                    <p className="font-bold text-gray-800">{planInfo.user_limit} accounts</p>
                  </div>
                </div>
              </div>
              
              <div className="md:border-l md:pl-6 space-y-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Next Billing Date</label>
                  <p className="font-mono font-black text-gray-800 bg-gray-50 px-3 py-1 rounded-lg border">
                    {planInfo.next_billing_date ? new Date(planInfo.next_billing_date).toLocaleDateString('en-PK', { dateStyle: 'long' }) : 'N/A'}
                  </p>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-[10px] text-blue-700 font-bold leading-tight">Need more capacity? Contact support to upgrade your plan.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-800">Software Updates</h3>
          <p className="text-xs text-gray-400 mt-0.5">Your POS is currently running the latest version v2.1.0-Premium</p>
        </div>
        <div className="flex -space-x-2">
          <span className="w-8 h-8 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-blue-600">AS</span>
          <span className="w-8 h-8 rounded-full bg-indigo-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-indigo-600">SM</span>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-red-50 rounded-2xl shadow-sm border-2 border-red-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
            <span className="text-xl">⚠️</span>
          </div>
          <div>
            <h3 className="font-bold text-red-800 text-lg">Danger Zone</h3>
            <p className="text-xs text-red-500">Irreversible actions — proceed with extreme caution</p>
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-red-100">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-bold text-gray-800">🗑️ Clear All Shop Data</p>
              <p className="text-xs text-gray-500 mt-1">Permanently delete ALL products, suppliers, customers, sales, purchases, expenses, and payments for this shop. This cannot be undone!</p>
            </div>
            <button
              onClick={() => setShowPasswordModal(true)}
              disabled={clearing}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition whitespace-nowrap shadow-lg shadow-red-200 disabled:opacity-50"
            >
              {clearing ? 'Clearing...' : '🔥 Clear All Data'}
            </button>
          </div>
        </div>
      </div>

      {showPasswordModal && (
        <PasswordModal
          title="⚠️ Clear ALL Shop Data"
          message="This will permanently delete ALL data. Enter your password to confirm."
          onConfirm={async () => {
            setShowPasswordModal(false)
            // Second confirmation: type shop name
            const shopName = form.name || 'My Shop'
            const typed = prompt(`Type "${shopName}" to confirm permanent deletion of ALL data:`)
            if (typed !== shopName) {
              alert('Shop name does not match. Operation cancelled.')
              return
            }
            setClearing(true)
            try {
              if (navigator.onLine) {
                // Delete child items first (no shop_id column — must delete by parent IDs)
                const { data: shopSales } = await supabase.from('sales').select('id').eq('shop_id', user.shop_id)
                const saleIds = (shopSales || []).map(s => s.id)
                if (saleIds.length) await supabase.from('sale_items').delete().in('sale_id', saleIds)

                const { data: shopPurchases } = await supabase.from('purchases').select('id').eq('shop_id', user.shop_id)
                const purchaseIds = (shopPurchases || []).map(p => p.id)
                if (purchaseIds.length) await supabase.from('purchase_items').delete().in('purchase_id', purchaseIds)

                // Now delete all shop_id-scoped tables
                const shopIdTables = ['products', 'categories', 'brands', 'customers', 'suppliers', 'sales', 'purchases', 'expenses', 'customer_payments', 'supplier_payments', 'audit_logs']
                for (const t of shopIdTables) {
                  await supabase.from(t).delete().eq('shop_id', user.shop_id)
                }
              }
              // Clear all local Dexie tables
              const allTables = ['products', 'categories', 'brands', 'customers', 'suppliers', 'sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'customer_payments', 'supplier_payments', 'audit_logs']
              for (const t of allTables) {
                if (db[t]) await db[t].clear()
              }
              await db.trash.clear()
              await db.sync_queue.clear()
              alert('✅ All shop data has been cleared successfully!')
              window.location.reload()
            } catch (err) {
              alert('Error clearing data: ' + err.message)
            } finally {
              setClearing(false)
            }
          }}
          onCancel={() => setShowPasswordModal(false)}
        />
      )}
    </div>
  )
}

export default Settings
