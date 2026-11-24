import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import {
  dismissedKey, popupSeenKey, systemAlertedKey, readIdSet, addToIdSet, resolveCtaUrl, isExternalUrl,
} from '../utils/shopNotifications'

// In-app notifications sent by the platform admin (`announcements` table).
// Global rows (shop_id NULL) go to every shop; targeted rows to one shop.

const REFRESH_MS = 5 * 60 * 1000
const STALE_MS = 60 * 1000

// Layout is mounted per route, so keep the last result at module level to
// avoid banners disappearing (and refetching) on every navigation.
let cache = { shopId: null, items: [], fetchedAt: 0 }

function isLive(a) {
  return a && a.is_active !== false && (!a.expires_at || new Date(a.expires_at).getTime() > Date.now())
}

function alertsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window
}

async function showSystemAlert(item, onClick) {
  const title = item.title || 'EdgeX POS'
  const options = { body: item.message, tag: `announcement-${item.id}`, icon: '/edgex_pos_logo_platform.png' }
  try {
    const n = new Notification(title, options)
    n.onclick = () => { window.focus(); onClick?.(); n.close() }
    return
  } catch {
    // Android Chrome only allows notifications through the service worker.
  }
  try {
    const reg = await navigator.serviceWorker?.ready
    await reg?.showNotification(title, options)
  } catch { /* alerts are best-effort */ }
}

// eslint-disable-next-line react-refresh/only-export-components -- shared helper next to its component
export function useShopNotifications(shopId, role) {
  const navigate = useNavigate()
  const [items, setItems] = useState(() => (cache.shopId === shopId ? cache.items : []))
  const [dismissed, setDismissed] = useState(() => (shopId ? readIdSet(dismissedKey(shopId)) : new Set()))
  const [popupSeen, setPopupSeen] = useState(() => (shopId ? readIdSet(popupSeenKey(shopId)) : new Set()))
  const [permission, setPermission] = useState(() => (alertsSupported() ? Notification.permission : 'unsupported'))

  const openCta = useCallback((item) => {
    const url = resolveCtaUrl(item?.cta_url, role)
    if (!url) return
    if (isExternalUrl(url)) window.open(url, '_blank', 'noopener,noreferrer')
    else navigate(url)
  }, [navigate, role])

  const fetchItems = useCallback(async () => {
    if (!shopId) return
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .eq('is_active', true)
        .or(`shop_id.is.null,shop_id.eq.${shopId}`)
        .order('created_at', { ascending: false })
      if (error || !data) return
      const live = data.filter(isLive)
      cache = { shopId, items: live, fetchedAt: Date.now() }
      setItems(live)

      // Phone/desktop alert for new targeted or popup notifications.
      if (alertsSupported() && Notification.permission === 'granted') {
        let alerted = readIdSet(systemAlertedKey(shopId))
        for (const item of live) {
          if (alerted.has(String(item.id))) continue
          if (item.shop_id || item.show_popup) showSystemAlert(item, () => openCta(item))
          alerted = addToIdSet(systemAlertedKey(shopId), item.id)
        }
      }
    } catch {
      console.error('Failed to fetch notifications')
    }
  }, [shopId, openCta])

  useEffect(() => {
    if (!shopId) return
    setDismissed(readIdSet(dismissedKey(shopId)))
    setPopupSeen(readIdSet(popupSeenKey(shopId)))
    if (cache.shopId !== shopId) setItems([])
    if (cache.shopId !== shopId || Date.now() - cache.fetchedAt > STALE_MS) fetchItems()
    const timer = setInterval(fetchItems, REFRESH_MS)
    return () => clearInterval(timer)
  }, [shopId, fetchItems])

  const dismiss = (id) => setDismissed(addToIdSet(dismissedKey(shopId), id))
  const markPopupSeen = (id) => setPopupSeen(addToIdSet(popupSeenKey(shopId), id))

  const enableAlerts = async () => {
    if (!alertsSupported()) return
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result === 'granted') {
        // Don't replay everything already on screen as alerts.
        for (const item of items) addToIdSet(systemAlertedKey(shopId), item.id)
      }
    } catch { /* ignore */ }
  }

  const live = items.filter(isLive)
  const banners = live.filter(a => !(a.dismissible !== false && dismissed.has(String(a.id))))
  const popup = live.find(a => a.show_popup && !popupSeen.has(String(a.id))) || null

  return { items: live, banners, popup, dismiss, markPopupSeen, openCta, permission, enableAlerts }
}

