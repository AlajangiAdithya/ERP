import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, ChevronLeft, Search } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Input, { Select, Textarea } from '../../components/ui/Input';

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const dueBadge = (dueDate) => {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const ms = due - now;
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days < 0) return <Badge color="red">Overdue ({Math.abs(days)}d)</Badge>;
  if (days <= 30) return <Badge color="amber">Due in {days}d</Badge>;
  return null;
};

const blankForm = {
  name: '',
  make: '',
  model: '',
  serialNo: '',
  rapsplSerialNo: '',
  operatingRange: '',
  capacityMin: '',
  capacityMax: '',
  leastCount: '',
  unitLocation: '',
  usedFor: '',
  calibrationOn: '',
  calibrationDueDate: '',
  recallDueDate: '',
  calibrationCertificate: '',
  periodicity: 'Every One Year',
  notes: '',
};

const toDateInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

/**
 * Generic calibration list. The columns and visible form fields are driven by
 * the `category` prop so the page can be reused for every metrology register.
 */
export default function CalibrationList({
  category,
  title,
  defaultName,
  fields = {},
}) {
  const { user } = useAuth();
  const canEdit = ['METROLOGY', 'ADMIN', 'SUPERADMIN'].includes(user?.role);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');

  const [editing, setEditing] = useState(null); // null | 'new' | item-object
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const fetchItems = () => {
    setLoading(true);
    const params = { category };
    if (search.trim()) params.search = search.trim();
    if (unitFilter) params.unit = unitFilter;
    api.get('/calibration', { params })
      .then(({ data }) => setItems(data.items || []))
      .catch((err) => console.error('Fetch calibration items failed', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchItems(); /* eslint-disable-next-line */ }, [category, search, unitFilter]);

  const unitOptions = useMemo(() => {
    const set = new Set();
    items.forEach((it) => { if (it.unitLocation) set.add(it.unitLocation); });
    return Array.from(set).sort();
  }, [items]);

  const openCreate = () => {
    setEditing('new');
    setForm({ ...blankForm, name: defaultName || '' });
    setFormError('');
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name:                   item.name || '',
      make:                   item.make || '',
      model:                  item.model || '',
      serialNo:               item.serialNo || '',
      rapsplSerialNo:         item.rapsplSerialNo || '',
      operatingRange:         item.operatingRange || '',
      capacityMin:            item.capacityMin || '',
      capacityMax:            item.capacityMax || '',
      leastCount:             item.leastCount || '',
      unitLocation:           item.unitLocation || '',
      usedFor:                item.usedFor || '',
      calibrationOn:          toDateInput(item.calibrationOn),
      calibrationDueDate:     toDateInput(item.calibrationDueDate),
      recallDueDate:          toDateInput(item.recallDueDate),
      calibrationCertificate: item.calibrationCertificate || '',
      periodicity:            item.periodicity || 'Every One Year',
      notes:                  item.notes || '',
    });
    setFormError('');
  };

  const closeForm = () => {
    setEditing(null);
    setForm(blankForm);
    setFormError('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    setFormError('');
    setSaving(true);
    try {
      const payload = { ...form, category };
      // Strip empty strings to null for date fields so the server skips them.
      ['calibrationOn', 'calibrationDueDate', 'recallDueDate'].forEach((k) => {
        if (!payload[k]) payload[k] = null;
      });
      if (editing === 'new') {
        await api.post('/calibration', payload);
      } else {
        await api.put(`/calibration/${editing.id}`, payload);
      }
      closeForm();
      fetchItems();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/calibration/${deleting.id}`);
      setDeleting(null);
      fetchItems();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    } finally {
      setDeleteBusy(false);
    }
  };

  const showCapacity = !!fields.capacity;
  const showLeastCount = !!fields.leastCount;
  const showOperatingRange = !!fields.operatingRange;
  const showUsedFor = !!fields.usedFor;
  const showRapspl = fields.rapspl !== false;

  const columns = [
    { key: '__sno', label: '#', width: '50px', render: (_, __, i) => i + 1 },
    { key: 'name', label: 'Equipment', render: (v, row) => (
      <div className="flex flex-col">
        <span className="font-medium text-navy-800">{v}</span>
        {row.usedFor && <span className="text-[11px] text-gray-500">Used for: {row.usedFor}</span>}
      </div>
    ) },
    showOperatingRange && { key: 'operatingRange', label: 'Range / Capacity', render: (v) => v || '—' },
    showCapacity && {
      key: 'capacityMax',
      label: 'Capacity (min – max)',
      render: (_, row) => {
        const lo = row.capacityMin, hi = row.capacityMax;
        if (!lo && !hi) return '—';
        return `${lo || '—'} – ${hi || '—'}`;
      },
    },
    showLeastCount && { key: 'leastCount', label: 'Least Count', render: (v) => v || '—' },
    { key: 'make',     label: 'Make / Model', render: (v, row) => [v, row.model].filter(Boolean).join(' / ') || '—' },
    { key: 'serialNo', label: 'Serial No', render: (v) => v || '—' },
    showRapspl && { key: 'rapsplSerialNo', label: 'RAPSPL Serial', render: (v) => v || '—' },
    { key: 'unitLocation', label: 'Location', render: (v) => v ? <Badge color="blue">{v}</Badge> : '—' },
    { key: 'calibrationOn', label: 'Calibrated On', render: fmtDate },
    { key: 'calibrationDueDate', label: 'Due Date', render: (v) => (
      <div className="flex flex-col">
        <span>{fmtDate(v)}</span>
        {dueBadge(v)}
      </div>
    ) },
    { key: 'recallDueDate', label: 'Recall Due', render: fmtDate },
    { key: 'calibrationCertificate', label: 'Certificate No', render: (v) => v || '—' },
    canEdit && {
      key: '__actions',
      label: 'Actions',
      render: (_, row) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => openEdit(row)}
            className="p-1.5 rounded hover:bg-navy-50 text-navy-700"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => setDeleting(row)}
            className="p-1.5 rounded hover:bg-red-50 text-red-600"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/metrology"
            className="inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"
          >
            <ChevronLeft size={16} /> Metrology
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-bold text-navy-800">{title}</h1>
        </div>
        {canEdit ? (
          <Button onClick={openCreate}>
            <Plus size={16} /> Add Entry
          </Button>
        ) : (
          <Badge color="gray">Read-only — Metrology team manages this register</Badge>
        )}
      </div>

      <Card className="!p-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, make, model, serial..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
            />
          </div>
          {unitOptions.length > 0 && (
            <Select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="w-44"
            >
              <option value="">All locations</option>
              {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          )}
          <span className="text-xs text-gray-500 ml-auto">{items.length} entries</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <Table columns={columns} data={items} emptyMessage="No calibration entries yet" />
        )}
      </Card>

      {editing && canEdit && (
        <Modal
          isOpen={!!editing}
          onClose={closeForm}
          title={editing === 'new' ? `New ${title} entry` : `Edit ${editing.name}`}
          size="xl"
        >
          <form onSubmit={handleSave} className="space-y-3">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input label="Location (Unit-I, Store, etc.)" value={form.unitLocation} onChange={(e) => setForm({ ...form, unitLocation: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
              <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Serial No" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} />
              {showRapspl && (
                <Input label="RAPSPL Serial No" value={form.rapsplSerialNo} onChange={(e) => setForm({ ...form, rapsplSerialNo: e.target.value })} />
              )}
            </div>
            {showOperatingRange && (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Operating Range / Capacity" value={form.operatingRange} onChange={(e) => setForm({ ...form, operatingRange: e.target.value })} />
                {showLeastCount && (
                  <Input label="Least Count" value={form.leastCount} onChange={(e) => setForm({ ...form, leastCount: e.target.value })} />
                )}
              </div>
            )}
            {showCapacity && (
              <div className="grid grid-cols-3 gap-3">
                <Input label="Capacity Min" value={form.capacityMin} onChange={(e) => setForm({ ...form, capacityMin: e.target.value })} />
                <Input label="Capacity Max" value={form.capacityMax} onChange={(e) => setForm({ ...form, capacityMax: e.target.value })} />
                <Input label="Least Count" value={form.leastCount} onChange={(e) => setForm({ ...form, leastCount: e.target.value })} />
              </div>
            )}
            {showUsedFor && (
              <Input label="Used For" value={form.usedFor} onChange={(e) => setForm({ ...form, usedFor: e.target.value })} />
            )}
            <div className="grid grid-cols-3 gap-3">
              <Input label="Calibrated On" type="date" value={form.calibrationOn} onChange={(e) => setForm({ ...form, calibrationOn: e.target.value })} />
              <Input label="Calibration Due Date" type="date" value={form.calibrationDueDate} onChange={(e) => setForm({ ...form, calibrationDueDate: e.target.value })} />
              <Input label="Recall Due Date" type="date" value={form.recallDueDate} onChange={(e) => setForm({ ...form, recallDueDate: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Calibration Certificate No" value={form.calibrationCertificate} onChange={(e) => setForm({ ...form, calibrationCertificate: e.target.value })} />
              <Input label="Periodicity" value={form.periodicity} onChange={(e) => setForm({ ...form, periodicity: e.target.value })} />
            </div>
            <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={closeForm}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : (editing === 'new' ? 'Create' : 'Save Changes')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title="Delete calibration entry" size="md">
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Delete <strong>{deleting.name}</strong>
              {deleting.serialNo && <> (Serial: <span className="font-mono">{deleting.serialNo}</span>)</>}? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" type="button" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" type="button" onClick={handleDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
