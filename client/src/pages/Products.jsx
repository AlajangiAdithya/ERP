import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Package, Download, FileText, CheckCircle2 } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select } from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';

// Compute days-until-return for a FIM batch's probable return date.
// Returns { label, color } so the FIM Status table can show a red countdown.
function returnCountdown(returnDate) {
  if (!returnDate) return null;
  const target = new Date(returnDate);
  const today = new Date();
  target.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `OVERDUE by ${-diff} day${-diff === 1 ? '' : 's'}`, color: 'red', urgent: true };
  if (diff === 0) return { label: 'Due today', color: 'red', urgent: true };
  if (diff <= 3) return { label: `${diff} day${diff === 1 ? '' : 's'} left`, color: 'red', urgent: true };
  if (diff <= 7) return { label: `${diff} days left`, color: 'orange', urgent: false };
  return { label: `${diff} days left`, color: 'gray', urgent: false };
}

export default function Products() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState('raps'); // 'raps' | 'fim'
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const canEdit = user?.role === 'ADMIN' || user?.role === 'STORE_MANAGER';
  const [downloading, setDownloading] = useState(false);

  // Fetch every product (paginating internally) and emit a CSV stock statement.
  // CSV is opened natively by Excel — no extra dependency needed.
  const downloadStockStatement = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const all = [];
      let p = 1;
      const PAGE = 500;
      // Loop pages until the server returns fewer rows than the page size
      while (true) {
        const { data } = await api.get('/products', {
          params: { page: p, limit: PAGE, search: search || undefined, category: catFilter || undefined, includeUnitStock: 'true' },
        });
        const batch = data.products || [];
        all.push(...batch);
        if (batch.length < PAGE || all.length >= (data.total || 0)) break;
        p += 1;
      }

      const esc = (v) => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const statusOf = (row) => {
        if (Number(row.currentStock) === 0) return 'Out of Stock';
        if (row.minStockLevel > 0 && row.currentStock <= row.minStockLevel) return 'Low Stock';
        return 'Available';
      };
      const ownedBy = (row) => {
        const list = Array.isArray(row.unitStocks) ? row.unitStocks.filter(u => u.quantity > 0) : [];
        return list.map(us => `${us.unit?.name || us.unit?.code || 'Unit'}:${us.quantity}`).join(' | ');
      };
      const header = [
        'SKU', 'Name', 'Category', 'UOM',
        'Current Stock', 'Min Stock Level',
        'Deficit (Min - Current)', 'Status', 'Owned By (Unit:Qty)',
        'Description',
      ];
      const rows = all.map(p => [
        p.sku, p.name, p.category || '', p.unit || '',
        p.currentStock ?? 0,
        p.minStockLevel ?? 0,
        Math.max(0, (p.minStockLevel || 0) - (p.currentStock || 0)),
        statusOf(p),
        ownedBy(p),
        p.description || '',
      ]);
      const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
      // BOM so Excel auto-detects UTF-8 (important for ₹ and accented characters)
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 10);
      a.download = `stock-statement-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Stock statement download failed:', err);
      alert(err?.response?.data?.error || 'Failed to download stock statement');
    } finally {
      setDownloading(false);
    }
  };

  const [form, setForm] = useState({
    name: '', description: '', category: 'Raw Material', unit: 'pcs',
    minStockLevel: 0,
  });
  const [materialTypes, setMaterialTypes] = useState([]);

  const fetchProducts = () => {
    setLoading(true);
    const params = { page, limit: 100, search: search || undefined, category: catFilter || undefined, includeUnitStock: 'true', includeMir: 'true' };
    api.get('/products', { params })
      .then(({ data }) => {
        setProducts(data.products);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); }, [page, search, catFilter]);
  useEffect(() => {
    api.get('/products/categories').then(({ data }) => setCategories(data));
    api.get('/products/material-types').then(({ data }) => setMaterialTypes(data)).catch(() => {});
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const data = {
        ...form,
        minStockLevel: parseFloat(form.minStockLevel) || 0,
      };
      await api.post('/products', data);
      setShowModal(false);
      setForm({ name: '', description: '', category: 'Raw Material', unit: 'pcs', minStockLevel: 0 });
      fetchProducts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create product');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', render: (v) => v || '—' },
    {
      key: 'currentStock', label: 'Total Stock',
      render: (v, row) => (
        <span className="flex items-center gap-2">
          {v} {row.unit}
          {v === 0 ? (
            <Badge color="red">Out</Badge>
          ) : row.minStockLevel > 0 && v <= row.minStockLevel ? (
            <Badge color="yellow">Low</Badge>
          ) : null}
        </span>
      )
    },
    {
      key: 'unitStocks', label: 'Owned by',
      render: (v, row) => {
        const list = Array.isArray(v) ? v.filter(u => u.quantity > 0) : [];
        if (list.length === 0) {
          return <span className="text-xs text-gray-400">Unassigned</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {list.map(us => (
              <span key={us.id} className="text-xs text-gray-700">
                <strong>{us.quantity}</strong> {row.unit} owned by{' '}
                <span className="font-medium text-navy-700">{us.unit?.name || us.unit?.code || 'Unit'}</span>
              </span>
            ))}
          </div>
        );
      }
    },
    {
      // MIR numbers (Material Inward Register) — auto-generated at stores inward on the PO.
      // We surface the most recent few so users can trace which inward batch brought this stock.
      key: 'batches', label: 'MIR No.',
      render: (v) => {
        const list = Array.isArray(v) ? v : [];
        const mirs = [];
        const seen = new Set();
        for (const b of list) {
          const mir = b.sourceQcInspection?.purchaseOrder?.mirNo;
          if (mir && !seen.has(mir)) {
            seen.add(mir);
            mirs.push({ mir, date: b.receivedDate });
          }
        }
        if (mirs.length === 0) return <span className="text-xs text-gray-400">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            {mirs.slice(0, 3).map(m => (
              <span key={m.mir} className="text-xs font-mono text-navy-700" title={new Date(m.date).toLocaleDateString()}>
                {m.mir}
              </span>
            ))}
            {mirs.length > 3 && <span className="text-[10px] text-gray-500">+{mirs.length - 3} more</span>}
          </div>
        );
      },
    },
    { key: 'minStockLevel', label: 'Min Level', render: (v, row) => v > 0 ? `${v} ${row.unit}` : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <div className="flex gap-2">
          {tab === 'raps' && (
            <Button variant="secondary" onClick={downloadStockStatement} disabled={downloading}>
              <Download size={16} /> {downloading ? 'Preparing…' : 'Download Stock Statement'}
            </Button>
          )}
          {canEdit && tab === 'raps' && (
            <Button onClick={() => setShowModal(true)}>
              <Plus size={16} /> Add Product
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        <button
          onClick={() => setTab('raps')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'raps'
              ? 'border-navy-700 text-navy-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          RAPS Products
        </button>
        <button
          onClick={() => setTab('fim')}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'fim'
              ? 'border-navy-700 text-navy-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          FIM Status
        </button>
      </div>

      {tab === 'raps' ? (
        <Card>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="flex-1">
              <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search products..." />
            </div>
            <Select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }} className="w-full sm:w-48">
              <option value="">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <Table columns={columns} data={products} onRowClick={(row) => navigate(`/products/${row.id}`)} />
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </Card>
      ) : (
        <FimStatusView user={user} onOpenProduct={(id) => navigate(`/products/${id}`)} />
      )}

      {/* Add Product Modal — only relevant on RAPS tab */}
      {canEdit && (
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Product" size="lg">
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}
            <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <p className="text-xs text-gray-500 -mt-2">SKU is auto-generated from material type (e.g. RAW-0001, CONS-0001).</p>
            <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-3 gap-4">
              <Select label="Material Type *" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                {(materialTypes.length ? materialTypes : ['Raw Material', 'Consumable', 'Tooling', 'Others']).map(mt => <option key={mt} value={mt}>{mt}</option>)}
              </Select>
              <Select label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {['pcs', 'kg', 'litre', 'meter', 'Sq. mtr', 'box', 'set'].map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
              <Input label="Min Stock Level" type="number" value={form.minStockLevel} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Product'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ──── FIM Status tab ────
// Lists every FIM batch (customer-owned material inwarded via INWARD gate pass)
// with assignment + acceptance controls and a red return-date countdown.
function FimStatusView({ user, onOpenProduct }) {
  const [batches, setBatches] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [assignTarget, setAssignTarget] = useState(null); // { batchId, productName }
  const [acceptTarget, setAcceptTarget] = useState(null); // { batchId, productName }
  const [assigningUnitId, setAssigningUnitId] = useState('');
  const [acceptRemark, setAcceptRemark] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const isStores = user?.role === 'STORE_MANAGER' || user?.role === 'ADMIN';
  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const fetchBatches = () => {
    setLoading(true);
    api.get('/products/fim-status', { params: { search: search || undefined, unitId: unitFilter || undefined } })
      .then(({ data }) => setBatches(data))
      .catch(() => setBatches([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchBatches(); }, [search, unitFilter]);
  useEffect(() => {
    api.get('/units').then(({ data }) => setUnits(Array.isArray(data) ? data : (data.units || []))).catch(() => setUnits([]));
  }, []);

  const submitAssign = async () => {
    setActionError('');
    if (!assigningUnitId) return setActionError('Choose a unit');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${assignTarget.batchId}/assign`, { unitId: assigningUnitId });
      setAssignTarget(null);
      setAssigningUnitId('');
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to assign batch');
    }
    setActionBusy(false);
  };

  const submitAccept = async () => {
    setActionError('');
    if (!acceptRemark.trim()) return setActionError('A remark is required');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${acceptTarget.batchId}/unit-accept`, { remark: acceptRemark.trim() });
      setAcceptTarget(null);
      setAcceptRemark('');
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to accept batch');
    }
    setActionBusy(false);
  };

  return (
    <Card>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} placeholder="Search product, customer, GP no…" />
        </div>
        <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-full sm:w-56">
          <option value="">All units (assigned or not)</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name || u.code}</option>)}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Package size={36} className="mx-auto mb-3 opacity-40" />
          <div className="text-sm">No FIM batches found.</div>
          <div className="text-xs mt-1">FIM appears here after Stores accepts an INWARD gate pass into the product list.</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 1200 }}>
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr className="text-left">
                <th className="px-3 py-2.5 font-medium">Product</th>
                <th className="px-3 py-2.5 font-medium">Customer</th>
                <th className="px-3 py-2.5 font-medium">GP no.</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">PDF</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 font-medium">Return date</th>
                <th className="px-3 py-2.5 font-medium">Countdown</th>
                <th className="px-3 py-2.5 font-medium">Assigned unit</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(b => {
                const cd = returnCountdown(b.sourceInwardGatePassItem?.probableReturnDate);
                const acceptedByThisUnit = b.assignedToUnitId && (user?.role === 'ADMIN' || user?.unitId === b.assignedToUnitId);
                const canAssign = isStores && !b.unitAcceptedAt;
                const canAccept = isManager && b.assignedToUnitId && !b.unitAcceptedAt && acceptedByThisUnit;
                return (
                  <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => onOpenProduct(b.product.id)}
                        className="font-medium text-navy-700 hover:underline text-left"
                      >
                        {b.product.name}
                      </button>
                      <div className="text-xs text-gray-500 font-mono">{b.product.sku}</div>
                    </td>
                    <td className="px-3 py-2.5">{b.sourceInwardGatePass?.customerName || '—'}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {b.sourceInwardGatePass?.customerGatePassNo || '—'}
                      <div className="text-[10px] text-gray-400">RAPS: {b.sourceInwardGatePass?.passNumber}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {b.sourceInwardGatePass?.customerGpDocType ? (
                        <Badge color={b.sourceInwardGatePass.customerGpDocType === 'ORIGINAL' ? 'green' : 'yellow'}>
                          {b.sourceInwardGatePass.customerGpDocType === 'ORIGINAL' ? 'Original' : 'Duplicate'}
                        </Badge>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {b.sourceInwardGatePass?.customerGpPdfUrl ? (
                        <a
                          href={b.sourceInwardGatePass.customerGpPdfUrl}
                          target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-navy-700 hover:underline text-xs"
                        >
                          <FileText size={14} /> View
                        </a>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">{b.quantity} {b.product.unit}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {b.sourceInwardGatePassItem?.probableReturnDate
                        ? new Date(b.sourceInwardGatePassItem.probableReturnDate).toLocaleDateString()
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {cd ? (
                        <span
                          className={`inline-flex items-center text-xs font-semibold ${
                            cd.color === 'red' ? 'text-red-600' :
                            cd.color === 'orange' ? 'text-orange-600' : 'text-gray-500'
                          }`}
                        >
                          {cd.urgent && <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5 animate-pulse" />}
                          {cd.label}
                        </span>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {b.assignedToUnit ? (
                        <span className="font-medium text-navy-700">{b.assignedToUnit.name || b.assignedToUnit.code}</span>
                      ) : <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {b.unitAcceptedAt ? (
                        <Badge color="green">
                          <CheckCircle2 size={12} className="inline mr-1" />Accepted (final)
                        </Badge>
                      ) : b.assignedToUnitId ? (
                        <Badge color="yellow">Awaiting unit accept</Badge>
                      ) : (
                        <Badge color="gray">In stores</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {canAssign && (
                        <button
                          onClick={() => { setAssignTarget({ batchId: b.id, productName: b.product.name }); setAssigningUnitId(b.assignedToUnitId || ''); setActionError(''); }}
                          className="text-xs px-2 py-1 rounded border border-navy-700 text-navy-700 hover:bg-navy-50"
                        >
                          {b.assignedToUnitId ? 'Reassign' : 'Assign to unit'}
                        </button>
                      )}
                      {canAccept && (
                        <button
                          onClick={() => { setAcceptTarget({ batchId: b.id, productName: b.product.name }); setAcceptRemark(''); setActionError(''); }}
                          className="ml-2 text-xs px-2 py-1 rounded bg-navy-700 text-white hover:bg-navy-800"
                        >
                          Accept
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {assignTarget && (
        <Modal isOpen onClose={() => setAssignTarget(null)} title="Assign FIM to unit">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Product: <strong>{assignTarget.productName}</strong>
            </div>
            <Select label="Destination unit *" value={assigningUnitId} onChange={(e) => setAssigningUnitId(e.target.value)}>
              <option value="">Select a unit…</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name || u.code}</option>)}
            </Select>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setAssignTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitAssign} disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Assign'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {acceptTarget && (
        <Modal isOpen onClose={() => setAcceptTarget(null)} title="Accept FIM at unit">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Accepting <strong>{acceptTarget.productName}</strong>. This is final — once accepted, the batch cannot be re-accepted.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Remark *</label>
              <textarea
                rows={3}
                value={acceptRemark}
                onChange={(e) => setAcceptRemark(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="e.g. Received in good condition, stored in Bay 2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setAcceptTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitAccept} disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Accept (final)'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
