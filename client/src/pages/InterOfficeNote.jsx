import { Fragment, useState, useEffect } from 'react';
import { Plus, Trash2, FlaskConical, Send, CheckCircle2 } from 'lucide-react';
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
  { key: 'ALL', label: 'All' },
  { key: 'SENT', label: 'Sent' },
  { key: 'WAITING', label: 'In Progress' },
  { key: 'COLLECTED', label: 'Completed' },
];

const statusColor = (s) => ({ SENT: 'yellow', WAITING: 'blue', COLLECTED: 'green' }[s] || 'gray');
const statusLabel = (s) => ({ SENT: 'Sent', WAITING: 'In Progress', COLLECTED: 'Completed' }[s] || s);

const RECIPIENT_ROLES = ['LAB', 'METROLOGY', 'NDT', 'RND'];
const CREATOR_ROLES = ['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'RND'];

const isNdtIon = (n) => n?.recipientRole === 'NDT' || n?.assignedTo?.role === 'NDT';

const blankItem = () => ({
  jobIdentification: '', activityRequired: '', materialComposition: '', drawingNo: '', specification: '',
});

export default function InterOfficeNote() {
  const { user } = useAuth();
  const isManager = user?.role === 'MANAGER';
  const isRecipient = RECIPIENT_ROLES.includes(user?.role);
  const canCreate = CREATOR_ROLES.includes(user?.role);

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
      <PageHero
        title="Inter Office Note"
        subtitle={canCreate
          ? 'Raise lab / metrology / NDT / R&D work orders.'
          : 'Incoming work orders from production.'}
        eyebrow="Work Orders"
        icon={FlaskConical}
        actions={
          canCreate && (
            <Button onClick={() => setShowCreate(true)}>
              <Plus size={16} /> New ION
            </Button>
          )
        }
      />

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
                {ions.map((n, i) => {
                  const roleBucket = n.recipientRole === 'METROLOGY' ? 'Metrology'
                    : n.recipientRole === 'NDT' ? 'NDT'
                    : n.recipientRole === 'RND' ? 'R&D'
                    : n.recipientRole ? n.recipientRole.charAt(0) + n.recipientRole.slice(1).toLowerCase()
                    : 'Lab';
                  const recipientLabel = n.assignedTo
                    ? `${n.assignedTo.name}${n.assignedTo.unit?.code ? ` (${n.assignedTo.unit.code})` : ''}`
                    : roleBucket;
                  return (
                    <tr key={n.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
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
  const [recipientType, setRecipientType] = useState('LAB');
  const [workOrders, setWorkOrders] = useState([]);
  const [form, setForm] = useState({
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
    remarks: '',
  });
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/work-orders/assignable')
      .then(({ data }) => setWorkOrders(data.workOrders || []))
      .catch(() => setWorkOrders([]));
  }, []);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, blankItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (items.some(i => !String(i.jobIdentification || '').trim())) return setError('Each item needs a Job Identification');
    setSaving(true);
    try {
      const payload = {
        recipientType,
        assignedToId: null,
        projectName: form.projectName,
        supplyOrderNo: form.supplyOrderNo,
        referenceDocQA: form.referenceDocQA,
        materialSupplyDate: form.materialSupplyDate || null,
        requiredByDate: form.requiredByDate || null,
        externalQAWitness: form.externalQAWitness,
        qcContactDetails: form.qcContactDetails,
        otherInformation: form.otherInformation,
        remarks: form.remarks,
        sampleRequired: form.sampleRequired,
        reportGeneration: form.reportGeneration,
        items: items.map(i => ({
          jobIdentification: String(i.jobIdentification).trim(),
          activityRequired: i.activityRequired || null,
          materialComposition: i.materialComposition || null,
          drawingNo: i.drawingNo || null,
          specification: i.specification || null,
        })),
      };
      await api.post('/ion', payload);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create ION');
    }
    setSaving(false);
  };

  const recipientLabel = recipientType === 'NDT' ? 'NDT'
    : recipientType === 'RND' ? 'R&D'
    : recipientType.charAt(0) + recipientType.slice(1).toLowerCase();

  return (
    <Modal isOpen onClose={onClose} title="New Inter Office Note" size="full">
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded">
          Doc No: RAMS/ION/00 — Work Order / Inter Office Note
        </div>

        <div className="bg-navy-50 border border-navy-200 rounded-md p-3 space-y-3">
          <h4 className="text-sm font-semibold text-navy-800 flex items-center gap-2">
            <Send size={14} /> Send to
          </h4>
          <Select label="Select department" value={recipientType} onChange={e => setRecipientType(e.target.value)}>
            <option value="LAB">Lab</option>
            <option value="METROLOGY">Metrology</option>
            <option value="NDT">NDT</option>
            <option value="RND">R&D</option>
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
            {saving ? 'Sending…' : `Send to ${recipientLabel}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

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
        <Input type="date" label="Required By Date" value={form.requiredByDate} onChange={e => update('requiredByDate', e.target.value)} />
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
                <th className="px-2 py-1.5">Drawing No</th>
                <th className="px-2 py-1.5">QAP No.</th>
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
            <span className="text-xs text-amber-600">Doc No: RAMS/ION/00</span>
          </div>
          <DownloadPdfButton
            document={<IONPdf data={n} />}
            fileName={`${n.ionNumber}.pdf`}
            label="View ION PDF"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="Date" value={formatDate(n.createdAt)} />
          <Field label="Project Name" value={n.projectName} />
          <Field label="Work Order No." value={n.supplyOrderNo} />
          <Field label="Ref Doc / QA Plan" value={n.referenceDocQA} />
          <Field label="Material Supply Date" value={n.materialSupplyDate ? formatDate(n.materialSupplyDate) : '—'} />
          <Field label="Required By" value={n.requiredByDate ? formatDate(n.requiredByDate) : '—'} />
          <Field label="Completed Date" value={n.completedDate ? formatDate(n.completedDate) : '—'} />
          <Field label="Sample Required" value={n.sampleRequired ? 'Yes' : 'No'} />
          <Field label="Report Generation" value={n.reportGeneration ? 'Yes' : 'No'} />
          <Field label="External QA Witness" value={n.externalQAWitness} />
          <Field label="QC Contact" value={n.qcContactDetails} />
          {ndt && n.reportNoAndDate && <Field label="Report No & Date" value={n.reportNoAndDate} />}
          <Field label="Raised By" value={`${n.createdBy?.name || '—'}${n.createdBy?.unit?.name ? ' — ' + n.createdBy.unit.name : ''}`} />
          <Field label="Sent To" value={n.assignedTo
            ? `${n.assignedTo.name}${n.assignedTo.unit?.name ? ' — ' + n.assignedTo.unit.name : ''} (${n.assignedTo.role})`
            : `${n.recipientRole === 'RND' ? 'R&D' : n.recipientRole || 'Lab'} (any available)`} />
        </div>

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
