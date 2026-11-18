// ============================================================================
// WhatsApp messages from the shop app: templates, phone numbers, the Outbox
// log, and opening WhatsApp. Every message the app prepares goes through
// openWhatsApp()/logWhatsApp() so it appears in WhatsApp → Outbox.
//
// WhatsApp opens with the text ready; the shopkeeper presses Send there. The app
// cannot see whether it was sent, so the Outbox lists messages *prepared*.
// ============================================================================
import { db } from '../services/db'

// 03001234567 → 923001234567; empty when there is no usable number
export function waPhone(phone) {
  let p = String(phone || '').replace(/[^0-9]/g, '')
  if (p.startsWith('0092')) p = p.slice(2)
  if (p.startsWith('03')) p = '92' + p.slice(1)
  else if (p.length === 10 && p.startsWith('3')) p = '92' + p
  return p
}

export const waUrl = (phone, text) => {
  const p = waPhone(phone)
  return `https://wa.me/${p}?text=${encodeURIComponent(text || '')}`
}

// ── Templates ───────────────────────────────────────────────────────────────
// Old built-in bill text: shops that saved it unchanged get the new default.
const OLD_BILL_DEFAULT = 'Hello [Name], thank you for shopping at [Shop Name]! Your bill summary for Invoice #[ID] is Rs. [Amount]. Thank you for your business!'

export const WA_TEMPLATES = {
  bill: {
    key: 'wa_bill_template',
    label: 'Bill (after a sale)',
    hint: 'Sent from the Sale complete screen. Lines whose value is empty (no balance, no link) are left out automatically.',
    placeholders: ['Name', 'Shop Name', 'ID', 'Date', 'Items', 'Amount', 'Discount', 'Paid', 'Balance', 'Total Balance', 'Link'],
    default:
`Assalam-o-Alaikum [Name]! 🙏
*[Shop Name]* se khareedari ka shukriya.

🧾 *Bill #[ID]* · [Date]
[Items]

Discount: Rs. [Discount]
💰 *Total: Rs. [Amount]*
✅ Paid: Rs. [Paid]
⏳ Is bill ka baqaya: Rs. [Balance]
📒 Aap ka kul baqaya: Rs. [Total Balance]

🔗 Bill online dekhein: [Link]

Shukriya! Dobara tashreef layein.`,
    sample: {
      Name: 'Ali Hardware', 'Shop Name': 'Raja Sanitary Store', ID: '1042', Date: '18 Nov 2026',
      Items: '• Basin Mixer × 2 = Rs. 4,800\n• PPRC Pipe 1 inch × 3.5 = Rs. 455', Amount: '5,200', Discount: '55',
      Paid: '4,000', Balance: '1,200', 'Total Balance': '16,400', Link: 'pos.edgexsuite.com/b/3f9a…',
    },
  },
  reminder: {
    key: 'wa_reminder_template',
    label: 'Payment reminder',
    hint: 'Used by Customers, Customer Ledger, Payment reminders and the WhatsApp page.',
    placeholders: ['Name', 'Shop Name', 'Amount', 'Days', 'Link'],
    default:
`Assalam-o-Alaikum [Name]!

*[Shop Name]* se yaad dehani: aap ka baqaya *Rs. [Amount]* hai.
Sab se purana bill [Days] din purana hai.
🔗 Apna hisaab dekhein: [Link]

Meharbani farma kar jald ada kar dein. Shukriya!`,
    sample: { Name: 'Ali Hardware', 'Shop Name': 'Raja Sanitary Store', Amount: '15,200', Days: '45', Link: '' },
  },
  reorder: {
    key: 'wa_reorder_template',
    label: 'Order to supplier',
    hint: 'Used by Inventory → Reorder.',
    placeholders: ['Supplier Name', 'Shop Name', 'Items'],
    default: 'Assalam-o-Alaikum *[Supplier Name]*! 🙏\n\n*[Shop Name]* se order:\n\n[Items]\n\nMeharbani farma kar jald supply karein. Shukriya!',
    sample: { 'Supplier Name': 'Porta Dealer', 'Shop Name': 'Raja Sanitary Store', Items: '• Basin Mixer — 24 (2 Box)\n• PPRC Pipe 1 inch — 16' },
  },
}

// The shop's saved template for `kind`, or the built-in default
export function templateFor(kind, shopSettings) {
  const t = WA_TEMPLATES[kind]
  const saved = shopSettings?.[t.key]
  if (!saved || !String(saved).trim()) return t.default
  if (kind === 'bill' && String(saved).trim() === OLD_BILL_DEFAULT) return t.default
  return saved
}

/**
 * Fill [Placeholders]. A line that contains a placeholder whose value is empty
 * (or 0 for money such as [Balance]) is dropped, so optional lines disappear.
 */
export function fillTemplate(template, vars) {
  const isEmpty = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '0'
  return String(template || '')
    .split('\n')
    .filter(line => {
      const keys = [...line.matchAll(/\[([^\]]+)\]/g)].map(m => m[1])
      return keys.every(k => !(k in vars) || !isEmpty(vars[k]))
    })
    .map(line => line.replace(/\[([^\]]+)\]/g, (m, k) => (k in vars ? String(vars[k]) : m)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-PK')

// Variables for the bill message from a POS receipt
export function billVars(receipt, { shopName, link } = {}) {
  const r = receipt || {}
  const sale = r.sale || {}
  const items = r.items || []
  const lines = items.slice(0, 12).map(i => `• ${i.name} × ${Number(i.qty)} = Rs. ${money(Number(i.custom_price) * Number(i.qty))}`)
  if (items.length > 12) lines.push(`• …and ${items.length - 12} more`)
  const total = Number(r.total) || 0
  const paid = Math.min(total, Number(sale.paid_amount ?? total) || 0)
  return {
    Name: r.customer?.name || r.walkInName || 'Customer',
    'Shop Name': shopName || 'our shop',
    ID: String(sale.id ?? '').slice(-8),
    Date: new Date(sale.created_at || Date.now()).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }),
    Items: lines.join('\n'),
    Amount: money(total),
    Discount: Number(r.totalDiscount) > 0 ? money(r.totalDiscount) : '',
    Paid: money(paid),
    Balance: total - paid > 0 ? money(total - paid) : '',
    'Total Balance': r.balanceAfter != null && Number(r.balanceAfter) > 0 ? money(r.balanceAfter) : '',
    Link: link || '',
  }
}

// ── Outbox ──────────────────────────────────────────────────────────────────
export const OUTBOX_KINDS = {
  bill: 'Bill', reminder: 'Reminder', statement: 'Statement', link: 'Customer link',
  summary: 'Daily summary', reorder: 'Supplier order', other: 'Other',
}

export async function logWhatsApp({ shopId, kind = 'other', phone, name, text }) {
  try {
    await db.wa_outbox.add({
      shop_id: shopId ?? null,
      kind,
      phone: waPhone(phone),
      name: name || '',
      text: String(text || ''),
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('WhatsApp outbox: could not save', e)
  }
}

// Log the message, then open WhatsApp with it ready to send
export function openWhatsApp({ shopId, kind, phone, name, text }) {
  logWhatsApp({ shopId, kind, phone, name, text })
  window.open(waUrl(phone, text), '_blank')
}
