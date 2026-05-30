import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, UserCog,
  BarChart3, Settings, Menu, X,
  CheckSquare, ScrollText, Bell,
  Building2, ShieldCheck, Database, HardDrive, Activity, Boxes, Ruler
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METROLOGY', 'NDT', 'RND', 'SAFETY', 'SUPPLY_CHAIN',
  'DESIGNS', 'FINANCE', 'PLANNING', 'LOGISTICS',
];

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING'];

// Metrology hub viewers: METROLOGY owns the registers; admin + procurement +
// quality + stores + safety get read-only entry. Hidden from FINANCE/PLANNING
// /LOGISTICS/SUPPLY_CHAIN to keep the sidebar lean for roles that don't need it.
const METROLOGY_VIEW_ROLES = [
  'METROLOGY', 'ADMIN', 'MANAGER', 'STORE_MANAGER',
  'PURCHASE_OFFICER', 'QC', 'ACCOUNTING', 'SAFETY',
  'LAB', 'NDT', 'RND', 'DESIGNS',
];

// Procurement & Inventory Management hub is visible to every authenticated
// user EXCEPT Metrology — Metrology team only works the calibration registers.
const PROCUREMENT_ROLES = ALL_ROLES.filter((r) => r !== 'METROLOGY');

const buildAllItems = () => {
  const items = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
    { to: '/procurement', icon: Boxes, label: 'Procurement & Inventory', roles: PROCUREMENT_ROLES },
    { to: '/metrology', icon: Ruler, label: 'Metrology', roles: METROLOGY_VIEW_ROLES },
    { to: '/ion', icon: ScrollText, label: 'Inter Office Note', roles: ['MANAGER', 'LAB', 'METROLOGY', 'NDT'] },
    { to: '/request-clearance', icon: CheckSquare, label: 'MIV Clearance', roles: ['STORE_MANAGER'] },
    { to: '/all-requests', icon: ScrollText, label: 'All MIV Requests', roles: ['ADMIN', 'SAFETY'] },
    { to: '/monitoring', icon: BarChart3, label: 'Monitoring', roles: ['ADMIN', 'STORE_MANAGER', 'LOGISTICS', 'PLANNING', 'SAFETY'] },
    { to: '/safety', icon: ShieldCheck, label: 'Safety Monitor', roles: ['SAFETY'] },
    { to: '/notifications', icon: Bell, label: 'Notifications', roles: ALL_ROLES },
    { to: '/settings', icon: Settings, label: 'Settings', roles: ALL_ROLES },
    { to: '/management', icon: UserCog, label: 'Management', roles: ['ADMIN'] },
    // SUPERADMIN-only owner hatch — invisible to everyone else.
    { to: '/superadmin/health', icon: Activity, label: 'System Health', roles: ['SUPERADMIN'] },
    { to: '/superadmin/corrections', icon: Database, label: 'Real-time Corrections', roles: ['SUPERADMIN'] },
    { to: '/superadmin/backups', icon: HardDrive, label: 'Backups', roles: ['SUPERADMIN'] },
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
          <div className="relative rounded-2xl px-4 py-3.5 bg-white ring-1 ring-white/40 shadow-[0_8px_28px_rgba(58,107,224,0.45)] flex items-center justify-center">
            <img
              src="/rapslogo6.png"
              alt="RAPS"
              className="h-14 w-auto object-contain drop-shadow-sm"
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
              `group flex items-center gap-2.5 px-3 py-2 mx-2 rounded-lg text-[13px] transition-all duration-150 mb-0.5
              ${isActive
                ? 'bg-white/15 text-white font-medium shadow-[inset_3px_0_0_theme(colors.blue.400)]'
                : 'text-white/90 hover:bg-white/[0.08] hover:text-white'
              }`
            }
          >
            <item.icon size={17} className="flex-shrink-0" strokeWidth={2} />
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
