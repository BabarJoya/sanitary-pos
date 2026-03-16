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

### Authentication Context
All pages require authentication via `src/context/AuthContext.jsx`:
- `useAuth()` hook provides `user`, `login()`, `logout()`
- **Currently:** Stores user in memory only (no persistence)
- **TODO:** Add localStorage persistence, protected routes middleware, actual backend auth

**Example usage in a page:**
```jsx
import { useAuth } from '../context/AuthContext'
const MyPage = () => {
  const { user, logout } = useAuth()
  // Implement auth checks here
}
```

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

### Data & Services Layer (Planned)
Empty directories reserved for backend integration:
- **`src/services/`** → API calls (fetch/axios to backend)
- **`src/hooks/`** → Custom React hooks for data fetching, form state
- **`src/utils/`** → Helper functions, validation, formatting

**Recommended pattern (not yet used):**
```jsx
// src/hooks/useFetchProducts.js
export function useFetchProducts() {
  const [products, setProducts] = useState([])
  useEffect(() => {
    fetch('/api/products')
      .then(r => r.json())
      .then(setProducts)
  }, [])
  return products
}

// In a page:
const Products = () => {
  const products = useFetchProducts()
  return <div>{products.map(p => <div key={p.id}>{p.name}</div>)}</div>
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
│   └── AuthContext.jsx  # Auth provider & hook
├── pages/               # Route page components (implement here first)
├── components/          # Reusable UI components (empty, add as needed)
├── hooks/               # Custom hooks (empty, add as needed)
├── services/            # API/backend calls (empty, implement)
└── utils/               # Helpers & utilities (empty, add as needed)
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

- ❌ **Auth persistence:** User data lost on refresh; add localStorage + protected routes
- ❌ **Backend API:** No services layer yet; plan API endpoints before implementing pages
- ❌ **Form validation:** Implement utility functions in `src/utils/` for field validation
- ❌ **State management:** Context API only; consider Redux/Zustand for complex state
- ❌ **Error handling:** No error boundaries or API error handling yet
- ❌ **Styling system:** No CSS framework; consider Tailwind or CSS-in-JS for consistency

---

## Tips for AI Agents

1. **Respect the structure:** Pages are the "entry point" for features; keep them focused
2. **Use auth hook:** Always import `useAuth` when accessing user data
3. **Plan before implementing:** Empty folders exist for a reason; organize logic properly
4. **Avoid duplication:** If writing similar code in 2+ pages, extract to component/hook
5. **Test locally:** Pages are mostly placeholder; full features need backend integration
6. **Document patterns:** If introducing a new pattern (e.g., form library), update this file
