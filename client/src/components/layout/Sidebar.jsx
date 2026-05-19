import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, PackagePlus, UserCog,
  FileText, BarChart3, Settings, Menu, X,
  ClipboardList, CheckSquare, ScrollText, Bell, History, ShoppingCart,
  FileSearch, Truck, CreditCard, ClipboardCheck, DoorOpen, FlaskConical, ArrowLeftRight,
  Building2, LogOut, User
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ALL_ROLES = ['ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB'];

const ROLE_LABELS = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  STORE_MANAGER: 'Store Manager',
  PURCHASE_OFFICER: 'Purchase Officer',
  ACCOUNTING: 'Accounting',
  QC: 'Quality Control',
  LAB: 'Lab',
};

const getInitials = (name) => {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

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
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = getNavItems(user?.role);
  const roleLabel = ROLE_LABELS[user?.role] || user?.role?.replace(/_/g, ' ');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
    setMobileOpen(false);
  };

  const sidebarContent = (
    <>
      <div className="px-5 pt-5 pb-3">
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-x-2 inset-y-0 bg-white/25 blur-2xl rounded-full" aria-hidden="true" />
          <div className="absolute inset-x-6 inset-y-1 bg-blue-300/30 blur-xl rounded-full" aria-hidden="true" />
          <img
            src="/rapslogo6.png"
            alt="RAPS"
            className="relative h-12 w-auto object-contain rounded-md"
          />
        </div>
        {user?.unit && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            <Building2 size={13} className="text-blue-300 flex-shrink-0" />
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase text-blue-100 truncate">
              {user.unit.name}
            </span>
          </div>
        )}
      </div>

      <div className="mx-5 border-t border-white/10" />

      <nav className="flex-1 pt-3 pb-3 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm transition-all duration-150 mb-0.5
              ${isActive
                ? 'bg-white/15 text-white font-medium shadow-[inset_3px_0_0_theme(colors.blue.400)]'
                : 'text-white/90 hover:bg-white/[0.08] hover:text-white'
              }`
            }
          >
            <item.icon size={19} className="flex-shrink-0" strokeWidth={2} />
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mx-3 mb-3 mt-1 rounded-xl bg-white/[0.06] border border-white/10 p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-navy-700 rounded-full flex items-center justify-center text-white text-[12px] font-semibold shadow-md ring-2 ring-white/20 flex-shrink-0">
            {getInitials(user?.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-white truncate leading-tight">
              {user?.name}
            </p>
            <p className="text-[10.5px] text-blue-200 truncate mt-0.5">{roleLabel}</p>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5">
          <button
            onClick={() => { navigate('/settings'); setMobileOpen(false); }}
            className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-white/85 hover:bg-white/10 hover:text-white rounded-md transition-colors"
          >
            <User size={12} /> Profile
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-red-200 hover:bg-red-500/15 hover:text-red-100 rounded-md transition-colors"
          >
            <LogOut size={12} /> Sign Out
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-2.5 left-3 z-50 p-2 bg-navy-800 text-white rounded-md shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-64 bg-gradient-to-b from-navy-800 to-navy-900 flex flex-col z-50">
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

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col bg-gradient-to-b from-navy-800 to-navy-900 h-screen sticky top-0 w-64 shadow-xl">
        {sidebarContent}
      </aside>
    </>
  );
}
