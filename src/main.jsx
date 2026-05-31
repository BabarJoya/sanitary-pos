import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import './services/syncService'

// Intercept database RLS policy errors globally to show a friendly instruction
if (typeof window !== 'undefined') {
  const originalAlert = window.alert;
  window.alert = (message) => {
    const msgStr = String(message || '');
    if (msgStr.toLowerCase().includes('row-level security policy') || msgStr.toLowerCase().includes('row violates row-level security')) {
      originalAlert(
        "⚠️ Login Session Required / Expired\n\n" +
        "Your login session is expired or unregistered in the database.\n\n" +
        "To resolve this, please:\n" +
        "1. Log out of the application.\n" +
        "2. Log back in to establish a fresh security session."
      );
    } else {
      originalAlert(message);
    }
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
