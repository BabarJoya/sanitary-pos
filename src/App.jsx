import {BrowserRouter, Routes, Route} from 'react-router-dom'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import AddProduct from './pages/AddProduct'
import POS from './pages/POS'
import Categories from './pages/Categories'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Suppliers from './pages/Suppliers'
import Customers from './pages/Customers'
import Sales from './pages/Sales'
import Expenses from './pages/Expenses'
import Users from './pages/Users'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'


function App() {
  return (
    <AuthProvider>
  <BrowserRouter>
  <Routes>
   <Route path="/" element={<Login />} />
   <Route path="/dashboard" element={
    <ProtectedRoute><Dashboard/></ProtectedRoute>} />
   <Route path="/products" element={<ProtectedRoute><Products/></ProtectedRoute>} />
   <Route path="/add-product" element={<ProtectedRoute><AddProduct/></ProtectedRoute>} />
   <Route path="/pos" element={<ProtectedRoute><POS/></ProtectedRoute>}/>
    <Route path="/categories" element={<ProtectedRoute><Categories/></ProtectedRoute>}/>
    <Route path="/inventory" element={<ProtectedRoute><Inventory/></ProtectedRoute>}/>
    <Route path="/purchases" element={<ProtectedRoute><Purchases/></ProtectedRoute>}/>
    <Route path="/suppliers" element={<ProtectedRoute><Suppliers/></ProtectedRoute>}/>
    <Route path="/customers" element={<ProtectedRoute><Customers/></ProtectedRoute>}/>
    <Route path="/sales" element={<ProtectedRoute><Sales/></ProtectedRoute>}/>
    <Route path="/expenses" element={<ProtectedRoute><Expenses/></ProtectedRoute>}/>
    <Route path="/users" element={
      <ProtectedRoute><Users/></ProtectedRoute>}/>
    <Route path="/reports" element={<ProtectedRoute><Reports/></ProtectedRoute>}/>
    <Route path="/settings" element={<ProtectedRoute><Settings/></ProtectedRoute>}/>
  </Routes>
  </BrowserRouter>
  </AuthProvider>
  );
}


export default App;