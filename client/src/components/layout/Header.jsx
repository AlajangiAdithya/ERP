import { Bell } from 'lucide-react';
import { useNotificationCenter } from '../../context/NotificationContext';
import { useNavigate } from 'react-router-dom';

export default function Header() {
  const navigate = useNavigate();
  const { unreadCount } = useNotificationCenter();

  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-6 h-14 flex items-center justify-end sticky top-0 z-30">
      <div className="lg:hidden absolute left-3 w-10 flex-shrink-0" />
      <button
        onClick={() => navigate('/notifications')}
        aria-label="Notifications"
        className="relative p-2 text-gray-500 hover:text-navy-700 hover:bg-gray-100 rounded-full transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-brand-red text-white text-[10px] font-bold rounded-full ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </header>
  );
}
