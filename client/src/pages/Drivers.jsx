import { useEffect, useMemo, useState } from 'react';
import { Plus, IdCard, Pencil, Trash2, ChevronRight, ArrowLeft, Activity, Send, CheckCircle2, Clock } from 'lucide-react';
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

const TRIP_BADGE = { SCHEDULED: 'yellow', IN_TRANSIT: 'blue', RETURNED: 'green', CANCELLED: 'gray' };

const STATUS_OPTS = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const statusBadge = (s) => ({ ACTIVE: 'green', INACTIVE: 'gray' }[s] || 'gray');

const toDateInput = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

const emptyForm = () => ({
  name: '', phone: '', licenseNo: '', licenseExpiry: '',
  defaultVehicleId: '', status: 'ACTIVE', notes: '',
});

export default function Drivers() {
  const { user } = useAuth();
  const canEdit = ['LOGISTICS', 'ADMIN'].includes(user?.role);

  const [drivers, setDrivers] = useState([]);
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
    api.get('/drivers', { params: { status: statusFilter || undefined, q: search || undefined } })
      .then(({ data }) => setDrivers(data.drivers || []))
      .catch(() => setDrivers([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [statusFilter, search]);

  useEffect(() => {
    api.get('/vehicles', { params: { status: 'ACTIVE' } })
      .then(({ data }) => setVehicles(data.vehicles || []))
      .catch(() => setVehicles([]));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError('');
    setShowModal(true);
  };
  const openEdit = (d) => {
    setEditing(d);
    setForm({
      name: d.name || '',
      phone: d.phone || '',
      licenseNo: d.licenseNo || '',
      licenseExpiry: toDateInput(d.licenseExpiry),
      defaultVehicleId: d.defaultVehicleId || '',
      status: d.status || 'ACTIVE',
      notes: d.notes || '',
    });
    setError('');
    setShowModal(true);
  };

  const save = async () => {
    setError('');
    if (!form.name.trim()) return setError('Driver name is required');
    try {
      const payload = { ...form, defaultVehicleId: form.defaultVehicleId || null };
      if (editing) {
        await api.put(`/drivers/${editing.id}`, payload);
      } else {
        await api.post('/drivers', payload);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    }
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete driver ${d.name}?`)) return;
    try {
      await api.delete(`/drivers/${d.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  if (detail) {
    return <DriverDetail driverId={detail} onBack={() => setDetail(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHero
        title="Driver Movement"
        subtitle="Drivers used for dispatches and ad-hoc trips. Full movement history per driver."
        eyebrow="Logistics"
        icon={IdCard}
        actions={canEdit && <Button onClick={openCreate}><Plus size={16} /> Add Driver</Button>}
      />

      <div className="flex flex-wrap gap-3 items-end">
        <Input
          label="Search"
          placeholder="Name, phone, license…"
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
        ) : drivers.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No drivers yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs uppercase tracking-wider text-gray-600">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">License</th>
                  <th className="px-3 py-2">Default Vehicle</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Trips</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-b hover:bg-blue-50/30 transition-colors">
                    <td className="px-3 py-2 font-semibold text-navy-700">{d.name}</td>
                    <td className="px-3 py-2 text-gray-700">{d.phone || '—'}</td>
                    <td className="px-3 py-2 text-gray-700">
                      <div className="font-mono text-xs">{d.licenseNo || '—'}</div>
                      {d.licenseExpiry && (
                        <div className="text-[10px] text-gray-500">exp {formatDate(d.licenseExpiry)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-mono text-xs">
                      {d.defaultVehicle?.regNumber || '—'}
                    </td>
                    <td className="px-3 py-2"><Badge color={statusBadge(d.status)}>{d.status}</Badge></td>
                    <td className="px-3 py-2 text-gray-700">{d._count?.trips ?? 0}</td>
                    <td className="px-3 py-2 text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => setDetail(d.id)}>
                        <ChevronRight size={14} /> Open
                      </Button>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openEdit(d)}>
                            <Pencil size={14} />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => remove(d)}>
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
        <Modal isOpen onClose={() => setShowModal(false)} title={editing ? 'Edit Driver' : 'Add Driver'}>
          <div className="space-y-3">
            {error && <div className="text-sm text-brand-red">{error}</div>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <Input label="License No" value={form.licenseNo} onChange={(e) => setForm({ ...form, licenseNo: e.target.value })} />
              <Input label="License Expiry" type="date" value={form.licenseExpiry} onChange={(e) => setForm({ ...form, licenseExpiry: e.target.value })} />
              <Select label="Default Vehicle" value={form.defaultVehicleId} onChange={(e) => setForm({ ...form, defaultVehicleId: e.target.value })}>
                <option value="">— None —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.regNumber}{v.make ? ` · ${v.make}${v.model ? ' ' + v.model : ''}` : ''}
                  </option>
                ))}
              </Select>
              <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={save}>{editing ? 'Save Changes' : 'Add Driver'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DriverDetail({ driverId, onBack }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tripFilter, setTripFilter] = useState('ALL');
  const [tripSearch, setTripSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    api.get(`/drivers/${driverId}`)
      .then(({ data }) => setD(data))
      .catch(() => setD(null))
      .finally(() => setLoading(false));
  }, [driverId]);

  const trips = d?.trips || [];
  const gatePasses = d?.gatePasses || [];

  const stats = useMemo(() => {
    const inTransit = trips.filter((t) => t.status === 'IN_TRANSIT').length;
    const returned = trips.filter((t) => t.status === 'RETURNED').length;
    const scheduled = trips.filter((t) => t.status === 'SCHEDULED').length;
    return { total: trips.length, inTransit, returned, scheduled };
  }, [trips]);

  const filteredTrips = useMemo(() => {
    const term = tripSearch.trim().toLowerCase();
    return trips.filter((t) => {
      if (tripFilter !== 'ALL' && t.status !== tripFilter) return false;
      if (!term) return true;
      const hay = [
        t.tripNumber, t.purpose, t.destination, t.vehicle?.regNumber, t.vehicleRegSnap,
        ...(t.gatePasses?.map((g) => g.passNumber) || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [trips, tripFilter, tripSearch]);

  if (loading) return <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>;
  if (!d) return <div className="p-8 text-center text-gray-500 text-sm">Driver not found.</div>;

  return (
    <div className="space-y-6">
      <PageHero
        title={d.name}
        subtitle={d.phone || 'Driver details and movement history.'}
        eyebrow="Driver Detail"
        icon={IdCard}
        actions={<Button variant="outline" onClick={onBack}><ArrowLeft size={14} /> Back</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatPill label="Total Trips" value={stats.total} Icon={Activity} tone="navy" />
        <StatPill label="In Transit" value={stats.inTransit} Icon={Send} tone="blue" />
        <StatPill label="Returned" value={stats.returned} Icon={CheckCircle2} tone="green" />
        <StatPill label="Scheduled" value={stats.scheduled} Icon={Clock} tone="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <div className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-navy-700 mb-2">Identity</h3>
            <Row label="Name" value={d.name} />
            <Row label="Phone" value={d.phone} />
            <Row label="License No" value={d.licenseNo} mono />
            <Row label="License Expiry" value={formatDate(d.licenseExpiry)} />
            <Row label="Status" value={<Badge color={statusBadge(d.status)}>{d.status}</Badge>} />
          </div>
        </Card>
        <Card>
          <div className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-navy-700 mb-2">Default Vehicle</h3>
            <Row label="Reg No" value={d.defaultVehicle?.regNumber} mono />
            <Row label="Make / Model" value={[d.defaultVehicle?.make, d.defaultVehicle?.model].filter(Boolean).join(' ')} />
            <p className="text-[11px] text-gray-500 pt-2 leading-snug">
              A driver's default vehicle is just a hint for dispatchers — any active driver can be paired with any active vehicle at trip time.
            </p>
          </div>
        </Card>
        <Card>
          <div className="p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-navy-700 mb-2">Activity</h3>
            <Row label="Total Trips" value={stats.total} />
            <Row label="Gate Passes Driven" value={gatePasses.length} />
            <Row label="Added On" value={formatDate(d.createdAt)} />
          </div>
        </Card>
      </div>

      {d.notes && (
        <Card><div className="p-4 text-sm whitespace-pre-wrap"><strong>Notes:</strong> {d.notes}</div></Card>
      )}

      <Card>
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-navy-700 flex items-center gap-2">
              <Send size={16} /> Previous Trips ({stats.total})
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                label="Search"
                placeholder="Trip no, vehicle, destination…"
                value={tripSearch}
                onChange={(e) => setTripSearch(e.target.value)}
                className="min-w-[200px]"
              />
              <Select label="Filter" value={tripFilter} onChange={(e) => setTripFilter(e.target.value)} className="min-w-[140px]">
                <option value="ALL">All</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_TRANSIT">In Transit</option>
                <option value="RETURNED">Returned</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </div>
          </div>

          {!trips.length ? (
            <div className="p-6 text-center text-sm text-gray-500">
              This driver hasn't been on any trips yet.
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
                    <th className="px-3 py-2">Trip No</th>
                    <th className="px-3 py-2">Vehicle</th>
                    <th className="px-3 py-2">Purpose / Destination</th>
                    <th className="px-3 py-2">Gate Passes</th>
                    <th className="px-3 py-2">Dispatched</th>
                    <th className="px-3 py-2">Returned</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTrips.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-navy-700">{t.tripNumber}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">
                        {t.vehicle?.regNumber || t.vehicleRegSnap || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {[t.purpose, t.destination].filter(Boolean).join(' → ') || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {t.gatePasses?.length
                          ? t.gatePasses.map((g) => g.passNumber).join(', ')
                          : <span className="italic text-gray-400">ad-hoc</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {t.dispatchedAt ? formatDateTime(t.dispatchedAt) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {t.returnedAt ? formatDateTime(t.returnedAt) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={TRIP_BADGE[t.status] || 'gray'}>{t.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {gatePasses.length > 0 && (
        <Card>
          <div className="p-4 space-y-3">
            <h3 className="font-semibold text-navy-700 flex items-center gap-2">
              <Activity size={16} /> Gate Passes Driven ({gatePasses.length})
            </h3>
            <div className="overflow-x-auto border border-gray-200 rounded">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-left text-xs uppercase tracking-wider text-gray-600">
                    <th className="px-3 py-2">Pass No</th>
                    <th className="px-3 py-2">Vehicle</th>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Party / Job</th>
                    <th className="px-3 py-2">Dispatched</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gatePasses.map((g) => (
                    <tr key={g.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-navy-700">{g.passNumber}</td>
                      <td className="px-3 py-2 font-mono text-gray-700">{g.assignedVehicle?.regNumber || '—'}</td>
                      <td className="px-3 py-2">
                        {g.kind ? <Badge color={g.kind === 'OUTSIDE' ? 'blue' : 'purple'}>{g.kind}</Badge> : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-[16rem] truncate">
                        {g.partyName || g.jobWorkNo || '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {g.dispatchedAt ? formatDateTime(g.dispatchedAt) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge color={STATUS_BADGE[g.status] || 'gray'}>{STATUS_LABEL(g.status)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}
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
