import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronDown, ChevronRight, Search, Filter,
  CheckCircle2, Clock, AlertTriangle, Activity, FileText,
  Settings2, X, Upload, Eye, Save, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input, { Select, Textarea } from '../../components/ui/Input';

const API_ORIGIN = (api.defaults.baseURL || '').replace(/\/api\/?$/, '') || '';

// Baseline FY columns shown side-by-side in the register, matching the
// physical Excel sheet the client maintains. The visible set is union'd
// with any fiscal year present in the data so user-entered FYs outside
// the baseline still get a column.
const BASE_FY_COLUMNS = ['FY 25-26', 'FY 26-27', 'FY 27-28'];

// Indian fiscal year: April 1 → March 31. Returns 'FY 25-26' for a
// calibratedOn date like 2025-06-15 or 2026-03-15, 'FY 26-27' for 2026-04-15.
const computeFiscalYear = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const month = d.getMonth() + 1;
  const year  = d.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `FY ${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
};

// Metrology access (per access chart RAPS/QSP):
// Full edit: METROLOGY, QC, MANAGER@Unit-V. SUPERADMIN bypasses.
// View + remarks + cert download: ADMIN, MANAGER (all units), LAB, NDT, RND.
// Unit 5 may appear as code '5', name 'Unit 5', or username 'unit 5'.
const EDIT_UNIT_CODES = ['5', 'UNIT-V', 'UNIT-5'];
const EDIT_UNIT_NAMES = ['unit 5', 'unit-5', 'unit5', 'unit v'];
const BASE_EDIT_ROLES = ['METROLOGY', 'QC'];
const BASE_VIEW_ROLES = ['ADMIN', 'METROLOGY', 'QC', 'LAB', 'NDT', 'RND'];

const isUnit5Manager = (user) => {
  if (user?.role !== 'MANAGER') return false;
  const code = (user?.unit?.code || '').toString().toUpperCase();
  const name = (user?.unit?.name || '').toString().trim().toLowerCase();
  const uname = (user?.username || '').toString().trim().toLowerCase();
  return EDIT_UNIT_CODES.includes(code)
    || EDIT_UNIT_NAMES.includes(name)
    || EDIT_UNIT_NAMES.includes(uname);
};

const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

const dueStatus = (dueDate) => {
  if (!dueDate) return { tone: 'none' };
  const days = daysUntil(dueDate);
  if (days < 0)   return { tone: 'overdue', days: Math.abs(days), label: `Overdue ${Math.abs(days)}d` };
  if (days <= 30) return { tone: 'dueSoon', days, label: `${days}d left` };
  return { tone: 'healthy', days };
};

const toDateInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const HERO_THEME = {
  PRESSURE_GAUGE:       { gradient: 'from-blue-600 via-indigo-600 to-blue-700',     ring: 'ring-blue-300/30' },
  VACUUM_GAUGE:         { gradient: 'from-sky-600 via-cyan-600 to-teal-600',         ring: 'ring-cyan-300/30' },
  WEIGHING_BALANCE:     { gradient: 'from-emerald-600 via-green-600 to-emerald-700', ring: 'ring-emerald-300/30' },
  TESTING_EQUIPMENT:    { gradient: 'from-amber-600 via-orange-600 to-red-600',      ring: 'ring-amber-300/30' },
  METROLOGY_INSTRUMENT: { gradient: 'from-indigo-600 via-violet-600 to-purple-700',  ring: 'ring-indigo-300/30' },
  MMR:                  { gradient: 'from-rose-600 via-pink-600 to-fuchsia-700',     ring: 'ring-rose-300/30' },
};

const blankForm = {
  mirNo: '',
  mirDate: '',
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
  periodicity: 'Every One Year',
  notes: '',
  mmrSubCategory: '',
};

const blankCalibrationRecord = () => ({
  qcVerifiedBy: '',
  verifiedOn: '',
  certificateNo: '',
  calibratedOn: '',
  dueDate: '',
  recallDate: '',
  certificateAttachment: '',
  // `originalFy` is set on records loaded from the server, so we know which
  // FY to delete when the user changes calibratedOn to land in a different FY.
  originalFy: '',
});

// FY currently targeted by a record in the form: derived from calibratedOn,
// falling back to the FY the record was originally saved under so blank
// calibratedOn doesn't strand existing edits.
const targetFyForRecord = (rec) => {
  if (rec.calibratedOn) return computeFiscalYear(rec.calibratedOn);
  return rec.originalFy || '';
};

// Map a calibration row to a unified category bucket. A group matches when
// the row's `category` is in `matchCategories` OR (row is MMR and its
// `mmrSubCategory` is in `matchMmrSubs`).
const matchesUnified = (item, group) => {
  if (!group) return true;
  if (item.category === 'MMR') {
    return (group.matchMmrSubs || []).includes(item.mmrSubCategory);
  }
  return (group.matchCategories || []).includes(item.category);
};

export default function CalibrationList({
  category,
  title,
  defaultName,
  fields = {},
  mmrSubOptions = null, // [{value, label}] when category=MMR
  hideBack = false,
  // Unified view: shows items from every category in one register. Each group
  // declares which server-side `category` and MMR `mmrSubCategory` values it
  // collapses into a single bucket. When set, the register fetches without a
  // category filter and applies the bucket filter client-side.
  unifiedCategories = null, // [{value, label, matchCategories, matchMmrSubs}]
  // Pre-select a bucket on mount — used by the per-category focused routes
  // so /metrology/category/<slug> opens already filtered.
  initialBucket = '',
}) {
  const unified = !!unifiedCategories;
  const { user } = useAuth();

  const canEdit = useMemo(() => {
    if (!user) return false;
    if (user.role === 'SUPERADMIN') return true; // owner hatch
    if (BASE_EDIT_ROLES.includes(user.role)) return true;
    if (isUnit5Manager(user)) return true;
    return false;
  }, [user]);

  const canView = useMemo(() => {
    if (!user) return false;
    if (canEdit) return true;
    if (BASE_VIEW_ROLES.includes(user.role)) return true;
    if (user.role === 'MANAGER') return true; // any unit manager may view
    return false;
  }, [user, canEdit]);

  const theme = HERO_THEME[category] || (unifiedCategories ? HERO_THEME.MMR : HERO_THEME.PRESSURE_GAUGE);

  // The filter-dropdown bucket options. In unified mode this drives a
  // client-side filter; in MMR mode it drives a server-side `mmrSubCategory`
  // filter.
  const bucketOptions = unifiedCategories || mmrSubOptions;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [mmrSub, setMmrSub] = useState(initialBucket || '');
  // Click "RAP S.no" header to cycle: none → asc → desc → none.
  // Sort is numeric-aware so PG-2 sorts before PG-10. Falls back to the row
  // index counter when rapsplSerialNo is empty.
  const [rapsplSort, setRapsplSort] = useState('none');
  const cycleRapsplSort = () => setRapsplSort((p) => (p === 'none' ? 'asc' : p === 'asc' ? 'desc' : 'none'));

  const [editing, setEditing] = useState(null); // 'new' | item | null
  const [form, setForm] = useState(blankForm);
  // Each entry is the shape returned by `blankCalibrationRecord()` plus an
  // optional `originalFy` for records loaded from the server. The FY each
  // record will be saved under is computed from `calibratedOn`.
  const [calibrationRecords, setCalibrationRecords] = useState([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // FY columns rendered in the register table: baseline plus every FY found
  // in the loaded data, so user-entered years outside the baseline still
  // show up in the table.
  const fyColumns = useMemo(() => {
    const set = new Set(BASE_FY_COLUMNS);
    items.forEach((it) => {
      (it.records || []).forEach((r) => {
        if (r.fiscalYear) set.add(r.fiscalYear);
      });
    });
    return Array.from(set).sort();
  }, [items]);

  // Collapsed FY columns in the register. Default: only the most recent FY is
  // expanded so the table stays readable as more years are added.
  const [collapsedFys, setCollapsedFys] = useState(
    () => new Set(BASE_FY_COLUMNS.slice(0, -1))
  );
  const isFyCollapsed = (fy) => collapsedFys.has(fy);
  const toggleFy = (fy) => setCollapsedFys((prev) => {
    const next = new Set(prev);
    if (next.has(fy)) next.delete(fy); else next.add(fy);
    return next;
  });

  const [deleting, setDeleting] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Per-row remarks draft and saving state — every viewer is allowed to edit
  // remarks even if they cannot edit the rest of the row.
  const [remarksDraft, setRemarksDraft] = useState({});
  const [remarksBusy, setRemarksBusy] = useState({});

  const fetchItems = () => {
    if (!canView) { setLoading(false); return; }
    setLoading(true);
    // In unified mode we want every row regardless of category, so neither
    // `category` nor `mmrSubCategory` is sent — the bucket filter runs on
    // the client.
    const params = unified ? {} : { category };
    if (search.trim()) params.search = search.trim();
    if (unitFilter) params.unit = unitFilter;
    if (!unified && mmrSub) params.mmrSubCategory = mmrSub;
    api.get('/calibration', { params })
      .then(({ data }) => {
        setItems(data.items || []);
        const drafts = {};
        (data.items || []).forEach((it) => { drafts[it.id] = it.remarks || ''; });
        setRemarksDraft(drafts);
      })
      .catch((err) => console.error('Fetch calibration items failed', err))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchItems(); }, [category, search, unitFilter, mmrSub]);

  const unitOptions = useMemo(() => {
    const set = new Set();
    items.forEach((it) => { if (it.unitLocation) set.add(it.unitLocation); });
    return Array.from(set).sort();
  }, [items]);

  // Compute stats over the bucket-filtered rows so the chips reflect what's
  // visible, not the entire register.
  const bucketScopedRows = useMemo(() => {
    if (unified && mmrSub) {
      const group = unifiedCategories.find((g) => g.value === mmrSub);
      return items.filter((it) => matchesUnified(it, group));
    }
    return items;
  }, [items, unified, mmrSub, unifiedCategories]);

  const stats = useMemo(() => {
    let overdue = 0, dueSoon = 0, healthy = 0;
    bucketScopedRows.forEach((it) => {
      // Use the latest FY record's due date if present, else the item snapshot.
      const due = latestDueDate(it);
      const s = dueStatus(due);
      if (s.tone === 'overdue') overdue++;
      else if (s.tone === 'dueSoon') dueSoon++;
      else healthy++;
    });
    return { total: bucketScopedRows.length, overdue, dueSoon, healthy };
  }, [bucketScopedRows]);

  const filteredItems = useMemo(() => {
    let rows = items;
    if (unified && mmrSub) {
      const group = unifiedCategories.find((g) => g.value === mmrSub);
      rows = rows.filter((it) => matchesUnified(it, group));
    }
    if (statusFilter) {
      rows = rows.filter((it) => dueStatus(latestDueDate(it)).tone === statusFilter);
    }
    if (rapsplSort !== 'none') {
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const sign = rapsplSort === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => sign * collator.compare(a.rapsplSerialNo || '', b.rapsplSerialNo || ''));
    }
    return rows;
  }, [items, statusFilter, unified, mmrSub, unifiedCategories, rapsplSort]);

  const openCreate = () => {
    setEditing('new');
    // In unified mode, pre-select the currently active bucket so the new
    // entry inherits it.
    const mmrSubDefault = unified ? (mmrSub || '') : '';
    setForm({ ...blankForm, name: defaultName || '', mmrSubCategory: mmrSubDefault });
    setCalibrationRecords([blankCalibrationRecord()]);
    setFormError('');
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      mirNo:           item.mirNo || '',
      mirDate:         toDateInput(item.mirDate),
      name:            item.name || '',
      make:            item.make || '',
      model:           item.model || '',
      serialNo:        item.serialNo || '',
      rapsplSerialNo:  item.rapsplSerialNo || '',
      operatingRange:  item.operatingRange || '',
      capacityMin:     item.capacityMin || '',
      capacityMax:     item.capacityMax || '',
      leastCount:      item.leastCount || '',
      unitLocation:    item.unitLocation || '',
      usedFor:         item.usedFor || '',
      periodicity:     item.periodicity || 'Every One Year',
      notes:           item.notes || '',
      mmrSubCategory:  item.mmrSubCategory || '',
    });
    // Carry every existing FY record into the form so they remain visible
    // and untouched when the user adds a new one. Append one empty row at
    // the end as the slot for the next calibration.
    const existing = (item.records || []).map((r) => ({
      qcVerifiedBy:           r.qcVerifiedBy || '',
      verifiedOn:             toDateInput(r.verifiedOn),
      certificateNo:          r.certificateNo || '',
      calibratedOn:           toDateInput(r.calibratedOn),
      dueDate:                toDateInput(r.dueDate),
      recallDate:             toDateInput(r.recallDate),
      certificateAttachment:  r.certificateAttachment || '',
      originalFy:             r.fiscalYear || '',
    }));
    setCalibrationRecords([...existing, blankCalibrationRecord()]);
    setFormError('');
  };

  const closeForm = () => {
    setEditing(null);
    setForm(blankForm);
    setCalibrationRecords([]);
    setFormError('');
  };

  const addCalibrationRecord = () => {
    setCalibrationRecords((prev) => [...prev, blankCalibrationRecord()]);
  };

  const removeCalibrationRecord = (idx) => {
    setCalibrationRecords((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCalibrationField = (idx, field, value) => {
    setCalibrationRecords((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  // Returns { records, error }. Each kept record carries `fiscalYear` (the
  // computed target FY) and `originalFy` so the save loop knows whether the
  // record moved FYs.
  const buildRecordsPayload = () => {
    const seen = new Map();
    const out = [];
    for (const r of calibrationRecords) {
      const fy = targetFyForRecord(r);
      const hasAny = r.qcVerifiedBy || r.verifiedOn || r.certificateNo
        || r.calibratedOn || r.dueDate || r.recallDate || r.certificateAttachment;
      if (!fy) {
        if (hasAny) {
          return { error: 'Enter a "Calibrated on" date so its fiscal year can be set.' };
        }
        continue; // entirely empty row → skip silently
      }
      if (seen.has(fy)) {
        return { error: `Two calibrations would land in ${fy}. Each fiscal year supports only one record.` };
      }
      seen.set(fy, true);
      out.push({
        fiscalYear:            fy,
        qcVerifiedBy:          r.qcVerifiedBy || null,
        certificateNo:         r.certificateNo || null,
        verifiedOn:            r.verifiedOn || null,
        calibratedOn:          r.calibratedOn || null,
        dueDate:               r.dueDate || null,
        recallDate:            r.recallDate || null,
        certificateAttachment: r.certificateAttachment || null,
        originalFy:            r.originalFy || '',
      });
    }
    return { records: out };
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!canEdit) return;
    setFormError('');
    setSaving(true);
    try {
      // In unified mode rows live under MMR + sub-category. New rows always
      // require a pick; existing legacy rows (PRESSURE_GAUGE etc.) migrate
      // to MMR the moment the user explicitly picks a category, otherwise
      // their original category is preserved.
      let effectiveCategory;
      if (unified) {
        if (editing === 'new') {
          effectiveCategory = 'MMR';
        } else if (form.mmrSubCategory) {
          effectiveCategory = 'MMR';
        } else {
          effectiveCategory = editing.category || 'MMR';
        }
      } else {
        effectiveCategory = category;
      }
      const payload = { ...form, category: effectiveCategory };
      ['mirDate'].forEach((k) => { if (!payload[k]) payload[k] = null; });
      if (!payload.mmrSubCategory) payload.mmrSubCategory = null;
      if (unified && editing === 'new' && !payload.mmrSubCategory) {
        setFormError('Pick a category before saving');
        setSaving(false);
        return;
      }

      const { records, error: recordsError } = buildRecordsPayload();
      if (recordsError) {
        setFormError(recordsError);
        setSaving(false);
        return;
      }

      let itemId;
      if (editing === 'new') {
        // Strip transient fields the server doesn't accept on POST.
        const newRecords = records.map(({ originalFy, certificateAttachment, ...rest }) => rest);
        const { data } = await api.post('/calibration', { ...payload, records: newRecords });
        itemId = data.id;
      } else {
        const { data } = await api.put(`/calibration/${editing.id}`, payload);
        itemId = data.id;

        // Compare original FYs against the new target set so we delete only
        // the rows the user actually dropped (or moved into a different FY).
        const originalFys = new Set((editing.records || []).map((r) => r.fiscalYear).filter(Boolean));
        const newFys      = new Set(records.map((r) => r.fiscalYear));

        for (const fy of originalFys) {
          if (!newFys.has(fy)) {
            await api.delete(`/calibration/${itemId}/records/${encodeURIComponent(fy)}`);
          }
        }

        // Upsert each current record under its target FY. The server keeps
        // certificateAttachment when it's passed through, so a moved record
        // doesn't lose its uploaded PDF.
        for (const r of records) {
          const { originalFy, ...recordPayload } = r;
          await api.put(
            `/calibration/${itemId}/records/${encodeURIComponent(r.fiscalYear)}`,
            recordPayload
          );
        }
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

  const handleCertUpload = async (idx, file) => {
    if (!file) return;
    if (editing === 'new' || !editing?.id) {
      alert('Save the entry first, then upload the certificate.');
      return;
    }
    const rec = calibrationRecords[idx];
    const fy = targetFyForRecord(rec);
    if (!fy) {
      alert('Set the "Calibrated on" date before uploading the certificate.');
      return;
    }
    const fd = new FormData();
    fd.append('certificate', file);
    try {
      const { data } = await api.post(
        `/calibration/${editing.id}/records/${encodeURIComponent(fy)}/certificate`,
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setCalibrationRecords((prev) =>
        prev.map((r, i) => {
          if (i !== idx) return r;
          return {
            ...r,
            certificateAttachment: data.certificateAttachment || '',
            // Treat this record as saved-at-this-FY so subsequent saves
            // know whether the FY has since moved.
            originalFy: r.originalFy || fy,
          };
        })
      );
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to upload certificate');
    }
  };

  const saveRemarks = async (item) => {
    const next = remarksDraft[item.id] ?? '';
    if ((item.remarks || '') === next) return;
    setRemarksBusy((b) => ({ ...b, [item.id]: true }));
    try {
      await api.patch(`/calibration/${item.id}/remarks`, { remarks: next });
      setItems((rows) => rows.map((r) => r.id === item.id ? { ...r, remarks: next } : r));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save remarks');
    } finally {
      setRemarksBusy((b) => ({ ...b, [item.id]: false }));
    }
  };

  if (!canView) {
    return (
      <Card>
        <p className="text-center text-gray-500 py-8">
          You don't have access to the {title} register.
        </p>
      </Card>
    );
  }

  // In unified mode show every spec column — rows come from many categories
  // and each may use a different combination of fields.
  const showCapacity       = unified ? true : !!fields.capacity;
  const showLeastCount     = unified ? true : !!fields.leastCount;
  const showOperatingRange = unified ? true : !!fields.operatingRange;
  const showUsedFor        = unified ? true : !!fields.usedFor;
  const showRapspl         = fields.rapspl !== false;
  const showBucketColumn   = unified;

  // Resolve which unified bucket an item belongs to (for the per-row badge).
  const bucketOfItem = (item) => {
    if (!unified) return null;
    return unifiedCategories.find((g) => matchesUnified(item, g)) || null;
  };

  // Per-category RAP S.no auto-counter — increments per row in the current
  // category view. Independent of any other category.
  let rapCounter = 0;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className={`relative overflow-hidden rounded-3xl bg-gradient-to-br ${theme.gradient} px-6 py-6 text-white shadow-xl`}>
        <div className="absolute -top-16 -right-16 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-10 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative">
          {!hideBack && (
            <Link
              to="/metrology"
              className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white transition-colors"
            >
              <ChevronLeft size={14} /> Back to Metrology
            </Link>
          )}

          <div className={`${hideBack ? '' : 'mt-2 '}flex flex-wrap items-center justify-between gap-4`}>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
              <p className="text-sm text-white/80 mt-1">
                Periodicity of calibration: <span className="font-semibold">one year</span>
                {canEdit ? ' · You can add, edit, or remove entries below.' : ' · Read-only view — remarks remain editable.'}
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

          {/* Stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5">
            <StatChip active={statusFilter === ''}        onClick={() => setStatusFilter('')}                                  icon={<Activity size={14} />}       label="Total"     value={stats.total}   tone="white" />
            <StatChip active={statusFilter === 'healthy'} onClick={() => setStatusFilter(statusFilter === 'healthy' ? '' : 'healthy')} icon={<CheckCircle2 size={14} />} label="Healthy"   value={stats.healthy} tone="emerald" />
            <StatChip active={statusFilter === 'dueSoon'} onClick={() => setStatusFilter(statusFilter === 'dueSoon' ? '' : 'dueSoon')} icon={<Clock size={14} />}        label="Due ≤ 30d" value={stats.dueSoon} tone="amber" />
            <StatChip active={statusFilter === 'overdue'} onClick={() => setStatusFilter(statusFilter === 'overdue' ? '' : 'overdue')} icon={<AlertTriangle size={14} />} label="Overdue"   value={stats.overdue} tone="rose" />
          </div>

          {/* Category-wise counts */}
          {bucketOptions && (() => {
            const counts = {};
            bucketOptions.forEach((o) => { counts[o.value] = 0; });
            items.forEach((it) => {
              const key = unified
                ? (unifiedCategories.find((g) => matchesUnified(it, g))?.value || 'OTHER')
                : (it.mmrSubCategory || 'OTHER');
              if (counts[key] !== undefined) counts[key]++;
              else counts['OTHER'] = (counts['OTHER'] || 0) + 1;
            });
            return (
              <div className="flex flex-wrap gap-2 mt-4">
                {bucketOptions.map((o) => (
                  <div
                    key={o.value}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      mmrSub === o.value
                        ? 'bg-white/25 text-white ring-1 ring-white/40'
                        : 'bg-white/10 text-white/80 hover:bg-white/15'
                    }`}
                    onClick={() => setMmrSub(mmrSub === o.value ? '' : o.value)}
                  >
                    <span className="text-sm font-bold tabular-nums">{counts[o.value] || 0}</span>
                    <span className="truncate max-w-[180px]">{o.label}</span>
                  </div>
                ))}
              </div>
            );
          })()}
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
              placeholder="Search by MIR no, name, make, model, serial..."
              className="w-full pl-9 pr-9 py-2.5 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500 focus:bg-white transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            )}
          </div>

          {bucketOptions && (
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              <select
                value={mmrSub}
                onChange={(e) => setMmrSub(e.target.value)}
                className="px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-navy-500 focus:bg-white transition-colors"
              >
                <option value="">{unified ? 'All categories' : 'All sub-categories'}</option>
                {bucketOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

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
            <table className="min-w-full text-[11.5px] border-separate border-spacing-0 border border-gray-200 rounded-lg">
              <thead className="sticky top-0 z-10">
                {/* Top header — base columns span 2 rows, FY groups span their inner columns */}
                <tr>
                  <Th rowSpan={2} sticky>#</Th>
                  <Th rowSpan={2}>MIR no.</Th>
                  <Th rowSpan={2}>MIR date</Th>
                  <Th rowSpan={2}>Name of Gauge / Equipment</Th>
                  {showBucketColumn && <Th rowSpan={2}>Category</Th>}
                  {showOperatingRange && <Th rowSpan={2}>Range</Th>}
                  {showCapacity && <Th rowSpan={2}>Capacity</Th>}
                  {showLeastCount && <Th rowSpan={2}>Least Count</Th>}
                  <Th rowSpan={2}>Make</Th>
                  <Th rowSpan={2}>Model</Th>
                  <Th rowSpan={2}>S.no</Th>
                  <Th rowSpan={2}>
                    <button
                      type="button"
                      onClick={cycleRapsplSort}
                      className="inline-flex items-center gap-1 hover:text-navy-900 transition-colors"
                      title="Sort by RAP S.no"
                    >
                      RAP S.no
                      {rapsplSort === 'asc' ? <ArrowUp size={11} /> : rapsplSort === 'desc' ? <ArrowDown size={11} /> : <ArrowUpDown size={11} className="opacity-40" />}
                    </button>
                  </Th>
                  <Th rowSpan={2} groupEnd>Located at</Th>
                  {fyColumns.map((fy) => {
                    const collapsed = isFyCollapsed(fy);
                    return (
                      <Th
                        key={fy}
                        colSpan={collapsed ? 1 : 6}
                        rowSpan={collapsed ? 2 : 1}
                        center
                        groupTone
                        groupEnd
                      >
                        <button
                          type="button"
                          onClick={() => toggleFy(fy)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-navy-100 text-navy-700 hover:text-navy-900 transition-colors font-semibold"
                          title={collapsed ? 'Expand' : 'Collapse'}
                        >
                          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                          <span>{fy}</span>
                        </button>
                      </Th>
                    );
                  })}
                  <Th rowSpan={2}>Remarks</Th>
                  {canEdit && <Th rowSpan={2}>Actions</Th>}
                </tr>
                <tr>
                  {fyColumns.flatMap((fy) => {
                    if (isFyCollapsed(fy)) return [];
                    return [
                      <Th key={`${fy}-qc`}>QC Verif. by</Th>,
                      <Th key={`${fy}-vo`}>Verified on</Th>,
                      <Th key={`${fy}-cn`}>Certificate no.</Th>,
                      <Th key={`${fy}-co`}>Calibrated on</Th>,
                      <Th key={`${fy}-dd`}>Calibration due date</Th>,
                      <Th key={`${fy}-rd`} groupEnd>Recall date</Th>,
                    ];
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((row, rowIdx) => {
                  rapCounter += 1;
                  const fyMap = recordsByFy(row.records);
                  const zebra = rowIdx % 2 === 1 ? 'bg-brand-gray' : 'bg-white';
                  return (
                    <tr
                      key={row.id}
                      className={`group ${zebra} hover:bg-navy-50 transition-colors`}
                    >
                      <Td sticky className="text-gray-400 tabular-nums font-mono text-[10px] text-center">
                        {rapCounter}
                      </Td>
                      <Td className="font-mono text-[11px] text-gray-700">{orDash(row.mirNo)}</Td>
                      <Td className="text-gray-600">{row.mirDate ? fmtDate(row.mirDate) : <Dash />}</Td>
                      <Td nowrap={false} className="min-w-[180px] max-w-[260px]">
                        <div className="font-semibold text-navy-800 leading-tight">{row.name}</div>
                        {row.usedFor && (
                          <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={row.usedFor}>
                            For: {row.usedFor}
                          </div>
                        )}
                      </Td>
                      {showBucketColumn && (
                        <Td nowrap={false} className="max-w-[180px]">
                          {(() => {
                            const b = bucketOfItem(row);
                            return b ? (
                              <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200 leading-tight">
                                {b.label}
                              </span>
                            ) : <Dash />;
                          })()}
                        </Td>
                      )}
                      {showOperatingRange && (
                        <Td className="font-mono text-[11px] text-gray-700">{orDash(row.operatingRange)}</Td>
                      )}
                      {showCapacity && (
                        <Td className="font-mono text-[11px] text-gray-700">
                          {row.capacityMin || row.capacityMax
                            ? `${row.capacityMin || ''}${row.capacityMax ? ` – ${row.capacityMax}` : ''}`
                            : <Dash />}
                        </Td>
                      )}
                      {showLeastCount && (
                        <Td className="font-mono text-[11px] text-gray-700">{orDash(row.leastCount)}</Td>
                      )}
                      <Td className="text-gray-700">{orDash(row.make)}</Td>
                      <Td className="font-mono text-[11px] text-gray-700">{orDash(row.model)}</Td>
                      <Td className="font-mono text-[11px] text-gray-700">{orDash(row.serialNo)}</Td>
                      <Td className="font-mono text-[11px] text-navy-700 font-semibold tabular-nums">
                        {showRapspl && row.rapsplSerialNo ? row.rapsplSerialNo : rapCounter}
                      </Td>
                      <Td groupEnd>
                        {row.unitLocation ? (
                          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 ring-1 ring-blue-200">
                            {row.unitLocation}
                          </span>
                        ) : <Dash />}
                      </Td>

                      {fyColumns.flatMap((fy) => {
                        const r = fyMap[fy] || {};
                        const due = r.dueDate;
                        const status = dueStatus(due);
                        if (isFyCollapsed(fy)) {
                          const hasAny = r.qcVerifiedBy || r.verifiedOn || r.certificateNo || r.calibratedOn || r.dueDate || r.recallDate;
                          return [
                            <Td
                              key={`${fy}-collapsed`}
                              groupEnd
                              className="text-center cursor-pointer hover:bg-navy-50/60"
                              onClick={() => toggleFy(fy)}
                              title={`Expand ${fy}`}
                            >
                              {hasAny ? (
                                due ? (
                                  <div className="flex flex-col items-center gap-0.5 leading-tight">
                                    <span className="text-[10px] text-gray-800">{fmtDate(due)}</span>
                                    {status.tone === 'overdue' && (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                                        <AlertTriangle size={9} /> {status.label}
                                      </span>
                                    )}
                                    {status.tone === 'dueSoon' && (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                                        <Clock size={9} /> {status.label}
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-gray-500">…</span>
                                )
                              ) : <Dash />}
                            </Td>,
                          ];
                        }
                        return [
                          <Td key={`${fy}-qc`} className="text-gray-700">{orDash(r.qcVerifiedBy)}</Td>,
                          <Td key={`${fy}-vo`} className="text-gray-600">{r.verifiedOn ? fmtDate(r.verifiedOn) : <Dash />}</Td>,
                          <Td key={`${fy}-cn`}>
                            {r.certificateNo || r.certificateAttachment ? (
                              <div className="flex flex-col gap-0.5 leading-tight">
                                {r.certificateNo && (
                                  <span className="font-mono text-[10px] text-gray-800">{r.certificateNo}</span>
                                )}
                                {r.certificateAttachment && (
                                  <a
                                    href={`${API_ORIGIN}${r.certificateAttachment}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-navy-600 hover:text-navy-800 hover:underline w-fit"
                                  >
                                    <Eye size={10} /> View
                                  </a>
                                )}
                              </div>
                            ) : <Dash />}
                          </Td>,
                          <Td key={`${fy}-co`} className="text-gray-600">{r.calibratedOn ? fmtDate(r.calibratedOn) : <Dash />}</Td>,
                          <Td key={`${fy}-dd`}>
                            {due ? (
                              <div className="flex flex-col gap-0.5 leading-tight">
                                <span className="text-gray-800">{fmtDate(due)}</span>
                                {status.tone === 'overdue' && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 w-fit">
                                    <AlertTriangle size={9} /> {status.label}
                                  </span>
                                )}
                                {status.tone === 'dueSoon' && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 w-fit">
                                    <Clock size={9} /> {status.label}
                                  </span>
                                )}
                              </div>
                            ) : <Dash />}
                          </Td>,
                          <Td key={`${fy}-rd`} className="text-gray-600" groupEnd>
                            {r.recallDate ? fmtDate(r.recallDate) : <Dash />}
                          </Td>,
                        ];
                      })}

                      {/* Remarks — every viewer can edit */}
                      <Td nowrap={false} className="min-w-[200px]">
                        <div className="flex items-start gap-1">
                          <textarea
                            value={remarksDraft[row.id] ?? ''}
                            onChange={(e) => setRemarksDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                            onBlur={() => saveRemarks(row)}
                            placeholder="Add remarks…"
                            rows={1}
                            className="w-full text-[11px] px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-navy-400 focus:border-navy-400 bg-gray-50 hover:bg-white focus:bg-white resize-y transition-colors"
                          />
                          {remarksBusy[row.id] && <Save size={12} className="text-gray-400 animate-pulse mt-1.5 flex-shrink-0" />}
                        </div>
                      </Td>

                      {canEdit && (
                        <Td>
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              onClick={() => openEdit(row)}
                              className="p-1.5 rounded-md hover:bg-navy-100 text-navy-600 hover:text-navy-800 transition-colors"
                              title="Edit"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              onClick={() => setDeleting(row)}
                              className="p-1.5 rounded-md hover:bg-rose-100 text-gray-400 hover:text-rose-600 transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </Td>
                      )}
                    </tr>
                  );
                })}
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
          size="full"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {formError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200 text-sm">
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                {formError}
              </div>
            )}

            <FormSection title="Identification">
              <div className="grid grid-cols-3 gap-3">
                <Input label="MIR no." value={form.mirNo} onChange={(e) => setForm({ ...form, mirNo: e.target.value })} />
                <Input label="MIR date" type="date" value={form.mirDate} onChange={(e) => setForm({ ...form, mirDate: e.target.value })} />
                <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
                <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                <Input label="Serial No (S.no)" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {showRapspl && (
                  <Input
                    label={bucketOptions ? 'RAPSPL Serial No (auto if blank)' : 'RAPSPL Serial No'}
                    value={form.rapsplSerialNo}
                    onChange={(e) => setForm({ ...form, rapsplSerialNo: e.target.value })}
                    placeholder={bucketOptions ? 'Leave blank — auto-numbered per category' : ''}
                  />
                )}
                <Input label="Located at (Unit-I, Store, etc.)" value={form.unitLocation} onChange={(e) => setForm({ ...form, unitLocation: e.target.value })} />
                {bucketOptions && (
                  <Select
                    label={unified ? 'Category *' : 'MMR sub-category *'}
                    value={form.mmrSubCategory}
                    onChange={(e) => setForm({ ...form, mmrSubCategory: e.target.value })}
                    required={editing === 'new'}
                  >
                    <option value="">— Select —</option>
                    {bucketOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                )}
              </div>
              {bucketOptions && (
                <p className="text-[11px] text-gray-500 -mt-1">
                  RAPSPL serials are auto-assigned per category (PG = Pressure Gauges, VG = Vacuum Gauges, MI = Metrology, LTE = Lab Testing, AOT = Autoclave/Oven/Thermocouples, EOT = EOT/Chain Blocks, OTH = Other) and increment independently in each bucket.
                </p>
              )}
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
              <Input label="Periodicity" value={form.periodicity} onChange={(e) => setForm({ ...form, periodicity: e.target.value })} />
            </FormSection>

            <FormSection title="Calibrations">
              <p className="text-[11px] text-gray-500 -mt-1">
                Fiscal year is set automatically from the "Calibrated on" date — April → March = FY YY-YY+1.
              </p>
              {calibrationRecords.map((rec, idx) => {
                const fy = targetFyForRecord(rec);
                const isSaved = !!rec.originalFy;
                const fyMoved = isSaved && fy && fy !== rec.originalFy;
                return (
                  <div
                    key={idx}
                    className={`rounded-lg border ${isSaved ? 'border-gray-200 bg-gray-50/60' : 'border-navy-200 bg-navy-50/30'} p-3 space-y-3`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] uppercase tracking-widest font-bold text-navy-700">
                          {isSaved ? `Calibration · ${rec.originalFy}` : 'New calibration'}
                        </span>
                        {fy ? (
                          <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${
                            fyMoved
                              ? 'bg-amber-50 text-amber-700 ring-amber-200'
                              : 'bg-violet-50 text-violet-700 ring-violet-200'
                          }`}>
                            {fyMoved ? `Will move to ${fy}` : `FY: ${fy}`}
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400 italic">
                            Set "Calibrated on" — FY will be filled in
                          </span>
                        )}
                      </div>
                      {calibrationRecords.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCalibrationRecord(idx)}
                          className="p-1 rounded-md hover:bg-rose-100 text-gray-400 hover:text-rose-600 transition-colors"
                          title={isSaved ? 'Remove this calibration (will be deleted on save)' : 'Remove this row'}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        label="Calibration certificate QC Verification by"
                        value={rec.qcVerifiedBy}
                        onChange={(e) => updateCalibrationField(idx, 'qcVerifiedBy', e.target.value)}
                      />
                      <Input
                        label="Verified on"
                        type="date"
                        value={rec.verifiedOn}
                        onChange={(e) => updateCalibrationField(idx, 'verifiedOn', e.target.value)}
                      />
                      <Input
                        label="Certificate no."
                        value={rec.certificateNo}
                        onChange={(e) => updateCalibrationField(idx, 'certificateNo', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Input
                        label="Calibrated on *"
                        type="date"
                        value={rec.calibratedOn}
                        onChange={(e) => updateCalibrationField(idx, 'calibratedOn', e.target.value)}
                      />
                      <Input
                        label="Calibration due date"
                        type="date"
                        value={rec.dueDate}
                        onChange={(e) => updateCalibrationField(idx, 'dueDate', e.target.value)}
                      />
                      <Input
                        label="Recall date"
                        type="date"
                        value={rec.recallDate}
                        onChange={(e) => updateCalibrationField(idx, 'recallDate', e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <label className="block text-sm font-medium text-gray-700">Certificate PDF:</label>
                      {editing !== 'new' && (
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-gray-300 bg-white hover:bg-gray-50 cursor-pointer">
                          <Upload size={12} /> Upload
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={(e) => handleCertUpload(idx, e.target.files?.[0])}
                          />
                        </label>
                      )}
                      {rec.certificateAttachment ? (
                        <a
                          href={`${API_ORIGIN}${rec.certificateAttachment}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-navy-600 hover:text-navy-800"
                        >
                          <Eye size={12} /> View
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">No file</span>
                      )}
                      {editing === 'new' && (
                        <span className="text-[10px] text-gray-400">Save the entry first, then upload.</span>
                      )}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={addCalibrationRecord}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-dashed border-navy-300 text-navy-700 hover:bg-navy-50 transition-colors"
              >
                <Plus size={12} /> Add another calibration
              </button>
            </FormSection>

            <FormSection title="Notes">
              <Textarea label="Internal notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </FormSection>

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <Button variant="secondary" type="button" onClick={closeForm}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : (editing === 'new' ? 'Create Entry' : 'Update')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

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

// ── helpers ──
function recordsByFy(records = []) {
  const m = {};
  records.forEach((r) => { m[r.fiscalYear] = r; });
  return m;
}

function latestDueDate(item) {
  const fyRecs = item.records || [];
  let latest = null;
  fyRecs.forEach((r) => {
    if (!r.dueDate) return;
    const d = new Date(r.dueDate);
    if (!latest || d > latest) latest = d;
  });
  return latest || item.calibrationDueDate || null;
}

function Th({ children, rowSpan = 1, colSpan = 1, sticky = false, groupTone = false, groupEnd = false, center = false }) {
  const base = 'px-3 py-2 text-[10px] font-medium uppercase tracking-wider border-b border-gray-200';
  const stickyCls = sticky ? 'sticky left-0 z-20 bg-gray-50' : '';
  const tone = groupTone
    ? 'text-gray-600 bg-gray-50 border-t border-gray-200'
    : 'text-gray-500 bg-white';
  const align = center ? 'text-center' : 'text-left';
  const edge = groupEnd ? 'border-r-2 border-gray-200' : '';
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      className={`${base} ${tone} ${stickyCls} ${align} ${edge} whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function Td({ children, sticky = false, className = '', groupEnd = false, nowrap = true }) {
  const stickyCls = sticky ? 'sticky left-0 z-10 bg-inherit' : '';
  const edge = groupEnd ? 'border-r-2 border-gray-200' : '';
  const wrap = nowrap ? 'whitespace-nowrap' : '';
  return (
    <td className={`px-3 py-2 align-middle border-b border-gray-100 text-gray-700 ${wrap} ${stickyCls} ${edge} ${className}`}>
      {children}
    </td>
  );
}

// Subtle em-dash placeholder for empty values so the table doesn't look hollow.
const Dash = () => <span className="text-gray-300 select-none">—</span>;
const orDash = (v) => (v == null || v === '' ? <Dash /> : v);

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
