import { useState, useEffect, useMemo } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Plus, CheckCircle2, XCircle, ListOrdered, RefreshCw, ArrowLeftRight } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/formatters';

// Mirror of server utils/helpers DEPT_BY_ROLE — non-unit roles that own reserved
// stock. Stores is intentionally absent (its stock is the shared pool).
const DEPT_BY_ROLE = {
  DESIGNS: 'Designs', PLANNING: 'Planning', QC: 'QC', LAB: 'Lab',
  METROLOGY: 'Metrology', NDT: 'NDT', SAFETY: 'Safety',
};
const OWNER_DEPTS = Object.values(DEPT_BY_ROLE);

const TABS = [
  { key: 'incoming', label: 'Incoming', Icon: ArrowDownToLine, hint: 'Requests where I receive stock' },
  { key: 'outgoing', label: 'Outgoing', Icon: ArrowUpFromLine, hint: 'Requests where I release stock' },
  { key: 'all', label: 'All', Icon: ListOrdered, hint: 'Every transfer across units and departments' },
];

const statusColor = (s) => ({ PENDING: 'yellow', APPROVED: 'blue', REJECTED: 'red', TRANSFERRED: 'green' }[s] || 'gray');

// Owner-token helpers: a token is `unit:<id>` or `dept:<Label>`.
const parseOwner = (token) => {
  if (!token) return null;
  if (token.startsWith('unit:')) return { unitId: token.slice(5), dept: null };
  if (token.startsWith('dept:')) return { unitId: null, dept: token.slice(5) };
  return null;
};
// Short label for a transfer's from/to side, straight off the transfer record.
const fromLabel = (t) => (t.fromUnit ? `${t.fromUnit.code}` : (t.fromDept ? `${t.fromDept} (dept)` : '—'));
const toLabel = (t) => (t.toUnit ? `${t.toUnit.code}` : (t.toDept ? `${t.toDept} (dept)` : '—'));
const fromFull = (t) => (t.fromUnit ? `${t.fromUnit.name} (${t.fromUnit.code})` : (t.fromDept ? `${t.fromDept} (department)` : '—'));
const toFull = (t) => (t.toUnit ? `${t.toUnit.name} (${t.toUnit.code})` : (t.toDept ? `${t.toDept} (department)` : '—'));

