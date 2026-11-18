import { useCallback, useEffect, useState } from 'react'
import { syncOfflineData, getSyncQueueItems, retrySyncItem, retryFailedSyncItems, discardSyncItem, getDiscardedSyncItems, restoreDiscardedSyncItem } from '../services/syncService'
import { describeSyncItem, explainSyncError, formatSyncAmount } from '../utils/syncLabels'
import EmptyState from '../components/EmptyState'
import toast from '../utils/toast'

// ============================================================================
// Sync status: every change saved on this device that has not reached the
// server yet — what it is, why it is stuck, and Retry / Discard (with undo).
// ============================================================================

const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' })} · ${d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
}

const STATE = {
  failed: { label: 'Stuck', cls: 'badge-danger' },
  waiting: { label: 'Waiting', cls: 'badge-warning' },
  pending: { label: 'Waiting to send', cls: 'badge-primary' },
}

function ItemCard({ item, onRetry, onDiscard, busy }) {
  const d = describeSyncItem(item)
  const why = explainSyncError(item.last_error, { failed: item.state === 'failed', waiting: item.state === 'waiting' })
  const [showRaw, setShowRaw] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(item, null, 2)); toast.success('Details copied — paste them in a message to EdgeX support') }
    catch { toast.error('Could not copy on this device') }
  }
  return (
    <li className={`card p-3 ${item.state === 'failed' ? 'border-danger-line' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${STATE[item.state].cls}`}>{STATE[item.state].label}</span>
            <span className="font-bold text-fg">{d.title}</span>
          </div>
          <p className="text-xs text-fg-muted mt-0.5">
            Saved {when(item.timestamp)}{d.detail ? ` · ${d.detail}` : ''}{item.retry_count ? ` · tried ${item.retry_count}×` : ''}
          </p>
        </div>
        {d.amount != null && <p className="font-black text-fg shrink-0 tabular-nums">{formatSyncAmount(d.amount)}</p>}
      </div>
      <div className={`mt-2 rounded-lg px-3 py-2 text-sm ${item.state === 'failed' ? 'bg-danger-soft text-danger-strong' : 'bg-surface-2 text-fg-2'}`}>
        <p className="font-semibold">{why.text}</p>
        <p className="text-xs opacity-80">{why.hint}</p>
      </div>
      {showRaw && <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-surface-2 p-2 text-[11px] text-fg-muted">{JSON.stringify(item.data, null, 2)}</pre>}
      <div className="mt-2 flex flex-wrap gap-2 justify-end">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRaw(v => !v)} aria-expanded={showRaw}>{showRaw ? 'Hide details' : 'Details'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>Copy</button>
        <button type="button" className="btn btn-ghost btn-sm text-danger-fg" disabled={busy} onClick={() => onDiscard(item)}>Discard</button>
        {item.state === 'failed' && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onRetry(item)}>↻ Retry</button>}
      </div>
    </li>
  )
}

export default function SyncStatus() {
  const [items, setItems] = useState(null)
  const [discarded, setDiscarded] = useState([])
  const [busy, setBusy] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  const load = useCallback(async () => {
    try { setItems(await getSyncQueueItems()) } catch { setItems([]) }
    setDiscarded(getDiscardedSyncItems())
  }, [])

  useEffect(() => {
    load()
    const on = () => { setOnline(navigator.onLine); load() }
    window.addEventListener('sync_completed', load)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    const t = setInterval(load, 10000)
    return () => { window.removeEventListener('sync_completed', load); window.removeEventListener('online', on); window.removeEventListener('offline', on); clearInterval(t) }
  }, [load])

  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); if (okMsg) toast.success(okMsg) } catch (e) { toast.error('Could not finish: ' + (e?.message || e)) }
    finally { setBusy(false); load() }
  }

  const syncNow = () => {
    if (!navigator.onLine) { toast.warning('No internet — changes will send when you are back online.'); return }
    run(() => syncOfflineData(), 'Sync finished')
  }
  const onRetry = (item) => run(() => retrySyncItem(item.id), 'Tried again')
  const onDiscard = (item) => {
    const d = describeSyncItem(item)
    if (!confirm(`Discard "${d.title}${d.amount != null ? ' ' + formatSyncAmount(d.amount) : ''}"?\n\nIt will NOT be sent to the server. Other devices and reports will not see it.\nYou can put it back from "Recently discarded" on this page.`)) return
    run(() => discardSyncItem(item.id), 'Discarded — you can restore it below')
  }

  if (items === null) return <p className="p-6 text-center text-fg-muted">Loading…</p>

  const failed = items.filter(i => i.state === 'failed')
  const waiting = items.filter(i => i.state !== 'failed')

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-fg">🔄 Sync status</h1>
          <p className="text-sm text-fg-muted">Changes saved on this device that have not reached the server yet.</p>
        </div>
        <div className="flex gap-2">
          {failed.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy || !online} onClick={() => run(retryFailedSyncItems, 'Tried all again')}>↻ Retry all stuck</button>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={syncNow}>{busy ? 'Working…' : 'Sync now'}</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className={`rounded-xl border px-3 py-2 ${online ? 'bg-success-soft border-success-line text-success-strong' : 'bg-warning-soft border-warning-line text-warning-strong'}`}>
          <p className="text-xs font-semibold">Internet</p><p className="font-black">{online ? 'Online' : 'Offline'}</p>
        </div>
        <div className="rounded-xl border px-3 py-2 bg-primary-soft border-primary-line text-primary-strong">
          <p className="text-xs font-semibold">Waiting to send</p><p className="font-black">{waiting.length}</p>
        </div>
        <div className={`rounded-xl border px-3 py-2 ${failed.length ? 'bg-danger-soft border-danger-line text-danger-strong' : 'bg-surface border-line text-fg-2'}`}>
          <p className="text-xs font-semibold">Stuck</p><p className="font-black">{failed.length}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState icon="✅" title="Everything is on the server" text="Sales, payments and changes made offline appear here until they are sent. Nothing is waiting right now." />
      ) : (
        <>
          {failed.length > 0 && (
            <section aria-labelledby="stuck-title">
              <h2 id="stuck-title" className="font-bold text-danger-fg mb-2">Needs your decision ({failed.length})</h2>
              <ul className="space-y-2">{failed.map(i => <ItemCard key={i.id} item={i} busy={busy} onRetry={onRetry} onDiscard={onDiscard} />)}</ul>
            </section>
          )}
          {waiting.length > 0 && (
            <section aria-labelledby="waiting-title">
              <h2 id="waiting-title" className="font-bold text-fg-2 mb-2">Waiting to send ({waiting.length})</h2>
              <ul className="space-y-2">{waiting.map(i => <ItemCard key={i.id} item={i} busy={busy} onRetry={onRetry} onDiscard={onDiscard} />)}</ul>
            </section>
          )}
        </>
      )}

      {discarded.length > 0 && (
        <details className="card p-0 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 font-bold text-fg-2">Recently discarded ({discarded.length})</summary>
          <ul className="divide-y divide-line-subtle">
            {discarded.map((it, idx) => {
              const d = describeSyncItem(it)
              return (
                <li key={`${it.id}-${it.discarded_at}`} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fg">{d.title}{d.amount != null ? ` · ${formatSyncAmount(d.amount)}` : ''}</p>
                    <p className="text-xs text-fg-muted">Discarded {when(it.discarded_at)}</p>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={busy}
                    onClick={() => run(() => restoreDiscardedSyncItem(idx), 'Put back in the queue')}>Put back</button>
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </div>
  )
}
