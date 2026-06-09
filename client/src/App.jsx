import { Component } from 'react';
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
import Vehicles from './pages/Vehicles';
import Logistics from './pages/Logistics';
import InterOfficeNote from './pages/InterOfficeNote';
import InventoryTransfers from './pages/InventoryTransfers';
import WorkOrders from './pages/WorkOrders';
import SafetyMonitor from './pages/SafetyMonitor';
import RealtimeCorrections from './pages/superadmin/RealtimeCorrections';
import Backups from './pages/superadmin/Backups';
import Health from './pages/superadmin/Health';
import SuperAdminHub from './pages/superadmin/Hub';
import SuperAdminUsers from './pages/superadmin/Users';
import SuperAdminBroadcast from './pages/superadmin/Broadcast';
import SuperAdminActivity from './pages/superadmin/Activity';
import Metrology from './pages/Metrology';
import PressureGauges from './pages/metrology/PressureGauges';
import VacuumGauges from './pages/metrology/VacuumGauges';
import WeighingBalances from './pages/metrology/WeighingBalances';
import TestingEquipment from './pages/metrology/TestingEquipment';
import MetrologyInstruments from './pages/metrology/MetrologyInstruments';
import MMR from './pages/metrology/MMR';
import MetrologyCategoryView from './pages/metrology/CategoryView';
import MachineryRegister from './pages/MachineryRegister';
import HumanResources from './pages/HumanResources';
import HrEmployees from './pages/hr/Employees';
import HrSkillMatrix from './pages/hr/SkillMatrix';
import HrTrainingPlan from './pages/hr/TrainingPlan';
import HrTrainingRecords from './pages/hr/TrainingRecords';

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts, Planning (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'PLANNING', 'LAB', 'METROLOGY', 'NDT', 'SAFETY'];

// Metrology calibration registers access (per access chart RAPS/QSP):
// Full edit = METROLOGY, QC, MANAGER@UNIT-V.
// View + remarks + cert download = ADMIN, MANAGER (all units), LAB, NDT, RND.
// The route guard allows any potential viewer through; the page itself
// (and the server's calibration.routes.js) enforces the unit-aware split.
const METROLOGY_VIEW_ROLES = ['ADMIN', 'METROLOGY', 'QC', 'MANAGER', 'LAB', 'NDT', 'RND', 'SUPERADMIN'];

// Global ErrorBoundary — catches render-phase errors so a single page bug
// doesn't white-screen the entire app. Reload restores normal navigation.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] render crash', error, info?.componentStack);
  }
  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/';
  };
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-gray p-6">
        <div className="max-w-md w-full bg-white rounded-lg shadow p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
          <p className="text-sm text-gray-600 mb-4">
            An unexpected error occurred on this page. Your session is safe — reload to continue.
          </p>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 bg-navy-700 text-white text-sm rounded hover:bg-navy-800"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}

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
    <ErrorBoundary>
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

              {/* MIV requesters — Manager / Lab / QC / R&D */}
              <Route path="/my-requests" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LAB', 'QC', 'RND']}><MyRequests /></PrivateRoute>
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

              {/* Inward Entry — Stores does the work; Manager/QC/Designs/R&D/Safety
                  get read-only access for traceability. */}
              <Route path="/inward-entry" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'SAFETY']}><InwardEntry /></PrivateRoute>
              } />
              <Route path="/stock-movements" element={
                <PrivateRoute allowedRoles={['ADMIN', 'STORE_MANAGER', 'LOGISTICS', 'PLANNING', 'SAFETY']}><StockMovements /></PrivateRoute>
              } />
              <Route path="/gate-pass" element={
                <PrivateRoute allowedRoles={['ADMIN', 'MANAGER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'LOGISTICS', 'SAFETY', 'SITE_OFFICE']}><GatePass /></PrivateRoute>
              } />
              {/* Vehicle Register — viewable by anyone signed in (read-only).
                  LOGISTICS + ADMIN get edit/add/delete via the page's canEdit gate. */}
              <Route path="/vehicles" element={<Vehicles />} />
              {/* Logistics dispatch desk — PENDING_LOGISTICS queue with vehicle
                  assignment + dispatch confirmation. */}
              <Route path="/logistics" element={
                <PrivateRoute allowedRoles={['ADMIN', 'LOGISTICS']}><Logistics /></PrivateRoute>
              } />
              {/* Inventory Transfers — MANAGER + LOGISTICS + SAFETY monitor */}
              <Route path="/inventory-transfers" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LOGISTICS', 'SAFETY']}><InventoryTransfers /></PrivateRoute>
              } />

              {/* ION — MANAGER / LAB / METROLOGY / NDT / RND (creators + recipients) */}
              <Route path="/ion" element={
                <PrivateRoute allowedRoles={['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'RND']}><InterOfficeNote /></PrivateRoute>
              } />

              {/* Work Orders — SUPPLY_CHAIN logs supply orders; ADMIN accepts &
                  assigns to a unit; that unit's MANAGER executes (status +
                  remarks); SUPPLY_CHAIN / ACCOUNTING / ADMIN own BG/Insurance
                  history + delivery details; QC + FINANCE + ACCOUNTING own
                  the per-batch closure cycles inside the WO detail; SAFETY
                  monitors. */}
              <Route path="/work-orders" element={
                <PrivateRoute allowedRoles={['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY', 'ACCOUNTING', 'FINANCE', 'QC']}><WorkOrders /></PrivateRoute>
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
              <Route path="/metrology/category/:slug" element={
                <PrivateRoute allowedRoles={METROLOGY_VIEW_ROLES}><MetrologyCategoryView /></PrivateRoute>
              } />

              {/* Safety / HSE — Machinery + Fire Extinguisher register (everyone views, SAFETY + Unit-5 edit) */}
              <Route path="/machinery" element={
                <PrivateRoute><MachineryRegister /></PrivateRoute>
              } />

              {/* HR hub + sub-modules — everyone views; HR/ADMIN edit. Managers
                  can append training items for their team. Server enforces. */}
              <Route path="/hr"                 element={<PrivateRoute><HumanResources /></PrivateRoute>} />
              <Route path="/hr/employees"       element={<PrivateRoute><HrEmployees /></PrivateRoute>} />
              <Route path="/hr/skill-matrix"    element={<PrivateRoute><HrSkillMatrix /></PrivateRoute>} />
              <Route path="/hr/training-plan"   element={<PrivateRoute><HrTrainingPlan /></PrivateRoute>} />
              <Route path="/hr/training-records" element={<PrivateRoute><HrTrainingRecords /></PrivateRoute>} />

              {/* SUPERADMIN-only — owner hatch */}
              <Route path="/superadmin" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><SuperAdminHub /></PrivateRoute>
              } />
              <Route path="/superadmin/users" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><SuperAdminUsers /></PrivateRoute>
              } />
              <Route path="/superadmin/broadcast" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><SuperAdminBroadcast /></PrivateRoute>
              } />
              <Route path="/superadmin/activity" element={
                <PrivateRoute allowedRoles={['SUPERADMIN']}><SuperAdminActivity /></PrivateRoute>
              } />
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
    </ErrorBoundary>
  );
}
