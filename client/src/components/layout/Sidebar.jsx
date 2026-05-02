import { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Package, PackagePlus, Users, UserCog,
  FileText, BarChart3, Settings, ChevronLeft, ChevronRight, Menu, X,
  ClipboardList, CheckSquare, ScrollText, Bell, History, ShoppingCart,
  FileSearch, Truck, CreditCard, ClipboardCheck, DoorOpen, FlaskConical, ArrowLeftRight
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const ALL_ROLES = ['ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB'];

const getNavItems = (role) => {
  const items = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard', roles: ALL_ROLES },
    { to: '/products', icon: Package, label: 'Products', roles: ALL_ROLES },
    { to: '/purchase-requests', icon: ShoppingCart, label: 'Purchase Requests', roles: ['ADMIN', 'MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB'] },
    { to: '/quotations', icon: FileSearch, label: 'Quotations', roles: ['PURCHASE_OFFICER', 'ADMIN'] },
    { to: '/purchase-orders', icon: Truck, label: 'Purchase Orders', roles: ['PURCHASE_OFFICER', 'ADMIN', 'ACCOUNTING', 'STORE_MANAGER', 'QC'] },
    { to: '/payment-requests', icon: CreditCard, label: 'Payment Requests', roles: ['PURCHASE_OFFICER', 'ACCOUNTING', 'ADMIN'] },
    { to: '/qc-inspections', icon: ClipboardCheck, label: 'QC Inspections', roles: ['QC', 'ADMIN'] },
    { to: '/my-requests', icon: ClipboardList, label: 'MIV Requests', roles: ['MANAGER', 'LAB'] },
    { to: '/request-clearance', icon: CheckSquare, label: 'MIV Clearance', roles: ['STORE_MANAGER'] },
    { to: '/all-requests', icon: ScrollText, label: 'All MIV Requests', roles: ['ADMIN'] },
    { to: '/inward-entry', icon: PackagePlus, label: 'Inward Entry', roles: ['ADMIN', 'STORE_MANAGER'] },
    { to: '/stock-movements', icon: BarChart3, label: 'Stock Movements', roles: ['ADMIN', 'STORE_MANAGER'] },
    { to: '/gate-pass', icon: DoorOpen, label: 'Gate Pass', roles: ['ADMIN', 'STORE_MANAGER'] },
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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  const navItems = getNavItems(user?.role);

  const roleLabel = (role) => ({
    ADMIN: 'Admin',
    MANAGER: 'Manager',
    STORE_MANAGER: 'Store Manager',
    PURCHASE_OFFICER: 'Purchase Officer',
    ACCOUNTING: 'Accounting',
    QC: 'Quality Control',
    LAB: 'Lab',
  }[role] || role);

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between p-4 border-b border-navy-600">
        <div className={`flex items-center gap-3 ${collapsed ? 'justify-center w-full' : ''}`}>
          <img
            src="/rapslogo6.png"
            alt="RAPS"
            className={collapsed ? "h-9 w-9 object-contain bg-white rounded p-0.5" : "h-10 w-auto bg-white rounded px-1.5 py-1"}
          />
          {!collapsed && <span className="text-white font-bold text-base">ERP</span>}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:block text-white/70 hover:text-white p-1"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* User info */}
      {!collapsed && (
        <div className="px-4 py-3 border-b border-navy-600">
          <p className="text-white text-sm font-medium truncate">{user?.name}</p>
          <p className="text-white/50 text-xs">{roleLabel(user?.role)}</p>
          {user?.unit && (
            <p className="text-blue-300 text-xs mt-0.5">{user.unit.name}</p>
          )}
        </div>
      )}

      <nav className="flex-1 py-4 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-md text-sm transition-colors mb-0.5
              ${isActive
                ? 'bg-white/15 text-white font-medium'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
              } ${collapsed ? 'justify-center' : ''}`
            }
          >
            <item.icon size={20} className="flex-shrink-0" />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-navy-700 text-white rounded-md shadow-lg"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="fixed left-0 top-0 bottom-0 w-64 bg-navy-700 flex flex-col z-50">
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
      <aside className={`hidden lg:flex flex-col bg-navy-700 h-screen sticky top-0 transition-all duration-300
        ${collapsed ? 'w-16' : 'w-64'}`}>
        {sidebarContent}
      </aside>
    </>
  );
}
