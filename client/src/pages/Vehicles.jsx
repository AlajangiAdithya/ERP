import { useEffect, useMemo, useState } from 'react';
import { Plus, Truck, Pencil, Trash2, ChevronRight, ArrowLeft, Activity, Send, CheckCircle2, Clock } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import PageHero from '../components/shared/PageHero';
import { formatDate, formatDateTime } from '../utils/formatters';

const STATUS_BADGE = {
  DRAFT: 'gray',
  PENDING_STORE: 'yellow',
  PENDING_ACCOUNTS: 'yellow',
  PENDING_STORE_REVIEW: 'yellow',
  PENDING_LOGISTICS: 'yellow',
  IN_TRANSIT: 'blue',
  PENDING_RETURN: 'yellow',
  RETURNED: 'green',
  CLOSED: 'gray',
  REJECTED: 'red',
  APPROVED: 'green',
  OPEN: 'yellow',
};

const STATUS_LABEL = (s) => (s || '—').replace(/_/g, ' ');

const STATUS_OPTS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'MAINTENANCE', label: 'In Maintenance' },
];
const TYPE_OPTS = [
  { value: '', label: '—' },
  { value: 'TRUCK', label: 'Truck' },
  { value: 'VAN', label: 'Van' },
  { value: 'PICKUP', label: 'Pickup' },
  { value: 'CAR', label: 'Car' },
  { value: 'BIKE', label: 'Bike' },
];
const OWNER_TYPE_OPTS = [
  { value: '', label: '—' },
  { value: 'OWNED', label: 'Owned' },
  { value: 'HIRED', label: 'Hired' },
];

const statusBadge = (s) => ({ ACTIVE: 'green', INACTIVE: 'gray', MAINTENANCE: 'yellow' }[s] || 'gray');

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

const emptyForm = () => ({
  regNumber: '', vehicleType: '', make: '', model: '', capacityKg: '',
  ownerType: '', driverName: '', driverPhone: '',
  insuranceExpiry: '', pucExpiry: '', fitnessExpiry: '',
  status: 'ACTIVE', notes: '',
});