export default function InventoryTransfers() {
  const { user } = useAuth();

  // The owner the current user represents (their own unit, or their department).
  const myOwnerToken = useMemo(() => {
    if (user?.role === 'MANAGER' && user?.unitId) return `unit:${user.unitId}`;
    if (DEPT_BY_ROLE[user?.role]) return `dept:${DEPT_BY_ROLE[user.role]}`;
    return '';
  }, [user]);
  const myOwner = useMemo(() => parseOwner(myOwnerToken), [myOwnerToken]);

  const [tab, setTab] = useState('incoming');
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [units, setUnits] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    fromOwner: '',
    toOwner: myOwnerToken,
    productId: '',
    quantity: '',
    reason: '',
    notes: '',
  });

  // Every selectable owner (units + the 7 owner departments).
  const ownerOptions = useMemo(() => ([
    ...units.map((u) => ({ token: `unit:${u.id}`, label: `${u.name} (${u.code})`, group: 'Units' })),
    ...OWNER_DEPTS.map((d) => ({ token: `dept:${d}`, label: `${d} (department)`, group: 'Departments' })),
  ]), [units]);

  // How much of a product an owner currently holds (unit ledger or dept ledger).
  const ownerStockOf = (product, owner) => {
    if (!product || !owner) return 0;
    if (owner.unitId) return (product.unitStocks || []).find((u) => u.unitId === owner.unitId)?.quantity ?? 0;
    if (owner.dept) return (product.deptStocks || []).find((d) => d.dept === owner.dept)?.quantity ?? 0;
    return 0;
  };

  // Does the current user own a given (unitId/dept) side?
  const userOwnsSide = (unitId, dept) => {
    if (user?.role === 'ADMIN') return true;
    if (unitId) return user?.role === 'MANAGER' && user?.unitId === unitId;
    if (dept) return DEPT_BY_ROLE[user?.role] === dept;
    return false;
  };

  const load = () => {
    setLoading(true);
    const params = { limit: 100, fromDate: fromDate || undefined, toDate: toDate || undefined };
    if (tab !== 'all') params.direction = tab;
    if (statusFilter) params.status = statusFilter;
    api.get('/inventory-transfers', { params })
      .then(({ data }) => setTransfers(data.transfers || []))
      .catch(() => setTransfers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, statusFilter, fromDate, toDate]);

  useEffect(() => {
    api.get('/units').then(({ data }) => setUnits(data || [])).catch(() => setUnits([]));
    api.get('/products', { params: { limit: 'all', includeUnitStock: 'true' } })
      .then(({ data }) => setProducts(data.products || []))
      .catch(() => setProducts([]));
  }, []);

  const openCreate = () => {
    setForm({ fromOwner: '', toOwner: myOwnerToken, productId: '', quantity: '', reason: '', notes: '' });
    setFormError('');
    setShowCreate(true);
  };

  const submitCreate = async () => {
    setFormError('');
    const src = parseOwner(form.fromOwner);
    const dst = parseOwner(form.toOwner);
    if (!src || !dst || !form.productId || !form.quantity) {
      return setFormError('Source owner, destination owner, product and quantity are required.');
    }
    if (form.fromOwner === form.toOwner) {
      return setFormError('Source and destination must be different.');
    }
    const qty = parseFloat(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setFormError('Quantity must be a positive number.');
    }
    const selectedProduct = products.find((p) => p.id === form.productId);
    const sourceQty = ownerStockOf(selectedProduct, src);
    if (qty > sourceQty) {
      return setFormError(`Source only holds ${sourceQty} ${selectedProduct?.unit || ''}. Cannot transfer ${qty}.`);
    }
    setSaving(true);
    try {
      await api.post('/inventory-transfers', {
        fromUnitId: src.unitId || undefined,
        fromDept: src.dept || undefined,
        toUnitId: dst.unitId || undefined,
        toDept: dst.dept || undefined,
        productId: form.productId,
        quantity: qty,
        reason: form.reason || undefined,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create transfer');
    }
    setSaving(false);
  };

  const approve = async (id) => {
    if (!confirm('Approve this transfer? Ownership of the stock will move to the destination immediately — this cannot be undone.')) return;
    try {
      await api.put(`/inventory-transfers/${id}/approve`);
      setDetail(null);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const reject = async (id) => {
    const reason = prompt('Reason for rejection (optional):');
    if (reason === null) return;
    try {
      await api.put(`/inventory-transfers/${id}/reject`, { reason: reason || undefined });
      setDetail(null);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const activeTabMeta = useMemo(() => TABS.find((t) => t.key === tab), [tab]);

  // Holdings of the chosen source owner for the selected product (info box).
  const stockAtSource = useMemo(() => {
    const src = parseOwner(form.fromOwner);
    if (!src || !form.productId) return null;
    const product = products.find((p) => p.id === form.productId);
    if (!product) return null;
    return { qty: ownerStockOf(product, src), unit: product.unit, total: product.currentStock };
    // eslint-disable-next-line
  }, [products, form.fromOwner, form.productId]);

  const canApprove = (t) => t.status === 'PENDING' && (user?.role === 'ADMIN' || userOwnsSide(t.fromUnitId, t.fromDept));

  return (
    <div className="space-y-6">
      <PageHero
        title="Inventory Transfers"
        subtitle="Request and track reserved-stock movements between units and departments."
        eyebrow="Owner-to-Owner Movement"
        icon={ArrowLeftRight}
        actions={
          <>
            <Button variant="secondary" onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </Button>
            {myOwner && <Button onClick={openCreate}><Plus size={16} /> New Transfer Request</Button>}
          </>
        }
      />

      <div className="flex gap-2 border-b border-gray-200">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={16} className="inline mr-2" />{label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 pb-2">
          <label className="text-xs text-gray-500">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-300 rounded"
          >
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="TRANSFERRED">Transferred</option>
          </select>
        </div>
      </div>

      <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />

      <p className="text-xs text-gray-400">{activeTabMeta?.hint}</p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : transfers.length === 0 ? (
        <Card className="text-center text-gray-500 py-10">No transfers in this view.</Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-2 font-medium">Transfer No.</th>
                  <th className="px-4 py-2 font-medium">From → To</th>
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium">Qty</th>
                  <th className="px-4 py-2 font-medium">Requested By</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={t.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-4 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => setDetail(t)}>
                      {t.transferNumber}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      <span className="text-xs">{fromLabel(t)}</span>
                      <span className="mx-1 text-gray-400">→</span>
                      <span className="text-xs">{toLabel(t)}</span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{t.product?.name}</td>
                    <td className="px-4 py-2 text-gray-700">{t.quantity} {t.product?.unit}</td>
                    <td className="px-4 py-2 text-gray-600">{t.requestedBy?.name}</td>
                    <td className="px-4 py-2"><Badge color={statusColor(t.status)}>{t.status}</Badge></td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-2">
                      <Button size="sm" variant="secondary" onClick={() => setDetail(t)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Transfer Request" size="lg">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            You can only pull stock INTO your own unit/department. The source owner (the unit's Manager
            or the owning department — or an Admin) must approve. Stock is reserved <strong>per owner</strong> —
            you can only request what the source actually holds. Once approved, ownership moves immediately
            and the request is final.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="From (source owner)"
              value={form.fromOwner}
              onChange={(e) => setForm({ ...form, fromOwner: e.target.value, productId: '' })}
            >
              <option value="">Select source…</option>
              {ownerOptions
                .filter((o) => o.token !== form.toOwner)
                .map((o) => (
                  <option key={o.token} value={o.token}>{o.label}</option>
                ))}
            </Select>
            <Select
              label="To (destination — yours)"
              value={form.toOwner}
              onChange={(e) => setForm({ ...form, toOwner: e.target.value })}
              disabled
            >
              <option value="">Select destination…</option>
              {ownerOptions.map((o) => (
                <option key={o.token} value={o.token}>{o.label}</option>
              ))}
            </Select>
          </div>

          <Select
            label="Product"
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
            disabled={!form.fromOwner}
          >
            <option value="">
              {form.fromOwner ? 'Select product…' : 'Select a source owner first'}
            </option>
            {form.fromOwner && products
              .map((p) => ({ p, atSource: ownerStockOf(p, parseOwner(form.fromOwner)) }))
              .filter(({ atSource }) => atSource > 0)
              .map(({ p, atSource }) => (
                <option key={p.id} value={p.id}>
                  {p.name} — at source: {atSource} {p.unit}
                </option>
              ))}
          </Select>
          {form.fromOwner && products.every((p) => ownerStockOf(p, parseOwner(form.fromOwner)) <= 0) && (
            <p className="text-xs text-amber-600 -mt-2">This source currently holds no reserved products.</p>
          )}

          {stockAtSource && (
            <div className={`text-xs px-3 py-2 rounded-md border ${
              stockAtSource.qty <= 0
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-blue-50 border-blue-200 text-blue-800'
            }`}>
              {stockAtSource.qty <= 0 ? (
                <>
                  <strong>Source has 0 {stockAtSource.unit} on hand.</strong>{' '}
                  It cannot ship what it does not hold. Total across all owners: {stockAtSource.total} {stockAtSource.unit}.
                </>
              ) : (
                <>
                  Source currently holds <strong>{stockAtSource.qty} {stockAtSource.unit}</strong> of this product.
                  Total across all owners: {stockAtSource.total} {stockAtSource.unit}.
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Quantity"
              type="number"
              min={0}
              step="any"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
            <Input
              label="Reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="Short reason for the transfer"
            />
          </div>

          <Textarea
            label="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Anything the source owner should know"
          />

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? 'Submitting…' : 'Submit Request'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={!!detail} onClose={() => setDetail(null)} title={`Transfer ${detail?.transferNumber || ''}`} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(detail.status)}>{detail.status}</Badge></div>
              <div><span className="text-gray-500">Created:</span> {formatDateTime(detail.createdAt)}</div>
              <div><span className="text-gray-500">From:</span> <span className="font-medium">{fromFull(detail)}</span></div>
              <div><span className="text-gray-500">To:</span> <span className="font-medium">{toFull(detail)}</span></div>
              <div><span className="text-gray-500">Product:</span> <span className="font-medium">{detail.product?.name}</span></div>
              <div><span className="text-gray-500">Quantity:</span> <span className="font-medium">{detail.quantity} {detail.product?.unit}</span></div>
              <div><span className="text-gray-500">Requested by:</span> {detail.requestedBy?.name}</div>
              {detail.approvedBy && (
                <div><span className="text-gray-500">Actioned by:</span> {detail.approvedBy?.name} · {formatDateTime(detail.approvedAt)}</div>
              )}
              {detail.completedAt && (
                <div><span className="text-gray-500">Completed:</span> {formatDateTime(detail.completedAt)}</div>
              )}
            </div>

            {detail.reason && (
              <div className="bg-gray-50 rounded-md p-3 text-sm">
                <span className="text-gray-500">Reason:</span> {detail.reason}
              </div>
            )}
            {detail.notes && (
              <div className="bg-gray-50 rounded-md p-3 text-sm">
                <span className="text-gray-500">Notes:</span> {detail.notes}
              </div>
            )}
            {detail.rejectionReason && (
              <div className="bg-red-50 rounded-md p-3 text-sm">
                <span className="text-red-700 font-medium">Rejection reason:</span> {detail.rejectionReason}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              {canApprove(detail) && (
                <>
                  <Button variant="danger" onClick={() => reject(detail.id)}>
                    <XCircle size={16} className="mr-1" /> Reject
                  </Button>
                  <Button onClick={() => approve(detail.id)}>
                    <CheckCircle2 size={16} className="mr-1" /> Approve &amp; Transfer
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
