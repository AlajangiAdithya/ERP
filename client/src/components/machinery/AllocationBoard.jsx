import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Wrench, Clock, Trash2, CalendarDays, AlertTriangle, FileText, Package } from 'lucide-react';
import api from '../../api/axios';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input, { Select, Textarea } from '../ui/Input';
import Badge from '../ui/Badge';
import { formatDate } from '../../utils/formatters';

// Daily machine-occupation timeline. Working window 09:00–19:00 (600 min).
// Unit managers allocate Work Order / ION work onto machines and log downtime.

const WORK_START_MIN = 9 * 60;   // 540
const WORK_END_MIN = 19 * 60;    // 1140
const WINDOW = WORK_END_MIN - WORK_START_MIN; // 600
const HOUR_TICKS = Array.from({ length: (WORK_END_MIN - WORK_START_MIN) / 60 + 1 }, (_, i) => 9 + i);

// Allocation timestamps are wall-clock values stored verbatim in UTC (the
// server composes them with UTC setters regardless of its own timezone), so
// they must be read back with UTC getters — local getHours() would shift
// blocks by the viewer's UTC offset.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const minutesOfDay = (iso) => { const d = new Date(iso); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const clampPct = (v) => Math.max(0, Math.min(100, v));
const hhmm = (iso) => new Date(iso).toISOString().slice(11, 16);

// Position a [start,end) block within the 9–19 window as left/width %.
const blockGeom = (startAt, endAt) => {
  const s = Math.max(WORK_START_MIN, minutesOfDay(startAt));
  const e = Math.min(WORK_END_MIN, minutesOfDay(endAt));
  const left = clampPct(((s - WORK_START_MIN) / WINDOW) * 100);
  const width = clampPct(((e - s) / WINDOW) * 100);
  return { left, width };
};

const STATUS_TONE = {
  SCHEDULED: 'bg-blue-500',
  IN_PROGRESS: 'bg-amber-500',
  COMPLETED: 'bg-emerald-600',
  CANCELLED: 'bg-gray-400',
};

