# Copilot Instructions - Sanitary POS

## Project Overview
**Sanitary POS** is a React-based Point of Sale system for inventory, sales, and business management. Early-stage development with a clear modular structure but limited implementation.

**Tech Stack:**
- React 19 + React Router 7 + Vite
- Context API for state management (auth)
- Vanilla CSS (no CSS framework yet)
- ESLint for code quality

**Build & Run:**
```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build to dist/
npm run lint         # Run ESLint
npm run preview      # Preview production build
```

---

## Architecture & Data Flow

### Authentication with Supabase
Authentication is managed by Supabase Auth via `src/context/AuthContext.jsx`:
- `useAuth()` hook provides `user`, `login()`, `signup()`, `logout()`, `loading`, `error`
- Automatically persists sessions and checks auth state on app load
- **Setup required:** Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to `.env.local`

**Example usage in a page:**
```jsx
import { useAuth } from '../hooks/useAuth'
const MyPage = () => {
  const { user, logout, loading } = useAuth()
  if (loading) return <div>Loading...</div>
  return <div>Welcome, {user?.email}</div>
}
```

### Supabase Service Layer
`src/services/supabase.js` provides the initialized Supabase client for direct queries.

### Data Hooks
Custom React hooks in `src/hooks/` handle data fetching (e.g., `useProducts.js`):
```jsx
const { products, loading, error, addProduct, updateProduct, deleteProduct } = useProducts()
```
Each hook manages its own state and provides CRUD operations for a data table.

### Router Structure
`src/App.jsx` defines all routes (React Router v7):
- **Public:** `GET /` → Login page only
- **Protected:** `/dashboard`, `/products`, `/pos`, `/categories`, `/inventory`, `/purchases`, `/suppliers`, `/customers`, `/sales`, `/expenses`, `/users`, `/reports`, `/settings`
- **Pattern:** Each route maps to a simple page component (`src/pages/*.jsx`)

**When adding new routes:**
1. Create page in `src/pages/YourPage.jsx`
2. Import in `App.jsx`
3. Add `<Route>` in the `<Routes>` block
4. Consider adding auth guard middleware (not yet implemented)

### Data & Services Layer
- **`src/services/supabase.js`** → Initialized Supabase client for direct table queries
- **`src/hooks/`** → Custom React hooks for data fetching (e.g., `useProducts.js`, `useCustomers.js`)
- **`src/utils/`** → Helper functions, validation, formatting

**Pattern for new data hooks:**
```jsx
// src/hooks/useCustomers.js
import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

export function useCustomers() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchCustomers = async () => {
    const { data, error: err } = await supabase.from('customers').select('*')
    if (err) setError(err.message)
    else setCustomers(data)
  }

  useEffect(() => { fetchCustomers() }, [])
  return { customers, loading, error, refetch: fetchCustomers }
}
```

Use in pages:
```jsx
const Customers = () => {
  const { customers } = useCustomers()
  return <div>{customers.map(c => <div key={c.id}>{c.name}</div>)}</div>
}
```

---

## Code Patterns & Conventions

### Page Components
- **Location:** `src/pages/*.jsx`
- **Pattern:** Simple functional components, minimal logic
- **Naming:** PascalCase, match route names (e.g., `/products` → `Products.jsx`)
- **Template:**
```jsx
import React from 'react'

const PageName = () => {
  return (
    <div className="page-container">
      {/* Page content */}
    </div>
  )
}

export default PageName
```

### Styling
- **Approach:** Vanilla CSS, imported into page/component files
- **Files:** Colocated (e.g., `Dashboard.jsx` + `Dashboard.css`)
- **Global styles:** `src/index.css` for base/layout reset

### Component Organization (Planned)
- Reusable UI components go in `src/components/` (e.g., `Button.jsx`, `Modal.jsx`)
- Business logic → `src/hooks/`
- Utilities (date formatting, validation) → `src/utils/`

---

## File Structure Quick Reference

```
src/
├── App.jsx              # Router & layout root
├── main.jsx             # React entry point
├── index.css            # Global styles
├── App.css              # App-level styles
├── context/
│   ├── AuthContext.jsx  # Auth provider (Supabase)
│   └── AuthContextRoot.js # Context definition
├── services/
│   └── supabase.js      # Initialized Supabase client
├── pages/               # Route page components
├── components/          # Reusable UI components (add as needed)
├── hooks/               
│   ├── useAuth.js       # Auth hook
│   └── useProducts.js   # Products CRUD hook (template)
└── utils/               # Helpers & utilities (add as needed)
```

---

## Development Workflow

### Adding Features
1. **New page?** Create `src/pages/FeatureName.jsx`, add route in `App.jsx`
2. **New UI component?** Create `src/components/ComponentName.jsx` with CSS
3. **API integration?** Add service in `src/services/`, hook in `src/hooks/`, use in page
4. **Shared logic?** Add to `src/utils/` or a custom hook in `src/hooks/`

### Code Quality
- **Linting:** Run `npm run lint` before commit
- **ESLint Config:** `eslint.config.js` (uses @eslint/js + react-hooks rules)
- **React Hooks:** Ensure dependencies arrays are correct; plugin enforces this

### No TypeScript (Yet)
- Code is JavaScript with optional `@types/react` packages
- Consider adding TypeScript if the project grows beyond 20+ pages

---

## Known Limitations & TODOs

- ✅ **Auth with Supabase:** Complete with email/password login + signup
- ✅ **Supabase client:** Initialized and ready for data operations
- ⚠️ **Protected routes:** Not yet implemented; add `ProtectedRoute` wrapper for secure pages
- ❌ **RLS policies:** Set up in Supabase dashboard for production security
- ❌ **Error boundaries:** No error boundaries or API error handling yet
- ❌ **Real-time subscriptions:** Can be added via `supabase.on()` for live updates
- ❌ **File storage:** Product images can use Supabase Storage bucket

## Setup & Deployment

### Environment Variables
Create `.env.local` in the root directory:
```env
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

See [SUPABASE_QUICK_START.md](../SUPABASE_QUICK_START.md) for complete setup guide.

### Build
```bash
npm run build  # Creates /dist for deployment
```

When deploying (Vercel, Netlify, etc.), add the same env variables to your hosting platform.

---

## Tips for AI Agents

1. **Respect the structure:** Pages are the "entry point" for features; keep them focused
2. **Use auth hook:** Always import `useAuth` when accessing user data
3. **Plan before implementing:** Empty folders exist for a reason; organize logic properly
4. **Avoid duplication:** If writing similar code in 2+ pages, extract to component/hook
5. **Test locally:** Pages are mostly placeholder; full features need backend integration
6. **Document patterns:** If introducing a new pattern (e.g., form library), update this file
