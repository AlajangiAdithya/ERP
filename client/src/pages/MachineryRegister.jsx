import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Wrench, Plus, Pencil, Trash2, FileText, Upload, AlertTriangle,
  Search as SearchIcon,
} from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import PageHero from '../components/shared/PageHero';
import { formatDate } from '../utils/formatters';

// ──────────────────────────────────────────────────────────────
// Machinery register page. SAFETY (department) and Unit-5 users
// edit; everyone else views. The fire-extinguisher register moved
// to Measuring & Monitoring Resources (/metrology/fire-extinguishers).
// ──────────────────────────────────────────────────────────────

const AMC_STATUS_OPTIONS = ['ACTIVE', 'EXPIRED', 'PENDING', 'NA'];

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

export default function MachineryRegister({ embedded = false }) {
  const [canWrite, setCanWrite] = useState(false);

  const [machinery, setMachinery] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [placeFilter, setPlaceFilter] = useState('');

  const [showMachineryModal, setShowMachineryModal] = useState(false);
  const [editMachinery, setEditMachinery] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/machinery');
      setMachinery(data.items || []);
      setCanWrite(Boolean(data.canWrite));
    } catch (err) {
      console.error('Failed to load machinery register', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const places = useMemo(() => {
    const set = new Set();
    machinery.forEach((m) => { if (m.place) set.add(m.place); });
    return Array.from(set).sort();
  }, [machinery]);

  const filteredMachinery = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machinery.filter((m) => {
      if (placeFilter && m.place !== placeFilter) return false;
      if (!q) return true;
      return [m.name, m.rapsId, m.makeModel, m.machineSerialNo, m.place]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [machinery, search, placeFilter]);

  const handleDeleteMachine = async (m) => {
    if (!confirm(`Delete ${m.name} (${m.rapsId})?`)) return;
    try {
      await api.delete(`/machinery/${m.id}`);
      reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHero
          title="Machinery Register"
          eyebrow="Safety / HSE"
          subtitle="Master list of shop-floor machinery with AMC status. Editable by Safety and Unit-5; others view-only."
          icon={Wrench}
          actions={canWrite && (
            <Button onClick={() => { setEditMachinery(null); setShowMachineryModal(true); }}>
              <Plus size={16} /> Add Machine
            </Button>
          )}
        />
      )}
      {embedded && canWrite && (
        <div className="flex justify-end">
          <Button onClick={() => { setEditMachinery(null); setShowMachineryModal(true); }}>
            <Plus size={16} /> Add Machine
          </Button>
        </div>
      )}

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <SearchIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search machinery, RAPS ID, make…"
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
            />
          </div>
          <Select value={placeFilter} onChange={(e) => setPlaceFilter(e.target.value)} className="w-full sm:w-56">
            <option value="">All Units</option>
            {places.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <MachineryTable
            items={filteredMachinery}
            canWrite={canWrite}
            onEdit={(m) => { setEditMachinery(m); setShowMachineryModal(true); }}
            onDelete={handleDeleteMachine}
          />
        )}
      </Card>

      {showMachineryModal && (
        <MachineryModal
          item={editMachinery}
          onClose={() => setShowMachineryModal(false)}
          onSaved={() => { setShowMachineryModal(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─────────────── Machinery table ───────────────
function MachineryTable({ items, canWrite, onEdit, onDelete }) {
  if (items.length === 0) {
    return <div className="text-center py-10 text-sm text-gray-500">No machinery on file.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
            <th className="px-3 py-2 w-12">S.No</th>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Capacity / Size</th>
            <th className="px-3 py-2">Make &amp; Model</th>
            <th className="px-3 py-2">Serial No</th>
            <th className="px-3 py-2">RAPS ID</th>
            <th className="px-3 py-2">Place</th>
            <th className="px-3 py-2">AMC</th>
            <th className="px-3 py-2">Remarks</th>
            {canWrite && <th className="px-3 py-2 w-24 text-right">Actions</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((m) => (
            <tr key={m.id} className="hover:bg-navy-50/30">
              <td className="px-3 py-2 text-gray-500">{m.serialNumber}</td>
              <td className="px-3 py-2 font-medium text-navy-800">{m.name}</td>
              <td className="px-3 py-2 whitespace-pre-line text-gray-600">{m.capacity || '—'}</td>
              <td className="px-3 py-2 text-gray-600">{m.makeModel || '—'}</td>
              <td className="px-3 py-2 text-gray-600">{m.machineSerialNo || '—'}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-700">{m.rapsId}</td>
              <td className="px-3 py-2 text-gray-600">{m.place || '—'}</td>
              <td className="px-3 py-2">
                <AMCBadge status={m.amcStatus} expiry={m.amcExpiry} attachment={m.amcAttachment} />
              </td>
              <td className="px-3 py-2 text-gray-600 max-w-xs">{m.remarks || '—'}</td>
              {canWrite && (
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => onEdit(m)} className="p-1.5 rounded hover:bg-navy-100 text-navy-700"><Pencil size={14} /></button>
                    <button onClick={() => onDelete(m)} className="p-1.5 rounded hover:bg-red-50 text-brand-red"><Trash2 size={14} /></button>
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

function AMCBadge({ status, expiry, attachment }) {
  if (!status && !expiry && !attachment) return <span className="text-gray-400">—</span>;
  const expired = isOverdue(expiry);
  const due = isDueSoon(expiry);
  const tone = expired ? 'bg-red-50 text-red-700 ring-red-200'
    : due ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
    : 'bg-gray-50 text-gray-600 ring-gray-200';
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ring-1 ${tone}`}>
        {(expired || due) && <AlertTriangle size={11} />}
        {status || 'AMC'}
        {expiry && <span className="text-[10px] opacity-75">· {formatDate(expiry)}</span>}
      </span>
      {attachment && (
        <a href={attachment} target="_blank" rel="noreferrer" className="text-navy-600 hover:text-navy-800" title="Open AMC document">
          <FileText size={13} />
        </a>
      )}
    </div>
  );
}

// ─────────────── Machinery modal (add / edit) ───────────────
function MachineryModal({ item, onClose, onSaved }) {
  const isEdit = Boolean(item);
  const [form, setForm] = useState(() => ({
    serialNumber:    item?.serialNumber ?? '',
    name:            item?.name ?? '',
    capacity:        item?.capacity ?? '',
    makeModel:       item?.makeModel ?? '',
    machineSerialNo: item?.machineSerialNo ?? '',
    rapsId:          item?.rapsId ?? '',
    place:           item?.place ?? '',
    remarks:         item?.remarks ?? '',
    amcStatus:       item?.amcStatus ?? '',
    amcVendor:       item?.amcVendor ?? '',
    amcExpiry:       inputDate(item?.amcExpiry),
  }));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState(item?.amcAttachment ?? '');
  const fileInputRef = useRef(null);

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form, serialNumber: form.serialNumber === '' ? undefined : Number(form.serialNumber) };
      const saved = isEdit
        ? await api.put(`/machinery/${item.id}`, payload)
        : await api.post('/machinery', payload);
      // If user picked a file but item was new, upload now using the returned id.
      const pendingFile = fileInputRef.current?.files?.[0];
      if (pendingFile && !attachment) {
        const fd = new FormData();
        fd.append('document', pendingFile);
        await api.post(`/machinery/${saved.data.id}/amc-document`, fd, {
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
    if (!isEdit) return; // file held in ref until create completes
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('document', file);
      const r = await api.post(`/machinery/${item.id}/amc-document`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setAttachment(r.data.amcAttachment);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit Machine' : 'Add Machine'} size="xl">
      <form onSubmit={handleSave} className="space-y-4">
        {error && <p className="text-sm text-brand-red">{error}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="S. No" type="number" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} placeholder="auto" />
          <Input label="RAPS ID *" value={form.rapsId} onChange={(e) => setForm({ ...form, rapsId: e.target.value })} placeholder="RAMS/HP-01/LM/01" required />
          <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="sm:col-span-2" />
          <Input label="Make &amp; Model" value={form.makeModel} onChange={(e) => setForm({ ...form, makeModel: e.target.value })} />
          <Input label="Machine Serial No" value={form.machineSerialNo} onChange={(e) => setForm({ ...form, machineSerialNo: e.target.value })} />
          <Input label="Place of Machine" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} placeholder="Unit-1, Unit-5, …" />
          <Textarea label="Capacity / Size" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} rows={2} className="sm:col-span-2" />
          <Textarea label="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} className="sm:col-span-2" />
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold text-navy-700 mb-3">AMC (Annual Maintenance Contract)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select label="Status" value={form.amcStatus} onChange={(e) => setForm({ ...form, amcStatus: e.target.value })}>
              <option value="">—</option>
              {AMC_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="Vendor" value={form.amcVendor} onChange={(e) => setForm({ ...form, amcVendor: e.target.value })} />
            <Input label="Expiry" type="date" value={form.amcExpiry} onChange={(e) => setForm({ ...form, amcExpiry: e.target.value })} />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-md cursor-pointer text-sm text-gray-700 hover:bg-gray-50">
              <Upload size={14} />
              {uploading ? 'Uploading…' : (attachment ? 'Replace attachment' : 'Attach AMC document')}
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
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (isEdit ? 'Update' : 'Add Machine')}</Button>
        </div>
      </form>
    </Modal>
  );
}

