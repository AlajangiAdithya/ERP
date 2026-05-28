import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { enterAuditMode, installAuditInterceptors } from './pages/superadmin/auditOverlay';
import './index.css';

// If this tab was opened from the SUPERADMIN audit launcher (hash flag),
// promote it to audit-mode for its lifetime and install the interceptors
// BEFORE React mounts so the very first request is already short-circuited.
if (window.location.hash.includes('audit=1')) {
  enterAuditMode();
  window.history.replaceState(null, '', window.location.pathname);
}
installAuditInterceptors();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
