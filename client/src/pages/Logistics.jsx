import { useEffect, useState } from 'react';
import {
  Truck, Send, Clock, CheckCircle2, RefreshCw, MapPin, FileText, Upload,
  Package, Building2, Briefcase,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import PageHero from '../components/shared/PageHero';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import { formatDate, formatDateTime } from '../utils/formatters';
import { checkFileSize } from '../utils/fileGuard';

const TABS = [
  { key: 'PENDING_LOGISTICS', label: 'Pending Dispatch', Icon: Clock, color: 'amber' },
  { key: 'IN_TRANSIT',        label: 'In Transit',       Icon: Send,  color: 'blue' },
  { key: 'CLOSED',            label: 'Closed',           Icon: CheckCircle2, color: 'gray' },
];

const KIND_META = {
  LOCAL_JOB: { color: 'purple', label: 'Local Job', Icon: Briefcase },
  OUTSIDE:   { color: 'blue',   label: 'Outside',   Icon: MapPin },
};

export default function Logistics() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('PENDING_LOGISTICS');
  const [rows, setRows] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [inTransitCount, setInTransitCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [multiDispatch, setMultiDispatch] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/gatepasses', {
      params: { direction: 'OUTWARD', status: activeTab, limit: 200 },
    })
      .then(({ data }) => setRows(data.gatePasses || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  const loadCounts = () => {
    Promise.all([
      api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'PENDING_LOGISTICS', limit: 1 } }),
      api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'IN_TRANSIT', limit: 1 } }),
    ]).then(([p, t]) => {
      setPendingCount(p.data?.total ?? (p.data?.gatePasses?.length || 0));
      setInTransitCount(t.data?.total ?? (t.data?.gatePasses?.length || 0));
    }).catch(() => {});
  };

  useEffect(load, [activeTab, refreshKey]);
  useEffect(loadCounts, [refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <PageHero
        title="Logistics"
        subtitle="Vehicle assignment and dispatch confirmation for outward gate passes."
        eyebrow="Dispatch Desk"
        icon={Truck}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMultiDispatch(true)}>
              <Package size={14} /> Multi-Dispatch
            </Button>
            <Button variant="secondary" onClick={refresh}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Pending Dispatch" value={pendingCount} Icon={Clock} color="amber" />
        <StatCard label="In Transit" value={inTransitCount} Icon={Send} color="blue" />
        <StatCard label="Signed in as" value={user?.name || user?.username || '—'} Icon={Truck} color="navy" subtle />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={14} className="inline mr-1.5" />{label}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="p-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <EmptyState tab={activeTab} />
        ) : (
          <DispatchTable rows={rows} tab={activeTab} onOpen={setDetail} />
        )}
      </Card>

      {detail && (
        <DispatchModal
          gatePass={detail}
          onClose={() => setDetail(null)}
          onAction={() => { refresh(); }}
        />
      )}

      {multiDispatch && (
        <MultiDispatchModal
          onClose={() => setMultiDispatch(false)}
          onDone={() => { setMultiDispatch(false); refresh(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, Icon, color = 'navy', subtle = false }) {
  const tone = {
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
    blue:  'bg-blue-50 text-blue-700 ring-blue-200',
    navy:  'bg-navy-50 text-navy-700 ring-navy-200',
  }[color] || 'bg-gray-50 text-gray-700 ring-gray-200';
  return (
    <div className={`rounded-lg ring-1 ${tone} p-4 flex items-center gap-3`}>
      <div className="rounded-md bg-white/70 p-2"><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
        <p className={`font-semibold truncate ${subtle ? 'text-sm' : 'text-2xl'}`}>{value}</p>
      </div>
    </div>
  );
}

function EmptyState({ tab }) {
  const msg = {
    PENDING_LOGISTICS: 'No gate passes are waiting for vehicle assignment.',
    IN_TRANSIT: 'No gate passes are currently in transit.',
    CLOSED: 'No recently closed dispatches.',
  }[tab];
  return (
    <div className="p-10 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <Package size={20} className="text-gray-400" />
      </div>
      <p className="text-sm text-gray-600">{msg}</p>
    </div>
  );
}

function DispatchTable({ rows, tab, onOpen }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr className="text-left text-gray-600">
            <th className="px-3 py-2 font-medium">Pass No.</th>
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Site / Unit</th>
            <th className="px-3 py-2 font-medium">Destination</th>
            <th className="px-3 py-2 font-medium">Vehicle</th>
            <th className="px-3 py-2 font-medium">Raised by</th>
            <th className="px-3 py-2 font-medium text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((g) => {
            const kindMeta = KIND_META[g.kind] || { color: 'gray', label: g.kind || '—' };
            return (
              <tr key={g.id} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{g.passNumber}</td>
                <td className="px-3 py-2">{formatDate(g.date)}</td>
                <td className="px-3 py-2"><Badge color={kindMeta.color}>{kindMeta.label}</Badge></td>
                <td className="px-3 py-2">{g.siteName || '—'}</td>
                <td className="px-3 py-2 max-w-[16rem] truncate" title={g.partyName || ''}>
                  {g.partyName || '—'}
                </td>
                <td className="px-3 py-2 text-xs">
                  {g.assignedVehicle ? (
                    <span className="font-mono">{g.assignedVehicle.regNumber}</span>
                  ) : g.vehicleNo ? (
                    <span className="font-mono">{g.vehicleNo}</span>
                  ) : (
                    <span className="text-gray-400">Unassigned</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">{g.createdBy?.name || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant={tab === 'PENDING_LOGISTICS' ? 'primary' : 'secondary'} onClick={() => onOpen(g)}>
                    {tab === 'PENDING_LOGISTICS' ? <>
                      <Truck size={13} /> Dispatch
                    </> : 'View'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DispatchModal({ gatePass: initial, onClose, onAction }) {
  const [g, setG] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = async () => {
    try {
      const { data } = await api.get(`/gatepasses/${g.id}`);
      setG(data);
    } catch { /* ignore */ }
  };

  const itemCount = g.items?.length || 0;
  const canDispatch = g.status === 'PENDING_LOGISTICS';
  const kindMeta = KIND_META[g.kind] || { color: 'gray', label: g.kind || '—' };

  return (
    <Modal isOpen onClose={onClose} title={`Gate Pass ${g.passNumber}`} size="lg">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex flex-wrap items-center gap-2">
          <Badge color={kindMeta.color}>{kindMeta.label}</Badge>
          <Badge color="yellow">{g.status.replace(/_/g, ' ')}</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <Field label="Date" value={formatDate(g.date)} />
          <Field label="Site / Unit" value={g.siteName} icon={Building2} />
          {g.kind === 'LOCAL_JOB' && <Field label="Job Work / PO" value={g.jobWorkNo} icon={FileText} />}
          <Field label="Dispatched to" value={g.partyName} />
          <Field label="Raised by" value={g.createdBy?.name} />
          <Field label="Raised at" value={formatDateTime(g.createdAt)} />
          {g.invoiceNo && <Field label="Invoice No." value={g.invoiceNo} />}
          {g.dcNo && <Field label="DC No." value={g.dcNo} />}
          {g.dispatchedAt && <Field label="Dispatched at" value={formatDateTime(g.dispatchedAt)} />}
        </div>

        {itemCount > 0 && (
          <div>
            <h4 className="font-medium text-gray-800 mb-2 text-sm">Components ({itemCount})</h4>
            <div className="border border-gray-200 rounded overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-2 py-1.5">#</th>
                    <th className="px-2 py-1.5">Component</th>
                    <th className="px-2 py-1.5">Qty</th>
                    <th className="px-2 py-1.5">UOM</th>
                    <th className="px-2 py-1.5">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, idx) => (
                    <tr key={it.id || idx} className="border-t border-gray-100">
                      <td className="px-2 py-1.5 text-gray-500">{idx + 1}</td>
                      <td className="px-2 py-1.5">{it.description}</td>
                      <td className="px-2 py-1.5">{it.quantity}</td>
                      <td className="px-2 py-1.5">{it.unit}</td>
                      <td className="px-2 py-1.5 text-gray-600">{it.itemPurpose || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {g.assignedVehicle && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
            <p className="text-xs font-medium text-blue-800 mb-1">Assigned Vehicle</p>
            <p className="font-mono text-blue-900">{g.assignedVehicle.regNumber}</p>
            {g.assignedDriver ? (
              <p className="text-xs text-blue-700 mt-0.5">
                Driver: {g.assignedDriver.name}
                {g.assignedDriver.phone && ` · ${g.assignedDriver.phone}`}
              </p>
            ) : (g.assignedVehicle.driverName || g.assignedVehicle.driverPhone) && (
              <p className="text-xs text-blue-700 mt-0.5">
                {g.assignedVehicle.driverName}
                {g.assignedVehicle.driverPhone && ` · ${g.assignedVehicle.driverPhone}`}
              </p>
            )}
          </div>
        )}

        {canDispatch && (
          <div className="border-t border-gray-200 pt-4">
            <DispatchBox
              g={g}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              onAssigned={reload}
              onDispatched={() => { onAction(); onClose(); }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

function DispatchBox({ g, busy, setBusy, setError, onAssigned, onDispatched }) {
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [vehicleId, setVehicleId] = useState(g.assignedVehicleId || '');
  const [driverId, setDriverId] = useState(g.assignedDriverId || '');
  const [signedPdf, setSignedPdf] = useState(null);
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    api.get('/vehicles', { params: { status: 'ACTIVE' } })
      .then(({ data }) => setVehicles(data.vehicles || []))
      .catch(() => setVehicles([]));
    api.get('/drivers', { params: { status: 'ACTIVE' } })
      .then(({ data }) => setDrivers(data.drivers || []))
      .catch(() => setDrivers([]));
  }, []);

  const assigned = !!g.assignedVehicleId;

  const assign = async () => {
    if (!vehicleId) return setError('Pick a vehicle');
    setError(''); setBusy(true);
    try {
      await api.put(`/gatepasses/${g.id}/logistics-assign`, {
        vehicleId,
        driverId: driverId || undefined,
      });
      onAssigned();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign vehicle');
    }
    setBusy(false);
  };

  const dispatch = async () => {
    if (g.kind === 'OUTSIDE' && !signedPdf) {
      return setError('Driver-signed delivery PDF is required for Outside dispatches');
    }
    setError(''); setBusy(true);
    try {
      const fd = new FormData();
      if (signedPdf) fd.append('signedPdf', signedPdf);
      if (remarks.trim()) fd.append('remarks', remarks.trim());
      await api.post(`/gatepasses/${g.id}/logistics-dispatch`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onDispatched();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to dispatch');
    }
    setBusy(false);
  };

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-3">
      <p className="text-xs font-medium text-amber-800">
        {assigned ? 'Vehicle assigned — confirm dispatch' : 'Assign a vehicle + driver from the register'}
      </p>

      {!assigned && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Vehicle *" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
              <option value="">— Select a vehicle —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.regNumber} · {v.vehicleType || 'Vehicle'}
                </option>
              ))}
            </Select>
            <Select label="Driver" value={driverId} onChange={e => setDriverId(e.target.value)}>
              <option value="">— Select a driver (optional) —</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.phone ? ` · ${d.phone}` : ''}
                </option>
              ))}
            </Select>
          </div>
          {vehicles.length === 0 && (
            <p className="text-xs text-amber-700">
              No active vehicles in the register. Add one in <span className="font-medium">Vehicle Movement</span> first.
            </p>
          )}
          <div className="flex justify-end">
            <Button disabled={busy || !vehicleId} onClick={assign}>
              <Truck size={14} /> Assign Vehicle
            </Button>
          </div>
        </>
      )}

      {assigned && (
        <>
          {g.kind === 'OUTSIDE' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Driver-signed delivery PDF *</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => {
                  const f = e.target.files?.[0] || null;
                  if (f && !checkFileSize(f)) { e.target.value = ''; return; }
                  setSignedPdf(f);
                }}
                className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:text-gray-700 file:text-xs hover:file:bg-gray-100"
              />
            </div>
          )}
          <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
          <div className="flex justify-end">
            <Button disabled={busy || (g.kind === 'OUTSIDE' && !signedPdf)} onClick={dispatch}>
              <Upload size={14} /> Confirm Dispatch
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// Multi-dispatch: pick one vehicle + one driver, select multiple pending
// gatepasses, and create a VehicleTrip that bundles them together.
function MultiDispatchModal({ onClose, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [passes, setPasses] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [selected, setSelected] = useState([]);
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/vehicles', { params: { status: 'ACTIVE' } }).then(r => r.data.vehicles || []).catch(() => []),
      api.get('/drivers', { params: { status: 'ACTIVE' } }).then(r => r.data.drivers || []).catch(() => []),
      api.get('/gatepasses', { params: { direction: 'OUTWARD', status: 'PENDING_LOGISTICS', limit: 200 } })
        .then(r => r.data.gatePasses || []).catch(() => []),
    ]).then(([v, d, p]) => {
      setVehicles(v); setDrivers(d); setPasses(p);
    }).finally(() => setLoading(false));
  }, []);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async () => {
    setErr('');
    if (!vehicleId) return setErr('Select a vehicle');
    if (!selected.length) return setErr('Select at least one gate pass');
    try {
      setSaving(true);
      await api.post('/vehicle-trips', {
        vehicleId,
        driverId: driverId || undefined,
        gatePassIds: selected,
        purpose: purpose.trim() || undefined,
        destination: destination.trim() || undefined,
        remarks: remarks.trim() || undefined,
        dispatch: true,
      });
      onDone?.();
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };

  if (loading) return (
    <Modal isOpen onClose={onClose} title="Multi-Dispatch" size="lg">
      <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
    </Modal>
  );

  return (
    <Modal isOpen onClose={onClose} title="Multi-Dispatch — Batch Gate Passes" size="lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-600">
          Select 2+ pending gate passes heading to the same destination. They'll share one vehicle trip.
        </p>
        {err && <div className="text-sm text-brand-red">{err}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Vehicle *" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
            <option value="">— Select —</option>
            {vehicles.map(v => (
              <option key={v.id} value={v.id}>{v.regNumber} · {v.vehicleType || 'Vehicle'}</option>
            ))}
          </Select>
          <Select label="Driver" value={driverId} onChange={e => setDriverId(e.target.value)}>
            <option value="">— Optional —</option>
            {drivers.map(d => (
              <option key={d.id} value={d.id}>{d.name}{d.phone ? ` · ${d.phone}` : ''}</option>
            ))}
          </Select>
          <Input label="Purpose" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Job delivery" />
          <Input label="Destination" value={destination} onChange={e => setDestination(e.target.value)} placeholder="Party / place" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Pending Gate Passes ({passes.length} available) — select to attach:
          </label>
          {passes.length === 0 ? (
            <p className="text-xs text-gray-500">No pending gate passes available.</p>
          ) : (
            <div className="max-h-52 overflow-y-auto border border-gray-200 rounded divide-y divide-gray-100">
              {passes.map(p => (
                <label key={p.id} className={`flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${selected.includes(p.id) ? 'bg-blue-50' : ''}`}>
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                  <span className="font-mono text-xs text-navy-700 min-w-[110px]">{p.passNumber}</span>
                  <span className="text-gray-700 truncate">{p.partyName || '—'}</span>
                  <Badge color={p.kind === 'OUTSIDE' ? 'blue' : 'purple'}>{p.kind || '—'}</Badge>
                </label>
              ))}
            </div>
          )}
        </div>

        <Textarea label="Remarks" rows={2} value={remarks} onChange={e => setRemarks(e.target.value)} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Dispatching…' : `Dispatch ${selected.length} Pass${selected.length !== 1 ? 'es' : ''}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, value, icon: Icon }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-500 font-medium mb-0.5">{label}</p>
      <p className="text-sm text-gray-900 flex items-center gap-1.5">
        {Icon && <Icon size={13} className="text-gray-400 flex-shrink-0" />}
        <span className="truncate">{value || '—'}</span>
      </p>
    </div>
  );
}
