import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, UserCog,
  BarChart3, Settings, Menu, X,
  CheckSquare, ClipboardCheck, ScrollText,
  Building2, ShieldCheck, Crown, Boxes, Ruler,
  ClipboardList, Truck, DoorOpen, IdCard, Wrench, GraduationCap, CalendarClock, Navigation, Gauge, Table2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METROLOGY', 'NDT', 'RND', 'SAFETY', 'SUPPLY_CHAIN',
  'DESIGNS', 'FINANCE', 'PLANNING', 'LOGISTICS', 'HR', 'SITE_OFFICE',
];

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts, Planning (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'PLANNING', 'SAFETY'];

// Metrology hub viewers (per access chart RAPS/QSP):
// Full edit = METROLOGY, QC, MANAGER@UNIT-V.
// View + remarks + cert download = ADMIN, MANAGER (all units), LAB, NDT, RND, HR.
// SUPERADMIN reaches this register from Real-time Corrections, not the sidebar.
const METROLOGY_VIEW_ROLES = ['ADMIN', 'METROLOGY', 'QC', 'MANAGER', 'LAB', 'NDT', 'RND', 'HR', 'PLANNING', 'ACCOUNTING', 'FINANCE'];

// Procurement & Inventory Management hub is visible to every authenticated
// user EXCEPT Supply Chain and HR. ACCOUNTING + FINANCE are admin-level
// read-only observers of the procurement chain, so the hub is open to them.
const PROCUREMENT_ROLES = ALL_ROLES.filter((r) => r !== 'SUPPLY_CHAIN' && r !== 'HR');

// HR hub is hidden from Metrology — not part of their workflow.
const NON_METROLOGY_ROLES = ALL_ROLES.filter((r) => r !== 'METROLOGY');

// Gate Pass / Vehicle Movement / Logistics hub is hidden from Metrology
// and QC — neither runs dispatch.
const DISPATCH_ROLES = ALL_ROLES.filter((r) => r !== 'METROLOGY' && r !== 'QC');

