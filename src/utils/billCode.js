// ============================================================================
// Read what was scanned or typed to find a bill: the bill QR (a link ending in
// /b/<32-hex code>), the bare code, or the invoice number printed on the bill
// ("INV-12345678", "#12345678" or just the digits). Pure — no imports.
// ============================================================================

const TOKEN = /^[0-9a-f]{32}$/

export function parseBillCode(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  const fromUrl = raw.match(/\/b\/([0-9a-fA-F]{32})(?:[/?#]|$)/)
  if (fromUrl) return { token: fromUrl[1].toLowerCase() }
  if (TOKEN.test(raw.toLowerCase())) return { token: raw.toLowerCase() }
  const num = raw.replace(/^(?:inv(?:oice)?|bill|#)\s*[-#:]?\s*/i, '').replace(/^#/, '').trim()
  if (/^[0-9a-zA-Z-]{1,40}$/.test(num)) return { number: num }
  return null
}

// Does this sale match an invoice number (full id or the last 8 characters shown on bills)?
export function saleMatchesNumber(sale, number) {
  const id = String(sale?.id ?? '')
  const n = String(number || '').toLowerCase()
  if (!id || !n) return false
  return id.toLowerCase() === n || id.slice(-8).toLowerCase() === n
}
