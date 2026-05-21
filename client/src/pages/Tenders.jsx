import { useState, useEffect } from 'react';
import { Briefcase, Plus, Send, Trophy, XCircle, Clock, CheckCircle2, Building2 } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Textarea } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import { formatDate } from '../utils/formatters';

const STATUS_META = {
  ASSIGNED:    { color: 'blue',   label: 'Assigned',    Icon: Send },
  IN_PROGRESS: { color: 'yellow', label: 'In Progress', Icon: Clock },
  SUBMITTED:   { color: 'blue',   label: 'Submitted',   Icon: CheckCircle2 },
  WON:         { color: 'green',  label: 'Won',         Icon: Trophy },
  LOST:        { color: 'red',    label: 'Lost',        Icon: XCircle },
  CANCELLED:   { color: 'gray',   label: 'Cancelled',   Icon: XCircle },
};

const STATUS_TABS = ['ALL', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'WON', 'LOST', 'CANCELLED'];

export default function Tenders() {
  const { user } = useAuth();
  const canCreate = user?.role === 'TENDER_MANAGER' || user?.role === 'ADMIN';
  const [tenders, setTenders] = useState([]);
  const [units, setUnits] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/tenders', { params: {
      status: activeTab === 'ALL' ? undefined : activeTab,
      limit: 200,
      fromDate: fromDate || undefined, toDate: toDate || undefined,
    } })
      .then(({ data }) => setTenders(data.tenders || []))
      .catch(() => setTenders([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [activeTab, refreshKey, fromDate, toDate]);

  useEffect(() => {
    if (canCreate) {
      api.get('/units').then(({ data }) => setUnits(data.units || data || [])).catch(() => setUnits([]));
      api.get('/users/managers')
        .then(({ data }) => setManagers(Array.isArray(data) ? data : (data.users || [])))
        .catch(() => setManagers([]));
    }
  }, [canCreate]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
            <Briefcase size={24} /> Tenders
          </h1>
          <p className="text-sm text-navy-600">Assign and track tender opportunities across units.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} className="mr-1.5" /> New Tender
          </Button>
        )}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                activeTab === tab
                  ? 'bg-navy-800 text-white'
                  : 'bg-navy-50 text-navy-700 hover:bg-navy-100'
              }`}
            >
              {tab === 'ALL' ? 'All' : STATUS_META[tab]?.label || tab}
            </button>
          ))}
        </div>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} />
      </Card>

      {loading ? (
        <Card><p className="text-navy-500 text-center py-8">Loading...</p></Card>
      ) : tenders.length === 0 ? (
        <Card><p className="text-navy-500 text-center py-8">No tenders found.</p></Card>
      ) : (
        <div className="grid gap-3">
          {tenders.map((t) => {
            const meta = STATUS_META[t.status] || { color: 'gray', label: t.status, Icon: Briefcase };
            const Icon = meta.Icon;
            return (
              <Card key={t.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => setDetail(t)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-navy-500">{t.tenderNumber}</span>
                      <Badge color={meta.color}><Icon size={11} className="inline mr-1" />{meta.label}</Badge>
                    </div>
                    <h3 className="font-semibold text-navy-900 truncate">{t.title}</h3>
                    {t.clientName && <p className="text-sm text-navy-600">Client: {t.clientName}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-navy-500 mt-1">
                      <span className="flex items-center gap-1"><Building2 size={11} />{t.unit?.name}</span>
                      {t.assignedTo && <span>Assignee: {t.assignedTo.name}</span>}
                      {t.submissionDate && <span>Due: {formatDate(t.submissionDate)}</span>}
                    </div>
                  </div>
                  {t.estimatedValue != null && (
                    <div className="text-right">
                      <p className="text-xs text-navy-500">Estimated Value</p>
                      <p className="font-semibold text-navy-900">₹{Number(t.estimatedValue).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateTenderModal
          units={units}
          managers={managers}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setRefreshKey((k) => k + 1); }}
        />
      )}

      {detail && (
        <TenderDetailModal
          tender={detail}
          currentUser={user}
          onClose={() => setDetail(null)}
          onUpdated={() => { setDetail(null); setRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

function CreateTenderModal({ units, managers, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', description: '', clientName: '',
    estimatedValue: '', submissionDate: '',
    unitId: '', assignedToId: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const filteredManagers = form.unitId ? managers.filter((m) => m.unitId === form.unitId) : [];

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/tenders', {
        ...form,
        estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
        assignedToId: form.assignedToId || null,
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create tender');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="New Tender" size="lg">
      <form onSubmit={submit} className="space-y-3">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}
        <Input label="Tender Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Client Name" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
          <Input label="Estimated Value (₹)" type="number" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} />
        </div>
        <Input label="Submission Date" type="date" value={form.submissionDate} onChange={(e) => setForm({ ...form, submissionDate: e.target.value })} />
        <div>
          <label className="block text-sm font-medium text-navy-700 mb-1">Assign to Unit *</label>
          <select
            className="w-full border border-navy-200 rounded-md px-3 py-2 text-sm"
            value={form.unitId}
            onChange={(e) => setForm({ ...form, unitId: e.target.value, assignedToId: '' })}
            required
          >
            <option value="">Select unit...</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
          </select>
        </div>
        {form.unitId && (
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1">Assign to Manager (optional)</label>
            <select
              className="w-full border border-navy-200 rounded-md px-3 py-2 text-sm"
              value={form.assignedToId}
              onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}
            >
              <option value="">— Any manager in unit —</option>
              {filteredManagers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
        <Textarea label="Description" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={submitting}>{submitting ? 'Creating...' : 'Create Tender'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function TenderDetailModal({ tender, currentUser, onClose, onUpdated }) {
  const [status, setStatus] = useState(tender.status);
  const [notes, setNotes] = useState(tender.notes || '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isAssignee = currentUser?.id === tender.assignedToId;
  const isTenderMgr = currentUser?.role === 'TENDER_MANAGER' || currentUser?.role === 'ADMIN';
  const canTransition =
    (isAssignee && ['IN_PROGRESS', 'SUBMITTED', 'WON', 'LOST'].includes(status)) ||
    (isTenderMgr && status === 'CANCELLED');

  const update = async () => {
    setError('');
    setSubmitting(true);
    try {
      await api.put(`/tenders/${tender.id}/status`, { status, notes });
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Tender ${tender.tenderNumber}`} size="lg">
      <div className="space-y-3">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-navy-500">Title:</span> <span className="font-medium">{tender.title}</span></div>
          <div><span className="text-navy-500">Client:</span> {tender.clientName || '—'}</div>
          <div><span className="text-navy-500">Unit:</span> {tender.unit?.name}</div>
          <div><span className="text-navy-500">Assignee:</span> {tender.assignedTo?.name || '—'}</div>
          <div><span className="text-navy-500">Estimated:</span> ₹{tender.estimatedValue != null ? Number(tender.estimatedValue).toLocaleString() : '—'}</div>
          <div><span className="text-navy-500">Due:</span> {tender.submissionDate ? formatDate(tender.submissionDate) : '—'}</div>
        </div>

        {tender.description && (
          <div>
            <p className="text-xs text-navy-500 mb-1">Description</p>
            <p className="text-sm text-navy-800 whitespace-pre-wrap">{tender.description}</p>
          </div>
        )}

        {(isAssignee || isTenderMgr) && (
          <div className="border-t pt-3 space-y-2">
            <div>
              <label className="block text-sm font-medium text-navy-700 mb-1">Status</label>
              <select
                className="w-full border border-navy-200 rounded-md px-3 py-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {(isAssignee ? ['IN_PROGRESS', 'SUBMITTED', 'WON', 'LOST'] : ['ASSIGNED', 'CANCELLED']).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                ))}
              </select>
            </div>
            <Textarea label="Notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button onClick={update} disabled={submitting || !canTransition}>
                {submitting ? 'Saving...' : 'Update'}
              </Button>
            </div>
          </div>
        )}

        {!isAssignee && !isTenderMgr && (
          <div className="flex justify-end pt-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
