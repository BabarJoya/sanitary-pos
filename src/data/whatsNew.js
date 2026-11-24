// ============================================================================
// "What's new" — the full-screen updates page (header ✨ button). It opens by
// itself once after each new release and can always be closed.
// Newest first. Add an entry with every release that shop owners will notice:
// give it a new, later `id` (YYYY-MM-DD, add -2, -3 for several on one day).
// Each item: { text, module, to } — `to` is the in-app page the "Open" button
// goes to (e.g. '/whatsapp', '/settings#pos'); leave it out for fixes.
// Keep each line short and in the shopkeeper's words (what they can now do).
// ============================================================================

const WHATS_NEW = [
  {
    id: '2026-12-08',
    date: '8 Dec 2026',
    title: 'Item report: profit, reorder and dead stock',
    items: [
      { text: 'Reports → 📦 Item report: profit and margin on every product for the last 30, 60 or 90 days', module: 'Reports', to: '/item-reports' },
      { text: 'Reorder list: items running out, with how many to order for the next 30 days', module: 'Reports', to: '/item-reports' },
      { text: 'Slow and dead stock: what has not sold, and how much money is stuck on the shelf', module: 'Reports', to: '/item-reports' },
    ],
  },
  {
    id: '2026-12-07',
    date: '7 Dec 2026',
    title: 'Search finds items even with spelling mistakes',
    items: [
      { text: 'POS search understands spelling mistakes — \'mixar\', \'shwoer\' and \'comode\' still find the item', module: 'POS', to: '/pos' },
      { text: 'Type in Roman Urdu: \'tonti\' finds taps, \'paip\' finds pipes, \'kamod\' finds commodes, \'wal\' finds valves', module: 'POS', to: '/pos' },
      { text: 'Items you sell the most now show first in POS', module: 'POS', to: '/pos' },
    ],
  },
  {
    id: '2026-12-06',
    date: '6 Dec 2026',
    title: 'Shift close saved on the server',
    items: [
      { text: "Close Day → count the cash → 💾 Save shift close: opening, expected, counted and short/extra are saved with the cashier's name", module: 'Dashboard', to: '/dashboard' },
      { text: 'See the last closes and who was short or extra — from any phone or computer', module: 'Dashboard', to: '/dashboard' },
      { text: 'Saved closes cannot be changed or deleted later; offline closes send when the internet is back', module: 'Safety' },
    ],
  },
  {
    id: '2026-12-05',
    date: '5 Dec 2026',
    title: 'Returns by scanning the bill',
    items: [
      { text: "Sales History → ↩️ Return by bill: scan the QR on the customer's bill (or type the bill number) and the bill opens ready for the return", module: 'Sales', to: '/sales' },
      { text: 'On phones that support it, scan the bill QR with the camera right inside the app', module: 'Sales', to: '/sales' },
      { text: 'Scanned a bill with your phone camera? The bill page now has an \'Open in Sales\' button for shop staff', module: 'Sales', to: '/sales' },
    ],
  },
  {
    id: '2026-12-04',
    date: '4 Dec 2026',
    title: 'Correct cash on part-paid udhaar bills',
    items: [
      { text: 'Fixed: when a credit (udhaar) bill was partly paid at the counter, that cash was missing from Cash in drawer, Close Day and Reports — it is now counted', module: 'Fix' },
      { text: 'Automatic checks now test the money totals (cash, credit, returns, ledgers) before every update, so totals stay correct', module: 'Safety' },
    ],
  },
  {
    id: '2026-12-03',
    date: '3 Dec 2026',
    title: 'Scan a new item and sell it straight away',
    items: [
      { text: 'Barcode not found? Type the name, price and stock in a short form — the product is saved and goes straight into the bill', module: 'POS', to: '/pos' },
      { text: 'Scanning into the POS search box now works: a known barcode goes into the bill when the scanner presses Enter', module: 'POS', to: '/pos' },
      { text: 'Only the shop admin or manager can add products this way; cashiers are told to ask the admin', module: 'POS', to: '/pos' },
    ],
  },
  {
    id: '2026-12-02',
    date: '2 Dec 2026',
    title: 'See what is waiting to sync',
    items: [
      { text: 'New Sync status page: every sale, payment or change saved on this device that has not reached the server yet', module: 'Sync', to: '/sync' },
      { text: 'Stuck items show why in plain words, with Retry or Discard — discarded items can be put back', module: 'Sync', to: '/sync' },
      { text: 'The Online / Offline sign at the top now shows how many changes are waiting, and turns red if something is stuck — tap it to open Sync status', module: 'Sync', to: '/sync' },
    ],
  },
  {
    id: '2026-12-01',
    date: '1 Dec 2026',
    title: 'No more "OK" pop-ups to tap',
    items: [
      { text: 'Saved, error and reminder messages now show as a small note at the bottom — work continues without tapping OK', module: 'All screens' },
      { text: 'Green = done, red = problem, amber = check this; longer messages stay longer and you can tap to close', module: 'All screens' },
      { text: 'On phones and tablets, small buttons in lists (Edit, Ledger, WhatsApp…) are now bigger and easier to tap', module: 'All screens' },
    ],
  },
  {
    id: '2026-11-30',
    date: '30 Nov 2026',
    title: 'All pop-up windows work the same way',
    items: [
      { text: 'Every pop-up has its title and a ✕ at the top, and closes with the Esc key', module: 'All screens' },
      { text: 'On phones pop-ups open from the bottom, with Save / Done buttons always visible', module: 'All screens' },
      { text: 'Forms (stock adjust, add transaction, split payment…) no longer close if you tap outside by mistake — your typing is kept', module: 'All screens' },
      { text: 'The cursor goes straight to the first box, and back to where you were when the pop-up closes', module: 'All screens' },
    ],
  },
  {
    id: '2026-11-29',
    date: '29 Nov 2026',
    title: 'Search stays in view on long lists',
    items: [
      { text: 'Products, Inventory, Sales and Customers: the search and filters stay at the top while you scroll', module: 'Products', to: '/products' },
      { text: 'See "Showing 12 of 340" and clear every filter with one tap', module: 'Sales', to: '/sales' },
      { text: 'Customers now has a search box (name, phone, address) and "Owes money only"', module: 'Customers', to: '/customers' },
    ],
  },
  {
    id: '2026-11-28',
    date: '28 Nov 2026',
    title: 'Dashboard shows your day at a glance',
    items: [
      { text: 'Four big "Today" cards: Sale, Cash in drawer, Udhaar given and Payments received — tap any card to open it', module: 'Dashboard', to: '/dashboard' },
      { text: 'Cash in drawer counts cash sales and cash received, minus expenses, refunds and supplier cash — same as Close Day', module: 'Dashboard', to: '/dashboard' },
      { text: '"Needs attention": low stock, customers who owe you, bills on hold and changes waiting for internet, each with a button', module: 'Dashboard', to: '/dashboard' },
      { text: 'Profit on the Dashboard is shown only to staff allowed to see profit', module: 'Users', to: '/users' },
    ],
  },
  {
    id: '2026-11-27',
    date: '27 Nov 2026',
    title: 'Faster billing at the counter',
    items: [
      { text: 'Fixed: F4 now opens the payment screen straight away', module: 'POS', to: '/pos' },
      { text: 'Press + or − to change the quantity of the item you added last — no need to click the box', module: 'POS', to: '/pos' },
      { text: '🧾 Recent bills (F6): print or WhatsApp any of the last 5 bills again', module: 'POS', to: '/pos' },
      { text: '⌨️ Keys button (or press ?) shows every keyboard shortcut; Complete Sale shows F9', module: 'POS', to: '/pos' },
    ],
  },
  {
    id: '2026-11-26',
    date: '26 Nov 2026',
    title: 'Easier price editing in Inventory',
    items: [
      { text: 'Inventory → Edit Prices: easy cards on phones, search, and "Changed only" to check your edits', module: 'Inventory', to: '/inventory' },
      { text: 'Changed prices are highlighted with an Undo button, and Save shows how many products you changed', module: 'Inventory', to: '/inventory' },
      { text: 'Closing with unsaved changes now asks first, so edits are not lost by mistake', module: 'Inventory', to: '/inventory' },
      { text: 'Saved / error messages now appear as a small note at the bottom instead of a pop-up you must tap OK on', module: 'Inventory', to: '/inventory' },
      { text: 'Bigger History and Adjust buttons in the stock list', module: 'Inventory', to: '/inventory' },
    ],
  },
  {
    id: '2026-11-25',
    date: '25 Nov 2026',
    title: 'Pop-up windows fit the screen',
    items: [
      { text: 'Fixed: the brand price editor in Inventory no longer opens with its top hidden — you can always see the title and close button', module: 'Inventory', to: '/inventory' },
      { text: 'Fixed: tall pop-ups on every screen now start at the top and scroll inside, on computers and phones', module: 'Fix' },
    ],
  },
  {
    id: '2026-11-24',
    date: '24 Nov 2026',
    title: 'Real bill with QR for your customers',
    items: [
      { text: 'The QR page now shows the actual bill — 80mm receipt or A4 invoice, with its QR — to view, print or download as PDF', module: 'Bill QR page', to: '/sales' },
      { text: 'Choose in Settings → POS & Receipts whether customers can see the printed bill or only the summary', module: 'Settings', to: '/settings#pos' },
      { text: 'Professional A4 invoice with a clear "Scan to view this bill online" QR panel', module: 'Settings', to: '/settings#pos' },
      { text: 'Step-by-step guide inside WhatsApp → Outbox', module: 'WhatsApp', to: '/whatsapp?tab=outbox' },
      { text: 'This full-screen updates page — tap any update to open that module', module: 'Updates' },
    ],
  },
  {
    id: '2026-11-23',
    date: '23 Nov 2026',
    title: 'Better WhatsApp messages + Outbox',
    items: [
      { text: 'Bill on WhatsApp now lists the items, total, paid, balance and the bill link', module: 'POS', to: '/pos' },
      { text: 'Edit each WhatsApp message with clickable [placeholders] and a live preview', module: 'Settings', to: '/settings#whatsapp' },
      { text: 'WhatsApp → Outbox: every bill, reminder, statement and order you sent, with "Send again" and Copy', module: 'WhatsApp', to: '/whatsapp?tab=outbox' },
      { text: 'Fixed: scanning a bill QR on a phone with an older copy of the app no longer shows a blank screen', module: 'Fix' },
    ],
  },
  {
    id: '2026-11-22',
    date: '22 Nov 2026',
    title: 'New Smart bill with QR code',
    items: [
      { text: 'New "Smart" bill design: big total, easy-to-read items, paid / balance due and the customer\'s account', module: 'Settings', to: '/settings#pos' },
      { text: 'Every bill prints a QR code — the customer scans it to open the bill on their phone', module: 'POS', to: '/pos' },
      { text: 'Reprinted bills from Sales History carry the QR too', module: 'Sales', to: '/sales' },
      { text: 'Cleaner "Sale complete" screen: bill number, payment type, change to return, customer balance', module: 'POS', to: '/pos' },
      { text: 'Fixed: pop-up windows no longer turn the whole screen black', module: 'Fix' },
    ],
  },
  {
    id: '2026-11-21',
    date: '21 Nov 2026',
    title: 'Customers can see their own account',
    items: [
      { text: 'Customer Ledger → 🔗 Customer link: send a private link on WhatsApp', module: 'Customer Ledger', to: '/customer-ledger' },
      { text: 'The customer sees their balance, bills (with items) and payments without any login — nothing else', module: 'Customer Ledger', to: '/customer-ledger' },
      { text: 'Links work for 6 months; make a new link or turn it off any time', module: 'Customer Ledger', to: '/customer-ledger' },
      { text: 'Fixed: a customer\'s ledger now opens from saved data when the internet is weak', module: 'Fix' },
    ],
  },
  {
    id: '2026-11-20',
    date: '20 Nov 2026',
    title: 'Get paid faster, reorder on time',
    items: [
      { text: 'Payment reminders: who owes the longest comes first, one tap to send a WhatsApp reminder', module: 'Customer Ledger', to: '/customer-ledger' },
      { text: "Close Day sends today's summary straight to the owner's WhatsApp, with a reminder after 7 pm", module: 'Dashboard', to: '/dashboard' },
      { text: 'Reorder: low stock grouped by supplier — WhatsApp the order or make a purchase draft', module: 'Inventory', to: '/inventory' },
      { text: 'After saving a purchase, print price labels for exactly what arrived', module: 'Purchases', to: '/purchases' },
      { text: 'Allowed Actions: choose who can give discounts, change prices, sell below cost, see profit or delete', module: 'Users', to: '/users' },
      { text: 'Fixed: "Hold" in Purchases now works', module: 'Fix' },
    ],
  },
  {
    id: '2026-11-19',
    date: '19 Nov 2026',
    title: 'Faster checkout and clearer screens',
    items: [
      { text: 'Bigger Cash / Credit / Online / Split buttons and the customer\'s credit limit next to their name', module: 'POS', to: '/pos' },
      { text: 'Customers list shows as easy cards on phones', module: 'Customers', to: '/customers' },
      { text: 'Empty screens now tell you what to do next, with a button', module: 'All screens' },
    ],
  },
  {
    id: '2026-11-18',
    date: '18 Nov 2026',
    title: 'Bills, credit and stock',
    items: [
      { text: 'Bills show the customer\'s previous balance and total balance (sabiqa / kul baqaya)', module: 'POS', to: '/pos' },
      { text: 'Credit limit per customer — cashiers are stopped when a bill goes over it', module: 'Customers', to: '/customers' },
      { text: 'Customer statement for any dates, with dues by age, to print or send on WhatsApp', module: 'Customer Ledger', to: '/customer-ledger' },
      { text: 'Stock Count screen and full stock history for every product', module: 'Inventory', to: '/inventory' },
      { text: 'Purchases: pay part now and keep the rest on credit; quantities like 2.5 ft; box sizes', module: 'Purchases', to: '/purchases' },
      { text: 'Every sale, purchase and return is now saved in one safe step — nothing half-saved', module: 'Safety' },
    ],
  },
  {
    id: '2026-11-17',
    date: '17 Nov 2026',
    title: 'Correct totals everywhere',
    items: [
      { text: 'Close Day is now a cash book: cash in drawer, online and credit shown separately', module: 'Dashboard', to: '/dashboard' },
      { text: 'Dashboard, Reports and printed reports now show the same totals', module: 'Reports', to: '/reports' },
      { text: 'Opening balance (purani dues) for new customers and suppliers is kept in the ledger', module: 'Customers', to: '/customers' },
      { text: 'Choose how cost price is set on purchase: last price or average', module: 'Settings', to: '/settings#pos' },
    ],
  },
]

export default WHATS_NEW
export const LATEST_WHATS_NEW_ID = WHATS_NEW[0]?.id || ''
