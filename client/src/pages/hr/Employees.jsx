// List of Employees register — master roster.
// HR/ADMIN/SUPERADMIN can add/edit/delete; everyone else view-only.
import { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Pencil, Trash2, X, Search, Save, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';

const STATUSES = ['ACTIVE', 'INACTIVE'];

const EMPTY = {
  empCode: '', serialNo: '', name: '', designation: '', qualification: '',
  experience: '', category: '', department: '', phone: '', email: '',
  dateOfJoining: '', status: 'ACTIVE', notes: '', userId: '',
};

const INPUT_CLS = 'mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200';

export default function Employees() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/employees', { params: { status: statusFilter || undefined } });
      setList(data.employees || []);
      setCanWrite(!!data.canWrite);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return list;
    return list.filter((e) =>
      [e.empCode, e.name, e.designation, e.category, e.department]
        .filter(Boolean).some((s) => s.toLowerCase().includes(term))
    );
  }, [list, search]);

  const openCreate = () => { setEditId(null); setForm(EMPTY); setErr(''); setShowForm(true); };
  const openEdit = (e) => {
    setEditId(e.id);
    setForm({
      empCode: e.empCode || '',
      serialNo: e.serialNo ?? '',
      name: e.name || '',
      designation: e.designation || '',
      qualification: e.qualification || '',
      experience: e.experience ?? '',
      category: e.category || '',
      department: e.department || '',
      phone: e.phone || '',
      email: e.email || '',
      dateOfJoining: e.dateOfJoining ? e.dateOfJoining.slice(0, 10) : '',
      status: e.status || 'ACTIVE',
      notes: e.notes || '',
      userId: e.userId || '',
    });
    setErr('');
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body = { ...form };
      if (body.userId === '') delete body.userId;
      if (body.serialNo === '') delete body.serialNo;
      if (editId) await api.put(`/employees/${editId}`, body);
      else        await api.post('/employees', body);
      setShowForm(false);
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete ${e.name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/employees/${e.id}`);
      await load();
    } catch (er) {
      alert(er.response?.data?.error || er.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-sky-600 to-blue-700 text-white p-5 shadow">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-sky-100/80">
          <Users size={13} /> HR · Employees
        </div>
        <div className="text-xl font-bold mt-1">List of Employees</div>
        <div className="text-xs text-sky-100/80 mt-0.5">Master roster — designation, qualification, experience, department.</div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name, designation…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <select
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {canWrite && (
            <button onClick={openCreate} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold">
              <Plus size={14} /> New employee
            </button>
          )}
        </div>

        {err && !showForm && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex items-center gap-2">
            <AlertTriangle size={14} /> {err}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Code</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Designation</th>
                <th className="py-2 pr-3">Qualification</th>
                <th className="py-2 pr-3">Exp (yrs)</th>
                <th className="py-2 pr-3">Department</th>
                <th className="py-2 pr-3">Status</th>
                {canWrite && <th className="py-2 pr-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={canWrite ? 9 : 8} className="py-6 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={canWrite ? 9 : 8} className="py-6 text-center text-gray-400">No employees.</td></tr>
              ) : filtered.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 pr-3 text-gray-500">{e.serialNo}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{e.empCode}</td>
                  <td className="py-2 pr-3 font-semibold text-navy-900">{e.name}</td>
                  <td className="py-2 pr-3">{e.designation || '—'}</td>
                  <td className="py-2 pr-3">{e.qualification || '—'}</td>
                  <td className="py-2 pr-3">{e.experience ?? '—'}</td>
                  <td className="py-2 pr-3">{e.department || '—'}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      e.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'
                    }`}>{e.status}</span>
                  </td>
                  {canWrite && (
                    <td className="py-2 pr-3 text-right">
                      <button onClick={() => openEdit(e)} className="p-1.5 rounded hover:bg-blue-50 text-blue-700"><Pencil size={14} /></button>
                      <button onClick={() => remove(e)} className="p-1.5 rounded hover:bg-red-50 text-red-700 ml-1"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold text-navy-900">{editId ? 'Edit employee' : 'New employee'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              {err && (
                <div className="p-2.5 rounded bg-red-50 border border-red-200 text-sm text-red-800">{err}</div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Employee Code *">
                  <input value={form.empCode} onChange={(v) => setForm({ ...form, empCode: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Serial No.">
                  <input type="number" value={form.serialNo} onChange={(v) => setForm({ ...form, serialNo: v.target.value })} className={INPUT_CLS} placeholder="auto" />
                </Field>
                <Field label="Name *">
                  <input value={form.name} onChange={(v) => setForm({ ...form, name: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Designation">
                  <input value={form.designation} onChange={(v) => setForm({ ...form, designation: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Qualification">
                  <input value={form.qualification} onChange={(v) => setForm({ ...form, qualification: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Experience (years)">
                  <input type="number" value={form.experience} onChange={(v) => setForm({ ...form, experience: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Category">
                  <input value={form.category} onChange={(v) => setForm({ ...form, category: v.target.value })} className={INPUT_CLS} placeholder="e.g. Engineer / Technician" />
                </Field>
                <Field label="Department">
                  <input value={form.department} onChange={(v) => setForm({ ...form, department: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Phone">
                  <input value={form.phone} onChange={(v) => setForm({ ...form, phone: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Email">
                  <input type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Date of Joining">
                  <input type="date" value={form.dateOfJoining} onChange={(v) => setForm({ ...form, dateOfJoining: v.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Status">
                  <select value={form.status} onChange={(v) => setForm({ ...form, status: v.target.value })} className={INPUT_CLS}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Notes">
                <textarea rows={2} value={form.notes} onChange={(v) => setForm({ ...form, notes: v.target.value })} className={INPUT_CLS} />
              </Field>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={save} disabled={saving} className="px-3 py-2 text-sm rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
                <Save size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">{label}</span>
      {children}
    </label>
  );
}
