import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, X, Trash2 } from 'lucide-react';
import api from '../api/axios';
import { useAutoRefresh } from '../context/NotificationContext';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Pagination from '../components/shared/Pagination';
import { formatDateTime } from '../utils/formatters';
import PageHero from '../components/shared/PageHero';

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
  ORDER_PLACED_ON_CREDIT: '/purchase-orders',
  PO_FORCE_CLOSED: '/purchase-orders',
  INSPECTION_REQUEST: '/qc-inspections',
  QC_PASSED: '/qc-inspections',
  QC_FAILED: '/qc-inspections',
  QC_ON_HOLD: '/qc-inspections',
  QC_RE_REVIEW: '/qc-inspections',
  INSPECTION_PASSED: '/purchase-requests',
  INSPECTION_FAILED: '/purchase-requests',
  INSPECTION_PARTIAL: '/purchase-requests',
  ION_RECEIVED: '/ion',
  ION_STATUS_UPDATE: '/ion',
  NEW_PURCHASE_REQUEST: '/purchase-requests',
  PURCHASE_REQUEST_APPROVED: '/purchase-requests',
  PURCHASE_REQUEST_REJECTED: '/purchase-requests',
  NEW_PURCHASE_ASSIGNMENT: '/purchase-requests',
  PURCHASE_COMPLETED: '/purchase-requests',
  PR_CLOSED: '/purchase-requests',
  QUOTATION_REVIEW: '/quotations',
  QUOTATION_APPROVED: '/quotations',
  QUOTATION_HOLD: '/quotations',
  QUOTATION_RESUBMITTED: '/quotations',
  WORK_ORDER_PENDING_ADMIN: '/work-orders',
  WORK_ORDER_ASSIGNED_TO_UNIT: '/work-orders',
  WORK_ORDER_UNIT_ACCEPTED: '/work-orders',
  WORK_ORDER_UNIT_REJECTED: '/work-orders',
  WORK_ORDER_ADMIN_ACCEPTED: '/work-orders',
  WORK_ORDER_REJECTED: '/work-orders',
  WO_CLOSURE_UPDATE: '/work-orders',
  WO_CLOSURE_QC_PENDING: '/work-orders',
  WO_CLOSURE_MGMT_PENDING: '/work-orders',
  WO_CLOSURE_FINANCE_PENDING: '/work-orders',
  WO_CLOSURE_ON_HOLD: '/work-orders',
  WO_CLOSURE_HOLD_RESOLVED: '/work-orders',
  WO_CLOSURE_SLA_REMINDER: '/work-orders',
  WO_CLOSURE_SLA_BREACH: '/work-orders',
  GATE_PASS_REQUEST: '/gate-pass',
  GATE_PASS_STAGE: '/gate-pass',
  GATE_PASS_APPROVED: '/gate-pass',
  GATE_PASS_REJECTED: '/gate-pass',
  GATE_PASS_INWARD: '/gate-pass',
  GATE_PASS_COLLECTED: '/gate-pass',
  MESSAGE_RECEIVED: '/',
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
  ORDER_PLACED_ON_CREDIT: 'orange',
  PO_FORCE_CLOSED: 'orange',
  INSPECTION_REQUEST: 'yellow',
  QC_PASSED: 'green',
  QC_FAILED: 'red',
  QC_ON_HOLD: 'yellow',
  QC_RE_REVIEW: 'yellow',
  INSPECTION_PASSED: 'green',
  INSPECTION_FAILED: 'red',
  INSPECTION_PARTIAL: 'yellow',
  ION_RECEIVED: 'yellow',
  ION_STATUS_UPDATE: 'yellow',
  NEW_PURCHASE_REQUEST: 'yellow',
  PURCHASE_REQUEST_APPROVED: 'green',
  PURCHASE_REQUEST_REJECTED: 'red',
  NEW_PURCHASE_ASSIGNMENT: 'yellow',
  PURCHASE_COMPLETED: 'green',
  PR_CLOSED: 'gray',
  QUOTATION_REVIEW: 'yellow',
  QUOTATION_APPROVED: 'green',
  QUOTATION_HOLD: 'yellow',
  QUOTATION_RESUBMITTED: 'yellow',
  WORK_ORDER_PENDING_ADMIN: 'yellow',
  WORK_ORDER_ASSIGNED_TO_UNIT: 'yellow',
  WORK_ORDER_UNIT_ACCEPTED: 'green',
  WORK_ORDER_UNIT_REJECTED: 'red',
  WORK_ORDER_ADMIN_ACCEPTED: 'green',
  WORK_ORDER_REJECTED: 'red',
  WO_CLOSURE_UPDATE: 'yellow',
  WO_CLOSURE_QC_PENDING: 'yellow',
  WO_CLOSURE_MGMT_PENDING: 'yellow',
  WO_CLOSURE_FINANCE_PENDING: 'yellow',
  WO_CLOSURE_ON_HOLD: 'orange',
  WO_CLOSURE_HOLD_RESOLVED: 'green',
  WO_CLOSURE_SLA_REMINDER: 'orange',
  WO_CLOSURE_SLA_BREACH: 'red',
  GATE_PASS_REQUEST: 'yellow',
  GATE_PASS_STAGE: 'yellow',
  GATE_PASS_APPROVED: 'green',
  GATE_PASS_REJECTED: 'red',
  GATE_PASS_INWARD: 'yellow',
  GATE_PASS_COLLECTED: 'green',
  MESSAGE_RECEIVED: 'blue',
};

export default function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const navigate = useNavigate();
  const refreshKey = useAutoRefresh();

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

  useEffect(() => { fetchNotifications(); }, [page, refreshKey]);

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
      <PageHero
        title="Notifications"
        subtitle="System alerts about requests, orders, transfers, and inventory events relevant to you."
        eyebrow="Inbox"
        icon={Bell}
        actions={
          <>
            {totalCount > 0 && (
              <span className="text-xs font-medium text-blue-100/90 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full ring-1 ring-white/20">
                {totalCount} total
              </span>
            )}
            {notifications.length > 0 && (
              <Button variant="secondary" onClick={clearAll}>
                <Trash2 size={16} className="mr-1" /> Clear All
              </Button>
            )}
          </>
        }
      />

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
