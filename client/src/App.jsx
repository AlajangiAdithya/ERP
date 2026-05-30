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
import Procurement from './pages/Procurement';
import Monitoring from './pages/Monitoring';
import GatePass from './pages/GatePass';
import InterOfficeNote from './pages/InterOfficeNote';
import InventoryTransfers from './pages/InventoryTransfers';
import WorkOrders from './pages/WorkOrders';
import SafetyMonitor from './pages/SafetyMonitor';
import RealtimeCorrections from './pages/superadmin/RealtimeCorrections';
import Backups from './pages/superadmin/Backups';
import Health from './pages/superadmin/Health';
import Metrology from './pages/Metrology';
import PressureGauges from './pages/metrology/PressureGauges';
import VacuumGauges from './pages/metrology/VacuumGauges';
import WeighingBalances from './pages/metrology/WeighingBalances';
import TestingEquipment from './pages/metrology/TestingEquipment';
import MetrologyInstruments from './pages/metrology/MetrologyInstruments';
import MMR from './pages/metrology/MMR';

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING'];

// Metrology calibration registers — METROLOGY + ADMIN can edit; the rest
// of the procurement / quality chain has read-only visibility.
const METROLOGY_VIEW_ROLES = [
  'METROLOGY', 'ADMIN', 'MANAGER', 'STORE_MANAGER',
  'PURCHASE_OFFICER', 'QC', 'ACCOUNTING', 'SAFETY',
  'LAB', 'NDT', 'RND', 'DESIGNS',
];

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

              {/* Procurement hub — landing page that links to the modules below. */}
              <Route path="/procurement" element={
                <PrivateRoute allowedRoles={[...CHAIN_ROLES, 'LAB', 'LOGISTICS', 'SAFETY']}><Procurement /></PrivateRoute>
              } />

              {/* Monitoring hub — Stock Movements, Audit Logs, Unit Usage Logs. */}
              <Route path="/monitoring" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'LOGISTICS', 'PLANNING', 'SAFETY']}><Monitoring /></PrivateRoute>
              } />

              {/* PR → PO → QC → Inward chain — restricted to: Unit Managers, Quality,
                  Designs, R&D, Purchase, Stores, Accounts (+ ADMIN). */}
              <Route path="/purchase-requests" element={
                <PrivateRoute allowedRoles={CHAIN_ROLES}><PurchaseRequests /></PrivateRoute>
              } />

              <Route path="/quotations" element={
                <PrivateRoute allowedRoles={['ADMIN', 'PURCHASE_OFFICER', 'STORE_MANAGER']}><QuotationManagement /></PrivateRoute>
              } />

              {/* Approved Supplier List register — client-spec viewers only:
                  admin, managers, purchase, stores, designs. */}
              <Route path="/suppliers" element={
                <PrivateRoute allowedRoles={['ADMIN', 'MANAGER', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'DESIGNS']}><Suppliers /></PrivateRoute>
              } />

              <Route path="/purchase-orders" element={
                <PrivateRoute allowedRoles={CHAIN_ROLES}><PurchaseOrders /></PrivateRoute>
              } />

              <Route path="/payment-requests" element={
                <PrivateRoute allowedRoles={['ADMIN', 'PURCHASE_OFFICER', 'ACCOUNTING']}><PaymentRequests /></PrivateRoute>
              } />

              <Route path="/qc-inspections" element={
                <PrivateRoute allowedRoles={CHAIN_ROLES}><QCInspections /></PrivateRoute>
              } />

              {/* Inward Entry — Stores does the work; Manager/QC/Designs/R&D
                  get read-only access for traceability. */}
              <Route path="/inward-entry" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'MANAGER', 'QC', 'DESIGNS', 'RND']}><InwardEntry /></PrivateRoute>
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

              {/* ION — MANAGER (sender) + LAB/METROLOGY/NDT (recipients) */}
              <Route path="/ion" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LAB', 'METROLOGY', 'NDT']}><InterOfficeNote /></PrivateRoute>
              } />

              {/* Work Orders — SUPPLY_CHAIN drafts; ADMIN accepts; assigned unit MANAGER executes; SAFETY monitors */}
              <Route path="/work-orders" element={
                <PrivateRoute allowedRoles={['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY']}><WorkOrders /></PrivateRoute>
              } />

              {/* Safety Monitor */}
              <Route path="/safety" element={
                <PrivateRoute allowedRoles={['SAFETY', 'ADMIN']}><SafetyMonitor /></PrivateRoute>
              } />

              {/* Metrology hub + per-category calibration registers.
                  Editing is gated server-side to METROLOGY + ADMIN; the page
                  itself also hides edit/add/delete controls for viewers. */}
              <Route path="/metrology" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><Metrology /></PrivateRoute>
              } />
              <Route path="/metrology/pressure-gauges" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><PressureGauges /></PrivateRoute>
              } />
              <Route path="/metrology/vacuum-gauges" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><VacuumGauges /></PrivateRoute>
              } />
              <Route path="/metrology/weighing-balances" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><WeighingBalances /></PrivateRoute>
              } />
              <Route path="/metrology/testing-equipment" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><TestingEquipment /></PrivateRoute>
              } />
              <Route path="/metrology/metrology-instruments" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><MetrologyInstruments /></PrivateRoute>
              } />
              <Route path="/metrology/mmr" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><MMR /></PrivateRoute>
              } />

              {/* SUPERADMIN-only — owner hatch */}
              <Route path="/superadmin/corrections" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><RealtimeCorrections /></PrivateRoute>
              } />
              <Route path="/superadmin/backups" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><Backups /></PrivateRoute>
              } />
              <Route path="/superadmin/health" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><Health /></PrivateRoute>
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
