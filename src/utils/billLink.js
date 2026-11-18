// ============================================================================
// Bill link: every sale carries a random bill_token; the bill prints a QR code
// that opens /b/<token> (public page, sql/bill_link_migration.sql).
// ============================================================================
import qrcode from 'qrcode-generator'

const FLAG = 'edgex_bill_links' // '1' once the database has stored a bill_token

// 32 lowercase hex characters (128 random bits) — same format the database makes
export function newBillToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export const billUrl = (token) => `${window.location.origin}/b/${token}`

// Remember that the database keeps bill tokens, so bills printed offline can show
// a QR that will work once the sale syncs.
export const billLinksKnown = () => { try { return localStorage.getItem(FLAG) === '1' } catch { return false } }
export const noteBillLinks = (saleRow) => {
  if (saleRow && typeof saleRow.bill_token === 'string' && saleRow.bill_token) {
    try { localStorage.setItem(FLAG, '1') } catch { /* storage unavailable */ }
  }
}

// Shop setting "Print QR code on bills" (Settings → Print), on by default
export const billQrEnabled = (shopSettings) => shopSettings?.bill_qr !== false

// QR code as an inline SVG string (prints sharply on thermal and A4)
export function qrSvg(text, { size = 120 } = {}) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  let path = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`
}
