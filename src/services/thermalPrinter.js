// ============================================================================
// Direct thermal printing (this device). Sends ESC/POS bytes straight to a
// receipt printer over Web Serial (USB/COM printers), WebUSB, or Web Bluetooth,
// skipping the browser print dialog. Chrome / Edge on Windows, Android and
// ChromeOS support these; other browsers fall back to normal printing.
// Settings live per device in localStorage (`edgex_thermal`).
// ============================================================================

const KEY = 'edgex_thermal'
// Common BLE "serial" services on cheap receipt printers
const BLE_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
]

export function getThermalSettings() {
  try { return { enabled: false, kind: '', width: 48, drawer: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { enabled: false, kind: '', width: 48, drawer: false } }
}
export function saveThermalSettings(patch) {
  const next = { ...getThermalSettings(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
  return next
}

export function availableMethods() {
  if (typeof navigator === 'undefined') return []
  const m = []
  if ('serial' in navigator) m.push('serial')
  if ('usb' in navigator) m.push('usb')
  if ('bluetooth' in navigator) m.push('bluetooth')
  return m
}

let conn = null // { kind, write(bytes), close() }

async function openSerial(port) {
  if (!port.writable) await port.open({ baudRate: 9600 })
  return {
    kind: 'serial',
    async write(bytes) { const w = port.writable.getWriter(); try { await w.write(bytes) } finally { w.releaseLock() } },
    async close() { try { await port.close() } catch { /* already closed */ } },
  }
}

async function openUsb(device) {
  if (!device.opened) await device.open()
  if (device.configuration === null) await device.selectConfiguration(1)
  let target = null
  for (const iface of device.configuration.interfaces) {
    for (const alt of iface.alternates) {
      const ep = alt.endpoints.find(e => e.direction === 'out' && e.type === 'bulk')
      if (ep) { target = { iface: iface.interfaceNumber, ep: ep.endpointNumber }; break }
    }
    if (target) break
  }
  if (!target) throw new Error('This USB device has no printer output')
  try { await device.claimInterface(target.iface) } catch { /* may already be claimed */ }
  return {
    kind: 'usb',
    async write(bytes) { await device.transferOut(target.ep, bytes) },
    async close() { try { await device.close() } catch { /* ignore */ } },
  }
}

async function openBluetooth(device) {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect()
  let ch = null
  for (const uuid of BLE_SERVICES) {
    try {
      const svc = await server.getPrimaryService(uuid)
      const chars = await svc.getCharacteristics()
      ch = chars.find(c => c.properties.writeWithoutResponse || c.properties.write)
      if (ch) break
    } catch { /* try next */ }
  }
  if (!ch) throw new Error('No printer service found on this Bluetooth device')
  return {
    kind: 'bluetooth',
    async write(bytes) {
      for (let i = 0; i < bytes.length; i += 180) {
        const part = bytes.slice(i, i + 180)
        if (ch.properties.writeWithoutResponse) await ch.writeValueWithoutResponse(part)
        else await ch.writeValue(part)
      }
    },
    async close() { try { device.gatt.disconnect() } catch { /* ignore */ } },
  }
}

// Ask the user to pick a printer (must be called from a click)
export async function connectPrinter(kind) {
  if (conn) { await conn.close(); conn = null }
  if (kind === 'serial') conn = await openSerial(await navigator.serial.requestPort())
  else if (kind === 'usb') conn = await openUsb(await navigator.usb.requestDevice({ filters: [{ classCode: 7 }] }))
  else if (kind === 'bluetooth') conn = await openBluetooth(await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES }))
  else throw new Error('Choose how the printer is connected')
  saveThermalSettings({ kind })
  return conn.kind
}

// Re-open a printer this browser was already allowed to use (no pop-up)
async function reconnect() {
  const { kind } = getThermalSettings()
  if (kind === 'serial' && navigator.serial) {
    const [port] = await navigator.serial.getPorts()
    if (port) conn = await openSerial(port)
  } else if (kind === 'usb' && navigator.usb) {
    const [device] = await navigator.usb.getDevices()
    if (device) conn = await openUsb(device)
  } else if (kind === 'bluetooth' && navigator.bluetooth?.getDevices) {
    const [device] = await navigator.bluetooth.getDevices()
    if (device) conn = await openBluetooth(device)
  }
  return !!conn
}

export async function printBytes(bytes) {
  if (!conn && !(await reconnect())) throw new Error('Printer not connected — Settings → POS & Receipts → Direct thermal printer')
  try {
    await conn.write(bytes)
  } catch (e) {
    conn = null // dropped (cable / Bluetooth): try once more with a fresh connection
    if (!(await reconnect())) throw e
    await conn.write(bytes)
  }
}

export const printerConnected = () => !!conn
