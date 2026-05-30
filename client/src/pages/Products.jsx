import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Package, Download, FileText, CheckCircle2,
  Pencil, Send, Building2, Calendar, Truck, User as UserIcon,
  ArrowRightLeft, AlertTriangle, Hash, PackageCheck, RotateCcw,
} from 'lucide-react';
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
import PageHero from '../components/shared/PageHero';

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
  const [sort, setSort] = useState('name'); // 'name' | 'category' | 'id' — default alphabetical
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
        'ID No.', 'Name', 'Category', 'UOM',
        'Current Stock', 'Min Stock Level',
        'Deficit (Min - Current)', 'Status', 'Owned By (Unit:Qty)',
        'Description',
      ];
      const rows = all.map(p => [
        p.materialCode || p.sku || '', p.name, p.category || '', p.unit || '',
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
    materialCode: '', name: '', description: '', category: 'Raw Material', unit: 'pcs',
    minStockLevel: 0,
  });
  const [materialTypes, setMaterialTypes] = useState([]);

  const fetchProducts = () => {
    setLoading(true);
    const params = { page, limit: 100, search: search || undefined, category: catFilter || undefined, sort, includeUnitStock: 'true', includeMir: 'true' };
    api.get('/products', { params })
      .then(({ data }) => {
        setProducts(data.products);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); }, [page, search, catFilter, sort]);
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
        materialCode: form.materialCode.trim() || undefined,
        minStockLevel: parseFloat(form.minStockLevel) || 0,
      };
      await api.post('/products', data);
      setShowModal(false);
      setForm({ materialCode: '', name: '', description: '', category: 'Raw Material', unit: 'pcs', minStockLevel: 0 });
      fetchProducts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create product');
    } finally {
      setSaving(false);
    }
  };

  // Expiry-status colour for the table's Expiry Date column. earliestExpiry comes
  // from the server (computed across all batches with remaining > 0).
  const renderExpiry = (iso) => {
    if (!iso) return <span className="text-xs text-gray-400">—</span>;
    const d = new Date(iso);
    const days = Math.ceil((d - new Date()) / (1000 * 60 * 60 * 24));
    const label = d.toLocaleDateString();
    if (days < 0) return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-red-600 rounded px-2 py-0.5 animate-pulse">
        ⚠ Expired {label}
      </span>
    );
    if (days <= 30) return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-0.5">
        {label} ({days}d)
      </span>
    );
    return <span className="text-xs text-gray-700">{label}</span>;
  };

  const columns = [
    {
      key: 'materialCode', label: 'ID No.', width: 80,
      render: (v, row) => {
        const id = v || row.sku;
        return id ? <span className="text-sm font-semibold text-navy-700">{id}</span> : <span className="text-xs text-gray-400">—</span>;
      },
    },
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
      // Earliest dateOfExpiry across batches with remaining stock. QC fills this
      // on the inspection report; we surface the soonest so stores notice
      // expiring lots before issuing them.
      key: 'earliestExpiry', label: 'Expiry Date', render: (v) => renderExpiry(v),
    },
    { key: 'minStockLevel', label: 'Min Level', render: (v, row) => v > 0 ? `${v} ${row.unit}` : '—' },
  ];

  return (
    <div className="space-y-6">
      <PageHero
        title="Products"
        subtitle="Browse the product catalogue, stock levels, and FIM lifecycle across all units."
        eyebrow="Product Catalogue"
        icon={Package}
        actions={
          <>
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
          </>
        }
      />

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
            <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="w-full sm:w-48">
              <option value="name">Sort: Alphabetical (A–Z)</option>
              <option value="category">Sort: Category</option>
              <option value="id">Sort: ID No.</option>
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
            <Input
              label="ID No. *"
              value={form.materialCode}
              onChange={(e) => setForm({ ...form, materialCode: e.target.value })}
              placeholder="e.g. 1000"
              required
            />
            <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-3 gap-4">
              <Select label="Material Type *" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                {(materialTypes.length ? materialTypes : ['Raw Material', 'Consumable', 'Hand Tools & Fastners', 'Tools & Fixtures', 'Others']).map(mt => <option key={mt} value={mt}>{mt}</option>)}
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
  const [editRemarkTarget, setEditRemarkTarget] = useState(null); // { batchId, productName, existing }
  const [readyTarget, setReadyTarget] = useState(null); // batch (unit manager marks ready)
  const [sendOutTarget, setSendOutTarget] = useState(null); // batch (stores ships)
  const [assigningUnitId, setAssigningUnitId] = useState('');
  const [acceptRemark, setAcceptRemark] = useState('');
  const [editRemarkText, setEditRemarkText] = useState('');
  const [readyNote, setReadyNote] = useState('');
  const [sendOutForm, setSendOutForm] = useState({ vehicleNo: '', driverName: '', remarks: '' });
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [flash, setFlash] = useState('');

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

  const submitRemarkEdit = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${editRemarkTarget.batchId}/remarks`, { remark: editRemarkText });
      setEditRemarkTarget(null);
      setEditRemarkText('');
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to save remark');
    }
    setActionBusy(false);
  };

  const submitMarkReady = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      await api.put(`/gatepasses/fim-batches/${readyTarget.id}/mark-ready`, { note: readyNote.trim() || undefined });
      setReadyTarget(null);
      setReadyNote('');
      setFlash('Marked Ready to Collect — Stores has been notified.');
      setTimeout(() => setFlash(''), 6000);
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to mark ready');
    }
    setActionBusy(false);
  };

  const withdrawReady = async (batch) => {
    if (!window.confirm(`Withdraw the "ready to send out" flag on ${batch.product.name}?`)) return;
    try {
      await api.put(`/gatepasses/fim-batches/${batch.id}/unmark-ready`);
      fetchBatches();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to withdraw ready flag');
    }
  };

  const submitSendOut = async () => {
    setActionError('');
    setActionBusy(true);
    try {
      const { data } = await api.post(
        `/gatepasses/fim-batches/${sendOutTarget.id}/send-out`,
        {
          vehicleNo: sendOutForm.vehicleNo.trim() || undefined,
          driverName: sendOutForm.driverName.trim() || undefined,
          remarks: sendOutForm.remarks.trim() || undefined,
        },
      );
      setSendOutTarget(null);
      setSendOutForm({ vehicleNo: '', driverName: '', remarks: '' });
      setFlash(`Return gate pass ${data.passNumber} created — pending Store Incharge.`);
      setTimeout(() => setFlash(''), 8000);
      fetchBatches();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Failed to create return gate pass');
    }
    setActionBusy(false);
  };

  // Section divider style — used between column groups in the table header
  const groupBorder = 'border-r-2 border-navy-300';

  return (
    <Card>
      {/* Filter + register banner */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <SearchBar value={search} onChange={setSearch} placeholder="Search product, customer, GP no…" />
          </div>
          <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-full sm:w-56">
            <option value="">All units (assigned or not)</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.name || u.code}</option>)}
          </Select>
        </div>
        {flash && (
          <div className="px-3 py-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded flex items-center gap-2">
            <CheckCircle2 size={16} /> {flash}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : batches.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Package size={36} className="mx-auto mb-3 opacity-40" />
          <div className="text-sm">No FIM batches found.</div>
          <div className="text-xs mt-1">FIM appears here after Stores records an INWARD gate pass.</div>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden shadow-sm">
          {/* Register title bar */}
          <div className="px-4 py-3 bg-gradient-to-r from-navy-700 to-navy-800 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={16} className="opacity-90" />
              <h3 className="font-semibold tracking-wide text-sm">FIM / Customer Property Register</h3>
            </div>
            <div className="text-[11px] text-navy-100 font-medium">
              {batches.length} batch{batches.length === 1 ? '' : 'es'}
            </div>
          </div>

          {/* Scrollable table */}
          <div className="overflow-x-auto bg-white">
            <table className="w-full text-xs" style={{ minWidth: 2000 }}>
              <thead>
                {/* Grouping row (visual headers above the columns) */}
                <tr className="bg-navy-50 text-navy-700 border-b border-navy-200">
                  <th colSpan={5} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Hash size={11} /> Inward Details</span>
                  </th>
                  <th colSpan={4} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Package size={11} /> Item</span>
                  </th>
                  <th colSpan={3} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Calendar size={11} /> Return Tracking</span>
                  </th>
                  <th colSpan={2} className={`px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${groupBorder}`}>
                    <span className="flex items-center gap-1.5"><Building2 size={11} /> Unit</span>
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800">
                    <span className="flex items-center gap-1.5"><Pencil size={11} /> Remarks (live)</span>
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider">Actions</th>
                </tr>

                {/* Column headers */}
                <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
                  <th className="px-3 py-2 font-medium text-left">FIM No.</th>
                  <th className="px-3 py-2 font-medium text-left">Date</th>
                  <th className="px-3 py-2 font-medium text-left">Vehicle / Driver</th>
                  <th className="px-3 py-2 font-medium text-left">Cust. GP Type</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Cust. GP No.</th>

                  <th className="px-3 py-2 font-medium text-left">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Quantity</th>
                  <th className="px-3 py-2 font-medium text-left">Customer</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Purpose / Pass Type</th>

                  <th className="px-3 py-2 font-medium text-left">Probable Return</th>
                  <th className="px-3 py-2 font-medium text-left">Returned On</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Return Vehicle / Driver</th>

                  <th className="px-3 py-2 font-medium text-left">Assigned Unit</th>
                  <th className={`px-3 py-2 font-medium text-left ${groupBorder}`}>Status</th>

                  <th className="px-3 py-2 font-medium text-left bg-amber-50/40" style={{ minWidth: 340 }}>Notes</th>
                  <th className="px-3 py-2 font-medium text-left" style={{ minWidth: 180 }}>—</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b, rowIdx) => {
                  const gp = b.sourceInwardGatePass || {};
                  const it = b.sourceInwardGatePassItem || {};
                  const cd = returnCountdown(it.probableReturnDate);
                  const acceptedByThisUnit = b.assignedToUnitId && (user?.role === 'ADMIN' || user?.unitId === b.assignedToUnitId);
                  const canAssign = isStores && !b.unitAcceptedAt;
                  const canAccept = isManager && b.assignedToUnitId && !b.unitAcceptedAt && acceptedByThisUnit;
                  const canEditRemark = isStores
                    || (user?.role === 'MANAGER' && user?.unitId && user.unitId === b.assignedToUnitId);
                  const isReturnable = it.itemPassType === 'RETURNABLE';
                  // outwardLinkedItems is the array of OUTWARD DC items linked back to this inward item.
                  const outwardLinks = Array.isArray(it.outwardLinkedItems) ? it.outwardLinkedItems : [];
                  const lastOutward = outwardLinks[0]?.gatePass;
                  const alreadySentOut = outwardLinks.length > 0;
                  const isReady = !!b.readyToSendOutAt;
                  // Unit manager (or admin) marks the FIM ready first.
                  const canMarkReady = isReturnable
                    && b.unitAcceptedAt
                    && !isReady
                    && !alreadySentOut
                    && (user?.role === 'ADMIN' || (user?.role === 'MANAGER' && user?.unitId === b.assignedToUnitId));
                  // Unit manager (or admin) can withdraw the flag until Stores ships.
                  const canWithdrawReady = isReady
                    && !alreadySentOut
                    && (user?.role === 'ADMIN' || (user?.role === 'MANAGER' && user?.unitId === b.assignedToUnitId));
                  // Stores can only send out after the unit marks ready.
                  const canSendOut = isReturnable
                    && b.unitAcceptedAt
                    && isReady
                    && !alreadySentOut
                    && isStores;

                  return (
                    <tr
                      key={b.id}
                      className={`border-b border-gray-100 hover:bg-blue-50/20 align-top transition-colors ${
                        rowIdx % 2 === 1 ? 'bg-gray-50/40' : ''
                      } ${cd?.urgent ? 'ring-1 ring-inset ring-red-100' : ''}`}
                    >
                      {/* ── Inward Details ── */}
                      <td className="px-3 py-3">
                        <div className="font-mono text-[11px] font-bold text-navy-700">
                          {gp.fimNumber || <span className="text-gray-400 font-normal">—</span>}
                        </div>
                        {gp.passNumber && (
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">{gp.passNumber}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-700">
                        {gp.date ? (
                          <div className="text-[11px]">{new Date(gp.date).toLocaleDateString()}</div>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-[11px] text-gray-800 flex items-center gap-1">
                          <Truck size={11} className="text-gray-400" />
                          {gp.vehicleNo || <span className="text-gray-400">—</span>}
                        </div>
                        {gp.driverName && (
                          <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                            <UserIcon size={9} /> {gp.driverName}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {gp.customerGpDocType ? (
                          <Badge color={gp.customerGpDocType === 'ORIGINAL' ? 'green' : 'yellow'}>
                            {gp.customerGpDocType === 'ORIGINAL' ? 'Original' : 'Duplicate'}
                          </Badge>
                        ) : <span className="text-gray-400 text-[11px]">—</span>}
                      </td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        <div className="font-mono text-[11px] text-gray-800">{gp.customerGatePassNo || '—'}</div>
                        {gp.customerGatePassDate && (
                          <div className="text-[10px] text-gray-500 mt-0.5">{new Date(gp.customerGatePassDate).toLocaleDateString()}</div>
                        )}
                        {gp.customerGpPdfUrl && (
                          <a
                            href={gp.customerGpPdfUrl} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-navy-700 hover:underline text-[10px] mt-0.5"
                          >
                            <FileText size={10} /> View PDF
                          </a>
                        )}
                      </td>

                      {/* ── Item ── */}
                      <td className="px-3 py-3">
                        <button
                          onClick={() => onOpenProduct(b.product.id)}
                          className="font-medium text-navy-700 hover:underline text-left text-[12px]"
                        >
                          {b.product.name}
                        </button>
                        <div className="text-[10px] text-gray-500 font-mono mt-0.5">{b.product.sku}</div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="font-semibold text-gray-900 text-[12px]">{b.quantity}</span>
                        <span className="text-[10px] text-gray-500 ml-1">{b.product.unit}</span>
                      </td>
                      <td className="px-3 py-3 text-[11px] text-gray-800">{gp.customerName || '—'}</td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        <div className="text-[11px] text-gray-700">{it.itemPurpose || '—'}</div>
                        {it.itemPassType && (
                          <Badge color={isReturnable ? 'blue' : 'gray'} className="mt-1">
                            {it.itemPassType === 'RETURNABLE' ? 'Returnable' : 'Non-Returnable'}
                          </Badge>
                        )}
                      </td>

                      {/* ── Return Tracking ── */}
                      <td className="px-3 py-3">
                        {it.probableReturnDate ? (
                          <div className="text-[11px] text-gray-800">{new Date(it.probableReturnDate).toLocaleDateString()}</div>
                        ) : <span className="text-gray-400 text-[11px]">—</span>}
                        {cd && (
                          <div
                            className={`mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              cd.color === 'red' ? 'bg-red-50 text-red-700 border border-red-200' :
                              cd.color === 'orange' ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                              'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {cd.urgent && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                            {cd.label}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {lastOutward?.actualReturnDate ? (
                          <div className="text-[11px] text-green-700 font-medium">
                            {new Date(lastOutward.actualReturnDate).toLocaleDateString()}
                          </div>
                        ) : lastOutward ? (
                          <div className="text-[10px] text-blue-700">In transit</div>
                        ) : (
                          <span className="text-gray-400 text-[11px]">—</span>
                        )}
                        {lastOutward?.passNumber && (
                          <div className="text-[10px] text-gray-500 font-mono mt-0.5">{lastOutward.passNumber}</div>
                        )}
                      </td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        {lastOutward?.vehicleNo ? (
                          <>
                            <div className="text-[11px] text-gray-800 flex items-center gap-1">
                              <Truck size={11} className="text-gray-400" /> {lastOutward.vehicleNo}
                            </div>
                            {lastOutward.driverName && (
                              <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                                <UserIcon size={9} /> {lastOutward.driverName}
                              </div>
                            )}
                          </>
                        ) : <span className="text-gray-400 text-[11px]">—</span>}
                      </td>

                      {/* ── Unit ── */}
                      <td className="px-3 py-3">
                        {b.assignedToUnit ? (
                          <span className="inline-flex items-center gap-1 font-medium text-navy-700 text-[11px]">
                            <Building2 size={11} />
                            {b.assignedToUnit.name || b.assignedToUnit.code}
                          </span>
                        ) : <span className="text-gray-400 text-[11px]">Unassigned</span>}
                      </td>
                      <td className={`px-3 py-3 ${groupBorder}`}>
                        {b.unitAcceptedAt ? (
                          <Badge color="green"><CheckCircle2 size={10} className="inline mr-0.5" />Accepted</Badge>
                        ) : b.assignedToUnitId ? (
                          <Badge color="yellow">Awaiting</Badge>
                        ) : (
                          <Badge color="gray">In stores</Badge>
                        )}
                        {isReady && !alreadySentOut && (
                          <div className="mt-1">
                            <Badge color="amber"><PackageCheck size={10} className="inline mr-0.5" />Ready to Collect</Badge>
                          </div>
                        )}
                        {alreadySentOut && (
                          <div className="mt-1">
                            <Badge color="blue"><ArrowRightLeft size={10} className="inline mr-0.5" />Sent out</Badge>
                          </div>
                        )}
                      </td>

                      {/* ── Remarks (live, editable) ── */}
                      <td className="px-3 py-3 bg-amber-50/30 align-top" style={{ minWidth: 340 }}>
                        <div className="relative">
                          <div className="text-[11px] text-gray-700 whitespace-pre-wrap min-h-[1.25rem] pr-7">
                            {b.unitAcceptedRemarks ? (
                              <span>{b.unitAcceptedRemarks}</span>
                            ) : it.remarks ? (
                              <span className="text-gray-500 italic">{it.remarks}</span>
                            ) : (
                              <span className="text-gray-400 italic">No remarks yet…</span>
                            )}
                          </div>
                          {canEditRemark && (
                            <button
                              onClick={() => {
                                setEditRemarkTarget({ batchId: b.id, productName: b.product.name, existing: b.unitAcceptedRemarks || '' });
                                setEditRemarkText(b.unitAcceptedRemarks || '');
                                setActionError('');
                              }}
                              title="Edit remark"
                              className="absolute top-0 right-0 p-1 rounded hover:bg-amber-100 text-amber-700"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {b.unitAcceptedBy?.name && (
                            <div className="text-[9px] text-gray-500 mt-1 flex items-center gap-1">
                              <CheckCircle2 size={9} className="text-green-600" />
                              Accepted by {b.unitAcceptedBy.name}
                              {b.unitAcceptedAt && ` · ${new Date(b.unitAcceptedAt).toLocaleDateString()}`}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* ── Actions ── */}
                      <td className="px-3 py-3 whitespace-nowrap align-top">
                        <div className="flex flex-col gap-1.5">
                          {canAssign && (
                            <button
                              onClick={() => { setAssignTarget({ batchId: b.id, productName: b.product.name }); setAssigningUnitId(b.assignedToUnitId || ''); setActionError(''); }}
                              className="text-[11px] px-2 py-1 rounded border border-navy-700 text-navy-700 hover:bg-navy-50"
                            >
                              {b.assignedToUnitId ? 'Reassign' : 'Assign'}
                            </button>
                          )}
                          {canAccept && (
                            <button
                              onClick={() => { setAcceptTarget({ batchId: b.id, productName: b.product.name }); setAcceptRemark(''); setActionError(''); }}
                              className="text-[11px] px-2 py-1 rounded bg-navy-700 text-white hover:bg-navy-800"
                            >
                              Accept
                            </button>
                          )}
                          {canMarkReady && (
                            <button
                              onClick={() => { setReadyTarget(b); setReadyNote(''); setActionError(''); }}
                              className="text-[11px] px-2 py-1 rounded bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1 justify-center"
                            >
                              <PackageCheck size={11} /> Ready to Collect
                            </button>
                          )}
                          {canWithdrawReady && (
                            <button
                              onClick={() => withdrawReady(b)}
                              className="text-[11px] px-2 py-1 rounded border border-amber-500 text-amber-700 hover:bg-amber-50 inline-flex items-center gap-1 justify-center"
                            >
                              <RotateCcw size={11} /> Withdraw
                            </button>
                          )}
                          {canSendOut && (
                            <button
                              onClick={() => {
                                setSendOutTarget(b);
                                setSendOutForm({ vehicleNo: gp.vehicleNo || '', driverName: gp.driverName || '', remarks: '' });
                                setActionError('');
                              }}
                              className="text-[11px] px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1 justify-center"
                            >
                              <Send size={11} /> Send Out
                            </button>
                          )}
                          {alreadySentOut && !canSendOut && (
                            <span className="text-[10px] text-blue-700 inline-flex items-center gap-1">
                              <ArrowRightLeft size={10} /> {lastOutward?.passNumber}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-[10px] text-gray-500 flex items-center gap-2">
            <AlertTriangle size={11} className="text-amber-500" />
            Unit managers can update Remarks at any time. Acceptance is one-shot and final.
          </div>
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
              Accepting <strong>{acceptTarget.productName}</strong>. This is final — once accepted, the batch cannot be re-accepted (you can still edit Remarks afterwards).
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

      {editRemarkTarget && (
        <Modal isOpen onClose={() => setEditRemarkTarget(null)} title="Edit FIM remark">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Product: <strong>{editRemarkTarget.productName}</strong>
            </div>
            <p className="text-xs text-gray-500">
              Remarks are visible to Stores and any unit. You can update them at any time without losing the acceptance state.
            </p>
            <textarea
              rows={5}
              value={editRemarkText}
              onChange={(e) => setEditRemarkText(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
              placeholder="e.g. Bay 2, condition good, scheduled for grinding on Friday"
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setEditRemarkTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitRemarkEdit} disabled={actionBusy}>{actionBusy ? 'Saving…' : 'Save Remark'}</Button>
            </div>
          </div>
        </Modal>
      )}

      {sendOutTarget && (
        <Modal isOpen onClose={() => setSendOutTarget(null)} title="Send FIM back to customer" size="lg">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}

            <div className="p-3 rounded-md bg-blue-50 border border-blue-200 text-sm space-y-1">
              <div className="flex items-center gap-2 text-blue-900 font-medium">
                <ArrowRightLeft size={14} /> Same gate-pass cycle
              </div>
              <p className="text-xs text-blue-800">
                This creates an OUTWARD gate pass (Delivery Challan) linked back to
                FIM <strong className="font-mono">{sendOutTarget.sourceInwardGatePass?.fimNumber || sendOutTarget.sourceInwardGatePass?.passNumber}</strong>{' '}
                so the cycle closes against the same record.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">Customer</div>
                <div className="font-medium">{sendOutTarget.sourceInwardGatePass?.customerName || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Cust. GP No.</div>
                <div className="font-mono text-[12px]">{sendOutTarget.sourceInwardGatePass?.customerGatePassNo || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Item</div>
                <div className="font-medium">{sendOutTarget.product?.name}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Quantity</div>
                <div className="font-medium">{sendOutTarget.quantity} {sendOutTarget.product?.unit}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Vehicle No." value={sendOutForm.vehicleNo} onChange={(e) => setSendOutForm({ ...sendOutForm, vehicleNo: e.target.value })} placeholder="e.g. AP 31 CD 1234" />
              <Input label="Driver name" value={sendOutForm.driverName} onChange={(e) => setSendOutForm({ ...sendOutForm, driverName: e.target.value })} placeholder="Driver's full name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Send-out remarks</label>
              <textarea
                rows={3}
                value={sendOutForm.remarks}
                onChange={(e) => setSendOutForm({ ...sendOutForm, remarks: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="Optional — e.g. Returned after grinding; packed in original crate"
              />
            </div>

            <p className="text-[11px] text-gray-500">
              The Store Incharge will arrange vehicle confirmation and Accounts will give final approval, same as a standard gate pass.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setSendOutTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitSendOut} disabled={actionBusy}>
                <Send size={14} /> {actionBusy ? 'Creating…' : 'Create Return Gate Pass'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {readyTarget && (
        <Modal isOpen onClose={() => setReadyTarget(null)} title="Mark FIM ready to collect">
          <div className="space-y-4">
            {actionError && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{actionError}</div>}
            <div className="text-sm text-gray-700">
              Marking <strong>{readyTarget.product?.name}</strong> ready for Stores to collect from your unit. Stores will be notified immediately.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Note for Stores (optional)</label>
              <textarea
                rows={3}
                value={readyNote}
                onChange={(e) => setReadyNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                placeholder="e.g. Work complete, packed in original crate, available after 4 PM"
              />
            </div>
            <p className="text-[11px] text-gray-500">
              You can withdraw this flag any time before Stores creates the return gate pass.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
              <Button variant="secondary" onClick={() => setReadyTarget(null)} disabled={actionBusy}>Cancel</Button>
              <Button onClick={submitMarkReady} disabled={actionBusy}>
                <PackageCheck size={14} /> {actionBusy ? 'Saving…' : 'Mark Ready to Collect'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
