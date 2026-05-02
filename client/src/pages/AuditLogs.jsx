import { useState, useEffect } from 'react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Pagination from '../components/shared/Pagination';
import { Select } from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ action: '', entity: '' });

  useEffect(() => {
    setLoading(true);
    const params = {
      page, limit: 25,
      action: filters.action || undefined,
      entity: filters.entity || undefined,
    };
    api.get('/reports/audit-logs', { params })
      .then(({ data }) => {
        setLogs(data.logs);
        setTotalPages(data.totalPages);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page, filters]);

  const actionColors = {
    CREATE: 'green', UPDATE: 'blue', DELETE: 'red', LOGIN: 'navy', LOGOUT: 'gray',
    APPROVE: 'green', REJECT: 'red', COLLECT: 'blue', CANCEL: 'yellow', RECEIVE: 'green',
  };

  const actions = ['', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'REJECT', 'COLLECT', 'CANCEL'];
  const entities = ['', 'User', 'Unit', 'Product', 'ProductRequest', 'PurchaseRequest', 'InwardEntry', 'Notification', 'StockAdjustment'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Audit Logs</h1>
        <span className="text-sm text-gray-500">{total} total entries</span>
      </div>

      <div className="flex gap-3">
        <Select value={filters.action} onChange={(e) => { setFilters({ ...filters, action: e.target.value }); setPage(1); }} className="w-40">
          <option value="">All Actions</option>
          {actions.filter(Boolean).map(a => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select value={filters.entity} onChange={(e) => { setFilters({ ...filters, entity: e.target.value }); setPage(1); }} className="w-48">
          <option value="">All Entities</option>
          {entities.filter(Boolean).map(e => <option key={e} value={e}>{e}</option>)}
        </Select>
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
                  ) : logs.map(log => (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50">
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
                      <td className="px-3 py-2 text-gray-500 text-xs max-w-64 truncate">
                        {log.details ? JSON.stringify(log.details) : '—'}
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
