import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Flame, Plus, Pencil, Trash2, FileText, Upload, AlertTriangle,
  Search as SearchIcon, ChevronLeft,
} from 'lucide-react';
import api from '../../api/axios';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input, { Select } from '../../components/ui/Input';
import PageHero from '../../components/shared/PageHero';
import { formatDate } from '../../utils/formatters';

// ──────────────────────────────────────────────────────────────
// Fire Extinguisher register — lives under Measuring & Monitoring
// Resources. SAFETY (department) and Unit-5 users edit; everyone
// else views. Server enforces via fireExtinguisher.routes.js.
// ──────────────────────────────────────────────────────────────

const FE_TYPE_OPTIONS = [
  'Dry Powder Fire Extinguisher (ABC)',
  'Carbon Dioxide Fire Extinguisher',
  'Foam Fire Extinguisher',
  'Water Fire Extinguisher',
];
const FE_CAPACITY_OPTIONS = ['1 Kg', '2 Kgs', '4 Kgs', '4.5 Kgs', '6 Kgs', '9 Kgs'];

const inputDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
};

const isOverdue = (d) => d && new Date(d).getTime() < Date.now();
const isDueSoon = (d) => {
  if (!d) return false;
  const days = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= 30;
};

export default function FireExtinguishers() {
  const [canWrite, setCanWrite] = useState(false);
  const [fires, setFires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');

  const [showFireModal, setShowFireModal] = useState(false);
  const [editFire, setEditFire] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/fire-extinguishers');
      setFires(data.items || []);
      setCanWrite(Boolean(data.canWrite));
    } catch (err) {
      console.error('Failed to load fire extinguisher register', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const units = useMemo(() => {
    const set = new Set();
    fires.forEach((f) => { if (f.unit) set.add(f.unit); });
    return Array.from(set).sort();
  }, [fires]);

  const filteredFires = useMemo(() => {
    const q = search.trim().toLowerCase();
    return fires.filter((f) => {
      if (unitFilter && f.unit !== unitFilter) return false;
      if (!q) return true;
      return [f.type, f.rapsId, f.capacity, f.unit, f.location]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [fires, search, unitFilter]);

  const handleDeleteFire = async (f) => {
    if (!confirm(`Delete ${f.rapsId}?`)) return;
    try {
      await api.delete(`/fire-extinguishers/${f.id}`);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-5">
      <Link
        to="/metrology"
        className="inline-flex items-center gap-1 text-sm text-navy-600 hover:text-navy-800"
      >
        <ChevronLeft size={14} /> Back to Measuring &amp; Monitoring Resources
      </Link>

      <PageHero
        title="Fire Extinguisher Register"
        eyebrow="Measuring & Monitoring Resources"
        subtitle="Active fire-extinguisher inventory with refill and due dates. Editable by Safety and Unit-5; others view-only."
        icon={Flame}
        actions={canWrite && (
          <Button onClick={() => { setEditFire(null); setShowFireModal(true); }}>
            <Plus size={16} /> Add Fire Extinguisher
          </Button>
        )}
      />

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search type, RAPS ID, location…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </div>
          <Select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-full sm:w-56">
            <option value="">All Locations</option>
            {units.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <FireExtinguisherTable
            items={filteredFires}
            canWrite={canWrite}
            onEdit={(f) => { setEditFire(f); setShowFireModal(true); }}
            onDelete={handleDeleteFire}
          />
        )}
      </Card>

      {showFireModal && (
        <FireExtinguisherModal
          item={editFire}
          onClose={() => setShowFireModal(false)}
          onSaved={() => { setShowFireModal(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─────────────── Fire Extinguisher table ───────────────
function FireExtinguisherTable({ items, canWrite, onEdit, onDelete }) {
  if (items.length === 0) {
    return <div className="text-center py-10 text-sm text-gray-500">No fire extinguishers on file.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
            <th className="px-3 py-2 w-12">Sr</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Capacity</th>
            <th className="px-3 py-2">RAPS ID</th>
            <th className="px-3 py-2">Refilled on</th>
            <th className="px-3 py-2">Next due on</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2">Location</th>
            <th className="px-3 py-2">Doc</th>
            {canWrite && <th className="px-3 py-2 w-24 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((f) => (
            <tr key={f.id} className="hover:bg-navy-50/30">
              <td className="px-3 py-2 text-gray-500">{f.serialNumber}</td>
              <td className="px-3 py-2 font-medium text-navy-800">{f.type}</td>
              <td className="px-3 py-2 text-gray-600">{f.capacity}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-700">{f.rapsId}</td>
              <td className="px-3 py-2 text-gray-600">{f.refilledOn ? formatDate(f.refilledOn) : '—'}</td>
              <td className="px-3 py-2">
                {f.nextDueOn
                  ? <DueBadge date={f.nextDueOn} />
                  : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-3 py-2 text-gray-600">{f.unit}</td>
              <td className="px-3 py-2 text-gray-600">{f.location || '—'}</td>
              <td className="px-3 py-2">
                {f.attachment
                  ? <a href={f.attachment} target="_blank" rel="noreferrer" className="text-navy-600"><FileText size={14} /></a>
                  : <span className="text-gray-300">—</span>}
              </td>
              {canWrite && (
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => onEdit(f)} className="p-1.5 rounded hover:bg-navy-100 text-navy-700"><Pencil size={14} /></button>
                    <button onClick={() => onDelete(f)} className="p-1.5 rounded hover:bg-red-50 text-brand-red"><Trash2 size={14} /></button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DueBadge({ date }) {
  const expired = isOverdue(date);
  const soon = isDueSoon(date);
  const tone = expired ? 'bg-red-50 text-red-700 ring-red-200'
    : soon ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${tone}`}>
      {(expired || soon) && <AlertTriangle size={11} />}
      {formatDate(date)}
    </span>
  );
}

// ─────────────── Fire Extinguisher modal (add / edit) ───────────────
function FireExtinguisherModal({ item, onClose, onSaved }) {
  const isEdit = Boolean(item);
  const [form, setForm] = useState(() => ({
    serialNumber: item?.serialNumber ?? '',
    type:         item?.type ?? FE_TYPE_OPTIONS[0],
    capacity:     item?.capacity ?? '',
    rapsId:       item?.rapsId ?? '',
    refilledOn:   inputDate(item?.refilledOn),
    nextDueOn:    inputDate(item?.nextDueOn),
    unit:         item?.unit ?? '',
    location:     item?.location ?? '',
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState(item?.attachment ?? '');
  const fileInputRef = useRef(null);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, serialNumber: form.serialNumber === '' ? undefined : Number(form.serialNumber) };
      const saved = isEdit
        ? await api.put(`/fire-extinguishers/${item.id}`, payload)
        : await api.post('/fire-extinguishers', payload);
      const pendingFile = fileInputRef.current?.files?.[0];
      if (pendingFile && !attachment) {
        const fd = new FormData();
        fd.append('document', pendingFile);
        await api.post(`/fire-extinguishers/${saved.data.id}/document`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleUploadExisting = async (file) => {
    if (!isEdit) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('document', file);
      const r = await api.post(`/fire-extinguishers/${item.id}/document`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachment(r.data.attachment);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit Fire Extinguisher' : 'Add Fire Extinguisher'} size="lg">
      <form onSubmit={handleSave} className="space-y-4">
        {error && <p className="text-sm text-brand-red">{error}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Sr No" type="number" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="auto" />
          <Input label="RAPS ID *" value={form.rapsId} onChange={(e) => setForm({ ...form, rapsId: e.target.value })} placeholder="RAMS/ABC-01/FE-01" required />
          <Select label="Type *" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required>
            {FE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select label="Capacity *" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} required>
            <option value="">Select…</option>
            {FE_CAPACITY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label="Unit *" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unit-1, Unit-5, …" required />
          <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Main entrance, QC Lab entrance…" />
          <Input label="Refilled on" type="date" value={form.refilledOn} onChange={(e) => setForm({ ...form, refilledOn: e.target.value })} />
          <Input label="Next due on" type="date" value={form.nextDueOn} onChange={(e) => setForm({ ...form, nextDueOn: e.target.value })} />
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-md cursor-pointer text-sm text-gray-700 hover:bg-gray-50">
              <Upload size={14} />
              {uploading ? 'Uploading…' : (attachment ? 'Replace document' : 'Attach service slip / certificate')}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && isEdit) handleUploadExisting(file);
                }}
              />
            </label>
            {attachment && (
              <a href={attachment} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-navy-700 hover:underline">
                <FileText size={14} /> View current
              </a>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Update' : 'Add Extinguisher')}</Button>
        </div>
      </form>
    </Modal>
  );
}
