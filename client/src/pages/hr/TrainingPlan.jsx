// Annual Training Plan — HR creates/edits the plan; Managers add items for
// their unit; everyone else view-only.
import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Plus, Pencil, Trash2, X, Save, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const PLAN_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const ITEM_STATUSES = ['PLANNED', 'SCHEDULED', 'COMPLETED', 'CANCELLED'];
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

const INPUT_CLS = 'mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200';

const EMPTY_PLAN = { fiscalYear: '', title: '', reference: '', preparedBy: '', approvedBy: '', status: 'DRAFT' };
const EMPTY_ITEM = {
  subject: '', participants: '', faculty: '', scheduledMonth: '', actualMonth: '',
  hoursPerMonth: '', remarks: '', status: 'PLANNED', category: '',
};

export default function TrainingPlan() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [perms, setPerms] = useState({ canEditPlan: false, canAddItems: false });
  const [loading, setLoading] = useState(true);

  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planEditId, setPlanEditId] = useState(null);
  const [planErr, setPlanErr] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);

  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemEditId, setItemEditId] = useState(null);
  const [itemErr, setItemErr] = useState('');
  const [savingItem, setSavingItem] = useState(false);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const [{ data: p }, { data: pm }] = await Promise.all([
        api.get('/training-plans'),
        api.get('/training-plans/permissions'),
      ]);
      setPlans(p.plans || []);
      setPerms(pm);
      if (!selectedId && p.plans?.length) setSelectedId(p.plans[0].id);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  };

  const loadDetail = async (id) => {
    if (!id) { setDetail(null); return; }
    try {
      const { data } = await api.get(`/training-plans/${id}`);
      setDetail(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { loadPlans(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { loadDetail(selectedId); }, [selectedId]);

  // Plan form
  const openCreatePlan = () => { setPlanEditId(null); setPlanForm(EMPTY_PLAN); setPlanErr(''); setShowPlanForm(true); };
  const openEditPlan = (p) => {
    setPlanEditId(p.id);
    setPlanForm({
      fiscalYear: p.fiscalYear, title: p.title, reference: p.reference || '',
      preparedBy: p.preparedBy || '', approvedBy: p.approvedBy || '', status: p.status,
    });
    setPlanErr(''); setShowPlanForm(true);
  };
  const savePlan = async () => {
    setSavingPlan(true); setPlanErr('');
    try {
      if (planEditId) {
        await api.put(`/training-plans/${planEditId}`, planForm);
      } else {
        const { data } = await api.post('/training-plans', planForm);
        setSelectedId(data.id);
      }
      setShowPlanForm(false);
      await loadPlans();
      if (planEditId) await loadDetail(planEditId);
    } catch (e) {
      setPlanErr(e.response?.data?.error || e.message);
    } finally { setSavingPlan(false); }
  };
  const deletePlan = async (p) => {
    if (!window.confirm(`Delete plan ${p.fiscalYear}? This cannot be undone.`)) return;
    try {
      await api.delete(`/training-plans/${p.id}`);
      if (selectedId === p.id) setSelectedId(null);
      await loadPlans();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
  };

  // Item form
  const openCreateItem = () => { setItemEditId(null); setItemForm(EMPTY_ITEM); setItemErr(''); setShowItemForm(true); };
  const openEditItem = (it) => {
    setItemEditId(it.id);
    setItemForm({
      subject: it.subject, participants: it.participants,
      faculty: it.faculty || '', scheduledMonth: it.scheduledMonth || '',
      actualMonth: it.actualMonth || '',
      hoursPerMonth: it.hoursPerMonth ?? '',
      remarks: it.remarks || '', status: it.status, category: it.category || '',
    });
    setItemErr(''); setShowItemForm(true);
  };
  const saveItem = async () => {
    setSavingItem(true); setItemErr('');
    try {
      if (itemEditId) {
        await api.put(`/training-plans/items/${itemEditId}`, itemForm);
      } else {
        await api.post(`/training-plans/${selectedId}/items`, itemForm);
      }
      setShowItemForm(false);
      await loadDetail(selectedId);
    } catch (e) {
      setItemErr(e.response?.data?.error || e.message);
    } finally { setSavingItem(false); }
  };
  const deleteItem = async (it) => {
    if (!window.confirm(`Delete item "${it.subject}"?`)) return;
    try {
      await api.delete(`/training-plans/items/${it.id}`);
      await loadDetail(selectedId);
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    }
  };

  const canEditItem = (it) => {
    if (!detail) return false;
    if (perms.canEditPlan) return true; // HR/ADMIN
    if (user?.role === 'MANAGER') {
      if (it.createdById === user.id) return true;
      if (it.unitId && it.unitId === user.unitId) return true;
    }
    return false;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white p-5 shadow">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-emerald-100/80">
          <CalendarRange size={13} /> HR · Annual Training Plan
        </div>
        <div className="text-xl font-bold mt-1">Annual Training Plan</div>
        <div className="text-xs text-emerald-100/80 mt-0.5">
          HR sets the fiscal-year plan; Unit Managers add training items for their team.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Plan list */}
        <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-navy-900">Plans</div>
            {perms.canEditPlan && (
              <button onClick={openCreatePlan} className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
                <Plus size={12} /> New
              </button>
            )}
          </div>
          {loading ? <div className="text-xs text-gray-400">Loading…</div> : plans.length === 0 ? (
            <div className="text-xs text-gray-400">No plans yet.</div>
          ) : plans.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`w-full text-left p-3 rounded-lg border ${
                selectedId === p.id ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200 hover:border-emerald-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-navy-900">FY {p.fiscalYear}</div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
                  p.status === 'DRAFT' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'
                }`}>{p.status}</span>
              </div>
              <div className="text-xs text-gray-600 mt-1 truncate">{p.title}</div>
              <div className="text-[10px] text-gray-400 mt-1">{p._count?.items || 0} items · {p._count?.sessions || 0} sessions</div>
            </button>
          ))}
        </div>

        {/* Plan detail */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-4">
          {!detail ? (
            <div className="py-10 text-center text-gray-400 text-sm">Select a plan to see items.</div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3 mb-3">
                <div>
                  <div className="text-xs text-gray-500">FY {detail.fiscalYear}</div>
                  <h2 className="text-base font-semibold text-navy-900">{detail.title}</h2>
                  {(detail.reference || detail.preparedBy || detail.approvedBy) && (
                    <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-3">
                      {detail.reference  && <span>Ref: {detail.reference}</span>}
                      {detail.preparedBy && <span>Prepared by: {detail.preparedBy}</span>}
                      {detail.approvedBy && <span>Approved by: {detail.approvedBy}</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {perms.canEditPlan && (
                    <>
                      <button onClick={() => openEditPlan(detail)} className="p-1.5 rounded hover:bg-emerald-50 text-emerald-700"><Pencil size={14} /></button>
                      <button onClick={() => deletePlan(detail)} className="p-1.5 rounded hover:bg-red-50 text-red-700"><Trash2 size={14} /></button>
                    </>
                  )}
                  {detail.canAddItems && (
                    <button onClick={openCreateItem} className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
                      <Plus size={12} /> Add item
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-2">Subject</th>
                      <th className="py-2 pr-2">Participants</th>
                      <th className="py-2 pr-2">Faculty</th>
                      <th className="py-2 pr-2">Scheduled</th>
                      <th className="py-2 pr-2">Actual</th>
                      <th className="py-2 pr-2">Hrs/mo</th>
                      <th className="py-2 pr-2">Unit</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2 pr-2">Owner</th>
                      <th className="py-2 pr-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.length === 0 ? (
                      <tr><td colSpan={11} className="py-6 text-center text-gray-400">No items yet.</td></tr>
                    ) : detail.items.map((it) => (
                      <tr key={it.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 pr-2 text-gray-500">{it.serialNo}</td>
                        <td className="py-2 pr-2 font-semibold text-navy-900">{it.subject}</td>
                        <td className="py-2 pr-2">{it.participants}</td>
                        <td className="py-2 pr-2">{it.faculty || '—'}</td>
                        <td className="py-2 pr-2">{it.scheduledMonth || '—'}</td>
                        <td className="py-2 pr-2">{it.actualMonth || '—'}</td>
                        <td className="py-2 pr-2">{it.hoursPerMonth ?? '—'}</td>
                        <td className="py-2 pr-2">{it.unit?.code || '—'}</td>
                        <td className="py-2 pr-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            it.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                            it.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' :
                            it.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                          }`}>{it.status}</span>
                        </td>
                        <td className="py-2 pr-2 text-[10px] text-gray-500">{it.createdBy?.name || '—'}</td>
                        <td className="py-2 pr-2 text-right">
                          {canEditItem(it) && (
                            <>
                              <button onClick={() => openEditItem(it)} className="p-1 rounded hover:bg-emerald-50 text-emerald-700"><Pencil size={12} /></button>
                              <button onClick={() => deleteItem(it)} className="p-1 rounded hover:bg-red-50 text-red-700 ml-1"><Trash2 size={12} /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Plan form modal */}
      {showPlanForm && (
        <Modal title={planEditId ? 'Edit plan' : 'New training plan'} onClose={() => setShowPlanForm(false)}>
          {planErr && <Err msg={planErr} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Fiscal Year *">
              <input value={planForm.fiscalYear} onChange={(e) => setPlanForm({ ...planForm, fiscalYear: e.target.value })} className={INPUT_CLS} placeholder="e.g. 2026-27" />
            </Field>
            <Field label="Status">
              <select value={planForm.status} onChange={(e) => setPlanForm({ ...planForm, status: e.target.value })} className={INPUT_CLS}>
                {PLAN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Title *" wide>
              <input value={planForm.title} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} className={INPUT_CLS} />
            </Field>
            <Field label="Reference">
              <input value={planForm.reference} onChange={(e) => setPlanForm({ ...planForm, reference: e.target.value })} className={INPUT_CLS} />
            </Field>
            <Field label="Prepared by">
              <input value={planForm.preparedBy} onChange={(e) => setPlanForm({ ...planForm, preparedBy: e.target.value })} className={INPUT_CLS} />
            </Field>
            <Field label="Approved by">
              <input value={planForm.approvedBy} onChange={(e) => setPlanForm({ ...planForm, approvedBy: e.target.value })} className={INPUT_CLS} />
            </Field>
          </div>
          <FormActions onCancel={() => setShowPlanForm(false)} onSave={savePlan} saving={savingPlan} />
        </Modal>
      )}

      {/* Item form modal */}
      {showItemForm && (
        <Modal title={itemEditId ? 'Edit training item' : 'Add training item'} onClose={() => setShowItemForm(false)}>
          {itemErr && <Err msg={itemErr} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Subject *" wide>
              <input value={itemForm.subject} onChange={(e) => setItemForm({ ...itemForm, subject: e.target.value })} className={INPUT_CLS} />
            </Field>
            <Field label="Participants *" wide>
              <input value={itemForm.participants} onChange={(e) => setItemForm({ ...itemForm, participants: e.target.value })} className={INPUT_CLS} placeholder="e.g. Unit-5 Designs team" />
            </Field>
            <Field label="Faculty">
              <input value={itemForm.faculty} onChange={(e) => setItemForm({ ...itemForm, faculty: e.target.value })} className={INPUT_CLS} />
            </Field>
            <Field label="Category">
              <input value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} className={INPUT_CLS} placeholder="e.g. Quality / Safety" />
            </Field>
            <Field label="Scheduled month">
              <select value={itemForm.scheduledMonth} onChange={(e) => setItemForm({ ...itemForm, scheduledMonth: e.target.value })} className={INPUT_CLS}>
                <option value="">—</option>
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Actual month">
              <select value={itemForm.actualMonth} onChange={(e) => setItemForm({ ...itemForm, actualMonth: e.target.value })} className={INPUT_CLS}>
                <option value="">—</option>
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Hours / month">
              <input type="number" step="0.5" value={itemForm.hoursPerMonth} onChange={(e) => setItemForm({ ...itemForm, hoursPerMonth: e.target.value })} className={INPUT_CLS} />
            </Field>
            <Field label="Status">
              <select value={itemForm.status} onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })} className={INPUT_CLS}>
                {ITEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Remarks" wide>
              <textarea rows={2} value={itemForm.remarks} onChange={(e) => setItemForm({ ...itemForm, remarks: e.target.value })} className={INPUT_CLS} />
            </Field>
          </div>
          <FormActions onCancel={() => setShowItemForm(false)} onSave={saveItem} saving={savingItem} />
        </Modal>
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
function Err({ msg }) {
  return <div className="p-2.5 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex items-center gap-2"><AlertTriangle size={14} /> {msg}</div>;
}
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-navy-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  );
}
function FormActions({ onCancel, onSave, saving }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button onClick={onCancel} className="px-3 py-2 text-sm border border-gray-200 rounded-lg">Cancel</button>
      <button onClick={onSave} disabled={saving} className="px-3 py-2 text-sm rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50">
        <Save size={14} /> {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
