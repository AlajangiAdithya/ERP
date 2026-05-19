import { LogOut, User, ChevronDown, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useNotificationCenter } from '../../context/NotificationContext';
import Dropdown, { DropdownItem } from '../ui/Dropdown';
import { useNavigate } from 'react-router-dom';

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

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { unreadCount } = useNotificationCenter();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const roleLabel = ROLE_LABELS[user?.role] || user?.role?.replace(/_/g, ' ');

  return (
    <header className="bg-white border-b border-navy-100 px-4 sm:px-6 h-16 flex items-center justify-between sticky top-0 z-30 shadow-[0_1px_0_rgba(16,36,82,0.04)]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="lg:hidden w-10 flex-shrink-0" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/notifications')}
          aria-label="Notifications"
          className="relative p-2 text-navy-600 hover:text-navy-800 hover:bg-navy-50 rounded-full transition-colors"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-brand-red text-white text-[10px] font-bold rounded-full ring-2 ring-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <span className="h-7 w-px bg-navy-100 mx-1" />

        <Dropdown
          trigger={
            <button className="flex items-center gap-2.5 pl-1 pr-2 sm:pr-3 py-1 rounded-full hover:bg-navy-50 transition-colors">
              <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-navy-700 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shadow-sm ring-2 ring-white">
                {getInitials(user?.name)}
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <p className="text-[13px] font-semibold text-navy-800 truncate max-w-[160px]">{user?.name}</p>
                <p className="text-[11px] text-navy-500 mt-0.5">{roleLabel}</p>
              </div>
              <ChevronDown size={14} className="text-navy-400 hidden sm:block" />
            </button>
          }
        >
          <div className="px-3 py-2.5 border-b border-gray-100 sm:hidden">
            <p className="text-sm font-semibold text-navy-800 truncate">{user?.name}</p>
            <p className="text-xs text-navy-500">{roleLabel}</p>
          </div>
          <DropdownItem onClick={() => navigate('/settings')}>
            <span className="flex items-center gap-2"><User size={14} /> Profile</span>
          </DropdownItem>
          <DropdownItem onClick={handleLogout} danger>
            <span className="flex items-center gap-2"><LogOut size={14} /> Sign Out</span>
          </DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
