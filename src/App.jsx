import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import POS from './pages/POS'
import Products from './pages/Products'
import AddProduct from './pages/AddProduct'
import EditProduct from './pages/EditProduct'
import Categories from './pages/Categories'
import Brands from './pages/Brands'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Suppliers from './pages/Suppliers'
import SupplierLedger from './pages/SupplierLedger'
import Customers from './pages/Customers'
import CustomerLedger from './pages/CustomerLedger'
import Sales from './pages/Sales'
import Expenses from './pages/Expenses'
import Users from './pages/Users'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import PurchaseHistory from './pages/PurchaseHistory'
import TrashBin from './pages/TrashBin'
import Support from './pages/Support'
import WhatsAppMessaging from './pages/WhatsAppMessaging'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Navigate to="/" replace />} />

          {/* Both admin & cashier */}
          <Route path="/dashboard" element={<ProtectedRoute><Layout><Dashboard /></Layout></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute requiredModule="pos" allowedRoles={['admin', 'manager', 'cashier']}><Layout><POS /></Layout></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute requiredModule="customers" allowedRoles={['admin', 'manager', 'cashier']}><Layout><Customers /></Layout></ProtectedRoute>} />
          <Route path="/customers/:id" element={<ProtectedRoute requiredModule="customers" allowedRoles={['admin', 'manager', 'cashier']}><Layout><CustomerLedger /></Layout></ProtectedRoute>} />
          <Route path="/sales" element={<ProtectedRoute requiredModule="sales" allowedRoles={['admin', 'manager', 'accountant']}><Layout><Sales /></Layout></ProtectedRoute>} />

          {/* Admin only */}
          <Route path="/products" element={<ProtectedRoute requiredModule="products" allowedRoles={['admin']}><Layout><Products /></Layout></ProtectedRoute>} />
          <Route path="/add-product" element={<ProtectedRoute requiredModule="products" allowedRoles={['admin']}><Layout><AddProduct /></Layout></ProtectedRoute>} />
          <Route path="/edit-product/:id" element={<ProtectedRoute requiredModule="products" allowedRoles={['admin']}><Layout><EditProduct /></Layout></ProtectedRoute>} />
          <Route path="/categories" element={<ProtectedRoute requiredModule="categories" allowedRoles={['admin']}><Layout><Categories /></Layout></ProtectedRoute>} />
          <Route path="/brands" element={<ProtectedRoute requiredModule="brands" allowedRoles={['admin']}><Layout><Brands /></Layout></ProtectedRoute>} />
          <Route path="/suppliers" element={<ProtectedRoute requiredModule="suppliers" allowedRoles={['admin']}><Layout><Suppliers /></Layout></ProtectedRoute>} />
          <Route path="/suppliers/:id" element={<ProtectedRoute requiredModule="suppliers" allowedRoles={['admin']}><Layout><SupplierLedger /></Layout></ProtectedRoute>} />
          <Route path="/purchases" element={<ProtectedRoute requiredModule="purchases" allowedRoles={['admin', 'manager']}><Layout><Purchases /></Layout></ProtectedRoute>} />
          <Route path="/purchase-history" element={<ProtectedRoute requiredModule="purchase-history" allowedRoles={['admin', 'manager', 'accountant']}><Layout><PurchaseHistory /></Layout></ProtectedRoute>} />
          <Route path="/expenses" element={<ProtectedRoute requiredModule="expenses" allowedRoles={['admin']}><Layout><Expenses /></Layout></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute requiredModule="inventory" allowedRoles={['admin']}><Layout><Inventory /></Layout></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute requiredModule="reports" allowedRoles={['admin']}><Layout><Reports /></Layout></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute requiredModule="users" allowedRoles={['admin']}><Layout><Users /></Layout></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredModule="settings" allowedRoles={['admin']}><Layout><Settings /></Layout></ProtectedRoute>} />
          <Route path="/trash" element={<ProtectedRoute requiredModule="trash" allowedRoles={['admin']}><Layout><TrashBin /></Layout></ProtectedRoute>} />
          <Route path="/whatsapp" element={<ProtectedRoute requiredModule="customers" allowedRoles={['admin', 'manager', 'cashier']}><Layout><WhatsAppMessaging /></Layout></ProtectedRoute>} />
          <Route path="/support" element={<ProtectedRoute requiredModule="support" allowedRoles={['admin', 'manager', 'cashier', 'accountant']}><Layout><Support /></Layout></ProtectedRoute>} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App