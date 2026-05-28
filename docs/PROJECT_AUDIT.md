# Sanitary POS Project Audit

Audit date: 2026-05-28

This audit is based on static inspection plus root app verification commands. The highest-priority findings have follow-up fixes in the working tree.

## Verification Baseline

- `npm run build` succeeds for the root app without chunk warnings after route-level lazy loading and action-time PDF imports.
- `npm run lint` exits successfully. It still reports warnings for existing cleanup debt, but no longer fails before source linting.

## Priority Findings

### P1 - ESLint Is Broken Before Source Linting

Status: fixed in the working tree. Lint now runs and exits successfully with warnings.

Evidence:

- `eslint.config.js:14` uses `reactRefresh.configs.vite`.
- `npm run lint` exits with a config-loading `TypeError` before checking project files.

Impact:

- Source linting is unavailable, so hook dependency issues, unused variables, and refresh-safety issues can slip into the project.

Recommended fix:

- Update the flat config to match the installed `eslint-plugin-react-refresh` export shape. Use the plugin's supported flat config if available, or register the plugin explicitly and configure `react-refresh/only-export-components`.
- Re-run `npm run lint` after the config loads and then triage actual source findings separately.

### P1 - POS Mobile Layout Uses Fragile Viewport Math

Status: fixed in the working tree. POS now inherits available layout height with `h-full min-h-0`, and its mobile cart uses a bounded overlay.

Evidence:

- `src/pages/POS.jsx:832` sets inline height to `calc(100vh - 112px)` inside a page already rendered inside the full-screen `Layout` shell.
- `src/components/Layout.jsx:163` and `src/components/Layout.jsx:269` use `h-screen` containers.

Impact:

- On phones, browser chrome, the header, app padding, impersonation banner, and announcement banner can make POS content clip or double-scroll. This threatens the core cashier workflow.

Recommended fix:

- Replace hardcoded viewport subtraction with a flex layout that inherits available height from `Layout`.
- Use `min-h-0`, `h-full`, and internal scroll containers for product grid/cart regions.
- If viewport units are still needed, prefer `dvh`-aware sizing and account for banners in the layout shell, not page-local math.

### P1 - Sales Detail Modal Overflows Narrow Phones

Status: fixed in the working tree. The modal now uses `w-full max-w-2xl max-h-[90dvh] overflow-y-auto` and stacked mobile actions.

Evidence:

- `src/pages/Sales.jsx:514` uses a fixed modal width: `w-[600px]`.

Impact:

- The sale detail modal can overflow small screens despite the overlay padding, hiding content/actions during invoice review, return, print, or quotation conversion workflows.

Recommended fix:

- Replace with `w-full max-w-2xl max-h-[90dvh] overflow-y-auto`.
- Stack footer/action buttons on mobile and keep the close button visible.

### P1 - Password Hashes And Session Tokens Are Stored In Browser Storage

Evidence:

- `src/pages/Login.jsx` stores `session_token` and `user_pw_hash` in `localStorage`.
- `src/components/PasswordModal.jsx` verifies against cached `user_pw_hash`.
- `src/utils/authUtils.js` uses unsalted frontend SHA-256.
- `src/services/supabase.js:18` sends `x-session-token` from `localStorage`.

Impact:

- Any script execution in the origin can read reusable session material and password hashes.
- Unsalted SHA-256 is weak for password storage compared with server-side password hashing.

Recommended fix:

- Treat this as an auth redesign, not a quick cleanup.
- Move password verification to server/RPC with a slow salted hash.
- Prefer short-lived server-issued session tokens and avoid long-lived secrets in `localStorage` where possible.
- Preserve offline-login requirements explicitly if they are product-critical, and document the accepted risk or introduce a separate offline PIN model.

### P2 - High-Traffic Pages Depend On Wide Tables For Mobile

Status: fixed in the working tree. Products, Inventory, Sales, Purchase History, and Ledger pages now include mobile card/list views while retaining desktop tables.

Evidence:

- `src/pages/Products.jsx:673` wraps the products table in horizontal scroll.
- `src/pages/Inventory.jsx:754` wraps the inventory table in horizontal scroll.
- `src/pages/Sales.jsx:457` wraps the sales table in horizontal scroll.

