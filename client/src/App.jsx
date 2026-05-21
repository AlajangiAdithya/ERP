import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import MainLayout from './components/layout/MainLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import InwardEntry from './pages/InwardEntry';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import StockMovements from './pages/StockMovements';
import Settings from './pages/Settings';
import Management from './pages/Management';
import MyRequests from './pages/MyRequests';
import RequestClearance from './pages/RequestClearance';
import AllRequests from './pages/AllRequests';
import AuditLogs from './pages/AuditLogs';
import UnitUsageLogs from './pages/UnitUsageLogs';
import Notifications from './pages/Notifications';
import PurchaseRequests from './pages/PurchaseRequests';
import QuotationManagement from './pages/QuotationManagement';
import PurchaseOrders from './pages/PurchaseOrders';
import PaymentRequests from './pages/PaymentRequests';
import QCInspections from './pages/QCInspections';
import GatePass from './pages/GatePass';
import InterOfficeNote from './pages/InterOfficeNote';
import InventoryTransfers from './pages/InventoryTransfers';
import Tenders from './pages/Tenders';
import SafetyMonitor from './pages/SafetyMonitor';

function PrivateRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-gray">
        <div className="w-10 h-10 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" replace />;

  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-gray">
        <div className="w-10 h-10 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />

      <Route path="/*" element={
        <PrivateRoute>
          <MainLayout>
            <Routes>
              <Route path="/" element={<Dashboard />} />

              {/* Admin only */}
              <Route path="/management" element={
                <PrivateRoute allowedRoles={['ADMIN']}><Management /></PrivateRoute>
              } />
              <Route path="/all-requests" element={
                <PrivateRoute allowedRoles={['ADMIN', 'SAFETY']}><AllRequests /></PrivateRoute>
              } />
              <Route path="/audit-logs" element={
                <PrivateRoute allowedRoles={['ADMIN', 'SAFETY']}><AuditLogs /></PrivateRoute>
              } />
              <Route path="/unit-usage" element={
                <PrivateRoute allowedRoles={['ADMIN', 'SAFETY']}><UnitUsageLogs /></PrivateRoute>
              } />

              {/* Manager / Lab */}
              <Route path="/my-requests" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LAB']}><MyRequests /></PrivateRoute>
              } />

              {/* Store Manager only */}
              <Route path="/request-clearance" element={
                <PrivateRoute allowedRoles={['STORE_MANAGER']}><RequestClearance /></PrivateRoute>
              } />

              {/* Purchase Requests — Admin, Manager, Lab, Purchase Officer, Accounting, QC, Safety */}
              <Route path="/purchase-requests" element={
                <PrivateRoute allowedRoles={['ADMIN', 'MANAGER', 'ACCOUNTING', 'QC', 'LAB', 'PURCHASE_OFFICER', 'SAFETY']}><PurchaseRequests /></PrivateRoute>
              } />

              {/* Quotation Management — PO submits, ADMIN approves (no accounting tier) */}
              <Route path="/quotations" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ADMIN', 'SAFETY']}><QuotationManagement /></PrivateRoute>
              } />

              {/* Purchase Orders */}
              <Route path="/purchase-orders" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ADMIN', 'ACCOUNTING', 'STORE_MANAGER', 'QC', 'MANAGER', 'LAB', 'SAFETY']}><PurchaseOrders /></PrivateRoute>
              } />

              {/* Payment Requests */}
              <Route path="/payment-requests" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ACCOUNTING', 'ADMIN', 'SAFETY']}><PaymentRequests /></PrivateRoute>
              } />

              {/* QC Inspections */}
              <Route path="/qc-inspections" element={
                <PrivateRoute allowedRoles={['QC', 'ADMIN', 'SAFETY']}><QCInspections /></PrivateRoute>
              } />

              {/* Store Manager + Admin */}
              <Route path="/inward-entry" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER']}><InwardEntry /></PrivateRoute>
              } />
              <Route path="/stock-movements" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'SAFETY']}><StockMovements /></PrivateRoute>
              } />
              <Route path="/gate-pass" element={
                <PrivateRoute allowedRoles={['ADMIN', 'MANAGER', 'STORE_MANAGER', 'ACCOUNTING', 'SAFETY']}><GatePass /></PrivateRoute>
              } />
              {/* Inventory Transfers — MANAGER + SAFETY monitor */}
              <Route path="/inventory-transfers" element={
                <PrivateRoute allowedRoles={['MANAGER', 'SAFETY']}><InventoryTransfers /></PrivateRoute>
              } />

              {/* ION — MANAGER (sender) + LAB/METEOROLOGY/NDT/RND (recipients) + SAFETY (monitor) */}
              <Route path="/ion" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LAB', 'METEOROLOGY', 'NDT', 'RND', 'SAFETY']}><InterOfficeNote /></PrivateRoute>
              } />

              {/* Tenders — TENDER_MANAGER assigns; MANAGER works; SAFETY monitors */}
              <Route path="/tenders" element={
                <PrivateRoute allowedRoles={['TENDER_MANAGER', 'ADMIN', 'MANAGER', 'SAFETY']}><Tenders /></PrivateRoute>
              } />

              {/* Safety Monitor */}
              <Route path="/safety" element={
                <PrivateRoute allowedRoles={['SAFETY', 'ADMIN']}><SafetyMonitor /></PrivateRoute>
              } />

              {/* All roles */}
              <Route path="/products" element={<Products />} />
              <Route path="/products/:id" element={<ProductDetail />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings" element={<Settings />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </MainLayout>
        </PrivateRoute>
      } />
    </Routes>
  );
}
