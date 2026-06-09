// Training Records — per-session attendance + evaluation log with uploaded
// notes/evaluation/feedback. HR + Managers (own items) edit; everyone views.
import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardSignature, Plus, X, Save, AlertTriangle, Upload, FileText,
  UserPlus, Trash2, Pencil, ChevronRight, Calendar,
} from 'lucide-react';
import api from '../../api/axios';

const INPUT_CLS = 'mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-200';

const EMPTY_SESSION = {
  planId: '', planItemId: '', subject: '', trainingDateFrom: '', trainingDateTo: '',
  duration: '', place: '', faculty: '', reference: '', notes: '',
};

export default function TrainingRecords() {
  const [sessions, setSessions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [canCreate, setCanCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY_SESSION);
  const [planItems, setPlanItems] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const [attErr, setAttErr] = useState('');
  const [attEmp, setAttEmp] = useState('');

  const loadList = async () => {
    setLoading(true);
    try {
      const [s, p, e, pm] = await Promise.all([
        api.get('/training-sessions'),
        api.get('/training-plans'),
        api.get('/employees', { params: { status: 'ACTIVE' } }),
        api.get('/training-sessions/permissions'),
      ]);
      setSessions(s.data.sessions || []);
      setPlans(p.data.plans || []);
      setEmployees(e.data.employees || []);
      setCanCreate(!!pm.data.canCreate);
      if (!selectedId && s.data.sessions?.length) setSelectedId(s.data.sessions[0].id);
    } catch (er) {
      console.error(er);
    } finally { setLoading(false); }
  };

  const loadDetail = async (id) => {
    if (!id) { setDetail(null); return; }
    try {
      const { data } = await api.get(`/training-sessions/${id}`);
      setDetail(data);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadDetail(selectedId); }, [selectedId]);

  // When plan changes in the form, load its items.
  useEffect(() => {
    if (!form.planId) { setPlanItems([]); return; }
    api.get(`/training-plans/${form.planId}`).then(({ data }) => {
      setPlanItems(data.items || []);
    }).catch(() => setPlanItems([]));
  }, [form.planId]);

  const openCreate = () => { setEditId(null); setForm(EMPTY_SESSION); setErr(''); setShowForm(true); };
  const openEdit = (s) => {
    setEditId(s.id);
    setForm({
      planId: s.planId || '', planItemId: s.planItemId || '',
      subject: s.subject, trainingDateFrom: s.trainingDateFrom?.slice(0, 10) || '',
      trainingDateTo: s.trainingDateTo?.slice(0, 10) || '',
      duration: s.duration || '', place: s.place || '', faculty: s.faculty,
      reference: s.reference || '', notes: s.notes || '',
    });
    setErr(''); setShowForm(true);
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const body = { ...form };
      if (!body.planId) delete body.planId;
      if (!body.planItemId) delete body.planItemId;
      if (editId) await api.put(`/training-sessions/${editId}`, body);
      else {
        const { data } = await api.post('/training-sessions', body);
        setSelectedId(data.id);
      }
      setShowForm(false);
      await loadList();
      if (editId) await loadDetail(editId);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  const removeSession = async (s) => {
    if (!window.confirm(`Delete session ${s.sessionNumber}?`)) return;
    try {
      await api.delete(`/training-sessions/${s.id}`);
      if (selectedId === s.id) setSelectedId(null);
      await loadList();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const addAttendee = async () => {
    setAttErr('');
    if (!attEmp) { setAttErr('Pick an employee.'); return; }
    try {
      await api.post(`/training-sessions/${selectedId}/attendees`, { employeeId: attEmp });
      setAttEmp('');
      await loadDetail(selectedId);
    } catch (e) {
      setAttErr(e.response?.data?.error || e.message);
    }
  };

  const updateAttendee = async (att, patch) => {
    try {
      await api.put(`/training-sessions/${selectedId}/attendees/${att.id}`, patch);
      await loadDetail(selectedId);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const removeAttendee = async (att) => {
    if (!window.confirm(`Remove ${att.employee?.name} from this session?`)) return;
    try {
      await api.delete(`/training-sessions/${selectedId}/attendees/${att.id}`);
      await loadDetail(selectedId);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const uploadField = async (field, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/training-sessions/${selectedId}/upload/${field}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadDetail(selectedId);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const uploadAttendeeSign = async (att, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post(`/training-sessions/${selectedId}/attendees/${att.id}/sign`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadDetail(selectedId);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const availableEmployees = useMemo(() => {
    if (!detail) return employees;
    const used = new Set(detail.attendees.map((a) => a.employeeId));
    return employees.filter((e) => !used.has(e.id));
  }, [employees, detail]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 text-white p-5 shadow">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-amber-100/80">
          <ClipboardSignature size={13} /> HR · Training Records
        </div>
        <div className="text-xl font-bold mt-1">Training Attendance cum Evaluation Records</div>
        <div className="text-xs text-amber-100/80 mt-0.5">One row per delivered session — attendees, evaluation, supporting docs.</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sessions list */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-navy-900">Sessions</div>
            {canCreate && (
              <button onClick={openCreate} className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold">
                <Plus size={12} /> New
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
            {loading ? <div className="text-xs text-gray-400">Loading…</div> : sessions.length === 0 ? (
              <div className="text-xs text-gray-400">No sessions logged.</div>
            ) : sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={`w-full text-left p-3 rounded-lg border ${
                  selectedId === s.id ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200 hover:border-amber-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[11px] text-gray-500">{s.sessionNumber}</div>
                  <ChevronRight size={14} className="text-gray-300" />
                </div>
                <div className="text-sm font-semibold text-navy-900 mt-0.5 truncate">{s.subject}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                  <Calendar size={10} /> {s.trainingDateFrom?.slice(0, 10)}
                  {s.trainingDateTo && <> → {s.trainingDateTo.slice(0, 10)}</>}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">{s.attendees?.length || 0} attendees · {s.faculty}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Session detail */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-4 space-y-4">
          {!detail ? (
            <div className="py-10 text-center text-gray-400 text-sm">Select a session to view details.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
                <div>
                  <div className="font-mono text-xs text-gray-500">{detail.sessionNumber}</div>
                  <h2 className="text-base font-semibold text-navy-900">{detail.subject}</h2>
                  <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-3">
                    <span>From: {detail.trainingDateFrom?.slice(0, 10)}</span>
                    {detail.trainingDateTo && <span>To: {detail.trainingDateTo.slice(0, 10)}</span>}
                    {detail.duration && <span>Duration: {detail.duration}</span>}
                    {detail.place && <span>Place: {detail.place}</span>}
                    <span>Faculty: {detail.faculty}</span>
                    {detail.reference && <span>Ref: {detail.reference}</span>}
                  </div>
                  {detail.plan && <div className="text-[10px] text-gray-400 mt-1">Plan FY {detail.plan.fiscalYear} — {detail.plan.title}</div>}
                  {detail.planItem && <div className="text-[10px] text-gray-400">Item #{detail.planItem.serialNo}: {detail.planItem.subject}</div>}
                </div>
                {canCreate && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => openEdit(detail)} className="p-1.5 rounded hover:bg-amber-50 text-amber-700"><Pencil size={14} /></button>
                    <button onClick={() => removeSession(detail)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>

              {/* File uploads */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <FileBlock label="Training Notes"     url={detail.trainingNotesUrl} onUpload={canCreate ? (f) => uploadField('trainingNotes', f) : null} />
                <FileBlock label="Evaluation"         url={detail.evaluationUrl}    onUpload={canCreate ? (f) => uploadField('evaluation', f) : null} />
                <FileBlock label="Feedback"           url={detail.feedbackUrl}      onUpload={canCreate ? (f) => uploadField('feedback', f) : null} />
                <FileBlock label="Faculty Sign"       url={detail.facultySign}      onUpload={canCreate ? (f) => uploadField('facultySign', f) : null} />
              </div>

              {/* Attendees */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-navy-900">Attendees ({detail.attendees.length})</div>
                </div>

                {canCreate && (
                  <div className="flex items-center gap-2 mb-3">
                    <select value={attEmp} onChange={(e) => setAttEmp(e.target.value)} className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg">
                      <option value="">Pick employee…</option>
                      {availableEmployees.map((e) => (
                        <option key={e.id} value={e.id}>{e.empCode} — {e.name}</option>
                      ))}
                    </select>
                    <button onClick={addAttendee} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold">
                      <UserPlus size={12} /> Add
                    </button>
                  </div>
                )}
                {attErr && <div className="text-xs text-red-700 mb-2">{attErr}</div>}

                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                        <th className="py-2 pr-2">Employee</th>
                        <th className="py-2 pr-2">Designation</th>
                        <th className="py-2 pr-2">Evaluation</th>
                        <th className="py-2 pr-2">Date</th>
                        <th className="py-2 pr-2">Evaluated by</th>
                        <th className="py-2 pr-2">Sign</th>
                        {canCreate && <th className="py-2 pr-2 text-right"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.attendees.length === 0 ? (
                        <tr><td colSpan={7} className="py-4 text-center text-gray-400">No attendees yet.</td></tr>
                      ) : detail.attendees.map((a) => (
                        <tr key={a.id} className="border-b border-gray-100">
                          <td className="py-1.5 pr-2 font-semibold text-navy-900">
                            <div>{a.employee?.name}</div>
                            <div className="text-[10px] text-gray-500 font-mono">{a.employee?.empCode}</div>
                          </td>
                          <td className="py-1.5 pr-2 text-gray-600">{a.employee?.designation || '—'}</td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="text"
                              defaultValue={a.evaluationDetails || ''}
                              disabled={!canCreate}
                              onBlur={(e) => e.target.value !== (a.evaluationDetails || '') && updateAttendee(a, { evaluationDetails: e.target.value })}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="date"
                              defaultValue={a.dateOfEvaluation?.slice(0, 10) || ''}
                              disabled={!canCreate}
                              onBlur={(e) => updateAttendee(a, { dateOfEvaluation: e.target.value || null })}
                              className="px-1.5 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="text"
                              defaultValue={a.evaluatedBy || ''}
                              disabled={!canCreate}
                              onBlur={(e) => e.target.value !== (a.evaluatedBy || '') && updateAttendee(a, { evaluatedBy: e.target.value })}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50"
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            {a.signUrl ? (
                              <a href={a.signUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1">
                                <FileText size={12} /> View
                              </a>
                            ) : <span className="text-gray-400">—</span>}
                            {canCreate && (
                              <label className="block cursor-pointer text-[10px] text-amber-700 hover:underline mt-0.5">
                                <span className="inline-flex items-center gap-1"><Upload size={10} /> Sign</span>
                                <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => uploadAttendeeSign(a, e.target.files[0])} />
                              </label>
                            )}
                          </td>
                          {canCreate && (
                            <td className="py-1.5 pr-2 text-right">
                              <button onClick={() => removeAttendee(a)} className="p-1 rounded hover:bg-red-50 text-red-700"><Trash2 size={12} /></button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {detail.notes && (
                <div className="text-xs text-gray-600 border-t border-gray-100 pt-3">
                  <div className="font-semibold text-gray-500 uppercase tracking-wider text-[10px] mb-1">Notes</div>
                  {detail.notes}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Session form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
              <h2 className="text-base font-semibold text-navy-900">{editId ? 'Edit session' : 'New training session'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              {err && (
                <div className="p-2.5 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex items-center gap-2">
                  <AlertTriangle size={14} /> {err}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Plan (optional)">
                  <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value, planItemId: '' })} className={INPUT_CLS}>
                    <option value="">—</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>FY {p.fiscalYear} — {p.title}</option>)}
                  </select>
                </Field>
                <Field label="Plan item (optional)">
                  <select value={form.planItemId} onChange={(e) => setForm({ ...form, planItemId: e.target.value })} disabled={!form.planId} className={INPUT_CLS}>
                    <option value="">—</option>
                    {planItems.map((it) => <option key={it.id} value={it.id}>#{it.serialNo} — {it.subject}</option>)}
                  </select>
                </Field>
                <Field label="Subject *" wide>
                  <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Training start *">
                  <input type="date" value={form.trainingDateFrom} onChange={(e) => setForm({ ...form, trainingDateFrom: e.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Training end">
                  <input type="date" value={form.trainingDateTo} onChange={(e) => setForm({ ...form, trainingDateTo: e.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Duration">
                  <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} className={INPUT_CLS} placeholder="e.g. 4 hrs / half-day" />
                </Field>
                <Field label="Place">
                  <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Faculty *">
                  <input value={form.faculty} onChange={(e) => setForm({ ...form, faculty: e.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Reference">
                  <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={INPUT_CLS} />
                </Field>
                <Field label="Notes" wide>
                  <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={INPUT_CLS} />
                </Field>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
              <button onClick={save} disabled={saving} className="px-3 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
                <Save size={14} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function FileBlock({ label, url, onUpload }) {
  return (
    <div className="p-2.5 rounded-lg border border-gray-200 bg-gray-50">
      <div className="text-[10px] uppercase font-semibold tracking-wider text-gray-500">{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 mt-1">
          <FileText size={12} /> View
        </a>
      ) : <div className="text-xs text-gray-400 mt-1">No file</div>}
      {onUpload && (
        <label className="block mt-1 cursor-pointer text-[10px] text-amber-700 hover:underline">
          <span className="inline-flex items-center gap-1"><Upload size={10} /> Upload</span>
          <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => onUpload(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
