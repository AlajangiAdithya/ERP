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
import Suppliers from './pages/Suppliers';
import PurchaseOrders from './pages/PurchaseOrders';
import PaymentRequests from './pages/PaymentRequests';
import QCInspections from './pages/QCInspections';
import GatePass from './pages/GatePass';
import InterOfficeNote from './pages/InterOfficeNote';
import InventoryTransfers from './pages/InventoryTransfers';
import Tenders from './pages/Tenders';
import SafetyMonitor from './pages/SafetyMonitor';
import RealtimeCorrections from './pages/superadmin/RealtimeCorrections';
import Backups from './pages/superadmin/Backups';
import AuditLauncher from './pages/superadmin/AuditLauncher';

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

              {/* Purchase Requests — Admin, Manager, Lab, Purchase Officer, Accounting/Finance, QC, Planning, Safety */}
              <Route path="/purchase-requests" element={
                <PrivateRoute allowedRoles={['ADMIN', 'MANAGER', 'ACCOUNTING', 'FINANCE', 'QC', 'LAB', 'PURCHASE_OFFICER', 'PLANNING', 'SAFETY']}><PurchaseRequests /></PrivateRoute>
              } />

              {/* Quotation Management — PO submits, ADMIN approves (no accounting tier) */}
              <Route path="/quotations" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ADMIN', 'SUPPLY_CHAIN', 'SAFETY']}><QuotationManagement /></PrivateRoute>
              } />

              {/* Suppliers — PO manages compliance PDFs; Admin + Safety can view */}
              <Route path="/suppliers" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ADMIN', 'SAFETY']}><Suppliers /></PrivateRoute>
              } />

              {/* Purchase Orders */}
              <Route path="/purchase-orders" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ADMIN', 'ACCOUNTING', 'FINANCE', 'STORE_MANAGER', 'QC', 'MANAGER', 'LAB', 'PLANNING', 'SUPPLY_CHAIN', 'SAFETY']}><PurchaseOrders /></PrivateRoute>
              } />

              {/* Payment Requests */}
              <Route path="/payment-requests" element={
                <PrivateRoute allowedRoles={['PURCHASE_OFFICER', 'ACCOUNTING', 'FINANCE', 'ADMIN', 'SAFETY']}><PaymentRequests /></PrivateRoute>
              } />

              {/* QC Inspections — PR originators (MANAGER, LAB, PLANNING) see inspections tied to their PRs */}
              <Route path="/qc-inspections" element={
                <PrivateRoute allowedRoles={['QC', 'ADMIN', 'SAFETY', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'MANAGER', 'LAB', 'PLANNING']}><QCInspections /></PrivateRoute>
              } />

              {/* Store Manager + Admin + Logistics */}
              <Route path="/inward-entry" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'LOGISTICS']}><InwardEntry /></PrivateRoute>
              } />
              <Route path="/stock-movements" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'LOGISTICS', 'PLANNING', 'SAFETY']}><StockMovements /></PrivateRoute>
              } />
              <Route path="/gate-pass" element={
                <PrivateRoute allowedRoles={['ADMIN', 'MANAGER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'LOGISTICS', 'SAFETY']}><GatePass /></PrivateRoute>
              } />
              {/* Inventory Transfers — MANAGER + LOGISTICS + SAFETY monitor */}
              <Route path="/inventory-transfers" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LOGISTICS', 'SAFETY']}><InventoryTransfers /></PrivateRoute>
              } />

              {/* ION — MANAGER (sender) + LAB/METROLOGY/NDT/RND/DESIGNS (recipients) + SAFETY (monitor) */}
              <Route path="/ion" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'RND', 'DESIGNS', 'SAFETY']}><InterOfficeNote /></PrivateRoute>
              } />

              {/* Tenders — SUPPLY_CHAIN assigns; MANAGER works; SAFETY monitors */}
              <Route path="/tenders" element={
                <PrivateRoute allowedRoles={['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY']}><Tenders /></PrivateRoute>
              } />

              {/* Safety Monitor */}
              <Route path="/safety" element={
                <PrivateRoute allowedRoles={['SAFETY', 'ADMIN']}><SafetyMonitor /></PrivateRoute>
              } />

              {/* SUPERADMIN-only — owner hatch */}
              <Route path="/superadmin/corrections" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><RealtimeCorrections /></PrivateRoute>
              } />
              <Route path="/superadmin/backups" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><Backups /></PrivateRoute>
              } />
              <Route path="/superadmin/audit" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><AuditLauncher /></PrivateRoute>
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
