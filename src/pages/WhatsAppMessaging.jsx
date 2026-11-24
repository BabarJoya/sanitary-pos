import { useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../context/AuthContext'
import { db } from '../services/db'
import { Link, useSearchParams } from 'react-router-dom'
import { hasFeature } from '../utils/featureGate'
import UpgradeWall from '../components/UpgradeWall'
import WhatsAppOutbox from '../components/WhatsAppOutbox'
import { openWhatsApp, templateFor, fillTemplate } from '../utils/whatsapp'
import { getShopSettings } from '../utils/businessPresets'

function WhatsAppMessaging() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [shop, setShop] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') === 'outbox' ? 'outbox' : 'reminders') // 'reminders' | 'outbox'
  useEffect(() => { if (searchParams.get('tab') === 'outbox') setTab('outbox') }, [searchParams])

  useEffect(() => {
    fetchData()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads when these inputs change; the fetch functions read current state (listing them would refetch every render)
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch Shop Settings (for templates)
      const { data: shopData } = await supabase.from('shops').select('*').eq('id', user.shop_id).maybeSingle()
      setShop(shopData)
      if (shopData) await db.shops.put(shopData)

      // Fetch Customers with outstanding balance
      const { data: custData, error } = await supabase
        .from('customers')
        .select('*')
        .eq('shop_id', user.shop_id)
        .gt('outstanding_balance', 0)
        .order('outstanding_balance', { ascending: false })

      if (error) throw error
      setCustomers(custData || [])
    } catch (err) {
      console.error('WhatsApp Logic Error:', err)
      // Fallback to local DB
      const localCustomers = await db.customers
        .where('shop_id').equals(user.shop_id)
        .filter(c => c.outstanding_balance > 0)
        .toArray()
      setCustomers(localCustomers.sort((a,b) => b.outstanding_balance - a.outstanding_balance))
      
      const localShop = await db.shops.get(user.shop_id)
      setShop(localShop)
    } finally {
      setLoading(false)
    }
  }

  // Reminder text from the shop's template (Settings → WhatsApp), logged to the Outbox
  const sendReminder = (customer) => {
    const settings = { ...(shop || {}), ...getShopSettings(user?.shop_id) }
    const text = fillTemplate(templateFor('reminder', settings), {
      Name: customer.name,
      'Shop Name': shop?.name || settings.name || 'our shop',
      Amount: Math.round(Number(customer.outstanding_balance) || 0).toLocaleString('en-PK'),
      Days: '',
      Link: '',
    })
    openWhatsApp({ shopId: user.shop_id, kind: 'reminder', phone: customer.phone, name: customer.name, text })
  }

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (c.phone || '').includes(searchTerm)
  )

  if (!hasFeature('whatsapp')) return <UpgradeWall feature="whatsapp" />
  if (loading) return <div className="p-8">Loading debt list...</div>

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-fg">📲 WhatsApp</h1>
          <p className="text-sm text-fg-muted">Send payment reminders, and see every message the app prepared in the Outbox.</p>
        </div>
        <Link to="/settings#whatsapp" className="px-4 py-2 bg-surface border border-line rounded-xl text-xs font-bold text-fg-3 hover:bg-surface-2 transition shadow-sm">
          ⚙️ Edit message templates
        </Link>
      </div>

      <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="WhatsApp">
        {[['reminders', '💬 Reminders'], ['outbox', '📤 Outbox']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`min-h-10 px-4 rounded-lg text-sm font-bold transition ${tab === id ? 'bg-primary text-white shadow-sm' : 'text-fg-3 hover:bg-surface-2'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'outbox' ? <WhatsAppOutbox shopId={user.shop_id} /> : (<>

      <div className="bg-surface rounded-2xl shadow-sm border border-line-subtle overflow-hidden">
        <div className="p-4 bg-surface-2 border-b">
          <input 
            type="text" 
            placeholder="Search by name or phone..."
            className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-primary outline-none text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface text-fg-subtle text-[10px] font-black uppercase tracking-widest border-b">
                <th className="px-6 py-4">Customer</th>
                <th className="px-6 py-4 text-right">Balance</th>
                <th className="px-6 py-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan="3" className="px-6 py-10 text-center text-fg-subtle italic text-sm">
                    No customers found with outstanding balance.
                  </td>
                </tr>
              ) : (
                filteredCustomers.map(customer => {
                  const hasPhone = !!String(customer.phone || '').replace(/[^0-9]/g, '')
                  return (
                    <tr key={customer.id} className="hover:bg-primary-soft/30 transition group">
                      <td className="px-6 py-4">
                        <div className="font-bold text-fg text-sm">{customer.name}</div>
                        <div className="text-[10px] text-fg-subtle font-medium">{customer.phone || 'No Phone'}</div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-black text-danger-fg">Rs. {customer.outstanding_balance?.toLocaleString()}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {hasPhone ? (
                          <button
                            type="button"
                            onClick={() => sendReminder(customer)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-success hover:bg-success-hover text-white rounded-xl text-xs font-black transition shadow-lg shadow-success-muted uppercase"
                          >
                            <span>💬</span>
                            <span>Send Reminder</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-warning-fg font-bold uppercase py-2 block">Missing Phone</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-4 bg-primary-soft border border-primary-muted rounded-2xl flex items-start gap-4">
        <span className="text-xl">💡</span>
        <div>
          <p className="text-xs text-primary-strong font-bold">Pro-Tip: Keeping it Free</p>
          <p className="text-[10px] text-primary-fg leading-relaxed mt-1">
            We use the official WhatsApp Link system which is free. When you click "Send Reminder", it will open WhatsApp Web or the App with the message ready. You just need to press <b>Enter</b> to send it!
          </p>
        </div>
      </div>
      </>)}
    </div>
  )
}

export default WhatsAppMessaging
