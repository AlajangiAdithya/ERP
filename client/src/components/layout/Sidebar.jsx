import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, PackagePlus, UserCog,
  FileText, BarChart3, Settings, Menu, X,
  ClipboardList, CheckSquare, ScrollText, Bell, History, ShoppingCart,
  FileSearch, Truck, CreditCard, ClipboardCheck, DoorOpen, FlaskConical, ArrowLeftRight,
  Building2, ShieldCheck, Briefcase
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METEOROLOGY', 'NDT', 'RND', 'SAFETY', 'TENDER_MANAGER',
];

const getNavItems = (role) => {
  const items = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
    { to: '/products', icon: Package, label: 'Products', roles: ALL_ROLES },
    { to: '/purchase-requests', icon: ShoppingCart, label: role === 'PURCHASE_OFFICER' ? 'Purchase Assignments' : 'Purchase Requests', roles: ['ADMIN', 'MANAGER', 'ACCOUNTING', 'QC', 'LAB', 'PURCHASE_OFFICER', 'SAFETY'] },
    { to: '/quotations', icon: FileSearch, label: 'Quotations', roles: ['PURCHASE_OFFICER', 'ADMIN', 'SAFETY'] },
    { to: '/purchase-orders', icon: Truck, label: 'Purchase Orders', roles: ['PURCHASE_OFFICER', 'ADMIN', 'ACCOUNTING', 'STORE_MANAGER', 'QC', 'MANAGER', 'LAB', 'SAFETY'] },
    { to: '/payment-requests', icon: CreditCard, label: 'Payment Requests', roles: ['PURCHASE_OFFICER', 'ACCOUNTING', 'ADMIN', 'SAFETY'] },
    { to: '/qc-inspections', icon: ClipboardCheck, label: 'QC Inspections', roles: ['QC', 'ADMIN', 'SAFETY', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'MANAGER', 'LAB'] },
    { to: '/my-requests', icon: ClipboardList, label: 'MIV Requests', roles: ['MANAGER', 'LAB'] },
    { to: '/request-clearance', icon: CheckSquare, label: 'MIV Clearance', roles: ['STORE_MANAGER'] },
    { to: '/all-requests', icon: ScrollText, label: 'All MIV Requests', roles: ['ADMIN', 'SAFETY'] },
    { to: '/inward-entry', icon: PackagePlus, label: 'Inward Entry', roles: ['ADMIN', 'STORE_MANAGER'] },
    { to: '/stock-movements', icon: BarChart3, label: 'Stock Movements', roles: ['ADMIN', 'STORE_MANAGER', 'SAFETY'] },
    { to: '/gate-pass', icon: DoorOpen, label: 'Gate Pass', roles: ['ADMIN', 'MANAGER', 'STORE_MANAGER', 'ACCOUNTING', 'SAFETY'] },
    { to: '/inventory-transfers', icon: ArrowLeftRight, label: 'Inventory Transfers', roles: ['MANAGER', 'SAFETY'] },
    { to: '/ion', icon: FlaskConical, label: 'Inter Office Note', roles: ['MANAGER', 'LAB', 'METEOROLOGY', 'NDT', 'RND', 'SAFETY'] },
    { to: '/tenders', icon: Briefcase, label: 'Tenders', roles: ['TENDER_MANAGER', 'ADMIN', 'MANAGER', 'SAFETY'] },
    { to: '/safety', icon: ShieldCheck, label: 'Safety Monitor', roles: ['SAFETY', 'ADMIN'] },
    { to: '/unit-usage', icon: History, label: 'Unit Usage Logs', roles: ['ADMIN', 'SAFETY'] },
    { to: '/audit-logs', icon: FileText, label: 'Audit Logs', roles: ['ADMIN', 'SAFETY'] },
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
      <div className="px-3 pt-4 pb-3">
        <div className="relative">
          <div className="absolute -inset-2 bg-blue-400/20 blur-2xl rounded-3xl" aria-hidden="true" />
          <div className="relative rounded-xl px-3 py-2.5 bg-gradient-to-br from-blue-50/95 to-blue-100/90 ring-1 ring-white/20 shadow-[0_4px_16px_rgba(58,107,224,0.25)] flex items-center justify-center">
            <img
              src="/rapslogo6.png"
              alt="RAPS"
              className="h-11 w-auto object-contain"
            />
          </div>
        </div>
        {user?.unit && (
          <div className="mt-3 flex items-center justify-center gap-1.5 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-1">
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
          <div className="fixed left-0 top-0 bottom-0 w-56 bg-gradient-to-b from-navy-800 to-navy-900 flex flex-col z-50">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 text-white/70 hover:text-white"
            >
              <X size={20} />
            </button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Desktop sidebar — fixed so it stays put while the page scrolls */}
      <aside className="hidden lg:flex flex-col bg-gradient-to-b from-navy-800 to-navy-900 fixed left-0 top-0 bottom-0 w-56 shadow-xl z-30">
        {sidebarContent}
      </aside>
    </>
  );
}
