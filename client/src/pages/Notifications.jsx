import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Trash2 } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Pagination from '../components/shared/Pagination';
import { formatDateTime } from '../utils/formatters';

const typeRoutes = {
  LOW_STOCK: '/products',
  NEW_REQUEST: '/request-clearance',
  REQUEST_APPROVED: '/my-requests',
  REQUEST_REJECTED: '/my-requests',
  TRANSFER_REQUEST: '/inventory-transfers',
  TRANSFER_APPROVED: '/inventory-transfers',
  TRANSFER_REJECTED: '/inventory-transfers',
  PAYMENT_REQUEST: '/payment-requests',
  PAYMENT_APPROVED: '/payment-requests',
  PAYMENT_PROCESSED: '/payment-requests',
  PAYMENT_REJECTED: '/payment-requests',
  GOODS_ARRIVED: '/purchase-orders',
  INWARD_COMPLETE: '/purchase-orders',
  PARTIAL_DELIVERY: '/purchase-orders',
  ITEM_STATUS_UPDATE: '/purchase-orders',
  ORDER_PLACED: '/purchase-orders',
  INSPECTION_REQUEST: '/qc-inspections',
  QC_PASSED: '/qc-inspections',
  QC_FAILED: '/qc-inspections',
  ION_RECEIVED: '/ion',
  ION_STATUS_UPDATE: '/ion',
};

const typeColors = {
  LOW_STOCK: 'red',
  NEW_REQUEST: 'yellow',
  REQUEST_APPROVED: 'green',
  REQUEST_REJECTED: 'red',
  TRANSFER_REQUEST: 'yellow',
  TRANSFER_APPROVED: 'green',
  TRANSFER_REJECTED: 'red',
  PAYMENT_REQUEST: 'yellow',
  PAYMENT_APPROVED: 'green',
  PAYMENT_PROCESSED: 'green',
  PAYMENT_REJECTED: 'red',
  GOODS_ARRIVED: 'green',
  INWARD_COMPLETE: 'green',
  PARTIAL_DELIVERY: 'yellow',
  ITEM_STATUS_UPDATE: 'yellow',
  ORDER_PLACED: 'green',
  INSPECTION_REQUEST: 'yellow',
  QC_PASSED: 'green',
  QC_FAILED: 'red',
  ION_RECEIVED: 'yellow',
  ION_STATUS_UPDATE: 'yellow',
};

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const navigate = useNavigate();

  const fetchNotifications = () => {
    setLoading(true);
    api.get('/alerts/notifications', { params: { page, limit: 20 } })
      .then(({ data }) => {
        setNotifications(data.notifications);
        setTotalPages(data.totalPages);
        setTotalCount(data.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchNotifications(); }, [page]);

  const dismiss = async (id, e) => {
    e.stopPropagation();
    await api.delete(`/alerts/notifications/${id}`);
    fetchNotifications();
  };

  const clearAll = async () => {
    await api.delete('/alerts/notifications/clear-all');
    fetchNotifications();
  };

  const handleClick = async (n) => {
    try {
      await api.delete(`/alerts/notifications/${n.id}`);
    } catch {}
    const route = typeRoutes[n.type] || '/';
    navigate(route);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
          {totalCount > 0 && <Badge color="gray">{totalCount}</Badge>}
        </div>
        {notifications.length > 0 && (
          <Button variant="secondary" onClick={clearAll}>
            <Trash2 size={16} className="mr-1" /> Clear All
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
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className="flex items-start gap-4 px-4 py-3 cursor-pointer transition-colors hover:bg-navy-50/50 group"
                >
                  <div className="w-2 h-2 rounded-full mt-2 flex-shrink-0 bg-navy-700" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge color={typeColors[n.type] || 'gray'}>{n.type.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs text-gray-400">{formatDateTime(n.createdAt)}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-800">{n.title}</p>
                    <p className="text-sm text-gray-600 mt-0.5">{n.message}</p>
                    {n.sentBy && <p className="text-xs text-gray-400 mt-1">From: {n.sentBy.name} ({n.sentBy.role?.replace('_', ' ')})</p>}
                  </div>
                  <button
                    onClick={(e) => dismiss(n.id, e)}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
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
