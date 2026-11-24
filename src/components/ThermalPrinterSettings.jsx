import { useState } from 'react'
import { getThermalSettings, saveThermalSettings, availableMethods, connectPrinter, printBytes, printerConnected } from '../services/thermalPrinter'
import { buildTestPage } from '../utils/escpos'
import toast from '../utils/toast'

// Settings → POS & Receipts → Direct thermal printer (this device only)
const METHOD_LABEL = { serial: '🔌 USB / COM (Serial)', usb: '🖨️ USB printer', bluetooth: '📶 Bluetooth' }

export default function ThermalPrinterSettings({ shopName }) {
  const [s, setS] = useState(getThermalSettings)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(printerConnected())
  const methods = availableMethods()
  const update = (patch) => setS(saveThermalSettings(patch))

  const connect = async (kind) => {
    setBusy(true)
    try {
      await connectPrinter(kind)
      setConnected(true)
      update({ kind, enabled: true })
      toast.success('Printer connected. Tap "Test print" to check it.')
    } catch (e) {
      if (e?.name !== 'NotFoundError') toast.error('Could not connect: ' + (e?.message || e))
    } finally { setBusy(false) }
  }

  const testPrint = async () => {
    setBusy(true)
    try { await printBytes(buildTestPage({ width: s.width, drawer: s.drawer, shopName })); setConnected(true); toast.success('Test page sent to the printer') }
    catch (e) { toast.error(e?.message || String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="md:col-span-2 rounded-xl border border-line p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-fg-2">🧾 Direct thermal printer (this device)</p>
        <p className="text-xs text-fg-muted">Prints receipts straight to the printer — no print window — and can open the cash drawer. Works in Chrome or Edge on Windows, Android and ChromeOS. Other devices keep the normal print. Receipts print in English letters (Urdu shop names and footers need the normal print).</p>
      </div>

      {methods.length === 0 ? (
        <p className="text-sm rounded-lg px-3 py-2 bg-warning-soft text-warning-strong">This browser cannot talk to printers directly. Use Chrome or Edge, or keep the normal print.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {methods.map(m => (
              <button key={m} type="button" className={`btn btn-sm min-h-10 ${s.kind === m && connected ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => connect(m)}>
                {METHOD_LABEL[m]}{s.kind === m && connected ? ' ✓' : ''}
              </button>
            ))}
          </div>
          <p className="text-xs text-fg-muted">{s.kind ? `Printer: ${METHOD_LABEL[s.kind]}${connected ? ' — connected' : ' — reconnects when you print'}` : 'Pick how the printer is connected, then choose it in the list the browser shows.'}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 min-h-10 cursor-pointer text-sm font-semibold text-fg-2">
              <input type="checkbox" className="h-5 w-5" checked={!!s.enabled} disabled={!s.kind} onChange={e => update({ enabled: e.target.checked })} />
              Print receipts directly
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-fg-2">
              Paper
              <select className="input !w-auto" value={s.width} onChange={e => update({ width: Number(e.target.value) })} aria-label="Paper width">
                <option value={48}>80 mm</option>
                <option value={32}>58 mm</option>
              </select>
            </label>
            <label className="flex items-center gap-2 min-h-10 cursor-pointer text-sm font-semibold text-fg-2">
              <input type="checkbox" className="h-5 w-5" checked={!!s.drawer} onChange={e => update({ drawer: e.target.checked })} />
              Open cash drawer on cash sales
            </label>
          </div>
          <button type="button" className="btn btn-secondary btn-sm min-h-10" disabled={busy || !s.kind} onClick={testPrint}>{busy ? 'Working…' : '🖨️ Test print'}</button>
        </>
      )}
    </div>
  )
}
