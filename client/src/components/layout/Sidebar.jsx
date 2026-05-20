import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, PackagePlus, UserCog,
  FileText, BarChart3, Settings, Menu, X,
  ClipboardList, CheckSquare, ScrollText, Bell, History, ShoppingCart,
  FileSearch, Truck, CreditCard, ClipboardCheck, DoorOpen, FlaskConical, ArrowLeftRight,
  Building2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ALL_ROLES = ['ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB'];

const getNavItems = (role) => {
  const items = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
    { to: '/products', icon: Package, label: 'Products', roles: ALL_ROLES },
    { to: '/purchase-requests', icon: ShoppingCart, label: role === 'PURCHASE_OFFICER' ? 'Purchase Assignments' : 'Purchase Requests', roles: ['ADMIN', 'MANAGER', 'ACCOUNTING', 'QC', 'LAB', 'PURCHASE_OFFICER'] },
    { to: '/quotations', icon: FileSearch, label: 'Quotations', roles: ['PURCHASE_OFFICER', 'ADMIN'] },
    { to: '/purchase-orders', icon: Truck, label: 'Purchase Orders', roles: ['PURCHASE_OFFICER', 'ADMIN', 'ACCOUNTING', 'STORE_MANAGER', 'QC', 'MANAGER', 'LAB'] },
    { to: '/payment-requests', icon: CreditCard, label: 'Payment Requests', roles: ['PURCHASE_OFFICER', 'ACCOUNTING', 'ADMIN'] },
    { to: '/qc-inspections', icon: ClipboardCheck, label: 'QC Inspections', roles: ['QC', 'ADMIN'] },
    { to: '/my-requests', icon: ClipboardList, label: 'MIV Requests', roles: ['MANAGER', 'LAB'] },
    { to: '/request-clearance', icon: CheckSquare, label: 'MIV Clearance', roles: ['STORE_MANAGER'] },
    { to: '/all-requests', icon: ScrollText, label: 'All MIV Requests', roles: ['ADMIN'] },
    { to: '/inward-entry', icon: PackagePlus, label: 'Inward Entry', roles: ['ADMIN', 'STORE_MANAGER'] },
    { to: '/stock-movements', icon: BarChart3, label: 'Stock Movements', roles: ['ADMIN', 'STORE_MANAGER'] },
    { to: '/gate-pass', icon: DoorOpen, label: 'Gate Pass', roles: ['ADMIN', 'MANAGER', 'STORE_MANAGER', 'ACCOUNTING'] },
    { to: '/inventory-transfers', icon: ArrowLeftRight, label: 'Inventory Transfers', roles: ['MANAGER'] },
    { to: '/ion', icon: FlaskConical, label: 'Inter Office Note', roles: ['MANAGER', 'LAB'] },
    { to: '/unit-usage', icon: History, label: 'Unit Usage Logs', roles: ['ADMIN'] },
    { to: '/audit-logs', icon: FileText, label: 'Audit Logs', roles: ['ADMIN'] },
    { to: '/notifications', icon: Bell, label: 'Notifications', roles: ALL_ROLES },
    { to: '/settings', icon: Settings, label: 'Settings', roles: ALL_ROLES },
    { to: '/management', icon: UserCog, label: 'Management', roles: ['ADMIN'] },
  ];

  return items.filter(item => item.roles.includes(role));
};

export default function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  const navItems = getNavItems(user?.role);

  const sidebarContent = (
    <>
      <div className="px-5 pt-8 pb-6 flex flex-col items-center">
        <div className="relative group w-full flex justify-center">
          <div className="absolute -inset-1 bg-gradient-to-r from-blue-400 to-indigo-500 opacity-20 blur-xl group-hover:opacity-40 transition duration-500 rounded-full" aria-hidden="true" />
          <img
            src="/rapslogo6.png"
            alt="RAPS"
            className="h-12 w-auto object-contain relative z-10 transition-transform duration-300 group-hover:scale-105"
            style={{ filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.3))' }}
          />
        </div>
        {user?.unit && (
          <div className="mt-5 flex items-center justify-center gap-2 bg-white/5 backdrop-blur-md border border-white/10 shadow-glass rounded-full px-4 py-1.5 w-max">
            <Building2 size={13} className="text-blue-300 flex-shrink-0" />
            <span className="text-[11px] font-bold tracking-widest uppercase text-white/90">
              {user.unit.name}
            </span>
          </div>
        )}
      </div>

      <div className="mx-6 border-t border-white/10" />

      <nav className="flex-1 pt-4 pb-4 overflow-y-auto px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden
              ${isActive
                ? 'text-white bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ring-1 ring-white/10'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-8 bg-blue-400 rounded-r-full shadow-[0_0_12px_rgba(96,165,250,0.8)]" />
                )}
                <item.icon size={20} className={`flex-shrink-0 transition-colors duration-300 ${isActive ? 'text-blue-400' : 'text-white/40 group-hover:text-white/70'}`} strokeWidth={isActive ? 2.5 : 2} />
                <span className="truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-6 py-4 border-t border-white/10 bg-black/10">
        <p className="text-[10px] uppercase tracking-[0.25em] text-white/40 font-bold text-center">
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
        className="lg:hidden fixed top-3 left-3 z-50 p-2 bg-navy-900 text-white rounded-lg shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-navy-900/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-72 bg-gradient-to-b from-navy-800 to-navy-900 flex flex-col z-50 shadow-2xl border-r border-white/10">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1.5 bg-white/10 rounded-full text-white/70 hover:text-white hover:bg-white/20 transition-colors"
            >
              <X size={18} />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col bg-gradient-to-b from-navy-800 to-navy-900 h-screen sticky top-0 w-72 shadow-[4px_0_24px_rgba(0,0,0,0.1)] border-r border-navy-700 z-20">
        {sidebarContent}
      </aside>
    </>
  );
}
