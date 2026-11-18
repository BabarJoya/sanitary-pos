// ============================================================================
// "What's new" — shown from the sparkle button in the app header.
// Newest first. Add an entry with every release that shop owners will notice:
// give it a new, later `id` (YYYY-MM-DD, add -2, -3 for several on one day) so
// the header shows a dot until the owner opens the panel.
// Keep each line short and in the shopkeeper's words (what they can now do).
// ============================================================================

const WHATS_NEW = [
  {
    id: '2026-11-19',
    date: '19 Nov 2026',
    title: 'Faster checkout and clearer screens',
    items: [
      'POS: bigger Cash / Credit / Online / Split buttons that are easier to tap',
      'POS: the selected customer\'s balance and credit limit are shown next to their name',
      'After a sale, the change to give back is shown in large numbers',
      'Customers list shows as easy cards on phones',
      'Empty screens now tell you what to do next, with a button',
      'This "What\'s new" panel — check here to see every improvement',
    ],
  },
  {
    id: '2026-11-18',
    date: '18 Nov 2026',
    title: 'Bills, credit and stock',
    items: [
      'Bills show the customer\'s previous balance and total balance (sabiqa / kul baqaya)',
      'Credit limit per customer — cashiers are stopped when a bill goes over it',
      'Customer statement for any dates, with dues by age, to print or send on WhatsApp',
      'Stock Count screen: count many products at once, only the difference is applied',
      'Full stock history for every product (sale, purchase, return, count)',
      'Purchases: pay part now and keep the rest on credit',
      'Quantities like 2.5 ft / 1.5 kg, and box sizes with a "+1 Box" button',
      'Every sale, purchase and return is now saved in one safe step — nothing half-saved',
    ],
  },
  {
    id: '2026-11-17',
    date: '17 Nov 2026',
    title: 'Correct totals everywhere',
    items: [
      'Close Day is now a cash book: cash in drawer, online and credit shown separately',
      'Dashboard, Reports and printed reports now show the same totals',
      'Opening balance (purani dues) for new customers and suppliers is kept in the ledger',
      'Returns are no longer counted twice in customer and supplier ledgers',
      'Choose how cost price is set on purchase: last price or average',
    ],
  },
]

export default WHATS_NEW
export const LATEST_WHATS_NEW_ID = WHATS_NEW[0]?.id || ''