export default function Vehicles() {
  const { user } = useAuth();
  const canEdit = ['LOGISTICS', 'ADMIN'].includes(user?.role);

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/vehicles', { params: { status: statusFilter || undefined, q: search || undefined } })
      .then(({ data }) => setVehicles(data.vehicles || []))
      .catch(() => setVehicles([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [statusFilter, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError('');
    setShowModal(true);
  };
  const openEdit = (v) => {
    setEditing(v);
    setForm({
      regNumber: v.regNumber || '',
      vehicleType: v.vehicleType || '',
      make: v.make || '',
      model: v.model || '',
      capacityKg: v.capacityKg ?? '',
      ownerType: v.ownerType || '',
      driverName: v.driverName || '',
      driverPhone: v.driverPhone || '',
      insuranceExpiry: toDateInput(v.insuranceExpiry),
      pucExpiry: toDateInput(v.pucExpiry),
      fitnessExpiry: toDateInput(v.fitnessExpiry),
      status: v.status || 'ACTIVE',
      notes: v.notes || '',
    });
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    setError('');
    if (!form.regNumber.trim()) return setError('Registration number is required');
    try {
      const payload = {
        ...form,
        capacityKg: form.capacityKg === '' ? null : Number(form.capacityKg),
      };
      if (editing) {
        await api.put(`/vehicles/${editing.id}`, payload);
      } else {
        await api.post('/vehicles', payload);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  };

  const remove = async (v) => {
    if (!window.confirm(`Delete vehicle ${v.regNumber}?`)) return;
    try {
      await api.delete(`/vehicles/${v.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  if (detail) {
    return <VehicleDetail vehicleId={detail} onBack={() => setDetail(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHero
        title="Vehicle Register"
        subtitle="Pool of vehicles used for gate-pass dispatches. Trip history per vehicle."
        eyebrow="Logistics"
        icon={Truck}
        actions={canEdit && <Button onClick={openCreate}><Plus size={16} /> Add Vehicle</Button>}
      />

      <div className="flex flex-wrap gap-3 items-end">
        <Input
          label="Search"
          placeholder="Reg no, driver, make…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[220px]"
        />
        <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="min-w-[160px]">
          <option value="">All</option>
          {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
        ) : vehicles.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No vehicles yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-600">
                  <th className="px-3 py-2">Reg No</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Make / Model</th>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Capacity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Trips</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id} className="border-b hover:bg-blue-50/30 transition-colors">
                    <td className="px-3 py-2 font-mono font-semibold text-navy-700">{v.regNumber}</td>
                    <td className="px-3 py-2 text-gray-700">{v.vehicleType || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {v.driverName || '—'}
                      {v.driverPhone && <div className="text-[10px] text-gray-500">{v.driverPhone}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{v.capacityKg ? `${v.capacityKg} kg` : '—'}</td>
                    <td className="px-3 py-2"><Badge color={statusBadge(v.status)}>{v.status}</Badge></td>
                    <td className="px-3 py-2 text-gray-700">{v._count?.gatePasses ?? 0}</td>
                    <td className="px-3 py-2 text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => setDetail(v.id)}>
                        <ChevronRight size={14} /> Open
                      </Button>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(v)}>
                            <Pencil size={14} />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => remove(v)}>
                            <Trash2 size={14} />
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showModal && (
        <Modal isOpen onClose={() => setShowModal(false)} title={editing ? 'Edit Vehicle' : 'Add Vehicle'}>
          <div className="space-y-3">
            {error && <div className="text-sm text-brand-red">{error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Registration No *" value={form.regNumber} onChange={(e) => setForm({ ...form, regNumber: e.target.value })} placeholder="KA01AB1234" />
              <Select label="Type" value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}>
                {TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <Input label="Make" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} placeholder="Tata, Ashok Leyland…" />
              <Input label="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              <Input label="Capacity (kg)" type="number" value={form.capacityKg} onChange={(e) => setForm({ ...form, capacityKg: e.target.value })} />
              <Select label="Owner Type" value={form.ownerType} onChange={(e) => setForm({ ...form, ownerType: e.target.value })}>
                {OWNER_TYPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <Input label="Driver Name" value={form.driverName} onChange={(e) => setForm({ ...form, driverName: e.target.value })} />
              <Input label="Driver Phone" value={form.driverPhone} onChange={(e) => setForm({ ...form, driverPhone: e.target.value })} />
              <Input label="Insurance Expiry" type="date" value={form.insuranceExpiry} onChange={(e) => setForm({ ...form, insuranceExpiry: e.target.value })} />
              <Input label="PUC Expiry" type="date" value={form.pucExpiry} onChange={(e) => setForm({ ...form, pucExpiry: e.target.value })} />
              <Input label="Fitness Expiry" type="date" value={form.fitnessExpiry} onChange={(e) => setForm({ ...form, fitnessExpiry: e.target.value })} />
              <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={save}>{editing ? 'Save Changes' : 'Add Vehicle'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function VehicleDetail({ vehicleId, onBack }) {
  const [v, setV] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tripFilter, setTripFilter] = useState('ALL');
  const [tripSearch, setTripSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/vehicles/${vehicleId}`)
      .then(({ data }) => setV(data))
      .catch(() => setV(null))
      .finally(() => setLoading(false));
  }, [vehicleId]);

  const trips = v?.gatePasses || [];

  const stats = useMemo(() => {
    const inTransit = trips.filter((g) => g.status === 'IN_TRANSIT').length;
    const closed = trips.filter((g) => g.status === 'CLOSED' || g.status === 'RETURNED' || g.status === 'APPROVED').length;
    const pending = trips.filter((g) => String(g.status || '').startsWith('PENDING_')).length;
    return { total: trips.length, inTransit, closed, pending };
  }, [trips]);

  const filteredTrips = useMemo(() => {
    const term = tripSearch.trim().toLowerCase();
    return trips.filter((g) => {
      if (tripFilter !== 'ALL') {
        if (tripFilter === 'IN_TRANSIT' && g.status !== 'IN_TRANSIT') return false;
        if (tripFilter === 'CLOSED' && !['CLOSED', 'RETURNED', 'APPROVED'].includes(g.status)) return false;
        if (tripFilter === 'PENDING' && !String(g.status || '').startsWith('PENDING_')) return false;
      }
      if (!term) return true;
      const hay = [g.passNumber, g.kind, g.passType, g.partyName, g.jobWorkNo]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [trips, tripFilter, tripSearch]);

  if (loading) return <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>;
  if (!v) return <div className="p-8 text-center text-gray-500 text-sm">Vehicle not found.</div>;

  return (
    <div className="space-y-6">
      <PageHero
        title={v.regNumber}
        subtitle={[v.make, v.model].filter(Boolean).join(' ') || 'Vehicle details and trip history.'}
        eyebrow="Vehicle Detail"
        icon={Truck}
        actions={<Button variant="outline" onClick={onBack}><ArrowLeft size={14} /> Back</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatPill label="Total Trips" value={stats.total} Icon={Activity} tone="navy" />
        <StatPill label="In Transit" value={stats.inTransit} Icon={Send} tone="blue" />
        <StatPill label="Closed" value={stats.closed} Icon={CheckCircle2} tone="green" />
        <StatPill label="Pending" value={stats.pending} Icon={Clock} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-navy-700 mb-2">Identity</h3>
            <Row label="Reg No" value={v.regNumber} mono />
            <Row label="Type" value={v.vehicleType} />
            <Row label="Make" value={v.make} />
            <Row label="Model" value={v.model} />
            <Row label="Capacity" value={v.capacityKg ? `${v.capacityKg} kg` : '—'} />
            <Row label="Owner" value={v.ownerType} />
            <Row label="Status" value={<Badge color={statusBadge(v.status)}>{v.status}</Badge>} />
          </div>
        </Card>
        <Card>
          <div className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-navy-700 mb-2">Driver</h3>
            <Row label="Name" value={v.driverName} />
            <Row label="Phone" value={v.driverPhone} />
          </div>
        </Card>
        <Card>
          <div className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-navy-700 mb-2">Documents</h3>
            <Row label="Insurance Expiry" value={formatDate(v.insuranceExpiry)} />
            <Row label="PUC Expiry" value={formatDate(v.pucExpiry)} />
            <Row label="Fitness Expiry" value={formatDate(v.fitnessExpiry)} />
          </div>
        </Card>
      </div>

      {v.notes && (
        <Card><div className="p-4 text-sm whitespace-pre-wrap"><strong>Notes:</strong> {v.notes}</div></Card>
      )}

      <Card>
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-navy-700 flex items-center gap-2">
              <Activity size={16} /> Previous Assignments ({stats.total})
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label="Search"
                placeholder="Pass no, destination, job…"
                value={tripSearch}
                onChange={(e) => setTripSearch(e.target.value)}
                className="min-w-[200px]"
              />
              <Select label="Filter" value={tripFilter} onChange={(e) => setTripFilter(e.target.value)} className="min-w-[140px]">
                <option value="ALL">All</option>
                <option value="PENDING">Pending</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="CLOSED">Closed</option>
              </Select>
            </div>
          </div>

          {!trips.length ? (
            <div className="p-6 text-center text-sm text-gray-500">
              This vehicle hasn't been assigned to any gate pass yet.
            </div>
          ) : !filteredTrips.length ? (
            <div className="p-6 text-center text-sm text-gray-500">
              No trips match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto border border-gray-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-600">
                    <th className="px-3 py-2">Pass No</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Job / PO</th>
                    <th className="px-3 py-2">Destination / Party</th>
                    <th className="px-3 py-2">Dispatched</th>
                    <th className="px-3 py-2">Reached / Returned</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTrips.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-navy-700">{g.passNumber}</td>
                      <td className="px-3 py-2">{formatDate(g.date)}</td>
                      <td className="px-3 py-2">
                        {g.kind ? <Badge color={g.kind === 'OUTSIDE' ? 'blue' : 'purple'}>{g.kind}</Badge> : '—'}
                        {g.passType && <div className="text-[10px] text-gray-500 mt-0.5">{g.passType}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-[10rem] truncate" title={g.jobWorkNo || ''}>
                        {g.jobWorkNo || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-[14rem] truncate" title={g.partyName || ''}>
                        {g.partyName || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {g.dispatchedAt ? formatDateTime(g.dispatchedAt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {formatDate(g.reachedDate || g.actualReturnDate) || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={STATUS_BADGE[g.status] || 'gray'}>{STATUS_LABEL(g.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function StatPill({ label, value, Icon, tone = 'navy' }) {
  const styles = {
    navy:  'bg-navy-50 text-navy-700 ring-navy-200',
    blue:  'bg-blue-50 text-blue-700 ring-blue-200',
    green: 'bg-green-50 text-green-700 ring-green-200',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  }[tone] || 'bg-gray-50 text-gray-700 ring-gray-200';
  return (
    <div className={`rounded-lg ring-1 ${styles} p-3 flex items-center gap-2.5`}>
      <div className="rounded-md bg-white/70 p-1.5"><Icon size={16} /></div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
        <p className="text-xl font-semibold leading-none mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-800 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}
