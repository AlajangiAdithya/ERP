import { Fragment, useState, useEffect } from 'react';
import { Plus, Trash2, FlaskConical, Send, CheckCircle2, Users, Atom, Ruler } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useAutoRefresh } from '../context/NotificationContext';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { formatDate, formatDateTime } from '../utils/formatters';
import IONPdf from '../components/pdf/IONPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

const STATUS_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'SENT', label: 'Sent' },
  { key: 'WAITING', label: 'In Progress' },
  { key: 'COLLECTED', label: 'Completed' },
];

const statusColor = (s) => ({ SENT: 'yellow', WAITING: 'blue', COLLECTED: 'green' }[s] || 'gray');
const statusLabel = (s) => ({ SENT: 'Sent', WAITING: 'In Progress', COLLECTED: 'Completed' }[s] || s);

const RECIPIENT_ROLES = ['LAB', 'METROLOGY', 'NDT'];

const isNdtIon = (n) => n?.recipientRole === 'NDT' || n?.assignedTo?.role === 'NDT';

const blankStandardItem = () => ({
  jobIdentification: '', activityRequired: '', materialComposition: '', drawingNo: '', specification: '',
});
const blankNdtItem = () => ({
  nameOfJob: '', jobIdentification: '', materialComposition: '', qty: '', activityRequired: '', itemRemarks: '',
  ndtDetails: {
    method: '', gridSize: '', gridPoints: '', stage: '', acceptanceLimit: '',
    shotType: '', shotCount: '', acceptanceCriteria: '',
  },
});

