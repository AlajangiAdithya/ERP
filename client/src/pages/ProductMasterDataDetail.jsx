import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Package, FileText, Trash2, Upload, AlertTriangle, CheckCircle2, ArrowLeft, Save, Lock,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { isProductMasterEditor } from '../utils/roles';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input, { Select } from '../components/ui/Input';
import { UOM_OPTIONS } from '../utils/units';
import PageHero from '../components/shared/PageHero';

const blankForm = () => ({
  materialCode: '', name: '', description: '', category: 'Raw Material', unit: 'pcs',
  shelfLife: '', storageTemp: '',
});

// Dedicated master-data page for a single product. Opened from the Stock Details
// → Master Data tab. Edits save straight to the product (PUT /products/:id) and
// re-fetch immediately so the page always reflects the live state. Editing is
// limited to Unit 1–5 managers (+ Admin); everyone else sees a read-only view.
export default function ProductMasterDataDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = isProductMasterEditor(user);

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(blankForm());
  const [materialTypes, setMaterialTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [flash, setFlash] = useState('');
  const [specUploading, setSpecUploading] = useState(false);
  const [docError, setDocError] = useState('');

  const applyProduct = (data) => {
    setProduct(data);
    setForm({
      materialCode: data.materialCode || data.sku || '',
      name: data.name || '',
      description: data.description || '',
      category: data.category || 'Raw Material',
      unit: data.unit || 'pcs',
      shelfLife: data.shelfLife || '',
      storageTemp: data.storageTemp || '',
    });
  };

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/products/${id}`);
      applyProduct(data);
      setNotFound(false);
    } catch (err) {
      if (err.response?.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchProduct(); }, [fetchProduct]);
  useEffect(() => {
    api.get('/products/material-types').then(({ data }) => setMaterialTypes(data)).catch(() => {});
  }, []);

  const typeOptions = materialTypes.length ? materialTypes
    : ['Raw Material', 'Consumable', 'Hand Tools', 'Fasteners', 'Tools & Fixtures', 'Machinery', 'Stationery', 'Others'];

  const flashSaved = (msg = 'Master data saved.') => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 4000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.materialCode.trim()) { setFormError('ID No. is required'); return; }
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true);
    try {
      const { data } = await api.put(`/products/${id}`, {
        materialCode: form.materialCode.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        category: form.category,
        unit: form.unit,
        shelfLife: form.shelfLife.trim() || null,
        storageTemp: form.storageTemp.trim() || null,
      });
      // PUT returns the updated product; re-fetch to pick up computed fields
      // (e.g. masterDataComplete) so the page reflects the change in real time.
      if (data?.id) applyProduct(data);
      await fetchProduct();
      flashSaved();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save master data');
    } finally {
      setSaving(false);
    }
  };

  const uploadSpec = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') { setDocError('Spec must be a PDF'); return; }
    if (file.size > 10 * 1024 * 1024) { setDocError('Max 10 MB'); return; }
    setSpecUploading(true); setDocError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/products/${id}/specs`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await fetchProduct();
      flashSaved('Specification PDF uploaded.');
    } catch (err) {
      setDocError(err.response?.data?.error || 'Spec upload failed');
    } finally {
      setSpecUploading(false);
    }
  };

  const removeSpec = async (specId) => {
    if (!confirm('Remove this spec?')) return;
    setDocError('');
    try {
      await api.delete(`/products/${id}/specs/${specId}`);
      await fetchProduct();
    } catch (err) {
      setDocError(err.response?.data?.error || 'Failed to remove spec');
    }
  };

  const uploadMsds = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') { setDocError('MSDS must be a PDF'); return; }
    if (file.size > 10 * 1024 * 1024) { setDocError('Max 10 MB'); return; }
    setDocError('');
    try {
      const fd = new FormData();
      fd.append('msds', file);
      await api.post(`/products/${id}/msds`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await fetchProduct();
      flashSaved('MSDS uploaded.');
    } catch (err) {
      setDocError(err.response?.data?.error || 'MSDS upload failed');
    }
  };

  const removeMsds = async () => {
    if (!confirm('Remove the MSDS?')) return;
    setDocError('');
    try {
      await api.delete(`/products/${id}/msds`);
      await fetchProduct();
    } catch (err) {
      setDocError(err.response?.data?.error || 'Failed to remove MSDS');
    }
  };

  const backLink = (
    <Link
      to="/products?tab=master"
      className="group inline-flex items-center gap-1.5 text-xs font-semibold text-navy-700 bg-white hover:bg-navy-50 border border-navy-200 hover:border-navy-300 rounded-lg px-3 py-1.5 shadow-sm transition-all"
    >
      <ArrowLeft size={14} className="transition-transform group-hover:-translate-x-0.5" />
      Back to Master Data
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="space-y-4">
        {backLink}
        <Card><p className="text-center text-gray-500 py-10">Product not found.</p></Card>
      </div>
    );
  }

  const specs = Array.isArray(product.specs) ? product.specs : [];
  const complete = product.masterDataComplete !== false;

  return (
    <div className="space-y-4">
      {backLink}

      <PageHero
        title={product.name}
        subtitle={`Master data — ID No. ${product.materialCode || product.sku || '—'}`}
        eyebrow="Master Data"
        icon={Package}
        actions={
          complete
            ? <Badge color="green"><span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Master data added</span></Badge>
            : <Badge color="yellow"><span className="inline-flex items-center gap-1"><AlertTriangle size={12} /> Needs master data</span></Badge>
        }
      />

      {flash && (
        <div className="px-3 py-2 bg-green-50 border border-green-200 text-green-700 text-sm rounded flex items-center gap-2">
          <CheckCircle2 size={16} /> {flash}
        </div>
      )}

      {!canEdit && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 flex items-start gap-2">
          <Lock size={14} className="mt-0.5 shrink-0" />
          <span>You're viewing master data in read-only mode. Only Unit 1–5 managers can edit it.</span>
        </div>
      )}

      <Card>
        <form onSubmit={handleSave} className="space-y-4">
          {formError && <p className="text-sm text-brand-red">{formError}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="ID No. *" value={form.materialCode} disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, materialCode: e.target.value }))} placeholder="e.g. 1000" />
            <Input label="Name *" value={form.name} disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label="Material Type *" value={form.category} disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {typeOptions.map((mt) => <option key={mt} value={mt}>{mt}</option>)}
            </Select>
            <Select label="Unit (UOM)" value={form.unit} disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}>
              {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Specification</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700 disabled:bg-gray-50 disabled:text-gray-500"
              rows={3}
              disabled={!canEdit}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Material specification details (grade, dimensions, standard…)"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Shelf Life" value={form.shelfLife} disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, shelfLife: e.target.value }))} placeholder="e.g. 12 months from manufacture" />
            <Input label="Storage Temperature" value={form.storageTemp} disabled={!canEdit}
              onChange={(e) => setForm((f) => ({ ...f, storageTemp: e.target.value }))} placeholder="e.g. 2–8°C, store dry" />
          </div>

          {/* Spec PDF library */}
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">Specification PDFs</span>
              {canEdit && (
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-900 cursor-pointer">
                  <Upload size={13} /> {specUploading ? 'Uploading…' : 'Upload PDF'}
                  <input type="file" accept="application/pdf" className="hidden" disabled={specUploading}
                    onChange={(e) => { uploadSpec(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {specs.length === 0 ? (
              <p className="text-xs text-gray-400">No spec files yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {specs.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                    <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-navy-700 hover:underline truncate">
                      <FileText size={14} className="shrink-0" /> <span className="truncate">{s.name}</span>
                    </a>
                    {canEdit && (
                      <button type="button" onClick={() => removeSpec(s.id)} className="text-gray-400 hover:text-brand-red shrink-0" title="Remove">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* MSDS */}
          <div className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">MSDS (Safety Data Sheet)</span>
              {canEdit && (
                <label className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-700 hover:text-navy-900 cursor-pointer">
                  <Upload size={13} /> {product.msdsUrl ? 'Replace' : 'Upload PDF'}
                  <input type="file" accept="application/pdf" className="hidden"
                    onChange={(e) => { uploadMsds(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              )}
            </div>
            {product.msdsUrl ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <a href={product.msdsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-navy-700 hover:underline truncate">
                  <FileText size={14} className="shrink-0" /> <span className="truncate">{product.msdsName || 'MSDS.pdf'}</span>
                </a>
                {canEdit && (
                  <button type="button" onClick={removeMsds} className="text-gray-400 hover:text-brand-red shrink-0" title="Remove"><Trash2 size={14} /></button>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No MSDS uploaded.</p>
            )}
          </div>

          {docError && <p className="text-sm text-brand-red">{docError}</p>}

          {canEdit && (
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={() => navigate('/products?tab=master')}>Cancel</Button>
              <Button type="submit" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save master data'}</Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
