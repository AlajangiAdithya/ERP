import { useState, useEffect } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Pagination from '../components/shared/Pagination';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import { Select } from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';
import { FileText } from 'lucide-react';
import PageHero from '../components/shared/PageHero';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ action: '', entity: '' });
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = {
      page, limit: 25,
      action: filters.action || undefined,
      entity: filters.entity || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    };
    api.get('/reports/audit-logs', { params })
      .then(({ data }) => {
        setLogs(data.logs);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page, filters, fromDate, toDate]);

  const actionColors = {
    CREATE: 'green', UPDATE: 'blue', DELETE: 'red', LOGIN: 'navy', LOGOUT: 'gray',
    APPROVE: 'green', REJECT: 'red', COLLECT: 'blue', CANCEL: 'yellow', RECEIVE: 'green',
  };

  const actions = ['', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'COLLECT', 'CANCEL'];
  const entities = ['', 'User', 'Unit', 'Product', 'ProductRequest', 'PurchaseRequest', 'InwardEntry', 'Notification', 'StockAdjustment'];

  const formatDetails = (details) => {
    if (!details) return '—';
    if (typeof details === 'string') return details;
    const parts = [];
    if (details.method) parts.push(details.method);
    if (details.path) {
      const clean = details.path.replace(/^\/api\//, '').replace(/\/[a-f0-9-]{36}/g, '/:id');
      parts.push(clean);
    }
    if (details.reason) parts.push(details.reason);
    if (details.status) parts.push(`→ ${details.status}`);
    if (details.amount) parts.push(`₹${Number(details.amount).toLocaleString('en-IN')}`);
    if (details.quantity) parts.push(`qty: ${details.quantity}`);
    if (details.productName) parts.push(details.productName);
    if (details.orderNumber) parts.push(details.orderNumber);
    if (details.requestNumber) parts.push(details.requestNumber);
    if (parts.length > 0) return parts.join(' · ');
    const keys = Object.keys(details).filter(k => !['method', 'path'].includes(k));
    if (keys.length === 0 && details.method) return `${details.method} ${(details.path || '').replace(/^\/api\//, '')}`;
    return keys.map(k => `${k}: ${details[k]}`).join(', ');
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="Audit Logs"
        subtitle="Every privileged action recorded across the system, by user, action, and entity."
        eyebrow="Compliance"
        icon={FileText}
        actions={
          <span className="text-xs font-medium text-blue-100/90 bg-white/10 backdrop-blur-sm px-3 py-1.5 rounded-full ring-1 ring-white/20">
            {total} total entries
          </span>
        }
      />

      <div className="flex flex-wrap gap-3 items-end">
        <Select value={filters.action} onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(1); }} className="w-40">
          <option value="">All Actions</option>
          {actions.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select value={filters.entity} onChange={(e) => { setFilters({ ...filters, entity: e.target.value }); setPage(1); }} className="w-48">
          <option value="">All Entities</option>
          {entities.filter(Boolean).map(e => <option key={e} value={e}>{e}</option>)}
        </Select>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={(v) => { setFromDate(v); setPage(1); }} onToChange={(v) => { setToDate(v); setPage(1); }} />
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Timestamp</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">User</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Role</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Action</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Entity</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No logs found</td></tr>
                  ) : logs.map((log, i) => (
                    <tr key={log.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                      <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                      <td className="px-3 py-2 font-medium text-gray-700">{log.user?.name}</td>
                      <td className="px-3 py-2">
                        <Badge color={log.user?.role === 'ADMIN' ? 'navy' : log.user?.role === 'STORE_MANAGER' ? 'blue' : 'green'}>
                          {log.user?.role?.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{log.user?.unit?.code || '—'}</td>
                      <td className="px-3 py-2"><Badge color={actionColors[log.action] || 'gray'}>{log.action}</Badge></td>
                      <td className="px-3 py-2 text-gray-600">{log.entity}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs max-w-64 truncate" title={log.details ? JSON.stringify(log.details) : ''}>
                        {formatDetails(log.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