const buildAllItems = () => {
  const items = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
    // INWARD_QC is a single-purpose login — its only entry is the inward QC page.
    // (Not in ALL_ROLES, so every other item below stays hidden for it.)
    { to: '/inward-entry', icon: ClipboardCheck, label: 'Inward QC', roles: ['INWARD_QC'] },
    { to: '/work-orders', icon: ClipboardList, label: 'Work Orders', roles: ['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY', 'ACCOUNTING', 'FINANCE', 'QC', 'PLANNING'] },
    // Messaging stays reachable from the Dashboard card; no sidebar entry.
    { to: '/procurement', icon: Boxes, label: 'Procurement & Inventory', roles: PROCUREMENT_ROLES },
    { to: '/ion', icon: ScrollText, label: 'Inter Office Note', roles: ['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'RND', 'PLANNING'] },
    // Dispatch hub — Gate Pass + Logistics + Vehicle Movement. Vehicle
    // register is open to everyone, so the hub itself is too; the cards
    // inside are role-filtered, and each sub-page enforces its own gate.
    // Hidden from Metrology and QC — they don't run dispatch.
    { to: '/transport', icon: Navigation, label: 'Gate Pass & Vehicles', roles: DISPATCH_ROLES },
    { to: '/metrology', icon: Ruler, label: 'Measuring and Monitoring Resources', roles: METROLOGY_VIEW_ROLES },
    // Machinery register — view-only for everyone, edit for SAFETY + Unit-5 (gated server-side).
    // Hidden from Supply Chain — not part of their workflow. ACCOUNTING + FINANCE
    // get read-only visibility.
    { to: '/machinery', icon: Wrench, label: 'Machinery', roles: ALL_ROLES.filter((r) => r !== 'SUPPLY_CHAIN') },
    // HR hub — employees, skill matrix, annual training plan, training records.
    // HR + ADMIN edit; Managers can append training items for their unit; all view.
    // Hidden from Metrology — not part of their workflow.
    // HIDDEN FROM ERP (code retained, not removed):
    // { to: '/hr', icon: GraduationCap, label: 'Human Resources', roles: NON_METROLOGY_ROLES },
    // Attendance register — Unit managers edit their own unit; ADMIN + SAFETY
    // can view all units; ACCOUNTING sees only months submitted to them.
    // HIDDEN FROM ERP (code retained, not removed):
    // { to: '/attendance', icon: CalendarClock, label: 'Attendance', roles: ['MANAGER', 'ADMIN', 'SAFETY', 'ACCOUNTING', 'HR'] },
    // Role-specific action hubs.
    { to: '/request-clearance', icon: CheckSquare, label: 'MIV Clearance', roles: ['STORE_MANAGER'] },
    { to: '/safety', icon: ShieldCheck, label: 'Safety Monitor', roles: ['SAFETY'] },
    // Monitoring hub — Stock Movements, All MIV Requests, Audit Logs, Unit Usage Logs.
    { to: '/monitoring', icon: BarChart3, label: 'Monitoring', roles: ['ADMIN', 'STORE_MANAGER', 'LOGISTICS', 'PLANNING', 'SAFETY', 'ACCOUNTING', 'FINANCE'] },
    // QMS hub (SOPs, Work Instructions, KPIs).
    // Document uploads gated to Unit-5 server-side.
    // HIDDEN FROM ERP (code retained, not removed):
    // { to: '/qms', icon: Gauge, label: 'QMS', roles: ALL_ROLES },
    // Utility — available to everyone. Notifications intentionally omitted from
    // the side menu: it's reachable from the header bell on every page.
    { to: '/settings', icon: Settings, label: 'Settings', roles: ALL_ROLES },
    // Admin-only.
    { to: '/management', icon: UserCog, label: 'Management', roles: ['ADMIN'] },
    // SUPERADMIN-only owner hatch — invisible to everyone else. One entry
    // takes the owner to the hub; deeper pages link from there.
    { to: '/superadmin', icon: Crown, label: 'Control Hub', roles: ['SUPERADMIN'] },
    // DATA_EDITOR-only — single-purpose edit-only table corrector.
    { to: '/data-editor', icon: Table2, label: 'Edit Data', roles: ['DATA_EDITOR'] },
  ];

  return items;
};

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  const navItems = buildAllItems().filter((item) => item.roles.includes(user?.role));

  const sidebarContent = (
    <>
      <div className="px-3 pt-5 pb-4">
        <div className="relative">
          <div className="absolute -inset-3 bg-blue-400/30 blur-3xl rounded-3xl" aria-hidden="true" />
          <div className="relative rounded-full px-3 py-1 bg-white ring-1 ring-white/40 shadow-[0_8px_28px_rgba(58,107,224,0.45)] flex items-center justify-center">
            <img
              src="/rapslogo6.png"
              alt="RAPS"
              className="h-20 w-auto object-contain drop-shadow-sm"
            />
          </div>
        </div>
        {user?.unit && (
          <div className="mt-3.5 flex items-center justify-center gap-1.5 bg-white/[0.08] border border-white/15 rounded-full px-3 py-1.5">
            <Building2 size={11} className="text-blue-300 flex-shrink-0" />
            <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-blue-100 truncate">
              {user.unit.name}
            </span>
          </div>
        )}
      </div>

      <div className="mx-4 border-t border-white/10" />

      <nav className="flex-1 pt-2.5 pb-3 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group relative flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-[13px] transition-all duration-150 mb-0.5
              ${isActive
                ? 'bg-gradient-to-r from-blue-500/25 to-white/[0.06] text-white font-semibold ring-1 ring-white/15 shadow-[inset_3px_0_0_theme(colors.blue.400)]'
                : 'text-white/85 hover:bg-white/[0.08] hover:text-white hover:translate-x-0.5'
              }`
            }
          >
            <item.icon size={17} className="flex-shrink-0 transition-transform duration-150 group-hover:scale-110" strokeWidth={2} />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-2.5 border-t border-white/10">
        <p className="text-[10px] uppercase tracking-[0.2em] text-blue-200/70 font-semibold text-center">
          RAPS ERP
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 bg-navy-800 text-white rounded-md shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-56 bg-gradient-to-b from-navy-800 to-navy-900 flex flex-col z-50 overflow-hidden">
            <div
              className="absolute inset-0 opacity-[0.06] bg-cover bg-center pointer-events-none"
              style={{ backgroundImage: "url('/rocket.jpg')" }}
              aria-hidden="true"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-navy-800/70 via-navy-800/85 to-navy-900 pointer-events-none" aria-hidden="true" />
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
            >
              <X size={20} />
            </button>
            <div className="relative z-10 flex flex-col flex-1 min-h-0">{sidebarContent}</div>
          </div>
        </div>
      )}

      {/* Desktop sidebar — fixed so it stays put while the page scrolls */}
      <aside className="hidden lg:flex flex-col bg-gradient-to-b from-navy-800 to-navy-900 fixed left-0 top-0 bottom-0 w-56 shadow-xl z-30 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.06] bg-cover bg-center pointer-events-none"
          style={{ backgroundImage: "url('/rocket.jpg')" }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-800/70 via-navy-800/85 to-navy-900 pointer-events-none" aria-hidden="true" />
        <div className="relative z-10 flex flex-col flex-1 min-h-0">{sidebarContent}</div>
      </aside>
    </>
  );
}