export default function AllocationBoard() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allocOpen, setAllocOpen] = useState(false);
  const [downtimeOpen, setDowntimeOpen] = useState(false);
  const [detail, setDetail] = useState(null); // clicked allocation
  // 'mine' = only the user's own unit (default for unit people); 'all' = every unit.
  const [scope, setScope] = useState(null);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await api.get('/machine-allocations/day', { params: { date: d } });
      setData(res.data);
      // First load: land on "My Unit" when the user actually has one on the board.
      setScope((prev) => {
        if (prev) return prev;
        const keys = res.data?.myUnitKeys?.length ? res.data.myUnitKeys : [res.data?.myUnitKey].filter(Boolean);
        const hasOwn = (res.data?.machines || []).some((m) => m.canEdit || (m.unitKey && keys.includes(m.unitKey)));
        return hasOwn ? 'mine' : 'all';
      });
    } catch (err) {
      console.error('Load allocation board error', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const allocByMachine = useMemo(() => {
    const map = new Map();
    (data?.allocations || []).forEach((a) => {
      if (!map.has(a.machineryId)) map.set(a.machineryId, []);
      map.get(a.machineryId).push(a);
    });
    return map;
  }, [data]);

  const downByMachine = useMemo(() => {
    const map = new Map();
    (data?.downtimes || []).forEach((d) => {
      if (!map.has(d.machineryId)) map.set(d.machineryId, []);
      map.get(d.machineryId).push(d);
    });
    return map;
  }, [data]);

  const myUnitKey = data?.myUnitKey || null;
  const myUnitKeys = useMemo(
    () => (data?.myUnitKeys?.length ? data.myUnitKeys : [myUnitKey].filter(Boolean)),
    [data, myUnitKey],
  );
  const isMine = useCallback(
    (m) => m.canEdit || (m.unitKey && myUnitKeys.includes(m.unitKey)),
    [myUnitKeys],
  );
  const hasOwnUnit = useMemo(() => (data?.machines || []).some(isMine), [data, isMine]);

  // Group machines by their unit, honouring the scope toggle. The backend
  // already sorts machines so the user's own unit comes first, so Map
  // insertion order gives us that grouping.
  const groups = useMemo(() => {
    const machines = (data?.machines || []).filter((m) => (scope === 'mine' ? isMine(m) : true));
    const map = new Map();
    machines.forEach((m) => {
      const key = m.unitKey || 'UNASSIGNED';
      if (!map.has(key)) {
        map.set(key, { key, label: m.unitKey ? `Unit ${m.unitKey}` : 'Unassigned', machines: [] });
      }
      map.get(key).machines.push(m);
    });
    return Array.from(map.values());
  }, [data, scope, isMine]);

  // Machines this user may allocate/edit — the only ones offered in the modals.
  const editableMachines = useMemo(
    () => (data?.machines || []).filter((m) => m.canEdit),
    [data],
  );

  const canAllocate = data?.canAllocate;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div>
          <label className="block text-[13px] font-semibold text-navy-700 mb-1.5">Schedule date</label>
          <div className="relative">
            <CalendarDays size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="pl-9 pr-3 py-2 bg-white border border-navy-200 rounded-lg text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
            />
          </div>
        </div>
        {/* Own unit first; "All Units" shows what is going on everywhere (view-only). */}
        {hasOwnUnit && (
          <div className="flex rounded-lg border border-navy-200 overflow-hidden">
            {[['mine', 'My Unit'], ['all', 'All Units']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                className={`px-3.5 py-2 text-sm font-medium transition-colors ${
                  scope === key ? 'bg-navy-700 text-white' : 'bg-white text-navy-700 hover:bg-navy-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        {canAllocate && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDowntimeOpen(true)}>
              <Wrench size={15} /> Log Downtime
            </Button>
            <Button onClick={() => setAllocOpen(true)}>
              <Plus size={16} /> Allocate Machine
            </Button>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-500" /> Scheduled</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500" /> In Progress</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-600" /> Completed</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400" /> Downtime / Maintenance</span>
        <span className="ml-auto text-gray-400">Working window 09:00–19:00</span>
      </div>

      <Card className="overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !data?.machines?.length ? (
          <div className="text-center py-12 text-sm text-gray-500">No machines on file. Add machines in the Register tab first.</div>
        ) : (
          <div className="min-w-[720px]">
            {/* Hour axis */}
            <div className="flex items-stretch border-b border-gray-200 pb-1 mb-1">
              <div className="w-48 shrink-0 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Machine</div>
              <div className="relative flex-1 h-5">
                {HOUR_TICKS.map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 text-[10px] text-gray-400 -translate-x-1/2"
                    style={{ left: `${((h * 60 - WORK_START_MIN) / WINDOW) * 100}%` }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
            </div>

            {/* Machine rows, grouped by unit */}
            {groups.map((group) => {
              const mine = myUnitKeys.includes(group.key);
              const editable = group.machines.some((m) => m.canEdit);
              return (
                <div key={group.key}>
                  {/* Unit header */}
                  <div className="flex items-center gap-2 pt-3 pb-1.5 px-2 border-b border-gray-100">
                    <span className="text-xs font-semibold uppercase tracking-wide text-navy-700">{group.label}</span>
                    {editable ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[10px] font-medium">{mine ? 'Your unit · editable' : 'Editable'}</span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-gray-50 text-gray-500 ring-1 ring-gray-200 px-2 py-0.5 text-[10px] font-medium">View only</span>
                    )}
                  </div>

                  <div className="divide-y divide-gray-100">
                    {group.machines.map((m) => {
                      const allocs = allocByMachine.get(m.id) || [];
                      const downs = downByMachine.get(m.id) || [];
                      return (
                        <div key={m.id} className={`flex items-center py-2 ${editable ? '' : 'opacity-90'}`}>
                          <div className="w-48 shrink-0 px-2">
                            <div className="text-sm font-medium text-navy-800 truncate" title={m.name}>{m.name}</div>
                            <div className="text-[10px] font-mono text-gray-400">{m.rapsId}{m.place ? ` · ${m.place}` : ''}</div>
                          </div>
                          <div className="relative flex-1 h-9 rounded bg-gray-50 ring-1 ring-gray-100">
                            {/* hour gridlines */}
                            {HOUR_TICKS.slice(1, -1).map((h) => (
                              <div key={h} className="absolute top-0 bottom-0 w-px bg-gray-200/70"
                                style={{ left: `${((h * 60 - WORK_START_MIN) / WINDOW) * 100}%` }} />
                            ))}
                            {/* downtime blocks (behind) */}
                            {downs.map((d) => {
                              const g = blockGeom(d.startAt, d.endAt);
                              if (g.width <= 0) return null;
                              return (
                                <div key={d.id} title={`${d.reason} ${hhmm(d.startAt)}–${hhmm(d.endAt)}${d.note ? ` · ${d.note}` : ''}`}
                                  className="absolute top-0 bottom-0 rounded bg-red-400/70 border border-red-500/40"
                                  style={{ left: `${g.left}%`, width: `${g.width}%` }} />
                              );
                            })}
                            {/* allocation blocks */}
                            {allocs.map((a) => {
                              const g = blockGeom(a.startAt, a.endAt);
                              if (g.width <= 0) return null;
                              const label = a.title || a.workOrder?.workOrderNumber || a.ion?.ionNumber || 'Job';
                              return (
                                <button
                                  key={a.id}
                                  onClick={() => setDetail({ ...a, _canEdit: m.canEdit })}
                                  title={`${label} · ${hhmm(a.startAt)}–${hhmm(a.endAt)}`}
                                  className={`absolute top-0.5 bottom-0.5 rounded px-1.5 text-[10px] font-medium text-white truncate hover:brightness-110 ${STATUS_TONE[a.status] || 'bg-blue-500'}`}
                                  style={{ left: `${g.left}%`, width: `${g.width}%` }}
                                >
                                  {label}
                                </button>
                              );
                            })}
                            {allocs.length === 0 && downs.length === 0 && (
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-300">idle</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {allocOpen && (
        <AllocateModal date={date} machines={editableMachines} onClose={() => setAllocOpen(false)} onSaved={() => { setAllocOpen(false); load(date); }} />
      )}
      {downtimeOpen && (
        <DowntimeModal date={date} machines={editableMachines} onClose={() => setDowntimeOpen(false)} onSaved={() => { setDowntimeOpen(false); load(date); }} />
      )}
      {detail && (
        <AllocationDetailModal allocation={detail} canWrite={detail._canEdit} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); load(date); }} />
      )}
    </div>
  );
}

// ── Basic-detail panels ──
// Shown wherever a manager is about to (or has) put a Work Order / ION onto a
// machine, so it is obvious *what* job the machine is running — the nomenclature
// and the key order facts — without leaving the board.
function DetailField({ label, value, className = '' }) {
  if (value == null || value === '') return null;
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-navy-800 break-words">{value}</div>
    </div>
  );
}

function WorkOrderSummary({ wo }) {
  if (!wo) return null;
  const qty = wo.orderQuantity != null ? `${wo.orderQuantity} ${wo.orderUnit || ''}`.trim() : null;
  const unit = wo.assignedUnitName || null;
  return (
    <div className="rounded-lg border border-navy-100 bg-navy-50/40 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-navy-700 mb-2">
        <FileText size={13} /> Work Order details
      </div>
      {/* Nomenclature is the headline — what is being made. */}
      <div className="mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Nomenclature</div>
        <div className="text-sm font-medium text-navy-900 break-words">{wo.nomenclature || '—'}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <DetailField label="Work Order" value={wo.workOrderNumber} />
        <DetailField label="Customer" value={wo.customerName} />
        <DetailField label="Supply Order" value={wo.supplyOrderNo} />
        <DetailField label="SO Date" value={wo.supplyOrderDate ? formatDate(wo.supplyOrderDate) : null} />
        <DetailField label="Quantity" value={qty} />
        <DetailField label="Delivery (PDC)" value={wo.pdcDate ? formatDate(wo.pdcDate) : (wo.deliveryClause || null)} />
        <DetailField label="Unit" value={unit} />
      </div>
    </div>
  );
}

function IonSummary({ ion }) {
  if (!ion) return null;
  const jobs = (ion.items || []).map((it) => it.jobIdentification).filter(Boolean);
  return (
    <div className="rounded-lg border border-navy-100 bg-navy-50/40 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-navy-700 mb-2">
        <Package size={13} /> ION details
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <DetailField label="ION No" value={ion.ionNumber} />
        <DetailField label="Project" value={ion.projectName} />
        <DetailField label="Section" value={ion.section} />
        <DetailField label="Supply Order" value={ion.supplyOrderNo} />
        <DetailField label="Reference No" value={ion.userReferenceNo} />
        <DetailField label="Required by" value={ion.requiredByDate ? formatDate(ion.requiredByDate) : null} />
      </div>
      {jobs.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">Jobs</div>
          <ul className="list-disc pl-4 text-sm text-navy-800 space-y-0.5">
            {jobs.map((j, i) => <li key={i} className="break-words">{j}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Allocate a WO / ION to a machine ──
function AllocateModal({ date, machines, onClose, onSaved }) {
  const [sourceType, setSourceType] = useState('WORK_ORDER');
  const [machineryId, setMachineryId] = useState(machines[0]?.id || '');
  const [workOrderId, setWorkOrderId] = useState('');
  const [ionId, setIonId] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [title, setTitle] = useState('');
  const [workNote, setWorkNote] = useState('');
  const [options, setOptions] = useState({ workOrders: [], ions: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedWo = useMemo(
    () => options.workOrders.find((w) => w.id === workOrderId) || null,
    [options.workOrders, workOrderId],
  );
  const selectedIon = useMemo(
    () => options.ions.find((i) => i.id === ionId) || null,
    [options.ions, ionId],
  );

  useEffect(() => {
    api.get('/machine-allocations/allocatable')
      .then((r) => setOptions(r.data))
      .catch(() => setOptions({ workOrders: [], ions: [] }));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!machineryId) return setError('Select a machine');
    if (sourceType === 'WORK_ORDER' && !workOrderId) return setError('Select a work order');
    if (sourceType === 'ION' && !ionId) return setError('Select an ION');
    setSaving(true);
    try {
      await api.post('/machine-allocations', {
        machineryId, sourceType,
        workOrderId: sourceType === 'WORK_ORDER' ? workOrderId : undefined,
        ionId: sourceType === 'ION' ? ionId : undefined,
        date, startTime, endTime,
        title: title || undefined,
        workNote: workNote || undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to allocate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Allocate Machine" size="lg">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-brand-red flex items-center gap-1"><AlertTriangle size={14} /> {error}</p>}

        <Select label="Machine *" value={machineryId} onChange={(e) => setMachineryId(e.target.value)}>
          <option value="">Select machine…</option>
          {machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.rapsId})</option>)}
        </Select>

        <div>
          <label className="block text-[13px] font-semibold text-navy-700 mb-1.5">Work source *</label>
          <div className="flex gap-2">
            {['WORK_ORDER', 'ION'].map((t) => (
              <button
                key={t} type="button"
                onClick={() => setSourceType(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${sourceType === t ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-navy-700 border-navy-200'}`}
              >
                {t === 'WORK_ORDER' ? 'Work Order' : 'ION'}
              </button>
            ))}
          </div>
        </div>

        {sourceType === 'WORK_ORDER' ? (
          <>
            <Select label="Work Order *" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)}>
              <option value="">Select work order…</option>
              {options.workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.workOrderNumber} — {w.nomenclature || w.customerName}
                </option>
              ))}
            </Select>
            {/* Basic details of the picked WO so the manager sees what job goes on the machine. */}
            <WorkOrderSummary wo={selectedWo} />
          </>
        ) : (
          <>
            <Select label="ION *" value={ionId} onChange={(e) => setIonId(e.target.value)}>
              <option value="">Select ION…</option>
              {options.ions.map((i) => (
                <option key={i.id} value={i.id}>{i.ionNumber}{i.projectName ? ` — ${i.projectName}` : ''}</option>
              ))}
            </Select>
            <IonSummary ion={selectedIon} />
            {options.ions.length === 0 && (
              <p className="text-xs text-gray-500">No IONs assigned to you are awaiting a machine. Allocating one starts it (In Progress).</p>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input label="Start *" type="time" min="09:00" max="19:00" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="End *" type="time" min="09:00" max="19:00" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>

        <Input label="Block label (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto from WO/ION if blank" />
        <Textarea label="Work note (optional)" value={workNote} onChange={(e) => setWorkNote(e.target.value)} rows={2} placeholder="What is being done on this machine…" />

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Allocating…' : 'Allocate'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Log machine downtime (maintenance / breakdown) ──
function DowntimeModal({ date, machines, onClose, onSaved }) {
  const [machineryId, setMachineryId] = useState(machines[0]?.id || '');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [reason, setReason] = useState('MAINTENANCE');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!machineryId) return setError('Select a machine');
    setSaving(true);
    try {
      await api.post('/machine-allocations/downtime', { machineryId, date, startTime, endTime, reason, note: note || undefined });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log downtime');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Log Machine Downtime" size="md">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-sm text-brand-red">{error}</p>}
        <Select label="Machine *" value={machineryId} onChange={(e) => setMachineryId(e.target.value)}>
          <option value="">Select machine…</option>
          {machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.rapsId})</option>)}
        </Select>
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="MAINTENANCE">Maintenance</option>
          <option value="BREAKDOWN">Breakdown</option>
          <option value="OTHER">Other</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start *" type="time" min="09:00" max="19:00" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <Input label="End *" type="time" min="09:00" max="19:00" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Log Downtime'}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── View / edit / complete / delete a single allocation ──
function AllocationDetailModal({ allocation, canWrite, onClose, onChanged }) {
  const a = allocation;
  const [status, setStatus] = useState(a.status);
  const [workNote, setWorkNote] = useState(a.workNote || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.put(`/machine-allocations/${a.id}`, { status, workNote });
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Remove this allocation?')) return;
    setBusy(true); setError('');
    try {
      await api.delete(`/machine-allocations/${a.id}`);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete');
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`${a.machinery?.name || 'Machine'} · ${hhmm(a.startAt)}–${hhmm(a.endAt)}`} size="md">
      <div className="space-y-3">
        {error && <p className="text-sm text-brand-red">{error}</p>}
        {/* What job is running on this machine — basic details + nomenclature. */}
        {a.sourceType === 'WORK_ORDER' ? <WorkOrderSummary wo={a.workOrder} /> : <IonSummary ion={a.ion} />}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">Allocated by:</span> <span>{a.allocatedBy?.name || '—'}</span></div>
          <div className="flex items-center gap-1.5"><Clock size={13} className="text-gray-400" /> {hhmm(a.startAt)}–{hhmm(a.endAt)}</div>
          <div><span className="text-gray-500">Machine:</span> <span className="font-mono text-xs">{a.machinery?.rapsId}</span></div>
        </div>

        {canWrite ? (
          <>
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="SCHEDULED">Scheduled</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
            <Textarea label="Work note" value={workNote} onChange={(e) => setWorkNote(e.target.value)} rows={2} placeholder="Record of work done on this machine…" />
            <div className="flex justify-between pt-2 border-t">
              <Button variant="danger" onClick={remove} disabled={busy}><Trash2 size={15} /> Delete</Button>
              <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </>
        ) : (
          <div>
            <Badge color="blue">{a.status}</Badge>
            {a.workNote && <p className="mt-2 text-sm text-gray-700"><span className="text-gray-500">Note: </span>{a.workNote}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