const BANNER_STYLES = {
  error: 'bg-danger text-white',
  warning: 'bg-warning text-white',
  success: 'bg-success text-white',
  info: 'bg-primary text-white',
}

export function CtaButton({ item, role, onDone, className }) {
  const url = resolveCtaUrl(item?.cta_url, role)
  if (!url) return null
  const label = item.cta_label || 'Open'
  if (isExternalUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={onDone} className={className}>
        {label}
      </a>
    )
  }
  return <Link to={url} onClick={onDone} className={className}>{label}</Link>
}

export function NotificationBanners({ banners, role, onDismiss }) {
  if (banners.length === 0) return null
  return (
    <div className="flex flex-col shrink-0" role="region" aria-label="Notifications">
      {banners.map(ann => (
        <div
          key={ann.id}
          className={`px-3 sm:px-4 py-2 flex items-center gap-3 text-sm shadow-sm z-10 ${BANNER_STYLES[ann.type] || BANNER_STYLES.info}`}
        >
          <span aria-hidden="true" className="shrink-0">{ann.category === 'trial_ending' || ann.category === 'trial_expired' ? '⏳' : '📢'}</span>
          <div className="flex-1 min-w-0 sm:flex sm:items-center sm:gap-2">
            {ann.title && <span className="font-black block sm:inline">{ann.title}</span>}
            <span className="font-medium opacity-95 line-clamp-2 sm:line-clamp-1">{ann.message}</span>
          </div>
          <CtaButton
            item={ann}
            role={role}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-xs font-black uppercase tracking-wide transition whitespace-nowrap"
          />
          {ann.dismissible !== false && (
            <button
              type="button"
              onClick={() => onDismiss(ann.id)}
              className="shrink-0 p-1.5 hover:bg-black/10 rounded-full transition"
              title="Dismiss"
              aria-label="Dismiss notification"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const POPUP_ACCENT = {
  error: 'bg-danger-soft text-danger-strong',
  warning: 'bg-warning-soft text-warning-strong',
  success: 'bg-success-soft text-success-strong',
  info: 'bg-primary-soft text-primary-strong',
}

export function NotificationPopup({ item, role, onClose }) {
  if (!item) return null
  const close = () => onClose(item.id)
  return (
    <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center-safe justify-center p-3 sm:p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shop-notification-title"
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-surface rounded-2xl shadow-2xl border border-line-subtle"
        onClick={e => e.stopPropagation()}
      >
        <div className={`px-5 pt-5 pb-4 flex items-start gap-3 ${POPUP_ACCENT[item.type] || POPUP_ACCENT.info}`}>
          <span className="text-3xl" aria-hidden="true">{item.category === 'trial_ending' || item.category === 'trial_expired' ? '⏳' : '📢'}</span>
          <h2 id="shop-notification-title" className="flex-1 text-lg font-black leading-snug">{item.title || 'Notification'}</h2>
          <button type="button" onClick={close} aria-label="Close" className="p-1.5 rounded-full hover:bg-black/10 transition">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="px-5 py-4 text-fg-2 text-sm leading-relaxed whitespace-pre-line">{item.message}</p>
        <div className="px-5 pb-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={close} className="px-4 py-2.5 rounded-xl border border-line text-fg-3 font-bold text-sm hover:bg-surface-3 transition">
            Later
          </button>
          <CtaButton
            item={item}
            role={role}
            onDone={close}
            className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover text-white font-black text-sm text-center transition"
          />
        </div>
      </div>
    </div>
  )
}

export function NotificationList({ items, role, onNavigate }) {
  if (items.length === 0) return null
  return (
    <div className="divide-y divide-line-subtle">
      <p className="px-4 py-2 text-[10px] font-bold text-fg-subtle uppercase tracking-widest bg-primary-soft/50">Messages 📢</p>
      {items.map(a => (
        <div key={a.id} className="p-4 hover:bg-surface-2 transition">
          {a.title && <p className="text-sm font-bold text-fg">{a.title}</p>}
          <p className="text-xs text-fg-muted mt-0.5 line-clamp-3">{a.message}</p>
          <CtaButton
            item={a}
            role={role}
            onDone={onNavigate}
            className="inline-block mt-2 px-3 py-1 bg-primary-soft text-primary-fg rounded text-[10px] font-black hover:bg-primary hover:text-white transition uppercase"
          />
        </div>
      ))}
    </div>
  )
}
