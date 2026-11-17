# EdgeX POS: Shop Modules Calculation And Practicality Audit

Audit date: 2026-11-18. Base: `main` at `ad77e35`.
Method: static reading of `src/pages/*` (shop modules), `src/services/{integrity,syncService,db,fetchAll}.js`, `src/utils/{businessPresets,billTemplates}.js` and the SQL in `sql/` and root `*.sql`. No test login was available, so nothing was run against the hosted database. Line numbers refer to `ad77e35`.

Not re-reported (already fixed in PRs #2/#3, commits `e5e6d34`, `d632d90`): return refunds sharing the bill discount, ledger delete reversals, POS paid_amount / discount cap / below-cost rule, plan limits, out-of-stock add-to-cart, deleted-sale stock/balance reversal, 1,000-row paging for main lists. Those fixes were re-read and their own math holds: `splitReturnRefund`, `saleUnpaidAmount`, `applySaleEffects`, the POS discount cap, `getUnitPrice` and tier switching are correct as written.

Severity: **High** = money or stock is wrong in normal daily use, or a button can destroy correct data. **Medium** = wrong in a common edge case, or a report gives a misleading total. **Low** = cosmetic, rare, or off by a day at night.

---

## 1. Calculation errors (ranked)

### High

**H1. Customer ledger counts quotations as unpaid sales; Reconcile then writes them into the balance.**
`src/pages/CustomerLedger.jsx:46` loads every `sales` row for the customer with no `sale_type` filter. `:93-95` adds `amount - paid_amount` for each one, and quotations are saved with `paid_amount: 0` (`POS.jsx:893`).
*Example:* customer Ali owes Rs 2,000. The shop gives him a Rs 50,000 quotation. Ledger running balance = Rs 52,000; stored `outstanding_balance` = Rs 2,000 (correct). If the shopkeeper presses **Reconcile** (`:489-497`) the balance becomes Rs 52,000.
*Expected:* quotations are left out of the ledger (`.eq('sale_type','sale')`, also in the offline branch near `:136`).

**H2. Returns are subtracted twice in both ledgers.**
A sale return lowers the invoice (`Sales.jsx:182`, `total_amount` reduced) **and** inserts a negative `customer_payments` row with type `return` (`Sales.jsx:180`). The ledger uses the already-reduced invoice and then subtracts the return row again (`CustomerLedger.jsx:76, 101`). Purchase returns do the same: `PurchaseHistory.jsx:164-165` lowers the purchase total and `:173-179` adds a `supplier_payments` row of type `return`; `SupplierLedger.jsx:113-114` (and `Suppliers.jsx:86-90`) subtracts both.
*Example (customer):* credit sale Rs 1,000, nothing paid. Return goods worth Rs 500 to balance. Stored balance = Rs 500 (correct). Ledger: invoice now 500 owed, minus return row 500 → **Rs 0**. Reconcile → balance Rs 0 and Rs 500 of real dues disappear.
*Example (supplier):* credit purchase Rs 1,000; return Rs 300. Stored balance Rs 700 (correct); ledger shows **Rs 400**.
*Expected:* keep one source of truth. Either leave the invoice untouched and post the return as its own ledger line, or keep reducing the invoice and show the return row as information only (no running-balance effect). The first is better for audit trails.

**H3. Opening balances are not in the ledger, so Reconcile wipes them.**
Opening dues only enter via Excel import (`Customers.jsx:126`, `Suppliers.jsx:402`) or the Supplier form field (`Suppliers.jsx:26`), written straight to `outstanding_balance` with no ledger row. `CustomerLedger.jsx:106-118` shows an "Opening Balance" line only when there are **no** other transactions; `SupplierLedger.jsx:111-116` never shows one.
*Example:* imported customer with Rs 15,000 old dues buys Rs 1,000 on credit. Ledger shows Rs 1,000; stored balance Rs 16,000. Reconcile → Rs 1,000 (Rs 15,000 lost).
*Expected:* record the opening balance as a dated ledger entry (`payment_type: 'opening'`) when the customer/supplier is created or imported, start the running balance from it, and until H1–H3 are fixed, hide or admin-gate the Reconcile buttons.

**H4. Deleting a purchase in Purchase History leaves stock and supplier balance unchanged, and Trash cannot restore its items.**
`PurchaseHistory.jsx:331-348` deletes the header only, never calls `adjustStock` or `adjustSupplierBalance` (the Supplier Ledger delete at `SupplierLedger.jsx:207-240` does). `purchase_items` are `ON DELETE CASCADE` (`full_database_schema.sql:133`), so they vanish, and Trash keeps only the header (`:346`).
*Example:* credit purchase of 10 basin mixers, Rs 50,000, entered by mistake and deleted. Stock stays +10, supplier still shows Rs 50,000 owed; restoring from Trash brings back a purchase with no items.
*Expected:* reuse the Supplier Ledger delete path (load items, reverse remaining stock, reverse credit amount, trash header + items like sales do).

**H5. Editing a product writes back a stale stock quantity.**
`EditProduct.jsx:85` loads `stock_quantity` into the form and `:225-243` sends the whole form, stock included.
*Example:* owner opens "PPRC Pipe 1in" (stock 40) to change the price. Meanwhile the counter sells 6 (server stock 34). Owner saves → stock back to **40**. Same with a stale offline copy (`:128-132`) and the offline replay (`:253`).
Also `product.x || ''` turns 0 into an empty string (`:82, 85`), so saving a product with zero stock or zero cost sends `''` to a numeric column, which Postgres rejects (only `c_rate` is patched at `:228`). The offline replay is then parked as a permanent failure (`syncService.js:258`, code 22P02). This is likely, but confirm on a test shop.
*Expected:* never send `stock_quantity` from Edit Product (stock changes go through Inventory adjust/purchase/sale); convert empty numeric inputs to `0`/`null`.

**H6. End-of-Day "Net Cash" and the cash/credit split don't match the cash drawer.**
`Dashboard.jsx:100-101` labels a sale "cash" if `payment_type === 'cash'` and everything else "credit", using the full net bill. `:189-199` computes `netCash = cashSales − expenses − cashPurchases`.
*Examples:* (a) JazzCash/EasyPaisa or split bills fully paid count as **credit**. (b) A Rs 10,000 bill with Rs 4,000 cash received is saved as `payment_type 'cash'` and counted as Rs 10,000 cash. (c) Credit recoveries received today (`customer_payments` type `payment`), supplier payments made today, and cash refunds from returns are all ignored.
*Expected:* Cash in = Σ `payment_details` amounts with method cash (capped to `paid_amount`) + today's customer cash payments − cash refunds; cash out = cash supplier payments + cash expenses. Show online wallets as their own line and credit as `net − paid_amount`.

**H7. Stock is only checked when an item is added, so some paths can still sell more than is in stock.**
The out-of-stock fix lives in `addToCart`/`updateQty` (`POS.jsx:582-617`). `handleCompleteSale` (`:843`) does not re-check, and these paths fill the cart directly: quotation → sale (`:1071-1092`, `:312-338`), resuming a held bill (`:748-758`, stock may have been sold since holding), and brand discount "add all" (`:834`, adds every brand product at qty 1 even when stock is 0). `adjust_product_stock` (`sql/data_integrity_migration.sql:15-33`) also allows negatives.
*Example:* quotation for 20 tiles boxes, only 12 in stock. Convert to sale → stock −8, profit counted on goods that don't exist.
*Expected:* validate every cart line against fresh stock in `handleCompleteSale`. Optionally a per-shop "allow negative stock" setting plus a DB check.

### Medium

**M1. An offline purchase return skips the supplier balance, and a network drop mid-return applies stock twice.**
`PurchaseHistory.jsx:204-232`: the offline branch updates items, stock and total but never adjusts the supplier balance or logs the return. Also, if the online loop (`:148-161`) fails with "Failed to fetch" after some items were done, the catch re-runs **all** items offline, so `adjustStock(-qty)` is applied again for those already processed.
*Example:* credit purchase return of Rs 3,000 while offline → supplier still shows Rs 3,000 more than owed.
*Expected:* use the step-tracking pattern from `Sales.jsx:184-245` and `adjustSupplierBalance` (which queues by itself).

**M2. Purchase-level discount is lost, so returns and cost are overstated.**
`Purchases.jsx:194-249` saves `total_amount = subtotal − discount` but not the discount itself. Returns refund `unit_price × qty` (`PurchaseHistory.jsx:150`).
*Example:* 10 × Rs 100, discount Rs 100, credit total Rs 900. Return all 10 → supplier balance −Rs 1,000 (Rs 100 phantom credit), purchase total clamps to 0.
*Expected:* store `discount` on `purchases` (the column exists in `full_database_schema.sql:122`) and share it across lines the way `splitReturnRefund` does.

**M3. Cost price = last purchase price before discount; bulk % changes also rewrite the cost of stock already bought.**
`Purchases.jsx:306` overwrites `cost_price` with the line price, ignoring the bill discount and the cost of stock already on hand. `Inventory.jsx:543-548` multiplies `cost_price` (and rounds to whole rupees) when a company raises list prices, and does not touch `c_rate`.
*Example:* 10 in stock bought at Rs 100; buy 10 more at Rs 120 → all 20 valued at Rs 120 (Inventory value Rs 2,400 vs real Rs 2,200), and profit on the first 10 sold is understated by Rs 200. A "+8% Porta rate increase" makes existing stock look 8% more expensive while the C.Rate stays old, so POS C.Rate-based brand discounts (`POS.jsx:810-818`) are computed from an outdated list price.
*Expected:* shop setting "Cost method: last purchase / weighted average", with weighted average = (old stock × old cost + qty × net unit cost) / new stock, computed in an RPC. Bulk % should change `c_rate`/`sale_price`/`wholesale_price` only, with a rounding option (1/5/10).

**M4. Inventory stock adjust is an absolute write, cuts off fractions, and replays the whole product offline.**
`Inventory.jsx:342` writes `parseInt(newStock)` (12.5 ft → 12). It overwrites sales made on another device since the screen loaded. Offline (`:369-371`) it queues the **whole product row**, which later overwrites newer prices/stock. "Record return" (`:389-410`) is read-then-write (racy), uses `parseInt`, and records no refund or customer link.
*Expected:* compute `delta = counted − currentServerStock` and call `adjustStock(delta)` with a reason; use `Number()`; replace "Record return" with a link to Sales → Return, or record a refund.

**M5. Purchase returns drop fractional quantities.**
`PurchaseHistory.jsx:136, 149, 210` use `parseInt`. Returning 2.5 m of pipe or 1.5 kg returns 2 / 1. Sales returns were already fixed to `Number()`.

**M6. The printed Sales Report in Settings disagrees with Reports and Dashboard.**
`Settings.jsx:520-525` + `billTemplates.js:640-646`: includes **quotations** (no `sale_type` filter); "Total" is gross `total_amount` (before discount); "Paid" reads `amount_paid` (old column, always 0) so "Balance" = total; cash/card/credit buckets use `payment_method` values and miss online wallets and split; `.in('sale_id', ids)` with a month of ids can exceed URL limits and silently return no items; no paging past 1,000; "week" = 7 days here vs 8 in Reports.
*Expected:* one shared `computeSalesSummary(sales, items, payments)` helper used by Dashboard, Reports, EOD and this printout.

**M7. Reports page totals don't agree with each other.**
`Reports.jsx`:
- Sales trend (`:152-156`) plots gross `total_amount` (before discount) while the KPI cards are net, and keys by "17 Nov", so in "All time"/"Year" the same date in different years merges.
- Category pie (`:161`) reads `i.products?.categories?.name`, but the online query (`:81`) does not join products, so online everything is "Uncategorized"; it also ignores the bill discount and hides loss-making categories (`:165`).
- Expenses and purchases (`:82-83`) are not paged (capped at 1,000 rows for Year/All).
- "Week" (`:68`) covers 8 calendar days.
- Lines with `cost_price` 0 (no cost entered) count as 100% margin with no warning.

**M8. Returns change past periods, and refunds never show on the day they happen.**
A return edits the original invoice (`Sales.jsx:182`), so October's revenue drops when the return happens in November, and November's Reports/EOD show no refund. Purchase returns likewise. Day-close and month-close figures change after the fact.
*Expected:* keep returns as dated documents (`sale_returns` table, or `customer_payments` rows already dated) and subtract them in the period they occur.

**M9. Offline sync can double stock/balance changes or line items after a lost response.**
Only `sales`/`purchases` headers are idempotent (`client_ref`). Delta RPCs (`syncService.js:168-179`, `integrity.js:96-105`) and array inserts of `sale_items`, `purchase_items`, `customer_payments`, `supplier_payments` (`syncService.js:190`) are retried if the response is lost, so they can apply twice. Also, a queued stock RPC for a synced product runs even when its sale header is later parked as failed: stock goes down without a sale.
*Expected:* add a `client_ref`/`op_id` to every queued RPC and insert, and record applied op ids server-side (e.g. an `applied_ops` table checked inside `adjust_*`). Better: one `complete_sale(payload)` RPC that inserts header + items + stock + balance in one transaction.

**M10. The customer payment receipt shows the wrong "Remaining Balance".**
`CustomerLedger.jsx:218` prints `outstanding_balance − amount`, but by the time the voucher is printed the state is already reduced (`:357`, `:373`).
*Example:* balance Rs 5,000, receive Rs 2,000 → voucher says **Rs 1,000** remaining (should be Rs 3,000). Reprinting an old payment (`:623, 748`) subtracts it from today's balance. The voucher also always says "Payment received in full."
*Expected:* pass the balance after the payment explicitly; for reprints use that row's running `balance`.

**M11. Low-stock rules differ on every screen.**
POS `|| 5` (`POS.jsx:1273`); Inventory and Dashboard `|| 10` ignoring the category (`Inventory.jsx:316, 330`, `Dashboard.jsx:115`); Products product → category → 10 (`Products.jsx:146-151`); AddProduct pre-fills 10 (`AddProduct.jsx:45`) so the category threshold never applies to new products; Inventory "critical" is a fixed ≤ 5 (`:331`); `||` makes a threshold of 0 impossible. The Dashboard low-stock count, Inventory badge and Products filter show different numbers.
*Expected:* one `getLowStockThreshold(product, categories, shopDefault)` helper.

**M12. A return on a credit bill that was settled later refunds into the balance instead of cash.**
`Sales.jsx:174` uses the unpaid amount saved on the invoice, which ignores later ledger payments.
*Example:* credit sale Rs 1,000, customer pays Rs 1,000 next week via ledger (balance 0), then returns Rs 500 choosing "cash" → creditPart 500, cash 0, balance −500, alert says "Cash to give back: Rs 0".
*Expected:* cap the credit part at `min(unpaidOnSale, max(0, current outstanding_balance))`, or ask the cashier.

### Low

- **L1. Date filters cut the day at 05:00 Pakistan time.** `Sales.jsx:377` and `PurchaseHistory.jsx:380` match `created_at.startsWith(date)` on the UTC string, so a sale at 01:30 PKT on 18 Nov is filed under 17 Nov. Form defaults `new Date().toISOString().slice(0,10)` (`CustomerLedger.jsx:327`, `SupplierLedger.jsx:199`, `Suppliers.jsx:151`) show yesterday before 05:00. Use local-day bounds (`gte` start / `lt` next start).
- **L2. Quotation print/WhatsApp in % mode uses a stale discount.** `POS.jsx:1160, 1172` use `discount`, last computed from an older subtotal, instead of `totalDiscount`.
- **L3. Receipts never show "Change".** POS passes `changeDue` (`POS.jsx:1030`); templates read `r.change` (`billTemplates.js:206, 322, 505`).
- **L4. Partially paid sales look wrong in the ledger.** The debit column shows the full bill (`CustomerLedger.jsx:658`) while the balance rises only by the unpaid part (`:93-95`); no credit line shows what was paid at the counter. Show the paid part as its own credit row.
- **L5. Deleting a cash purchase from the Supplier Ledger leaves its automatic "payment" row** (`Purchases.jsx:323-341`, `SupplierLedger.jsx:236-240`), so the ledger then shows an advance the stored balance doesn't have.
- **L6. Deleting a "return" ledger row** (`CustomerLedger.jsx:427-431`) only changes the balance; the invoice total and stock stay returned.
- **L7. Purchase discount is not validated** (`Purchases.jsx:194`): a negative discount raises the total; a discount above the subtotal silently clamps to 0.
- **L8. Split payments can record more than the bill.** `payment_details` keeps tendered amounts above the bill (`POS.jsx:907`) while `paid_amount` is capped, so any per-method breakdown built from `payment_details` will overcount. Store the applied amount per method.
- **L9. Quotation search by partial number** uses `.filter('id','raw',…)` (`POS.jsx:1116`), which is not a PostgREST operator, so partial-number search likely always fails.
- **L10. Small lists are capped at 1,000 rows:** `CustomerLedgerOverview.jsx:23`, `customer_payments` in `CustomerLedger.jsx:48`, supplier ledger queries in `Suppliers.jsx:103-104`. These only matter for large shops.
- **L11. Float display:** money is summed in JS floats and shown with `toFixed(0)`; line totals like 3 × 33.33 can show 1 rupee off the sum of displayed lines. Round line totals to paisa when saving (`POS.jsx:972`).

---

## 2. Practicality improvements by module

**POS**
- Show the customer's **previous balance and new total balance** on the bill and on screen ("Sabiqa baqaya / Kul baqaya"). This is the most requested feature for Pakistani credit customers.
- **Credit limit** per customer, with a warning or block when a credit sale would exceed it.
- **Partial payment** on any method (cash 4,000 + rest on credit) as a first-class option, not only through split.
- Per-line discount (% or Rs) in addition to the bill discount; show C.Rate and "less %" per line for hardware/sanitary shops.
- Unit-aware quantity entry (ft/m/kg with decimals, box ↔ piece conversion).
- Re-validate stock at checkout (H7), and show "held bill price changed" when resuming.
- Bilingual labels (Urdu/English toggle); alerts are currently mixed Roman Urdu and English.

**Sales**
- Date-range filter (from/to) in local time; daily totals row (net, paid, credit) for the filtered list.
- A "Returns" tab listing dated return documents; reprint a return slip.
- Show paid/unpaid status and balance due on each row.

**Purchases / Purchase History**
- Partial payment on purchases (paid now + credit rest) and online/bank payment modes.
- Save supplier bill number and date (backdating) on the purchase.
- Warn when the new cost is at or above the sale price; offer to update the sale price / C.Rate in the same screen.
- Fix delete (H4) and offline return (M1).

**Inventory / Products / Add & Edit Product**
- Stock count (stocktake) mode: enter counted qty, the app posts the difference with a reason; printable variance sheet.
- Stock movement history per product from sales/purchases/returns/adjustments (a `stock_movements` table), not only audit logs.
- Reorder list grouped by supplier, using one low-stock rule (M11), with a WhatsApp order message (partly exists).
- Edit Product without stock field (H5); bulk price change by C.Rate with rounding (M3).
- Product variants / sizes (pipe sizes, colours) and barcode label printing.

**Customers / Customer Ledger / Overview**
- Opening balance field on the add form, saved as a ledger entry (H3).
- Ledger statement print/WhatsApp PDF for a date range with opening and closing balance.
- Ageing (0–30 / 31–60 / 60+ days) and a "due for reminder" list; bulk WhatsApp reminders.
- Guard Reconcile: show the difference line by line and require admin approval.

**Suppliers / Supplier Ledger**
- Opening balance entry (H3); supplier statement for a date range.
- Payment modes (cash, bank, cheque with number and date) on supplier payments.

**Expenses**
- Date field (backdate), payment mode (cash/bank), recurring expenses (rent, salaries, electricity).
- Category budget versus actual in Reports.

**Reports / Dashboard**
- One shared calculation module so Dashboard, EOD, Reports and the printed report match (M6, M7).
- Custom date range; local-day boundaries; returns and refunds in the period they occur (M8).
- Cash book / day book: opening cash, cash in (sales, recoveries), cash out (expenses, supplier payments, refunds), closing cash, with a counted-cash input and a difference.
- Stock valuation report at cost and sale price, with the cost method stated.
- Show a warning for items sold with no cost price.
- Dashboard 4-second timeout (`Dashboard.jsx:70`) is short for mobile data; show a "cached figures" banner like Reports does.

**Settings / Trash / Users**
- Trash restore for purchases should re-apply stock/balance and items (mirror of the sales restore).
- Role permissions for discount above X%, price edits, deletes and Reconcile (currently partly by role name in code).
- A visible sync-status chip in the header (pending/failed counts) linking to Settings → Data & Backup.

---

## 3. Phased plan

Sizes: **S** ≈ under half a day, **M** ≈ 1–2 days, **L** ≈ 3–5+ days (including testing on a test shop).

### Phase 1: Quick fixes (stop wrong numbers) – about 4–5 days total
| # | Item | Findings | Size |
|---|------|----------|------|
| 1 | Exclude quotations from the customer ledger (online + offline) | H1 | S |
| 2 | Stop double-subtracting returns in both ledgers (return rows informational, or stop reducing invoice) | H2 | S–M |
| 3 | Hide/admin-gate Reconcile until 1–2 and opening balances land | H1–H3 | S |
| 4 | Edit Product: drop `stock_quantity` from the update; empty numeric → 0/null | H5 | S |
| 5 | Re-check stock for every cart line at checkout; brand "add all" skips zero stock | H7 | S |
| 6 | PurchaseHistory delete: reverse stock + credit balance, trash items with header | H4 | M |
| 7 | Purchase returns: `Number()` qty, offline supplier balance, step tracking | M1, M5 | S–M |
| 8 | Payment voucher balance, receipt "Change" field, quotation % discount | M10, L2, L3 | S |
| 9 | Settings sales report: filter `sale_type`, use `paid_amount`, net totals | M6 (part) | S |
| 10 | Local-day date filters and form defaults | L1 | S |

### Phase 2: Medium (make reports agree, fix cost) – about 2 weeks
| # | Item | Findings | Size |
|---|------|----------|------|
| 11 | Shared `salesSummary` helper (net, paid by method from `payment_details`, credit, refunds, recoveries) used by Dashboard, EOD, Reports, printed report | H6, M6, M7, L8 | M |
| 12 | Correct EOD cash book (cash in/out including recoveries, supplier payments, refunds) with counted cash input | H6 | M |
| 13 | Opening balance as ledger entry for customers/suppliers (form + import + one-off migration that creates entries for current differences) | H3 | M |
| 14 | Store purchase discount; share it across lines in returns and cost | M2 | S–M |
| 15 | Cost method setting (last / weighted average) via RPC; bulk % on C.Rate/sale only, with rounding | M3 | M |
| 16 | Inventory adjust as delta with reason; remove full-row offline replay; fix "Record return" | M4 | S–M |
| 17 | One low-stock threshold helper across POS/Inventory/Products/Dashboard | M11 | S |
| 18 | Reports: net trend, year-aware keys, category join, paging for expenses/purchases, no-cost warning | M7 | S–M |
| 19 | Return-on-settled-credit cap | M12 | S |

### Phase 3: Larger (trustworthy by design + shopkeeper features) – 3–5 weeks
| # | Item | Findings | Size |
|---|------|----------|------|
| 20 | Server-side `complete_sale` / `complete_purchase` / `process_return` RPCs (one transaction: header, items, stock, balance, ledger row), idempotent by `client_ref` | M9, H7 | L |
| 21 | Idempotent sync for every queued operation (op ids checked server-side) | M9 | M–L |
| 22 | Dated return documents (`sale_returns`, `purchase_returns`) reported in their own period | M8, H2 | L |
| 23 | `stock_movements` table + per-product history + stocktake mode | M4 | L |
| 24 | Previous/total balance on bills, credit limits, partial payments everywhere, customer statements and ageing with WhatsApp | §2 | M–L |
| 25 | Urdu/English UI toggle (RTL-safe), units with decimals and pack conversion | §2 | L |

Recommended order: Phase 1 items 1–5 first (they are small and stop the worst data damage), then 6–10, then Phase 2 item 11 so every screen reports the same totals.
