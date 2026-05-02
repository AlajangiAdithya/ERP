import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Pagination from '../components/shared/Pagination';
import { formatDateTime } from '../utils/formatters';

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetch = () => {
    setLoading(true);
    api.get('/alerts/notifications', { params: { page, limit: 20 } })
      .then(({ data }) => {
        setNotifications(data.notifications);
        setTotalPages(data.totalPages);
        setUnreadCount(data.unreadCount);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetch(); }, [page]);

  const markRead = async (id) => {
    await api.put(`/alerts/notifications/${id}/read`);
    fetch();
  };

  const markAllRead = async () => {
    await api.put('/alerts/notifications/mark-all-read');
    fetch();
  };

  const typeColors = {
    LOW_STOCK: 'red',
    NEW_REQUEST: 'yellow',
    REQUEST_APPROVED: 'green',
    REQUEST_REJECTED: 'red',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {unreadCount > 0 && <Badge color="red">{unreadCount} unread</Badge>}
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" onClick={markAllRead}>
            <CheckCheck size={16} className="mr-1" /> Mark All Read
          </Button>
        )}
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <Bell size={32} className="mx-auto mb-2 text-gray-300" />
            <p>No notifications</p>
          </div>
        ) : (
          <>
            <div className="divide-y">
              {notifications.map(n => (
                <div key={n.id} className={`flex items-start gap-4 px-4 py-3 transition-colors ${!n.isRead ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!n.isRead ? 'bg-navy-700' : 'bg-transparent'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color={typeColors[n.type] || 'gray'}>{n.type.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-gray-400">{formatDateTime(n.createdAt)}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800">{n.title}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>
                    {n.sentBy && <p className="text-xs text-gray-400 mt-1">From: {n.sentBy.name} ({n.sentBy.role?.replace('_', ' ')})</p>}
                  </div>
                  {!n.isRead && (
                    <Button size="sm" variant="secondary" onClick={() => markRead(n.id)}>
                      <Check size={14} />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
