import { useState, useEffect } from 'react';
import { LogOut, User, ChevronDown, Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Dropdown, { DropdownItem } from '../ui/Dropdown';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);

  // Poll for notifications every 30 seconds
  useEffect(() => {
    const fetchCount = () => {
      api.get('/alerts/notifications/unread-count')
        .then(({ data }) => setUnreadCount(data.count))
        .catch(() => {});
    };

    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-30">
      <div className="lg:hidden w-10" /> {/* Spacer for mobile menu button */}
      <div className="hidden lg:flex items-center gap-2">
        {user?.unit && (
          <span className="text-xs bg-navy-50 text-navy-700 px-2.5 py-1 rounded-full font-medium">
            {user.unit.name}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Notification Bell */}
        <button
          onClick={() => navigate('/notifications')}
          className="relative p-2 text-gray-500 hover:text-navy-700 hover:bg-gray-50 rounded-md transition-colors"
        >
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-brand-red text-white text-[10px] font-bold rounded-full animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <Dropdown
          trigger={
            <button className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors">
              <div className="w-8 h-8 bg-navy-100 rounded-full flex items-center justify-center">
                <User size={16} className="text-navy-700" />
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-sm font-medium text-gray-700">{user?.name}</p>
                <p className="text-xs text-gray-400">{user?.role?.replace('_', ' ')}</p>
              </div>
              <ChevronDown size={16} className="text-gray-400" />
            </button>
          }
        >
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