export default function InterOfficeNote() {
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER';
  const isRecipient = RECIPIENT_ROLES.includes(user?.role);

  // Determine if a row is incoming for the current user (so we can show action affordances)
  const incomingForMe = (n) => {
    if (isRecipient) {
      return (
        (!n.assignedToId && n.recipientRole === user.role) ||
        n.assignedTo?.role === user.role
      );
    }
    if (isManager) return n.assignedToId === user.id;
    return false;
  };

  const [tab, setTab] = useState('ALL');
  const [ions, setIons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const globalRefreshKey = useAutoRefresh();

  const load = () => {
    setLoading(true);
    const params = { limit: 100, fromDate: fromDate || undefined, toDate: toDate || undefined };
    if (tab !== 'ALL') params.status = tab;
    api.get('/ion', { params })
      .then(({ data }) => setIons(data.ions || []))
      .catch(() => setIons([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab, refreshKey, fromDate, toDate, globalRefreshKey]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical size={24} className="text-navy-700" />
            Inter Office Note
          </h1>
          <p className="text-sm text-gray-500">
            {isManager
              ? 'Raise lab / metrology / NDT work orders, or send machining requests to managers in other units.'
              : 'Incoming work orders from production.'}
          </p>
        </div>
        {isManager && (
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} /> New ION
          </Button>
        )}
      </div>

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

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : ions.length === 0 ? (
        <Card className="text-center text-gray-500 py-10">
          No inter office notes yet.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-2 font-medium">ION No.</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Section</th>
                  <th className="px-4 py-2 font-medium">Items</th>
                  <th className="px-4 py-2 font-medium">Required By</th>
                  <th className="px-4 py-2 font-medium">From → To</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {ions.map(n => {
                  const roleBucket = n.recipientRole === 'METROLOGY' ? 'Metrology'
                    : n.recipientRole === 'NDT' ? 'NDT'
                    : n.recipientRole ? n.recipientRole.charAt(0) + n.recipientRole.slice(1).toLowerCase()
                    : 'Lab';
                  const recipientLabel = n.assignedTo
                    ? `${n.assignedTo.name}${n.assignedTo.unit?.code ? ` (${n.assignedTo.unit.code})` : ''}`
                    : roleBucket;
                  return (
                    <tr key={n.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-navy-700">
                        {n.ionNumber}
                        {isNdtIon(n) && <Badge color="purple" className="ml-2">NDT</Badge>}
                      </td>
                      <td className="px-4 py-2">{formatDate(n.createdAt)}</td>
                      <td className="px-4 py-2">{n.projectName || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{n.section || '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{n.items?.length || 0}</td>
                      <td className="px-4 py-2 text-gray-500">{n.requiredByDate ? formatDate(n.requiredByDate) : '—'}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">
                        <div>{n.createdBy?.name || '—'}{n.createdBy?.unit?.code ? ` (${n.createdBy.unit.code})` : ''}</div>
                        <div className="text-navy-600">→ {recipientLabel}</div>
                      </td>
                      <td className="px-4 py-2">
                        <Badge color={statusColor(n.status)}>{statusLabel(n.status)}</Badge>
                        {incomingForMe(n) && n.status !== 'COLLECTED' && (
                          <Badge color="purple" className="ml-1">For you</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(n)}>View</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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

function CreateIONModal({ onClose, onCreated }) {
  const [recipientType, setRecipientType] = useState('LAB'); // 'LAB' | 'METROLOGY' | 'NDT' | 'MANAGER'
  const [recipientManagerId, setRecipientManagerId] = useState('');
  const [managerOptions, setManagerOptions] = useState([]);
  const [form, setForm] = useState({
    userReferenceNo: '',
    section: '',
    projectName: '',
    supplyOrderNo: '',
    referenceDocQA: '',
    materialSupplyDate: '',
    requiredByDate: '',
    sampleRequired: false,
    reportGeneration: false,
    externalQAWitness: '',
    qcContactDetails: '',
    otherInformation: '',
    reportNoAndDate: '',
    remarks: '',
  });
  const [items, setItems] = useState([blankStandardItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isNdt = recipientType === 'NDT';

  // When switching format, reset items to the appropriate shape so the user
  // doesn't get half-filled fields that don't apply to the new format.
  useEffect(() => {
    setItems(isNdt ? [blankNdtItem()] : [blankStandardItem()]);
  }, [isNdt]);

  useEffect(() => {
    if (recipientType === 'MANAGER' && managerOptions.length === 0) {
      api.get('/users/managers')
        .then(({ data }) => setManagerOptions(data || []))
        .catch(() => setManagerOptions([]));
    }
  }, [recipientType, managerOptions.length]);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const updateNdtDetail = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], ndtDetails: { ...(copy[idx].ndtDetails || {}), [k]: v } };
    setItems(copy);
  };
  const addItem = () => setItems([...items, isNdt ? blankNdtItem() : blankStandardItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (items.some(i => !String(i.jobIdentification || '').trim())) return setError('Each item needs a Job Identification');
    if (recipientType === 'MANAGER' && !recipientManagerId) return setError('Pick the manager you are sending this to');
    setSaving(true);
    try {
      const payload = {
        recipientType,
        assignedToId: recipientType === 'MANAGER' ? recipientManagerId : null,
        userReferenceNo: form.userReferenceNo,
        section: form.section,
        projectName: form.projectName,
        supplyOrderNo: form.supplyOrderNo,
        referenceDocQA: form.referenceDocQA,
        materialSupplyDate: form.materialSupplyDate || null,
        requiredByDate: form.requiredByDate || null,
        externalQAWitness: form.externalQAWitness,
        qcContactDetails: form.qcContactDetails,
        otherInformation: form.otherInformation,
        remarks: form.remarks,
      };
      if (isNdt) {
        payload.reportNoAndDate = form.reportNoAndDate;
        payload.items = items.map(i => ({
          jobIdentification: String(i.jobIdentification).trim(),
          nameOfJob:           i.nameOfJob || null,
          materialComposition: i.materialComposition || null,
          qty:                 i.qty || null,
          activityRequired:    i.activityRequired || null,
          itemRemarks:         i.itemRemarks || null,
          ndtDetails:          i.ndtDetails && Object.values(i.ndtDetails).some(v => v) ? i.ndtDetails : null,
        }));
      } else {
        payload.sampleRequired = form.sampleRequired;
        payload.reportGeneration = form.reportGeneration;
        payload.items = items.map(i => ({
          jobIdentification: String(i.jobIdentification).trim(),
          activityRequired:    i.activityRequired || null,
          materialComposition: i.materialComposition || null,
          drawingNo:           i.drawingNo || null,
          specification:       i.specification || null,
        }));
      }
      await api.post('/ion', payload);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create ION');
    }
    setSaving(false);
  };

  return (
    <Modal isOpen onClose={onClose} title="New Inter Office Note" size="full">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded">
          {isNdt
            ? 'Doc No: RAPS/ION-7 — Inter Office Note for NDT (VT / UT / RT)'
            : 'Doc No: RAMS/ION/00 — Work Order / Inter Office Note'}
        </div>

        {/* Recipient picker */}
        <div className="bg-navy-50 border border-navy-200 rounded-md p-3 space-y-3">
          <h4 className="text-sm font-semibold text-navy-800 flex items-center gap-2">
            <Send size={14} /> Send to
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {[
              { v: 'LAB', icon: <FlaskConical size={14} />, label: 'Lab (testing/QC)', help: 'For sample tests, reports, and inspections.' },
              { v: 'METROLOGY', icon: <Ruler size={14} />, label: 'Metrology', help: 'For dimensional/metrology checks and reports.' },
              { v: 'NDT', icon: <Atom size={14} />, label: 'NDT (VT / UT / RT)', help: 'Non-destructive testing — uses RAPS/ION-7 form.' },
              { v: 'MANAGER', icon: <Users size={14} />, label: 'Manager (another unit)', help: 'For machining or production work in another unit.' },
            ].map(opt => (
              <label key={opt.v} className={`flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors ${recipientType === opt.v ? 'border-navy-400 bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-navy-300'}`}>
                <input type="radio" name="recipientType" value={opt.v} checked={recipientType === opt.v} onChange={() => setRecipientType(opt.v)} className="mt-1" />
                <div>
                  <div className="font-medium text-gray-800 flex items-center gap-2">{opt.icon} {opt.label}</div>
                  <div className="text-xs text-gray-500">{opt.help}</div>
                </div>
              </label>
            ))}
          </div>
          {recipientType === 'MANAGER' && (
            <Select label="Pick the receiving manager" value={recipientManagerId} onChange={(e) => setRecipientManagerId(e.target.value)}>
              <option value="">— Select manager —</option>
              {managerOptions.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.unit?.name ? ` — ${m.unit.name}` : ''}
                </option>
              ))}
            </Select>
          )}
        </div>

        {isNdt ? (
          <NdtFormFields form={form} update={update} items={items}
            updateItem={updateItem} updateNdtDetail={updateNdtDetail}
            addItem={addItem} removeItem={removeItem} />
        ) : (
          <StandardFormFields form={form} update={update} items={items}
            updateItem={updateItem} addItem={addItem} removeItem={removeItem} />
        )}

        <Textarea label="Remarks" value={form.remarks} onChange={e => update('remarks', e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Sending…' : recipientType === 'MANAGER' ? 'Send to Manager' : `Send to ${recipientType === 'NDT' ? 'NDT' : (recipientType.charAt(0) + recipientType.slice(1).toLowerCase())}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StandardFormFields({ form, update, items, updateItem, addItem, removeItem }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="User Ref No." value={form.userReferenceNo} onChange={e => update('userReferenceNo', e.target.value)} />
        <Input label="Work Required at Section" value={form.section} onChange={e => update('section', e.target.value)} placeholder="e.g. Welding bay" />
        <Input label="Project Name" value={form.projectName} onChange={e => update('projectName', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="Supply Order No." value={form.supplyOrderNo} onChange={e => update('supplyOrderNo', e.target.value)} />
        <Input label="Ref Doc / QA Plan" value={form.referenceDocQA} onChange={e => update('referenceDocQA', e.target.value)} />
        <Input type="date" label="Material Supply Date" value={form.materialSupplyDate} onChange={e => update('materialSupplyDate', e.target.value)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input type="date" label="Required By Date" value={form.requiredByDate} onChange={e => update('requiredByDate', e.target.value)} />
        <Select label="Sample Requirement" value={form.sampleRequired ? 'yes' : 'no'} onChange={e => update('sampleRequired', e.target.value === 'yes')}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
        <Select label="Report Generation" value={form.reportGeneration ? 'yes' : 'no'} onChange={e => update('reportGeneration', e.target.value === 'yes')}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input label="External QA/QC Witness" value={form.externalQAWitness} onChange={e => update('externalQAWitness', e.target.value)} placeholder="SSQAG / ANSP / R&QA / Others" />
        <Input label="QC Contact Details" value={form.qcContactDetails} onChange={e => update('qcContactDetails', e.target.value)} placeholder="Phone / email" />
      </div>

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
                <th className="px-2 py-1.5">Drawing No / QAP</th>
                <th className="px-2 py-1.5">Specification</th>
                <th className="px-2 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 text-gray-500">{idx + 1}</td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.jobIdentification} onChange={e => updateItem(idx, 'jobIdentification', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.activityRequired} onChange={e => updateItem(idx, 'activityRequired', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.materialComposition} onChange={e => updateItem(idx, 'materialComposition', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.drawingNo} onChange={e => updateItem(idx, 'drawingNo', e.target.value)} /></td>
                  <td className="px-2 py-1"><input className="w-full px-2 py-1 border border-gray-300 rounded text-sm" value={it.specification} onChange={e => updateItem(idx, 'specification', e.target.value)} /></td>
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

function NdtFormFields({ form, update, items, updateItem, updateNdtDetail, addItem, removeItem }) {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="User Reference No." value={form.userReferenceNo} onChange={e => update('userReferenceNo', e.target.value)} />
        <Input label="Work Section" value={form.section} onChange={e => update('section', e.target.value)} />
        <Input label="Project" value={form.projectName} onChange={e => update('projectName', e.target.value)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input label="SO / ION No." value={form.supplyOrderNo} onChange={e => update('supplyOrderNo', e.target.value)} />
        <Input label="QAP No." value={form.referenceDocQA} onChange={e => update('referenceDocQA', e.target.value)} />
        <Input type="date" label="Material Supply Date" value={form.materialSupplyDate} onChange={e => update('materialSupplyDate', e.target.value)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input type="date" label="Required By Date" value={form.requiredByDate} onChange={e => update('requiredByDate', e.target.value)} />
        <Input label="External QA/QC Witness" value={form.externalQAWitness} onChange={e => update('externalQAWitness', e.target.value)} placeholder="SSQAG / R&QA / MSQAA / Others" />
        <Input label="Report No & Date" value={form.reportNoAndDate} onChange={e => update('reportNoAndDate', e.target.value)} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-gray-800">NDT Job Items (VT / UT / RT)</h4>
          <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add item</Button>
        </div>
        <div className="space-y-3">
          {items.map((it, idx) => {
            const activity = String(it.activityRequired || '').toUpperCase();
            const showUt = activity.includes('UT');
            const showRt = activity.includes('RT');
            return (
              <div key={idx} className="border border-gray-200 rounded-md p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-600">Item {idx + 1}</span>
                  <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 disabled:opacity-30" disabled={items.length === 1}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Input label="Name of the Job" value={it.nameOfJob} onChange={e => updateItem(idx, 'nameOfJob', e.target.value)} />
                  <Input label="Job Identification" value={it.jobIdentification} onChange={e => updateItem(idx, 'jobIdentification', e.target.value)} />
                  <Input label="Material Composition" value={it.materialComposition} onChange={e => updateItem(idx, 'materialComposition', e.target.value)} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                  <Input label="Qty" value={it.qty} onChange={e => updateItem(idx, 'qty', e.target.value)} />
                  <Select label="Activity Required" value={it.activityRequired} onChange={e => updateItem(idx, 'activityRequired', e.target.value)}>
                    <option value="">— Select —</option>
                    <option value="VT">VT (Visual)</option>
                    <option value="UT">UT (Ultrasonic)</option>
                    <option value="RT">RT (Radiographic)</option>
                    <option value="UT,RT">UT + RT</option>
                    <option value="VT,UT">VT + UT</option>
                    <option value="VT,UT,RT">VT + UT + RT</option>
                  </Select>
                  <Input label="Remarks" value={it.itemRemarks} onChange={e => updateItem(idx, 'itemRemarks', e.target.value)} />
                </div>

                {(showUt || showRt) && (
                  <div className="mt-3 pt-3 border-t border-dashed border-gray-200 space-y-3">
                    {showUt && (
                      <div>
                        <div className="text-xs font-semibold text-navy-700 mb-1.5">UT — required details per QAP</div>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                          <Input label="Method" value={it.ndtDetails?.method || ''} onChange={e => updateNdtDetail(idx, 'method', e.target.value)} />
                          <Input label="Grid Size" value={it.ndtDetails?.gridSize || ''} onChange={e => updateNdtDetail(idx, 'gridSize', e.target.value)} />
                          <Input label="Grid Points" value={it.ndtDetails?.gridPoints || ''} onChange={e => updateNdtDetail(idx, 'gridPoints', e.target.value)} />
                          <Input label="Stage of Inspection" value={it.ndtDetails?.stage || ''} onChange={e => updateNdtDetail(idx, 'stage', e.target.value)} />
                          <Input label="Acceptance Limit" value={it.ndtDetails?.acceptanceLimit || ''} onChange={e => updateNdtDetail(idx, 'acceptanceLimit', e.target.value)} />
                        </div>
                      </div>
                    )}
                    {showRt && (
                      <div>
                        <div className="text-xs font-semibold text-navy-700 mb-1.5">RT — required details per QAP</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <Input label="Type of Shot" value={it.ndtDetails?.shotType || ''} onChange={e => updateNdtDetail(idx, 'shotType', e.target.value)} />
                          <Input label="Total No. of Shots" value={it.ndtDetails?.shotCount || ''} onChange={e => updateNdtDetail(idx, 'shotCount', e.target.value)} />
                          <Input label="Acceptance Criteria" value={it.ndtDetails?.acceptanceCriteria || ''} onChange={e => updateNdtDetail(idx, 'acceptanceCriteria', e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function DetailModal({ ion: initial, currentUser, onClose, onAction }) {
  const [n, setN] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState('');

  const ndt = isNdtIon(n);
  const isRecipientRole = RECIPIENT_ROLES.includes(currentUser?.role);
  const isAssignedManager =
    currentUser?.role === 'MANAGER' && n.assignedToId === currentUser?.id;
  const canAct =
    (isRecipientRole && (
      (!n.assignedToId && n.recipientRole === currentUser.role) ||
      n.assignedTo?.role === currentUser.role
    )) ||
    isAssignedManager;

  const act = async (status) => {
    setError(''); setBusy(true);
    try {
      const body = { status };
      if (remarks.trim()) body.remarks = remarks.trim();
      const { data } = await api.put(`/ion/${n.id}/status`, body);
      setN(data);
      onAction();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    }
    setBusy(false);
  };

  const canStart = canAct && n.status === 'SENT';
  const canComplete = canAct && n.status === 'WAITING';

  return (
    <Modal isOpen onClose={onClose} title={`ION ${n.ionNumber}${ndt ? ' (NDT)' : ''}`} size="xl">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge color={statusColor(n.status)}>{statusLabel(n.status)}</Badge>
            <span className="text-xs text-amber-600">
              {ndt ? 'Doc No: RAPS/ION-7' : 'Doc No: RAMS/ION/00'}
            </span>
          </div>
          <DownloadPdfButton
            document={<IONPdf data={n} />}
            fileName={`${n.ionNumber}.pdf`}
            label="View ION PDF"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="Date" value={formatDate(n.createdAt)} />
          <Field label="User Ref No." value={n.userReferenceNo} />
          <Field label={ndt ? 'Work Section' : 'Section'} value={n.section} />
          <Field label={ndt ? 'Project' : 'Project Name'} value={n.projectName} />
          <Field label={ndt ? 'SO / ION No.' : 'Supply Order No.'} value={n.supplyOrderNo} />
          <Field label={ndt ? 'QAP No.' : 'Ref Doc / QA Plan'} value={n.referenceDocQA} />
          <Field label="Material Supply Date" value={n.materialSupplyDate ? formatDate(n.materialSupplyDate) : '—'} />
          <Field label="Required By" value={n.requiredByDate ? formatDate(n.requiredByDate) : '—'} />
          <Field label="Completed Date" value={n.completedDate ? formatDate(n.completedDate) : '—'} />
          {!ndt && <Field label="Sample Required" value={n.sampleRequired ? 'Yes' : 'No'} />}
          {!ndt && <Field label="Report Generation" value={n.reportGeneration ? 'Yes' : 'No'} />}
          <Field label="External QA Witness" value={n.externalQAWitness} />
          {!ndt && <Field label="QC Contact" value={n.qcContactDetails} />}
          {ndt && <Field label="Report No & Date" value={n.reportNoAndDate} />}
          <Field label="Raised By" value={`${n.createdBy?.name || '—'}${n.createdBy?.unit?.name ? ' — ' + n.createdBy.unit.name : ''}`} />
          <Field label="Sent To" value={n.assignedTo
            ? `${n.assignedTo.name}${n.assignedTo.unit?.name ? ' — ' + n.assignedTo.unit.name : ''} (${n.assignedTo.role})`
            : `${n.recipientRole || 'LAB'} (any available)`} />
        </div>

        <div>
          <h4 className="font-medium text-gray-800 mb-2">Job Items</h4>
          <div className="border border-gray-200 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                {ndt ? (
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
                    <th className="px-3 py-1.5">Specification</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {(n.items || []).map((it, idx) => ndt ? (
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
                        <td className="px-3 py-1.5"></td>
                        <td colSpan={6} className="px-3 py-2 text-xs text-gray-600">
                          <NdtDetailsLine d={it.ndtDetails} />
                        </td>
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

        {!ndt && n.otherInformation && (
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

        {(canStart || canComplete) && (
          <div className="border-t border-gray-200 pt-4 space-y-3">
            <Textarea label="Add remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
            <div className="flex justify-end gap-2">
              {canStart && (
                <Button variant="secondary" disabled={busy} onClick={() => act('WAITING')}>
                  <Send size={14} /> Start Work
                </Button>
              )}
              {canComplete && (
                <Button disabled={busy} onClick={() => act('COLLECTED')}>
                  <CheckCircle2 size={14} /> Mark Work Complete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

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
