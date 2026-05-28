# Sanitary POS Agent Context

This file is the compact source of truth for AI agents working in this repo. Prefer reading this first, then inspect only the files needed for the task.

## Project Shape

- Root app is the shop-facing POS: React 18, Vite 5, Tailwind CSS 4, React Router 6, Supabase, Dexie offline storage, and PWA support.
- `superadmin/` is a separate Vite app for platform administration. It uses React 19, React Router 7, its own `package.json`, and its own Supabase service/auth context.
- Main app routing lives in `src/App.jsx`. Most routes are wrapped as `ProtectedRoute -> Layout -> Page`.
- The shared shell is `src/components/Layout.jsx`: fixed/sidebar layout, top header, notifications, announcements, and scrollable main content.
- Feature logic is mostly page-local in `src/pages/*.jsx`. High-traffic pages include `POS.jsx`, `Products.jsx`, `Inventory.jsx`, `Sales.jsx`, `Dashboard.jsx`, `Settings.jsx`, and ledger pages.

## Commands

Root app:

```powershell
npm run dev
npm run build
npm run lint
npm run preview
```

Superadmin app:

```powershell
cd superadmin
npm run dev
npm run build
npm run lint
npm run preview
```

Current baseline:

- `npm run build` succeeds for the root app.
- `npm run lint` exits successfully, with warnings for existing cleanup debt such as hook dependencies, unused variables, and empty catch blocks.
- The root app uses route-level lazy loading, and heavy PDF libraries are dynamically imported at action time.

## Data, Auth, And Offline Flow

- Supabase client and RLS/session helper live in `src/services/supabase.js`.
- Dexie schema and helpers live in `src/services/db.js`.
- Offline sync queue processing lives in `src/services/syncService.js`; it runs on a 30 second interval and on the browser `online` event.
- Auth state lives in `src/context/AuthContext.jsx` and is persisted in `localStorage`.
- Login uses `secure_login` RPC in `src/pages/Login.jsx`, stores the returned `session_token`, and caches plan features/limits in shop-scoped localStorage keys.
- Many pages use shop-scoped localStorage keys such as `shop_name_${shopId}`, `shop_logo_${shopId}`, `shop_settings_${shopId}`, `plan_features_${shopId}`, `plan_limits_${shopId}`, and `print_template_${shopId}`. Preserve this scoping when editing.
- Be careful around password/session handling: password hashes and session tokens are currently kept in browser storage for offline/admin workflows. Treat changes here as security-sensitive and test online/offline login flows.

## UI Conventions

- Styling is primarily Tailwind utilities in JSX. `src/index.css` only imports Tailwind.
- `src/App.css` is stale Vite template CSS and is not imported by `src/main.jsx`. Do not re-import it without replacing it, because it constrains `#root` and would break the full-screen POS shell.
- Layout should stay full-screen, with `Layout` owning the app shell and page content scrolling inside `<main>`.
- Existing modals commonly use `fixed inset-0 ... overflow-y-auto py-4 px-2 sm:px-4`. Prefer `w-full`, responsive `max-w-*`, `max-h-[90dvh]`, internal scroll, and mobile-stacked footer actions.
- For mobile UI, avoid hardcoded `100vh` subtraction inside pages. Prefer flex layouts with `min-h-0`, `h-full`, and `dvh` where viewport sizing is unavoidable.
- Products, Inventory, Sales, and ledger pages rely heavily on wide tables. For mobile improvements, prefer card/list variants under `md` instead of only horizontal scrolling.
- POS mobile flow uses a product grid plus floating cart button. Preserve quick cashier access to search, product quantity, cart summary, and payment actions.

## Editing Guidance

- Keep changes scoped; there is a lot of business logic embedded in pages.
- Do not rewrite offline sync or localStorage conventions casually.
- Run `npm run build` for root app changes. Run superadmin build only when touching `superadmin/`.
- Document any new shared pattern in this file so future agents do not have to rediscover it.
