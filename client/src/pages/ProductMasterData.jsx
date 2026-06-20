import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Package, Pencil, FileText, Trash2, Upload, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { isProductMasterEditor } from '../utils/roles';
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

const blankForm = () => ({
  materialCode: '', name: '', description: '', category: 'Raw Material', unit: 'pcs',
  shelfLife: '', storageTemp: '',
});

// `embedded` renders this inside the Stock Details "Master Data" tab — it drops
// the standalone PageHero (Stock Details already shows one) and exposes the Add
// Product action in a compact bar instead.
export default function ProductMasterData({ embedded = false }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = isProductMasterEditor(user);

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [sort, setSort] = useState('name');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [materialTypes, setMaterialTypes] = useState([]);

  // Create / edit modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [editTarget, setEditTarget] = useState(null); // existing product being edited
  const [editSpecs, setEditSpecs] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchProducts = useCallback(() => {
    setLoading(true);
    const params = {
      page, limit: 100,
      search: search || undefined,
      category: catFilter || undefined,
      sort: pendingOnly ? 'recent' : sort,
      masterData: pendingOnly ? 'pending' : undefined,
    };
    api.get('/products', { params })
      .then(({ data }) => {
        setProducts(data.products || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      })
      .finally(() => setLoading(false));
  }, [page, search, catFilter, sort, pendingOnly]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => {
    api.get('/products/categories').then(({ data }) => setCategories(data)).catch(() => {});
    api.get('/products/material-types').then(({ data }) => setMaterialTypes(data)).catch(() => {});
  }, []);

  const typeOptions = materialTypes.length ? materialTypes
    : ['Raw Material', 'Consumable', 'Hand Tools & Fastners', 'Tools & Fixtures', 'Stationery', 'Others'];

  const openCreate = () => { setForm(blankForm()); setFormError(''); setShowCreate(true); };

  const refreshEditTarget = async (id) => {
    const { data } = await api.get(`/products/${id}`);
    setEditTarget(data);
    setEditSpecs(Array.isArray(data.specs) ? data.specs : []);
  };

  const openEdit = async (row) => {
    setFormError('');
    setForm({
      materialCode: row.materialCode || row.sku || '',
      name: row.name || '',
      description: row.description || '',
      category: row.category || 'Raw Material',
      unit: row.unit || 'pcs',
      shelfLife: row.shelfLife || '',
      storageTemp: row.storageTemp || '',
    });
    setEditTarget(row);
    setEditSpecs([]);
    try { await refreshEditTarget(row.id); } catch { /* show what we have */ }
  };

  const closeModals = () => { setShowCreate(false); setEditTarget(null); setEditSpecs([]); setForm(blankForm()); };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.materialCode.trim()) { setFormError('ID No. is required'); return; }
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        materialCode: form.materialCode.trim(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        category: form.category,
        unit: form.unit,
        shelfLife: form.shelfLife.trim() || null,
        storageTemp: form.storageTemp.trim() || null,
      };
      if (editTarget) {
        await api.put(`/products/${editTarget.id}`, payload);
      } else {
        await api.post('/products', payload);
      }
      closeModals();
      fetchProducts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  // ── Spec PDF library + MSDS (edit modal only) ──
  const [specUploading, setSpecUploading] = useState(false);
  const [docError, setDocError] = useState('');

  const uploadSpec = async (file) => {
    if (!file || !editTarget) return;
    if (file.type !== 'application/pdf') { setDocError('Spec must be a PDF'); return; }
    if (file.size > 10 * 1024 * 1024) { setDocError('Max 10 MB'); return; }
    setSpecUploading(true); setDocError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/products/${editTarget.id}/specs`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refreshEditTarget(editTarget.id);
    } catch (err) {
      setDocError(err.response?.data?.error || 'Spec upload failed');
    } finally {
      setSpecUploading(false);
    }
  };

  const removeSpec = async (specId) => {
    if (!editTarget || !confirm('Remove this spec?')) return;
    try {
      await api.delete(`/products/${editTarget.id}/specs/${specId}`);
      await refreshEditTarget(editTarget.id);
    } catch (err) {
      setDocError(err.response?.data?.error || 'Failed to remove spec');
    }
  };

  const uploadMsds = async (file) => {
    if (!file || !editTarget) return;
    if (file.type !== 'application/pdf') { setDocError('MSDS must be a PDF'); return; }
    if (file.size > 10 * 1024 * 1024) { setDocError('Max 10 MB'); return; }
    setDocError('');
    try {
      const fd = new FormData();
      fd.append('msds', file);
      await api.post(`/products/${editTarget.id}/msds`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await refreshEditTarget(editTarget.id);
    } catch (err) {
      setDocError(err.response?.data?.error || 'MSDS upload failed');
    }
  };

  const removeMsds = async () => {
    if (!editTarget || !confirm('Remove the MSDS?')) return;
    try {
      await api.delete(`/products/${editTarget.id}/msds`);
      await refreshEditTarget(editTarget.id);
    } catch (err) {
      setDocError(err.response?.data?.error || 'Failed to remove MSDS');
    }
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
    { key: 'category', label: 'Material Type', render: (v) => v || '—' },
    { key: 'unit', label: 'UOM', width: 70 },
    {
      key: 'description', label: 'Specification',
      render: (v) => v ? <span className="text-sm text-gray-700 line-clamp-2">{v}</span> : <span className="text-xs text-gray-400">—</span>,
    },
    {
      key: 'shelfLife', label: 'Shelf Life',
      render: (v) => v ? <span className="text-sm text-gray-700">{v}</span> : <span className="text-xs text-gray-400">—</span>,
    },
    {
      key: 'storageTemp', label: 'Storage Temp',
      render: (v) => v ? <span className="text-sm text-gray-700">{v}</span> : <span className="text-xs text-gray-400">—</span>,
    },
    {
      key: 'masterDataComplete', label: 'Master Data',
      render: (v) => v === false
        ? <Badge color="yellow"><span className="inline-flex items-center gap-1"><AlertTriangle size={11} /> Needs master data</span></Badge>
        : <Badge color="green"><span className="inline-flex items-center gap-1"><CheckCircle2 size={11} /> Added</span></Badge>,
    },
  ];

  const tableColumns = canEdit
    ? [
        ...columns,
        {
          key: '_edit', label: '', width: 70,
          render: (_v, row) => (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openEdit(row); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:text-navy-900"
              title="Edit master data"
            >
              <Pencil size={13} /> Edit
            </button>
          ),
        },
      ]
    : columns;

  const formFields = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="ID No. *" value={form.materialCode} onChange={(e) => setForm((f) => ({ ...f, materialCode: e.target.value }))} placeholder="e.g. 1000" />
        <Input label="Name *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select label="Material Type *" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
          {typeOptions.map((mt) => <option key={mt} value={mt}>{mt}</option>)}
        </Select>
        <Select label="Unit (UOM)" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
          {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
        </Select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Specification</label>
        <textarea
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
          rows={3}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Material specification details (grade, dimensions, standard…)"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label="Shelf Life" value={form.shelfLife} onChange={(e) => setForm((f) => ({ ...f, shelfLife: e.target.value }))} placeholder="e.g. 12 months from manufacture" />
        <Input label="Storage Temperature" value={form.storageTemp} onChange={(e) => setForm((f) => ({ ...f, storageTemp: e.target.value }))} placeholder="e.g. 2–8°C, store dry" />
      </div>
    </>
  );

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {embedded ? (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm text-gray-500">
            Define products with their specifications and shelf life. Only Unit 1–5 managers can edit master data.
          </p>
          {canEdit && (
            <Button onClick={openCreate}><Plus size={16} /> Add Product</Button>
          )}
        </div>
      ) : (
        <PageHero
          title="Product Master Data"
          subtitle="Define products with their specifications and shelf life. Stock and batches are managed separately under Stock Details."
          eyebrow="Master Data"
          icon={Package}
          actions={canEdit ? (
            <Button onClick={openCreate}><Plus size={16} /> Add Product</Button>
          ) : null}
        />
      )}

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search products..." />
          </div>
          <Select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }} className="w-full sm:w-48">
            <option value="">All Material Types</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="w-full sm:w-48" disabled={pendingOnly}>
            <option value="name">Sort: Alphabetical (A–Z)</option>
            <option value="category">Sort: Material Type</option>
            <option value="id">Sort: ID No.</option>
            <option value="recent">Sort: Recently added</option>
          </Select>
          <button
            type="button"
            onClick={() => { setPendingOnly((p) => !p); setPage(1); }}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              pendingOnly
                ? 'bg-amber-500 border-amber-500 text-white'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-amber-50'
            }`}
            title="Show only products whose master data hasn't been added yet"
          >
            <AlertTriangle size={14} /> Needs master data
          </button>
        </div>

        {pendingOnly && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              These products exist (usually auto-created when a PR was raised) but their master data
              hasn't been added yet. Stores can't inward them into stock until a unit head or QC fills
              the specification / shelf life here. You can add the minimum now and complete the rest later.
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Table
              columns={tableColumns}
              data={products}
              onRowClick={(row) => (canEdit ? openEdit(row) : navigate(`/products/${row.id}`))}
            />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
            <p className="mt-2 text-xs text-gray-400">{total} product{total === 1 ? '' : 's'}</p>
          </>
        )}
      </Card>

      {/* Create modal */}
      {canEdit && (
        <Modal isOpen={showCreate} onClose={closeModals} title="Add Product to Master Data" size="lg">
          <form onSubmit={handleSave} className="space-y-4">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}
            {formFields}
            <p className="text-xs text-gray-500">
              You can add the spec PDF and MSDS after creating the product (open it again to Edit).
            </p>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={closeModals}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Product'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit modal */}
      {canEdit && editTarget && (
        <Modal isOpen onClose={closeModals} title={`Master data — ${editTarget.name}`} size="lg">
          <form onSubmit={handleSave} className="space-y-4">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}
            {formFields}

            {/* Spec PDF library */}
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">Specification PDFs</span>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-900 cursor-pointer">
                  <Upload size={13} /> {specUploading ? 'Uploading…' : 'Upload PDF'}
                  <input type="file" accept="application/pdf" className="hidden" disabled={specUploading}
                    onChange={(e) => { uploadSpec(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
              {editSpecs.length === 0 ? (
                <p className="text-xs text-gray-400">No spec files yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {editSpecs.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-navy-700 hover:underline truncate">
                        <FileText size={14} className="shrink-0" /> <span className="truncate">{s.name}</span>
                      </a>
                      <button type="button" onClick={() => removeSpec(s.id)} className="text-gray-400 hover:text-brand-red shrink-0" title="Remove">
                        <Trash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* MSDS */}
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">MSDS (Safety Data Sheet)</span>
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-900 cursor-pointer">
                  <Upload size={13} /> {editTarget.msdsUrl ? 'Replace' : 'Upload PDF'}
                  <input type="file" accept="application/pdf" className="hidden"
                    onChange={(e) => { uploadMsds(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              </div>
              {editTarget.msdsUrl ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <a href={editTarget.msdsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-navy-700 hover:underline truncate">
                    <FileText size={14} className="shrink-0" /> <span className="truncate">{editTarget.msdsName || 'MSDS.pdf'}</span>
                  </a>
                  <button type="button" onClick={removeMsds} className="text-gray-400 hover:text-brand-red shrink-0" title="Remove"><Trash2 size={14} /></button>
                </div>
              ) : (
                <p className="text-xs text-gray-400">No MSDS uploaded.</p>
              )}
            </div>

            {docError && <p className="text-sm text-brand-red">{docError}</p>}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={closeModals}>Close</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save master data'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
