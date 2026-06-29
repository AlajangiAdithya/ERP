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

  // Turn a raw API path into a human module name, e.g.
  // "/api/purchase-requests/<uuid>" → "purchase request".
  const MODULE_LABELS = {
    'purchase-requests': 'purchase request',
    'purchase-orders': 'purchase order',
    'payment-requests': 'payment request',
    'quotations': 'quotation',
    'suppliers': 'supplier',
    'products': 'product',
    'material-inward': 'material inward',
    'inventory': 'stock',
    'calibration': 'instrument',
    'machinery': 'machinery',
    'gatepass': 'gate pass',
    'gate-pass': 'gate pass',
    'work-orders': 'work order',
    'users': 'user',
    'units': 'unit',
  };
  const METHOD_VERBS = { POST: 'Created', PUT: 'Updated', PATCH: 'Updated', DELETE: 'Deleted', GET: 'Viewed' };

  // Convert SNAKE_CASE codes (QC_APPROVED, ORDER_PLACED) into "Qc approved".
  const prettify = (s) =>
    String(s).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  const friendlyFromPath = (method, path) => {
    if (!path) return '';
    const seg = path.replace(/^\/api\//, '').split('/').filter(Boolean);
    const moduleKey = seg[0] || '';
    const label = MODULE_LABELS[moduleKey] || moduleKey.replace(/-/g, ' ');
    const verb = METHOD_VERBS[method] || 'Changed';
    return label ? `${verb} ${label}` : verb;
  };

  const formatDetails = (details) => {
    if (!details) return '—';
    if (typeof details === 'string') return details;

    const parts = [];

    // 1) The record's human identifier (PR/PO/GP/payment number, product/batch name).
    const ident =
      details.requestNumber || details.orderNumber || details.gatePassNumber ||
      details.paymentNumber || details.productName || details.batchNumber;
    if (ident) parts.push(ident);

    // 2) What happened — sub-action and/or status transition.
    if (details.action) parts.push(prettify(details.action));
    const newStatus = details.newStatus || details.status;
    if (newStatus) parts.push(`→ ${prettify(newStatus)}`);

    // 3) Numbers worth seeing.
    if (details.itemCount != null) parts.push(`${details.itemCount} item${details.itemCount === 1 ? '' : 's'}`);
    if (details.quantity != null) parts.push(`qty ${details.quantity}`);
    if (details.amount != null) parts.push(`₹${Number(details.amount).toLocaleString('en-IN')}`);

    // 4) Context — unit, supplier, department.
    if (details.unit) parts.push(`Unit ${details.unit}`);
    if (details.supplierName) parts.push(details.supplierName);
    if (details.assignedDept) parts.push(details.assignedDept);

    // 5) Free-text reason / notes, quoted and trimmed.
    const note = details.reason || details.adminNotes || details.qcNotes;
    if (note) parts.push(`“${String(note).slice(0, 80)}”`);

    if (parts.length > 0) return parts.join(' · ');

    // Fallback: derive a friendly phrase from the HTTP method + path.
    if (details.path) return friendlyFromPath(details.method, details.path);
    return '—';
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
