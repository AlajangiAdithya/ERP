import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus, Package, Download, Pencil, AlertTriangle, Trash2,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { canEditProductDetails, canEditAnyProductDetails, STORE_PRODUCT_EDIT_UNTIL } from '../utils/roles';
import ProductMasterData from './ProductMasterData';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select } from '../components/ui/Input';
import { UOM_OPTIONS } from '../utils/units';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';
import PageHero from '../components/shared/PageHero';

export default function Products() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Master Data lives here as a second tab. Same viewers as the old standalone
  // screen; editing is restricted to Unit 1–5 managers (+ Admin).
  // (The FIM Status register moved to the Gate Pass page — a FIM arrives and
  // leaves on gate passes, so its lifecycle belongs with those registers.)
  const canSeeMasterData = ['ADMIN', 'MANAGER', 'QC', 'SUPERADMIN'].includes(user?.role);
  // Honor ?tab=master so the dedicated master-data page's "Back to Master Data"
  // link (and any deep link) lands on the right tab.
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'master' && canSeeMasterData ? 'master' : 'raps';
  const [tab, setTab] = useState(initialTab); // 'raps' | 'master'
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

  // Adding products + specs/MSDS stays on the Master Data screen (owned by Unit
  // 1–5 managers + QC). The Add Product button here remains master-only.
  const canEdit = false;
  // TEMPORARY (new-system rollout): Stores can edit a product's *details* — ID No.,
  // name, material type, specification, shelf life, storage temp — straight from
  // this list. Never stock numbers. Auto-expires (STORE_PRODUCT_EDIT_UNTIL); every
  // change is logged to the product's Edit History (visible on its detail page).
  // Whether the Edit column exists at all. Who may edit WHICH product is decided
  // per row below: master owners edit anything, everyone else only the materials
  // they themselves added to master data.
  const canEditDetails = canEditAnyProductDetails(user);
  const isStoreTempEditor = user?.role === 'STORE_MANAGER' && canEditProductDetails(user, null);
  const [downloading, setDownloading] = useState(false);

  // Inline product-detail edit (master owners + Stores during the rollout window).
  const blankEditForm = { materialCode: '', name: '', category: '', unit: 'pcs', description: '', shelfLife: '', storageTemp: '' };
  const [editTarget, setEditTarget] = useState(null); // the product row being edited
  const [editForm, setEditForm] = useState(blankEditForm);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const openEditDetails = (row) => {
    setEditTarget(row);
    setEditForm({
      materialCode: row.materialCode || row.sku || '',
      name: row.name || '',
      category: row.category || '',
      unit: row.unit || 'pcs',
      description: row.description || '',
      shelfLife: row.shelfLife || '',
      storageTemp: row.storageTemp || '',
    });
    setEditError('');
  };

  const saveEditDetails = async (e) => {
    e.preventDefault();
    if (!editForm.materialCode.trim()) { setEditError('ID No. is required'); return; }
    if (!editForm.name.trim()) { setEditError('Name is required'); return; }
    setEditSaving(true);
    setEditError('');
    try {
      await api.put(`/products/${editTarget.id}`, {
        materialCode: editForm.materialCode.trim(),
        name: editForm.name.trim(),
        category: editForm.category || undefined,
        unit: editForm.unit || undefined,
        description: editForm.description.trim() || null,
        shelfLife: editForm.shelfLife.trim() || null,
        storageTemp: editForm.storageTemp.trim() || null,
      });
      setEditTarget(null);
      fetchProducts();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to save product details');
    } finally {
      setEditSaving(false);
    }
  };

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
        const units = Array.isArray(row.unitStocks) ? row.unitStocks.filter(u => u.quantity > 0) : [];
        const depts = Array.isArray(row.deptStocks) ? row.deptStocks.filter(d => d.quantity > 0) : [];
        return [
          ...units.map(us => `${us.unit?.name || us.unit?.code || 'Unit'}:${us.quantity}`),
          ...depts.map(d => `${d.dept} (dept):${d.quantity}`),
        ].join(' | ');
      };
      const header = [
        'ID No.', 'Name', 'Category', 'UOM',
        'Current Stock', 'Min Stock Level',
        'Deficit (Min - Current)', 'Status', 'Owned By (Unit/Dept:Qty)',
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

  // New products are entered as a list — Stores usually adds several items at
  // once, so the modal starts with one blank row and grows via "Add More Items".
  const blankItem = () => ({
    materialCode: '', name: '', description: '', category: 'Raw Material', unit: 'pcs',
    minStockLevel: 0,
  });
  const [items, setItems] = useState([blankItem()]);
  const [materialTypes, setMaterialTypes] = useState([]);

  const updateItem = (idx, patch) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const openAddModal = () => { setItems([blankItem()]); setFormError(''); setShowModal(true); };

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
    // Ignore fully-blank trailing rows; validate the rest.
    const filled = items.filter((it) => it.materialCode.trim() || it.name.trim());
    if (!filled.length) { setFormError('Add at least one product'); return; }
    for (let i = 0; i < filled.length; i += 1) {
      if (!filled[i].materialCode.trim()) { setFormError(`Item ${i + 1}: ID No. is required`); return; }
      if (!filled[i].name.trim()) { setFormError(`Item ${i + 1}: Name is required`); return; }
    }
    setSaving(true);
    try {
      const payload = {
        items: filled.map((it) => ({
          ...it,
          materialCode: it.materialCode.trim(),
          name: it.name.trim(),
          minStockLevel: parseFloat(it.minStockLevel) || 0,
        })),
      };
      await api.post('/products/bulk', payload);
      setShowModal(false);
      setItems([blankItem()]);
      fetchProducts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create products');
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
        const units = Array.isArray(v) ? v.filter(u => u.quantity > 0) : [];
        // Department ownership (QC, Designs, Safety, …) for stock from non-unit PRs.
        const depts = Array.isArray(row.deptStocks) ? row.deptStocks.filter(d => d.quantity > 0) : [];
        if (units.length === 0 && depts.length === 0) {
          return <span className="text-xs text-gray-400">Unassigned</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {units.map(us => (
              <span key={us.id} className="text-xs text-gray-700">
                <strong>{us.quantity}</strong> {row.unit} owned by{' '}
                <span className="font-medium text-navy-700">{us.unit?.name || us.unit?.code || 'Unit'}</span>
              </span>
            ))}
            {depts.map(d => (
              <span key={`dept:${d.dept}`} className="text-xs text-gray-700">
                <strong>{d.quantity}</strong> {row.unit} owned by{' '}
                <span className="font-medium text-purple-700">{d.dept}</span>
                <span className="text-gray-400"> (dept)</span>
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
    {
      // Storage handling — shown to everyone, edited by Stores (pencil column).
      key: 'shelfLife', label: 'Shelf Life',
      render: (v) => v ? <span className="text-sm text-gray-700">{v}</span> : <span className="text-xs text-gray-400">—</span>,
    },
    {
      key: 'storageTemp', label: 'Room Temp',
      render: (v) => v ? <span className="text-sm text-gray-700">{v}</span> : <span className="text-xs text-gray-400">—</span>,
    },
  ];

  // Inline edit affordance for the product's details — drawn only on the rows
  // this user may actually edit (the server enforces the same rule). Edits are
  // logged to the product's Edit History.
  const tableColumns = canEditDetails
    ? [
        ...columns,
        {
          key: 'detailEdit', label: '', width: 70,
          render: (_v, row) => (canEditProductDetails(user, row) ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openEditDetails(row); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-900"
              title="Edit product details"
            >
              <Pencil size={13} /> Edit
            </button>
          ) : null),
        },
      ]
    : columns;

  return (
    <div className="space-y-6">
      <PageHero
        title="Stock Details"
        subtitle="Current stock, batches, per-unit balances and product master data — all in one place."
        eyebrow="Stock Details"
        icon={Package}
        actions={
          <>
            {tab === 'raps' && (
              <Button variant="secondary" onClick={downloadStockStatement} disabled={downloading}>
                <Download size={16} /> {downloading ? 'Preparing…' : 'Download Stock Statement'}
              </Button>
            )}
            {canEdit && tab === 'raps' && (
              <Button onClick={openAddModal}>
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
        {canSeeMasterData && (
          <button
            onClick={() => setTab('master')}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'master'
                ? 'border-navy-700 text-navy-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Master Data
          </button>
        )}
      </div>

      {tab === 'raps' ? (
        <Card>
          {isStoreTempEditor && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                <strong>Temporary edit access.</strong> You can correct a product's details
                (ID No., name, material type, specification, shelf life, storage temp) using the
                <span className="inline-flex items-center gap-0.5 font-medium"> <Pencil size={11} /> Edit</span> button — stock numbers can't be changed here.
                Every change is recorded in that product's <strong>Edit History</strong> (open the product to see it).
                This access ends on {STORE_PRODUCT_EDIT_UNTIL.toLocaleDateString()}.
              </span>
            </div>
          )}
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
              <Table columns={tableColumns} data={products} onRowClick={(row) => navigate(`/products/${row.id}`)} />
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </>
          )}
        </Card>
      ) : (
        <ProductMasterData embedded />
      )}

      {/* Add Product(s) Modal — enter one or many items in one go */}
      {canEdit && (
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Products" size="lg">
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}

            <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
              {items.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-gray-200 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-red"
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    )}
                  </div>
                  <Input
                    label="ID No. *"
                    value={item.materialCode}
                    onChange={(e) => updateItem(idx, { materialCode: e.target.value })}
                    placeholder="e.g. 1000"
                  />
                  <Input label="Name *" value={item.name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
                  <Input label="Description" value={item.description} onChange={(e) => updateItem(idx, { description: e.target.value })} />
                  <div className="grid grid-cols-3 gap-4">
                    <Select label="Material Type *" value={item.category} onChange={(e) => updateItem(idx, { category: e.target.value })}>
                      {(materialTypes.length ? materialTypes : ['Raw Material', 'Consumable', 'Hand Tools', 'Fasteners', 'Tools & Fixtures', 'Machinery', 'Stationery', 'Others']).map(mt => <option key={mt} value={mt}>{mt}</option>)}
                    </Select>
                    <Select label="Unit" value={item.unit} onChange={(e) => updateItem(idx, { unit: e.target.value })}>
                      {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                    </Select>
                    <Input label="Min Stock Level" type="number" value={item.minStockLevel} onChange={(e) => updateItem(idx, { minStockLevel: e.target.value })} />
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-700 hover:text-navy-900"
            >
              <Plus size={16} /> Add More Items
            </button>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : items.length > 1 ? `Create ${items.length} Products` : 'Create Product'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit product details (master owners + Stores temporary access).
          Stock numbers are intentionally absent — only descriptive details. */}
      {editTarget && canEditProductDetails(user, editTarget) && (
        <Modal isOpen onClose={() => setEditTarget(null)} title={`Edit details — ${editTarget.name}`} size="lg">
          <form onSubmit={saveEditDetails} className="space-y-4">
            {editError && <p className="text-sm text-brand-red">{editError}</p>}
            <p className="text-xs text-gray-500">
              Editing the product's details only. Stock quantities aren't changed here, and every
              change is saved to this product's <strong>Edit History</strong>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="ID No. *"
                value={editForm.materialCode}
                onChange={(e) => setEditForm((f) => ({ ...f, materialCode: e.target.value }))}
                placeholder="e.g. 1000"
              />
              <Input
                label="Name *"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                label="Material Type"
                value={editForm.category}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
              >
                <option value="">—</option>
                {(materialTypes.length ? materialTypes : ['Raw Material', 'Consumable', 'Hand Tools', 'Fasteners', 'Tools & Fixtures', 'Machinery', 'Stationery', 'Others']).map((mt) => <option key={mt} value={mt}>{mt}</option>)}
              </Select>
              <Select
                label="Unit (UOM)"
                value={editForm.unit}
                onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
              >
                {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Specification / Description</label>
              <textarea
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Material specification details (grade, dimensions, standard…)"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Shelf Life"
                value={editForm.shelfLife}
                onChange={(e) => setEditForm((f) => ({ ...f, shelfLife: e.target.value }))}
                placeholder="e.g. 12 months from manufacture"
              />
              <Input
                label="Room / Storage Temperature"
                value={editForm.storageTemp}
                onChange={(e) => setEditForm((f) => ({ ...f, storageTemp: e.target.value }))}
                placeholder="e.g. 2–8°C, store dry"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save details'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