Impact:

- Horizontal table scrolling technically works but makes common mobile actions hard to reach. Users may lose row identity while scrolling to actions, totals, or status columns.

Recommended fix:

- Add mobile card/list variants under `md` for Products, Inventory, and Sales.
- Keep desktop tables for larger screens.
- If cards are too large for a first pass, add sticky first/action columns and reduce mobile-visible columns.

### P2 - Bundle Is Too Large For A POS/PWA Entry

Status: fixed in the working tree. Route-level lazy loading reduces the entry chunk, and PDF libraries load on demand.

Evidence:

- Root build reports a main JS chunk around 2.5 MB minified.
- Heavy dependencies include PDF generation, canvas rendering, charts, and spreadsheet import/export.

Impact:

- Slower startup, worse PWA install/open performance, and more fragile low-end mobile usage.

Recommended fix:

- Code-split route pages with `React.lazy`.
- Dynamically import heavy libraries (`xlsx`, `jspdf`, `html2canvas`, chart-heavy views) at the action/page boundary.
- Consider manual chunks for vendor groups after route-level splitting.

### P2 - `syncService` Cannot Be Split Due To Mixed Imports

Status: fixed in the working tree. Settings imports `syncOfflineData` directly instead of dynamically importing a side-effect module already loaded at startup.

Evidence:

- `src/main.jsx:5` statically imports `./services/syncService`.
- Build warns that `src/pages/Settings.jsx` also dynamically imports `src/services/syncService.js`.
- `src/services/syncService.js:161` starts a global interval when the module loads.

Impact:

- Dynamic import does not reduce the entry chunk.
- Module side effects make it easy to accidentally start sync behavior just by importing it.

Recommended fix:

- Keep sync startup centralized in `main.jsx`, or refactor `syncService` to export explicit `startSyncService()` and `syncOfflineData()` functions.
- Avoid dynamic-importing the whole side-effect module from pages if it already starts globally.

### P2 - Bill PDF Rendering Injects HTML

Status: partially fixed in the working tree. `pdfShare.js` sanitizes the generated bill HTML before mounting it for canvas/PDF rendering.

Evidence:

- `src/utils/pdfShare.js:18` assigns `container.innerHTML = htmlString`.

Impact:

- If bill HTML ever includes unsanitized user-controlled values, this becomes an XSS risk inside the app origin.

Recommended fix:

- Define `buildBillHTML` output as trusted-only and sanitize/escape all interpolated fields there.
- Consider DOMPurify or building the bill DOM with React/DOM APIs before rendering to canvas.
- Add tests or fixtures for customer/product/shop fields containing HTML-special characters.

### P3 - Stale `App.css` Can Break The Full-Screen App If Reintroduced

Status: fixed in the working tree. The unused stale `src/App.css` file was removed.

Evidence:

- `src/App.css:2` contains Vite template `#root { max-width: 1280px; padding: 2rem; text-align: center; }`.
- `src/main.jsx` currently imports `src/index.css`, not `src/App.css`.

Impact:

- A future agent could re-import `App.css` and accidentally constrain the full-screen POS layout.

Recommended fix:

- Delete `src/App.css` if unused, or replace it with intentional app-wide styles.
- Keep global styling in `src/index.css` unless the project adopts a documented alternative.

## Additional Improvement Notes

- `README.md` is still mostly the default Vite README. Replace it with setup, env vars, deployment, and operational notes.
- The root and `superadmin/` apps use different major React/Router/Vite versions. This may be intentional, but it should be documented before shared code is introduced.
- Many features are page-heavy. Extract shared responsive modal/table/action-bar patterns only when touching those areas for fixes, to avoid broad churn.

## Suggested Next Fix Order

1. Fix ESLint config and run lint to expose real source issues.
2. Fix POS mobile height and Sales modal responsiveness.
3. Add mobile card/list views to Products, Inventory, Sales, Purchase History, and Ledger pages.
4. Split heavy route/action dependencies to reduce the main bundle.
5. Plan a security pass for auth/session/offline-login storage.
