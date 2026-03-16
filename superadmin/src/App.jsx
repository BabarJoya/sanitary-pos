import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ShopsList from './pages/ShopsList'
import Subscriptions from './pages/Subscriptions'
import AuditLogs from './pages/AuditLogs'
import EmailBroadcast from './pages/EmailBroadcast'
import PlanManagement from './pages/PlanManagement'
import SupportTickets from './pages/SupportTickets'
import Analytics from './pages/Analytics'

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-100">Loading Access...</div>
  if (!user || user.role !== 'superadmin') return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="shops" element={<ShopsList />} />
          <Route path="subscriptions" element={<Subscriptions />} />
          <Route path="plans" element={<PlanManagement />} />
          <Route path="tickets" element={<SupportTickets />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="audit-logs" element={<AuditLogs />} />
          <Route path="broadcast" element={<EmailBroadcast />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
