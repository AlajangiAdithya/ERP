import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, ChevronLeft, Search, Filter,
  CheckCircle2, Clock, AlertTriangle, Activity, FileText,
  Calendar, Settings2, MapPin, Hash, X,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import Input, { Select, Textarea } from '../../components/ui/Input';

const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

const dueStatus = (dueDate) => {
  if (!dueDate) return { tone: 'none', label: null };
  const days = daysUntil(dueDate);
  if (days < 0)  return { tone: 'overdue', days: Math.abs(days), label: `Overdue ${Math.abs(days)}d` };
  if (days <= 30) return { tone: 'dueSoon', days, label: `${days}d left` };
  return { tone: 'healthy', days, label: null };
};

const DueBadge = ({ dueDate }) => {
  const s = dueStatus(dueDate);
  if (s.tone === 'none') return null;
  if (s.tone === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200">
        <AlertTriangle size={10} /> {s.label}
      </span>
    );
  }
  if (s.tone === 'dueSoon') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        <Clock size={10} /> {s.label}
      </span>
    );
  }
  return null;
};

const StatusDot = ({ dueDate }) => {
  const s = dueStatus(dueDate);
  const color =
    s.tone === 'overdue' ? 'bg-rose-500 shadow-rose-500/50' :
    s.tone === 'dueSoon' ? 'bg-amber-400 shadow-amber-400/50' :
    'bg-emerald-500 shadow-emerald-500/50';
  return <span className={`block w-2 h-2 rounded-full ${color} shadow-[0_0_8px]`} />;
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

const HERO_THEME = {
  PRESSURE_GAUGE:      { gradient: 'from-blue-600 via-indigo-600 to-blue-700',     ring: 'ring-blue-300/30' },
  VACUUM_GAUGE:        { gradient: 'from-sky-600 via-cyan-600 to-teal-600',         ring: 'ring-cyan-300/30' },
  WEIGHING_BALANCE:    { gradient: 'from-emerald-600 via-green-600 to-emerald-700', ring: 'ring-emerald-300/30' },
  TESTING_EQUIPMENT:   { gradient: 'from-amber-600 via-orange-600 to-red-600',      ring: 'ring-amber-300/30' },
  METROLOGY_INSTRUMENT:{ gradient: 'from-indigo-600 via-violet-600 to-purple-700',  ring: 'ring-indigo-300/30' },
  MMR:                 { gradient: 'from-rose-600 via-pink-600 to-fuchsia-700',     ring: 'ring-rose-300/30' },
};

export default function CalibrationList({
  category,
  title,
  defaultName,
  fields = {},
}) {
  const { user } = useAuth();
  const canEdit = ['METROLOGY', 'ADMIN', 'SUPERADMIN'].includes(user?.role);
  const theme = HERO_THEME[category] || HERO_THEME.PRESSURE_GAUGE;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(''); // '' | 'overdue' | 'dueSoon' | 'healthy'

  const [editing, setEditing] = useState(null);
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

  const stats = useMemo(() => {
    let overdue = 0, dueSoon = 0, healthy = 0;
    items.forEach((it) => {
      const s = dueStatus(it.calibrationDueDate);
      if (s.tone === 'overdue') overdue++;
      else if (s.tone === 'dueSoon') dueSoon++;
      else healthy++;
    });
    return { total: items.length, overdue, dueSoon, healthy };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!statusFilter) return items;
    return items.filter((it) => dueStatus(it.calibrationDueDate).tone === statusFilter);
  }, [items, statusFilter]);

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

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${theme.gradient} px-6 py-6 text-white shadow-xl`}>
        <div className="absolute -top-16 -right-16 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          <Link
            to="/metrology"
            className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white transition-colors"
          >
            <ChevronLeft size={14} /> Back to Metrology
          </Link>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
              <p className="text-sm text-white/80 mt-1">
                {canEdit
                  ? 'You can add, edit, or remove calibration entries below.'
                  : 'Read-only view — Metrology team manages this register.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <button
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-navy-800 font-semibold shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all"
                >
                  <Plus size={16} /> New Entry
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/15 ring-1 ring-white/25">
                  <Settings2 size={12} /> View only
                </span>
              )}
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
            <StatChip
              active={statusFilter === ''}
              onClick={() => setStatusFilter('')}
              icon={<Activity size={14} />}
              label="Total"
              value={stats.total}
              tone="white"
            />
            <StatChip
              active={statusFilter === 'healthy'}
              onClick={() => setStatusFilter(statusFilter === 'healthy' ? '' : 'healthy')}
              icon={<CheckCircle2 size={14} />}
              label="Healthy"
              value={stats.healthy}
              tone="emerald"
            />
            <StatChip
              active={statusFilter === 'dueSoon'}
              onClick={() => setStatusFilter(statusFilter === 'dueSoon' ? '' : 'dueSoon')}
              icon={<Clock size={14} />}
              label="Due ≤ 30d"
              value={stats.dueSoon}
              tone="amber"
            />
            <StatChip
              active={statusFilter === 'overdue'}
              onClick={() => setStatusFilter(statusFilter === 'overdue' ? '' : 'overdue')}
              icon={<AlertTriangle size={14} />}
              label="Overdue"
              value={stats.overdue}
              tone="rose"
            />
          </div>
        </div>
      </div>

      {/* Filters + table */}
      <Card className="!p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, make, model, serial..."
              className="w-full pl-9 pr-9 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500 focus:bg-white transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {unitOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              <select
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-500 focus:bg-white transition-colors"
              >
                <option value="">All locations</option>
                {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          )}
          <span className="text-xs text-gray-500 ml-auto font-medium">
            Showing <span className="text-navy-700 font-bold">{filteredItems.length}</span> of <span className="font-semibold">{items.length}</span>
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="p-4 rounded-2xl bg-gray-50 ring-1 ring-gray-200 mb-4">
              <FileText size={32} className="text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-600">No entries match your filters</p>
            <p className="text-xs text-gray-400 mt-1">Try clearing the search or status filter above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest w-12">#</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Equipment</th>
                  {showOperatingRange && <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Range</th>}
                  {showCapacity && <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Capacity</th>}
                  {showLeastCount && <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Least Count</th>}
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Make / Model</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Serial Numbers</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Location</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Calibrated</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Due Date</th>
                  <th className="px-3 py-3 text-left text-[10px] font-bold text-gray-500 uppercase tracking-widest">Certificate</th>
                  {canEdit && <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-500 uppercase tracking-widest">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((row, i) => (
                  <tr
                    key={row.id}
                    className="group border-b border-gray-100 hover:bg-navy-50/40 transition-colors"
                  >
                    <td className="px-3 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <StatusDot dueDate={row.calibrationDueDate} />
                        <span className="text-xs font-medium text-gray-400 tabular-nums">{i + 1}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col">
                        <span className="font-semibold text-navy-800 leading-tight">{row.name}</span>
                        {row.usedFor && (
                          <span className="text-[11px] text-gray-500 mt-0.5">
                            <span className="text-gray-400">For:</span> {row.usedFor}
                          </span>
                        )}
                      </div>
                    </td>
                    {showOperatingRange && (
                      <td className="px-3 py-3 align-middle">
                        <span className="font-mono text-xs text-gray-700">{row.operatingRange || '—'}</span>
                      </td>
                    )}
                    {showCapacity && (
                      <td className="px-3 py-3 align-middle">
                        <span className="font-mono text-xs text-gray-700">
                          {(row.capacityMin || '—')} – {(row.capacityMax || '—')}
                        </span>
                      </td>
                    )}
                    {showLeastCount && (
                      <td className="px-3 py-3 align-middle">
                        <span className="font-mono text-xs text-gray-700">{row.leastCount || '—'}</span>
                      </td>
                    )}
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-800">{row.make || '—'}</span>
                        {row.model && <span className="text-[11px] text-gray-500 font-mono">{row.model}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col gap-0.5">
                        {row.serialNo ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono text-gray-700">
                            <Hash size={10} className="text-gray-400" />{row.serialNo}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                        {showRapspl && row.rapsplSerialNo && (
                          <span className="text-[10px] font-mono text-navy-600 bg-navy-50 px-1.5 py-0.5 rounded ring-1 ring-navy-100 inline-block w-fit">
                            {row.rapsplSerialNo}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {row.unitLocation ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                          <MapPin size={10} /> {row.unitLocation}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <span className="inline-flex items-center gap-1 text-xs text-gray-700">
                        <Calendar size={11} className="text-gray-400" /> {fmtDate(row.calibrationOn)}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-gray-700">{fmtDate(row.calibrationDueDate)}</span>
                        <DueBadge dueDate={row.calibrationDueDate} />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <span className="text-[11px] font-mono text-gray-600">{row.calibrationCertificate || '—'}</span>
                    </td>
                    {canEdit && (
                      <td className="px-3 py-3 align-middle text-right">
                        <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(row)}
                            className="p-1.5 rounded-lg hover:bg-navy-100 text-navy-700 transition-colors"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => setDeleting(row)}
                            className="p-1.5 rounded-lg hover:bg-red-100 text-red-600 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit modal */}
      {editing && canEdit && (
        <Modal
          isOpen={!!editing}
          onClose={closeForm}
          title={editing === 'new' ? `New ${title} entry` : `Edit ${editing.name}`}
          size="xl"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {formError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200 text-sm">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                {formError}
              </div>
            )}
            <FormSection title="Identification">
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
            </FormSection>

            <FormSection title="Specifications">
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
            </FormSection>

            <FormSection title="Calibration">
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
            </FormSection>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="secondary" type="button" onClick={closeForm}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : (editing === 'new' ? 'Create Entry' : 'Save Changes')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete modal */}
      {deleting && (
        <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title="Delete calibration entry" size="md">
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-rose-50 ring-1 ring-rose-200">
              <AlertTriangle size={18} className="text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-rose-800">
                Permanently delete <strong>{deleting.name}</strong>
                {deleting.serialNo && <> (Serial: <span className="font-mono">{deleting.serialNo}</span>)</>}?
                This cannot be undone.
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" type="button" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" type="button" onClick={handleDelete} disabled={deleteBusy}>
                {deleteBusy ? 'Deleting...' : 'Delete entry'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatChip({ icon, label, value, tone, active, onClick }) {
  const tones = {
    white:   active ? 'bg-white text-navy-800 shadow-lg ring-white'         : 'bg-white/10 text-white ring-white/20 hover:bg-white/20',
    emerald: active ? 'bg-emerald-400 text-emerald-950 shadow-lg ring-emerald-300' : 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30 hover:bg-emerald-400/25',
    amber:   active ? 'bg-amber-400 text-amber-950 shadow-lg ring-amber-300'  : 'bg-amber-400/15 text-amber-100 ring-amber-300/30 hover:bg-amber-400/25',
    rose:    active ? 'bg-rose-400 text-rose-950 shadow-lg ring-rose-300'    : 'bg-rose-400/15 text-rose-100 ring-rose-300/30 hover:bg-rose-400/25',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl ring-1 backdrop-blur-sm transition-all ${tones[tone]}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold opacity-90">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-lg font-bold tabular-nums">{value}</span>
    </button>
  );
}

function FormSection({ title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-1 border-b border-gray-100">
        <span className="text-[11px] uppercase tracking-widest font-bold text-navy-700">{title}</span>
        <span className="flex-1 h-px bg-gradient-to-r from-navy-100 to-transparent" />
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
