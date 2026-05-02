import { useState, useEffect, useMemo } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Plus, CheckCircle2, XCircle, PackageCheck, ListOrdered } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/formatters';

const TABS = [
  { key: 'incoming', label: 'Incoming', Icon: ArrowDownToLine, hint: 'Requests where my unit receives stock' },
  { key: 'outgoing', label: 'Outgoing', Icon: ArrowUpFromLine, hint: 'Requests where my unit ships stock' },
  { key: 'all', label: 'All', Icon: ListOrdered, hint: 'Every transfer across units' },
];

const statusColor = (s) => ({ PENDING: 'yellow', APPROVED: 'green', REJECTED: 'red', TRANSFERRED: 'blue' }[s] || 'gray');

export default function InventoryTransfers() {
  const { user } = useAuth();

  const [tab, setTab] = useState('incoming');
  const [statusFilter, setStatusFilter] = useState('');
  const [transfers, setTransfers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [units, setUnits] = useState([]);
  const [products, setProducts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    fromUnitId: '',
    toUnitId: user?.unitId || '',
    productId: '',
    quantity: '',
    reason: '',
    notes: '',
  });

  const load = () => {
    setLoading(true);
    const params = { limit: 100 };
    if (tab !== 'all') params.direction = tab;
    if (statusFilter) params.status = statusFilter;
    api.get('/inventory-transfers', { params })
      .then(({ data }) => setTransfers(data.transfers || []))
      .catch(() => setTransfers([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, statusFilter]);

  useEffect(() => {
    api.get('/units').then(({ data }) => setUnits(data || [])).catch(() => setUnits([]));
    api.get('/products', { params: { limit: 200 } })
      .then(({ data }) => setProducts(data.products || []))
      .catch(() => setProducts([]));
  }, []);

  const openCreate = () => {
    setForm({
      fromUnitId: '',
      toUnitId: user?.unitId || '',
      productId: '',
      quantity: '',
      reason: '',
      notes: '',
    });
    setFormError('');
    setShowCreate(true);
  };

  const submitCreate = async () => {
    setFormError('');
    if (!form.fromUnitId || !form.toUnitId || !form.productId || !form.quantity) {
      return setFormError('From unit, to unit, product and quantity are required.');
    }
    if (form.fromUnitId === form.toUnitId) {
      return setFormError('Source and destination units must be different.');
    }
    const qty = parseFloat(form.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return setFormError('Quantity must be a positive number.');
    }
    setSaving(true);
    try {
      await api.post('/inventory-transfers', {
        fromUnitId: form.fromUnitId,
        toUnitId: form.toUnitId,
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
    if (!confirm('Approve this transfer? The destination unit will then mark it received.')) return;
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

  const complete = async (id) => {
    if (!confirm('Mark as received? This records the stock movement on both sides.')) return;
    try {
      await api.put(`/inventory-transfers/${id}/complete`);
      setDetail(null);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const activeTabMeta = useMemo(() => TABS.find((t) => t.key === tab), [tab]);

  const canApprove = (t) => t.status === 'PENDING' && t.fromUnitId === user?.unitId;
  const canComplete = (t) => t.status === 'APPROVED' && (t.toUnitId === user?.unitId || t.fromUnitId === user?.unitId);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Transfers</h1>
          <p className="text-sm text-gray-500">Request and track stock movements between units.</p>
        </div>
        <Button onClick={openCreate}><Plus size={16} /> New Transfer Request</Button>
      </div>

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
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => setDetail(t)}>
                      {t.transferNumber}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      <span className="text-xs">{t.fromUnit?.code}</span>
                      <span className="mx-1 text-gray-400">→</span>
                      <span className="text-xs">{t.toUnit?.code}</span>
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
            As a Unit Manager, you can only pull stock INTO your own unit. The source unit's Manager must approve.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="From Unit (source)"
              value={form.fromUnitId}
              onChange={(e) => setForm({ ...form, fromUnitId: e.target.value })}
            >
              <option value="">Select source unit…</option>
              {units
                .filter((u) => u.id !== form.toUnitId)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
                ))}
            </Select>
            <Select
              label="To Unit (destination — your unit)"
              value={form.toUnitId}
              onChange={(e) => setForm({ ...form, toUnitId: e.target.value })}
              disabled
            >
              <option value="">Select destination unit…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.code})</option>
              ))}
            </Select>
          </div>

          <Select
            label="Product"
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
          >
            <option value="">Select product…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — stock: {p.currentStock} {p.unit}</option>
            ))}
          </Select>

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
            placeholder="Anything the source unit should know"
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
              <div><span className="text-gray-500">From:</span> <span className="font-medium">{detail.fromUnit?.name} ({detail.fromUnit?.code})</span></div>
              <div><span className="text-gray-500">To:</span> <span className="font-medium">{detail.toUnit?.name} ({detail.toUnit?.code})</span></div>
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
                    <CheckCircle2 size={16} className="mr-1" /> Approve
                  </Button>
                </>
              )}
              {canComplete(detail) && (
                <Button onClick={() => complete(detail.id)}>
                  <PackageCheck size={16} className="mr-1" /> Mark Received
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
