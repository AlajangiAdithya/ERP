import { Fragment, useState, useEffect } from 'react';
import { Plus, Trash2, FlaskConical, Send, CheckCircle2, Package, Hash, Calendar, Users, ClipboardList } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useAutoRefresh } from '../context/NotificationContext';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatDate } from '../utils/formatters';
import IONPdf from '../components/pdf/IONPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import PageHero from '../components/shared/PageHero';

const STATUS_TABS = [
  { key: 'ALL',       label: 'All' },
  { key: 'SENT',      label: 'Sent' },
  { key: 'WAITING',   label: 'In Progress' },
  { key: 'WORK_DONE', label: 'Work Done' },
  { key: 'COLLECTED', label: 'Completed' },
];

const statusColor = (s) => ({ SENT: 'yellow', WAITING: 'blue', WORK_DONE: 'purple', COLLECTED: 'green' }[s] || 'gray');
const statusLabel = (s) => ({ SENT: 'Sent', WAITING: 'In Progress', WORK_DONE: 'Work Done', COLLECTED: 'Completed' }[s] || s);

const RECIPIENT_ROLES = ['LAB', 'METROLOGY', 'NDT', 'RND'];
const CREATOR_ROLES  = ['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'RND'];

const isNdtIon = (n) => n?.recipientRole === 'NDT' || n?.assignedTo?.role === 'NDT';

const blankItem = () => ({
  jobIdentification: '', activityRequired: '', materialComposition: '', drawingNo: '', specification: '',
});

const GB = 'border-r-2 border-navy-200'; // group border class

export default function InterOfficeNote() {
  const { user } = useAuth();
  const isManager   = user?.role === 'MANAGER';
  const isRecipient = RECIPIENT_ROLES.includes(user?.role);
  const canCreate   = CREATOR_ROLES.includes(user?.role);

  const incomingForMe = (n) => {
    if (isRecipient) return (!n.assignedToId && n.recipientRole === user.role) || n.assignedTo?.role === user.role;
    if (isManager)   return n.assignedToId === user.id;
    return false;
  };

  const [tab,        setTab]        = useState('ALL');
  const [ions,       setIons]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail,     setDetail]     = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState('');
  const globalRefreshKey = useAutoRefresh();

  const load = () => {
    setLoading(true);
    const params = { limit: 200, fromDate: fromDate || undefined, toDate: toDate || undefined };
    if (tab !== 'ALL') params.status = tab;
    api.get('/ion', { params })
      .then(({ data }) => setIons(data.ions || []))
      .catch(() => setIons([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab, refreshKey, fromDate, toDate, globalRefreshKey]);

  const recipientLabel = (n) => {
    if (n.assignedTo) return `${n.assignedTo.name}${n.assignedTo.unit?.code ? ` (${n.assignedTo.unit.code})` : ''}`;
    const r = n.recipientRole;
    if (!r) return 'Lab';
    if (r === 'RND') return 'R&D';
    if (r === 'METROLOGY') return 'Metrology';
    return r.charAt(0) + r.slice(1).toLowerCase();
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="Inter Office Note"
        subtitle={canCreate ? 'Raise lab / metrology / NDT / R&D / unit work orders.' : 'Incoming work orders from production.'}
        eyebrow="Work Orders"
        icon={FlaskConical}
        actions={canCreate && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New ION
          </Button>
        )}
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex gap-2 border-b border-gray-200">
          {STATUS_TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
      </div>

      {/* Excel-style table */}
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : ions.length === 0 ? (
        <Card className="text-center text-gray-500 py-10">No inter office notes yet.</Card>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-xs" style={{ minWidth: 1900 }}>
            <thead>
              {/* Group header row */}
              <tr className="bg-navy-50 text-navy-700 border-b border-navy-200 text-[10px] font-bold uppercase tracking-wider">
                <th colSpan={3} className={`px-3 py-2 text-left ${GB}`}>
                  <span className="flex items-center gap-1"><Hash size={11} /> ION Reference</span>
                </th>
                <th colSpan={3} className={`px-3 py-2 text-left ${GB}`}>
                  <span className="flex items-center gap-1"><ClipboardList size={11} /> Work Details</span>
                </th>
                <th colSpan={2} className={`px-3 py-2 text-left ${GB}`}>
                  <span className="flex items-center gap-1"><Users size={11} /> Parties</span>
                </th>
                <th colSpan={2} className={`px-3 py-2 text-left ${GB}`}>
                  <span className="flex items-center gap-1"><Calendar size={11} /> Schedule</span>
                </th>
                <th colSpan={3} className={`px-3 py-2 text-left ${GB}`}>
                  <span className="flex items-center gap-1"><CheckCircle2 size={11} /> Completion</span>
                </th>
                <th className="px-3 py-2 text-center">Items</th>
                <th className="px-3 py-2 text-center">Action</th>
              </tr>

              {/* Column header row */}
              <tr className="bg-gray-50 text-gray-600 border-b-2 border-gray-200 font-medium text-[11px]">
                <th className="px-3 py-2 text-left whitespace-nowrap">ION No.</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Date</th>
                <th className={`px-3 py-2 text-left whitespace-nowrap ${GB}`}>Status</th>

                <th className="px-3 py-2 text-left whitespace-nowrap">Project</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">WO No.</th>
                <th className={`px-3 py-2 text-left whitespace-nowrap ${GB}`}>Ref Doc / QA Plan</th>

                <th className="px-3 py-2 text-left whitespace-nowrap">Sent By</th>
                <th className={`px-3 py-2 text-left whitespace-nowrap ${GB}`}>Sent To</th>

                <th className="px-3 py-2 text-left whitespace-nowrap">Mat. Supply Date</th>
                <th className={`px-3 py-2 text-left whitespace-nowrap ${GB}`}>Required By</th>

                <th className="px-3 py-2 text-left whitespace-nowrap">Work Done Date</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">Report No.</th>
                <th className={`px-3 py-2 text-left whitespace-nowrap ${GB}`}>Collected By</th>

                <th className="px-3 py-2 text-center whitespace-nowrap">#</th>
                <th className="px-3 py-2 text-center whitespace-nowrap">—</th>
              </tr>
            </thead>
            <tbody>
              {ions.map((n, i) => (
                <tr
                  key={n.id}
                  className={`border-b border-gray-100 transition-colors hover:bg-navy-50 ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'}`}>
                  {/* ION Reference */}
                  <td className="px-3 py-2 font-semibold text-navy-700 whitespace-nowrap">
                    {n.ionNumber}
                    {incomingForMe(n) && n.status !== 'COLLECTED' && (
                      <Badge color="purple" className="ml-1.5">For you</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(n.createdAt)}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${GB}`}>
                    <Badge color={statusColor(n.status)}>{statusLabel(n.status)}</Badge>
                  </td>

                  {/* Work Details */}
                  <td className="px-3 py-2 text-gray-700">{n.projectName || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{n.supplyOrderNo || '—'}</td>
                  <td className={`px-3 py-2 text-gray-500 ${GB}`}>{n.referenceDocQA || '—'}</td>

                  {/* Parties */}
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                    {n.createdBy?.name || '—'}
                    {n.createdBy?.unit?.code && <span className="text-gray-400"> ({n.createdBy.unit.code})</span>}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap text-gray-600 ${GB}`}>{recipientLabel(n)}</td>

                  {/* Schedule */}
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{n.materialSupplyDate ? formatDate(n.materialSupplyDate) : '—'}</td>
                  <td className={`px-3 py-2 whitespace-nowrap text-gray-500 ${GB}`}>{n.requiredByDate ? formatDate(n.requiredByDate) : '—'}</td>

                  {/* Completion */}
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{n.completedDate ? formatDate(n.completedDate) : '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{n.reportNoAndDate || '—'}</td>
                  <td className={`px-3 py-2 text-gray-600 ${GB}`}>{n.collectedBy || '—'}</td>

                  {/* Items count */}
                  <td className="px-3 py-2 text-center text-gray-500">{n.items?.length || 0}</td>

                  {/* Action */}
                  <td className="px-3 py-2 text-center">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(n)}>View</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateIONModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setRefreshKey(k => k + 1); }}
        />
      )}

      {detail && (
        <DetailModal
          ion={detail}
          currentUser={user}
          onClose={() => setDetail(null)}
          onAction={() => { setDetail(null); setRefreshKey(k => k + 1); }}
        />
      )}
    </div>
  );
}

/* ─── Create ION Modal ─────────────────────────────────────────────────────── */

function CreateIONModal({ onClose, onCreated }) {
  const [recipientType, setRecipientType] = useState('LAB');
  const [workOrders,    setWorkOrders]    = useState([]);
  const [units,         setUnits]         = useState([]);
  const [form, setForm] = useState({
    projectName: '', supplyOrderNo: '', referenceDocQA: '',
    materialSupplyDate: '', requiredByDate: '',
    sampleRequired: false, reportGeneration: false,
    externalQAWitness: '', qcContactDetails: '',
    otherInformation: '', remarks: '',
  });
  const [items,  setItems]  = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    api.get('/work-orders/assignable')
      .then(({ data }) => setWorkOrders(data.workOrders || []))
      .catch(() => setWorkOrders([]));
    api.get('/units')
      .then(({ data }) => setUnits(Array.isArray(data) ? data : (data.units || [])))
      .catch(() => setUnits([]));
  }, []);

  const update     = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem    = () => setItems([...items, blankItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (items.some(i => !String(i.jobIdentification || '').trim())) return setError('Each item needs a Job Identification');
    setSaving(true);
    const isUnit = recipientType.startsWith('UNIT:');
    const unitId = isUnit ? recipientType.slice(5) : null;
    try {
      await api.post('/ion', {
        recipientType:  isUnit ? 'UNIT' : recipientType,
        assignedUnitId: unitId,
        assignedToId:   null,
        projectName:        form.projectName,
        supplyOrderNo:      form.supplyOrderNo,
        referenceDocQA:     form.referenceDocQA,
        materialSupplyDate: form.materialSupplyDate || null,
        requiredByDate:     form.requiredByDate || null,
        externalQAWitness:  form.externalQAWitness,
        qcContactDetails:   form.qcContactDetails,
        otherInformation:   form.otherInformation,
        remarks:            form.remarks,
        sampleRequired:     form.sampleRequired,
        reportGeneration:   form.reportGeneration,
        items: items.map(i => ({
          jobIdentification: String(i.jobIdentification).trim(),
          activityRequired:  i.activityRequired || null,
          materialComposition: i.materialComposition || null,
          drawingNo:         i.drawingNo || null,
          specification:     i.specification || null,
        })),
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create ION');
    }
    setSaving(false);
  };

  const unitName = recipientType.startsWith('UNIT:')
    ? (units.find(u => u.id === recipientType.slice(5))?.name || 'Unit')
    : null;
  const sendLabel = unitName ?? (recipientType === 'NDT' ? 'NDT' : recipientType === 'RND' ? 'R&D' : recipientType.charAt(0) + recipientType.slice(1).toLowerCase());

  return (
    <Modal isOpen onClose={onClose} title="New Inter Office Note" size="full">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded">
          Doc No: RAMS/ION/00 — Work Order / Inter Office Note
        </div>

        {/* Recipient */}
        <div className="bg-navy-50 border border-navy-200 rounded-md p-3 space-y-3">
          <h4 className="text-sm font-semibold text-navy-800 flex items-center gap-2">
            <Send size={14} /> Send to
          </h4>
          <Select label="Select department / unit" value={recipientType} onChange={e => setRecipientType(e.target.value)}>
            <optgroup label="Departments">
              <option value="LAB">Lab</option>
              <option value="METROLOGY">Metrology</option>
              <option value="NDT">NDT</option>
              <option value="RND">R&D</option>
            </optgroup>
            {units.length > 0 && (
              <optgroup label="Units">
                {units.map(u => (
                  <option key={u.id} value={`UNIT:${u.id}`}>{u.name}{u.code ? ` (${u.code})` : ''}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>

        <FormFields
          form={form} update={update} items={items}
          updateItem={updateItem} addItem={addItem} removeItem={removeItem}
          workOrders={workOrders}
        />

        <Textarea label="Remarks" value={form.remarks} onChange={e => update('remarks', e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Sending…' : `Send to ${sendLabel}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Form fields (shared) ─────────────────────────────────────────────────── */

function FormFields({ form, update, items, updateItem, addItem, removeItem, workOrders = [] }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="Project Name" value={form.projectName} onChange={e => update('projectName', e.target.value)} />
        <Select label="Work Order No." value={form.supplyOrderNo} onChange={e => update('supplyOrderNo', e.target.value)}>
          <option value="">— Select work order —</option>
          {workOrders.map(wo => (
            <option key={wo.id} value={wo.workOrderNumber}>
              {wo.workOrderNumber}{wo.nomenclature ? ` — ${wo.nomenclature}` : wo.customerName ? ` — ${wo.customerName}` : ''}
            </option>
          ))}
        </Select>
        <Input label="Ref Doc / QA Plan" value={form.referenceDocQA} onChange={e => update('referenceDocQA', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input type="date" label="Material Supply Date" value={form.materialSupplyDate} onChange={e => update('materialSupplyDate', e.target.value)} />
        <Input type="date" label="Required By Date"     value={form.requiredByDate}     onChange={e => update('requiredByDate', e.target.value)} />
        <Select label="Sample Requirement" value={form.sampleRequired ? 'yes' : 'no'} onChange={e => update('sampleRequired', e.target.value === 'yes')}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Select label="Report Generation" value={form.reportGeneration ? 'yes' : 'no'} onChange={e => update('reportGeneration', e.target.value === 'yes')}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
        <Input label="External QA/QC Witness" value={form.externalQAWitness} onChange={e => update('externalQAWitness', e.target.value)} placeholder="SSQAG / ANSP / R&QA / Others" />
        <Input label="QC Contact Details"     value={form.qcContactDetails}   onChange={e => update('qcContactDetails', e.target.value)} placeholder="Phone / email" />
      </div>

      {/* Job items table */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-gray-800">Job Items</h4>
          <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add item</Button>
        </div>
        <div className="border border-gray-200 rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-left text-gray-600 text-xs">
                <th className="px-2 py-1.5 w-10">#</th>
                <th className="px-2 py-1.5">Job Identification</th>
                <th className="px-2 py-1.5">Activity Required</th>
                <th className="px-2 py-1.5">Material Composition</th>
                <th className="px-2 py-1.5">Drawing No</th>
                <th className="px-2 py-1.5">QAP No.</th>
                <th className="px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 text-gray-500">{idx + 1}</td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.jobIdentification}   onChange={e => updateItem(idx, 'jobIdentification',   e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.activityRequired}    onChange={e => updateItem(idx, 'activityRequired',    e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.materialComposition} onChange={e => updateItem(idx, 'materialComposition', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.drawingNo}           onChange={e => updateItem(idx, 'drawingNo',           e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.specification}       onChange={e => updateItem(idx, 'specification',       e.target.value)} /></td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 disabled:opacity-30" disabled={items.length === 1}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Textarea label="Other Information" value={form.otherInformation} onChange={e => update('otherInformation', e.target.value)} rows={2} />
    </>
  );
}

/* ─── Detail Modal ─────────────────────────────────────────────────────────── */

function DetailModal({ ion: initial, currentUser, onClose, onAction }) {
  const [n,              setN]            = useState(initial);
  const [busy,           setBusy]         = useState(false);
  const [error,          setError]        = useState('');
  const [workDoneOpen,   setWorkDoneOpen] = useState(false);
  const [collectedOpen,  setCollectedOpen]= useState(false);

  const ndt = isNdtIon(n);

  const isRecipientRole   = RECIPIENT_ROLES.includes(currentUser?.role);
  const isAssignedManager = currentUser?.role === 'MANAGER' && n.assignedToId === currentUser?.id;
  const canAct =
    (isRecipientRole && (
      (!n.assignedToId && n.recipientRole === currentUser.role) ||
      n.assignedTo?.role === currentUser.role
    )) || isAssignedManager;

  const act = async (status, extra = {}) => {
    setError(''); setBusy(true);
    try {
      const { data } = await api.put(`/ion/${n.id}/status`, { status, ...extra });
      setN(data);
      onAction();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    }
    setBusy(false);
  };

  const canStart         = canAct && n.status === 'SENT';
  const canMarkWorkDone  = canAct && n.status === 'WAITING';
  const canMarkCollected = canAct && n.status === 'WORK_DONE';

  return (
    <Modal isOpen onClose={onClose} title={`ION ${n.ionNumber}`} size="xl">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge color={statusColor(n.status)}>{statusLabel(n.status)}</Badge>
            <span className="text-xs text-amber-600">Doc No: RAMS/ION/00</span>
          </div>
          <DownloadPdfButton document={<IONPdf data={n} />} fileName={`${n.ionNumber}.pdf`} label="View ION PDF" />
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="Date"               value={formatDate(n.createdAt)} />
          <Field label="Project Name"        value={n.projectName} />
          <Field label="Work Order No."      value={n.supplyOrderNo} />
          <Field label="Ref Doc / QA Plan"   value={n.referenceDocQA} />
          <Field label="Material Supply Date" value={n.materialSupplyDate ? formatDate(n.materialSupplyDate) : '—'} />
          <Field label="Required By"         value={n.requiredByDate ? formatDate(n.requiredByDate) : '—'} />
          <Field label="Sample Required"     value={n.sampleRequired ? 'Yes' : 'No'} />
          <Field label="Report Generation"   value={n.reportGeneration ? 'Yes' : 'No'} />
          <Field label="External QA Witness" value={n.externalQAWitness} />
          <Field label="QC Contact"          value={n.qcContactDetails} />
          <Field label="Raised By"           value={`${n.createdBy?.name || '—'}${n.createdBy?.unit?.name ? ' — ' + n.createdBy.unit.name : ''}`} />
          <Field label="Sent To"             value={n.assignedTo
            ? `${n.assignedTo.name}${n.assignedTo.unit?.name ? ' — ' + n.assignedTo.unit.name : ''} (${n.assignedTo.role})`
            : `${n.recipientRole === 'RND' ? 'R&D' : n.recipientRole || 'Lab'} (any available)`} />
        </div>

        {/* Completion info (shown once relevant) */}
        {(n.completedDate || n.reportNoAndDate || n.collectedBy) && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            {n.completedDate   && <Field label="Work Done Date" value={formatDate(n.completedDate)} />}
            {n.reportNoAndDate && <Field label="Report No."     value={n.reportNoAndDate} />}
            {n.collectedBy     && <Field label="Collected By"   value={n.collectedBy} />}
          </div>
        )}

        {/* Job Items */}
        <div>
          <h4 className="font-medium text-gray-800 mb-2">Job Items</h4>
          <div className="border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                {ndt && n.items?.some(i => i.nameOfJob || i.qty) ? (
                  <tr className="text-left text-gray-600 text-xs">
                    <th className="px-3 py-1.5">#</th>
                    <th className="px-3 py-1.5">Name of Job</th>
                    <th className="px-3 py-1.5">Job Identification</th>
                    <th className="px-3 py-1.5">Material</th>
                    <th className="px-3 py-1.5">Qty</th>
                    <th className="px-3 py-1.5">Activity</th>
                    <th className="px-3 py-1.5">Remarks</th>
                  </tr>
                ) : (
                  <tr className="text-left text-gray-600 text-xs">
                    <th className="px-3 py-1.5">#</th>
                    <th className="px-3 py-1.5">Job Identification</th>
                    <th className="px-3 py-1.5">Activity</th>
                    <th className="px-3 py-1.5">Material</th>
                    <th className="px-3 py-1.5">Drawing No</th>
                    <th className="px-3 py-1.5">QAP No.</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {(n.items || []).map((it, idx) => ndt && (it.nameOfJob || it.qty) ? (
                  <Fragment key={it.id || idx}>
                    <tr className="border-t border-gray-100">
                      <td className="px-3 py-1.5">{idx + 1}</td>
                      <td className="px-3 py-1.5">{it.nameOfJob || '—'}</td>
                      <td className="px-3 py-1.5">{it.jobIdentification}</td>
                      <td className="px-3 py-1.5 text-gray-500">{it.materialComposition || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{it.qty || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{it.activityRequired || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{it.itemRemarks || '—'}</td>
                    </tr>
                    {it.ndtDetails && (
                      <tr className="border-t border-dashed border-gray-100 bg-gray-50/60">
                        <td /><td colSpan={6} className="px-3 py-2 text-xs text-gray-600"><NdtDetailsLine d={it.ndtDetails} /></td>
                      </tr>
                    )}
                  </Fragment>
                ) : (
                  <tr key={it.id || idx} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">{idx + 1}</td>
                    <td className="px-3 py-1.5">{it.jobIdentification}</td>
                    <td className="px-3 py-1.5 text-gray-500">{it.activityRequired || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{it.materialComposition || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{it.drawingNo || '—'}</td>
                    <td className="px-3 py-1.5 text-gray-500">{it.specification || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {n.otherInformation && (
          <div>
            <h4 className="font-medium text-gray-800 mb-1">Other Information</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.otherInformation}</p>
          </div>
        )}
        {n.remarks && (
          <div>
            <h4 className="font-medium text-gray-800 mb-1">Remarks</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.remarks}</p>
          </div>
        )}

        {/* Action buttons */}
        {(canStart || canMarkWorkDone || canMarkCollected) && (
          <div className="border-t border-gray-200 pt-4 flex justify-end gap-2">
            {canStart && (
              <Button variant="secondary" disabled={busy} onClick={() => act('WAITING')}>
                <Send size={14} /> Start Work
              </Button>
            )}
            {canMarkWorkDone && (
              <Button disabled={busy} onClick={() => setWorkDoneOpen(true)}>
                <CheckCircle2 size={14} /> Work Done
              </Button>
            )}
            {canMarkCollected && (
              <Button disabled={busy} onClick={() => setCollectedOpen(true)}>
                <Package size={14} /> Mark Collected
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Sub-dialogs */}
      {workDoneOpen && (
        <WorkDoneDialog
          busy={busy}
          onClose={() => setWorkDoneOpen(false)}
          onSubmit={(reportNo, remarks) => {
            setWorkDoneOpen(false);
            act('WORK_DONE', { reportNoAndDate: reportNo, remarks });
          }}
        />
      )}
      {collectedOpen && (
        <CollectedDialog
          busy={busy}
          onClose={() => setCollectedOpen(false)}
          onSubmit={(collectedBy) => {
            setCollectedOpen(false);
            act('COLLECTED', { collectedBy });
          }}
        />
      )}
    </Modal>
  );
}

/* ─── Work Done sub-dialog ─────────────────────────────────────────────────── */

function WorkDoneDialog({ busy, onClose, onSubmit }) {
  const [reportNo, setReportNo] = useState('');
  const [remarks,  setRemarks]  = useState('');
  return (
    <Modal isOpen onClose={onClose} title="Mark Work Done" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Enter the report number generated for this job before marking work as done.</p>
        <Input
          label="Report Number *"
          value={reportNo}
          onChange={e => setReportNo(e.target.value)}
          placeholder="e.g. RPT/LAB/2024/001"
          autoFocus
        />
        <Textarea
          label="Remarks (optional)"
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          rows={2}
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSubmit(reportNo, remarks)} disabled={busy || !reportNo.trim()}>
            <CheckCircle2 size={14} /> Confirm Work Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Collected sub-dialog ─────────────────────────────────────────────────── */

function CollectedDialog({ busy, onClose, onSubmit }) {
  const [collectedBy, setCollectedBy] = useState('');
  return (
    <Modal isOpen onClose={onClose} title="Mark as Collected" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Enter the name of the person who collected the items. The ION will be closed.</p>
        <Input
          label="Collected By *"
          value={collectedBy}
          onChange={e => setCollectedBy(e.target.value)}
          placeholder="Full name of person collecting"
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSubmit(collectedBy)} disabled={busy || !collectedBy.trim()}>
            <Package size={14} /> Confirm Collected & Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function NdtDetailsLine({ d }) {
  const parts = [];
  if (d.method)             parts.push(`UT Method: ${d.method}`);
  if (d.gridSize)           parts.push(`Grid Size: ${d.gridSize}`);
  if (d.gridPoints)         parts.push(`Grid Points: ${d.gridPoints}`);
  if (d.stage)              parts.push(`Stage: ${d.stage}`);
  if (d.acceptanceLimit)    parts.push(`UT Accept: ${d.acceptanceLimit}`);
  if (d.shotType)           parts.push(`RT Shot Type: ${d.shotType}`);
  if (d.shotCount)          parts.push(`RT Shots: ${d.shotCount}`);
  if (d.acceptanceCriteria) parts.push(`RT Accept: ${d.acceptanceCriteria}`);
  if (!parts.length) return null;
  return <span>{parts.join('  •  ')}</span>;
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-gray-800">{value || '—'}</p>
    </div>
  );
}
