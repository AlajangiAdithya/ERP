import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  CheckCircle2, Clock, AlertTriangle, FileText, Upload, Trash2, FileCheck2,
  Banknote, Phone, ShieldCheck, ArrowLeft, FileX, Plus, X,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import PageHero from '../components/shared/PageHero';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input, { Textarea, Select } from '../components/ui/Input';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import QCVerificationCertificatePdf from '../components/pdf/QCVerificationCertificatePdf';
import WorkOrderBillPdf from '../components/pdf/WorkOrderBillPdf';
import HoldChecklistPdf from '../components/pdf/HoldChecklistPdf';

const STAGES = [
  { key: 'NOT_STARTED',        label: 'Not Started',         color: 'gray' },
  { key: 'UNIT_DOCS_PENDING',  label: 'Unit Docs',           color: 'amber' },
  { key: 'QC_VERIFIED',        label: 'QC Verified',         color: 'blue' },
  { key: 'MGMT_APPROVED',      label: 'Mgmt Approved',       color: 'purple' },
  { key: 'FINANCE_REVIEW',     label: 'Finance Review',      color: 'orange' },
  { key: 'ON_HOLD',            label: 'On Hold',             color: 'red' },
  { key: 'BILL_GENERATED',     label: 'Bill Generated',      color: 'navy' },
  { key: 'PDC_CLEARED',        label: 'PDC Cleared',         color: 'blue' },
  { key: 'CUSTOMER_CONTACTED', label: 'Customer Contacted',  color: 'orange' },
  { key: 'ACCOUNTS_TRACKING',  label: 'Accounts Tracking',   color: 'yellow' },
  { key: 'CLOSURE_COMPLETE',   label: 'Closure Complete',    color: 'green' },
];

const REQUIRED_UNIT_DOCS = [
  'WORK_COMPLETION_REPORT',
  'TEST_REPORT',
  'AS_BUILT_DRAWING',
  'DISPATCH_CHECKLIST',
  'COMPLETION_PHOTOS',
];

const DOC_TYPE_LABELS = {
  WORK_COMPLETION_REPORT: 'Work Completion Report',
  TEST_REPORT: 'Test Report',
  AS_BUILT_DRAWING: 'As-Built Drawing',
  DISPATCH_CHECKLIST: 'Dispatch Checklist',
  COMPLETION_PHOTOS: 'Completion Photos',
  QC_VERIFICATION_CERTIFICATE: 'QC Verification Certificate',
  BILL: 'Bill',
  HOLD_CHECKLIST: 'Hold Checklist',
  CUSTOMER_PDC_ACK: 'Customer PDC Acknowledgement',
  RECEIPT_PROOF: 'Receipt Proof',
};

const L5 = ['sureshbabu', 'rameshbabu', 'madhubabu'];

const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN') : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function SlaCountdown({ deadlineAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  if (!deadlineAt) return null;
  const dl = new Date(deadlineAt).getTime();
  const ms = dl - now;
  const hours = Math.round(ms / (1000 * 60 * 60));
  if (ms <= 0) {
    return <Badge color="red">SLA BREACHED — {Math.abs(hours)}h overdue</Badge>;
  }
  const color = hours <= 12 ? 'red' : hours <= 24 ? 'orange' : 'blue';
  return <Badge color={color}>{hours}h left on 48h SLA</Badge>;
}

function StageTimeline({ stage }) {
  const idx = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="flex flex-wrap gap-1.5">
      {STAGES.map((s, i) => {
        const active = s.key === stage;
        const past = idx >= 0 && i < idx && s.key !== 'ON_HOLD';
        return (
          <span
            key={s.key}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium
              ${active ? `bg-${s.color}-100 text-${s.color}-800 ring-1 ring-${s.color}-300`
                : past ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-400'}`}
          >
            {past && <CheckCircle2 size={11} />}
            {s.label}
          </span>
        );
      })}
    </div>
  );
}

export default function WorkOrderClosure() {
  const { id } = useParams();
  const { user } = useAuth();
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const [billOpen, setBillOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [pdcOpen, setPdcOpen] = useState(false);
  const [qcOpen, setQcOpen] = useState(false);
  const [mgmtOpen, setMgmtOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(null); // hold object
  const [uploadDocType, setUploadDocType] = useState('');

  const role = user?.role;
  const isL5 = role === 'ADMIN' && L5.includes(user?.username);
  const isUnit = role === 'MANAGER' && wo?.assignedUnitId === user?.unitId;
  const isQC = role === 'QC';
  const isFinance = role === 'FINANCE';
  const isAccounts = role === 'ACCOUNTING';
  const isAdmin = role === 'ADMIN';

  const refresh = () => {
    setLoading(true);
    api.get(`/work-orders/${id}`)
      .then(({ data }) => { setWo(data); setErr(''); })
      .catch((e) => setErr(e?.response?.data?.error || 'Failed to load work order'))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, [id]);

  const presentDocTypes = useMemo(
    () => new Set((wo?.closureDocs || []).filter((d) => d.stage === 'UNIT_DOCS_PENDING').map((d) => d.docType)),
    [wo],
  );
  const missingUnitDocs = REQUIRED_UNIT_DOCS.filter((t) => !presentDocTypes.has(t));
  const activeHold = (wo?.holdRequests || []).find((h) => !h.resolvedAt);

  const post = async (path, body) => {
    setActionBusy(true);
    try {
      const { data } = await api.post(`/work-orders/${id}/closure/${path}`, body || {});
      // Refresh from full payload
      if (data?.workOrder) setWo(data.workOrder);
      else setWo(data);
    } catch (e) {
      alert(e?.response?.data?.error || 'Action failed');
    } finally {
      setActionBusy(false);
    }
  };

  const uploadDoc = async (docType, file, note) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('docType', docType);
    if (note) fd.append('note', note);
    setActionBusy(true);
    try {
      await api.post(`/work-orders/${id}/closure/docs`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      refresh();
    } catch (e) {
      alert(e?.response?.data?.error || 'Upload failed');
    } finally {
      setActionBusy(false);
    }
  };

  const deleteDoc = async (docId) => {
    if (!confirm('Delete this document?')) return;
    try {
      await api.delete(`/work-orders/${id}/closure/docs/${docId}`);
      refresh();
    } catch (e) {
      alert(e?.response?.data?.error || 'Delete failed');
    }
  };

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (err) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!wo) return null;

  const stage = wo.closureStage || 'NOT_STARTED';
  const canStartClosure = ['COMPLETED', 'CLOSED'].includes(wo.status) && stage === 'NOT_STARTED' && (isUnit || isAdmin);

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Work Order Closure"
        title={`${wo.workOrderNumber}`}
        subtitle={`Customer ${wo.customerName} • Supply Order ${wo.supplyOrderNo} • Qty ${wo.orderQuantity} ${wo.orderUnit || ''}`}
        icon={ShieldCheck}
        actions={
          <Link to="/work-orders" className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-white/15 hover:bg-white/25 text-white">
            <ArrowLeft size={14} /> Back to Work Orders
          </Link>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Badge color="navy">WO Status: {wo.status}</Badge>
          <Badge color="blue">Closure Stage: {STAGES.find((s) => s.key === stage)?.label || stage}</Badge>
          {wo.slaDeadlineAt && stage === 'CUSTOMER_CONTACTED' && <SlaCountdown deadlineAt={wo.slaDeadlineAt} />}
          {activeHold && <Badge color="red">ON HOLD — {activeHold.missingItems?.length || 0} missing item(s)</Badge>}
        </div>
      </PageHero>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Stage Timeline</div>
        <StageTimeline stage={stage} />
      </div>

      {/* Action bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap gap-2">
        {canStartClosure && (
          <Button onClick={() => post('start')} disabled={actionBusy}>
            <FileCheck2 size={16} /> Start Closure
          </Button>
        )}

        {stage === 'UNIT_DOCS_PENDING' && (isUnit || isAdmin) && (
          <Button
            onClick={() => post('submit-to-qc')}
            disabled={actionBusy || missingUnitDocs.length > 0}
            title={missingUnitDocs.length ? `Missing: ${missingUnitDocs.join(', ')}` : ''}
          >
            <FileCheck2 size={16} /> Submit to QC
          </Button>
        )}

        {stage === 'UNIT_DOCS_PENDING' && wo.unitDocsSubmittedAt && (isQC || isAdmin) && (
          <Button onClick={() => setQcOpen(true)} disabled={actionBusy}>
            <ShieldCheck size={16} /> QC Verify
          </Button>
        )}

        {stage === 'QC_VERIFIED' && isL5 && (
          <Button onClick={() => setMgmtOpen(true)} disabled={actionBusy}>
            <CheckCircle2 size={16} /> Management Approve
          </Button>
        )}

        {stage === 'MGMT_APPROVED' && (isFinance || isAdmin) && (
          <>
            <Button onClick={() => setBillOpen(true)} disabled={actionBusy}>
              <Banknote size={16} /> Generate Bill
            </Button>
            <Button variant="danger" onClick={() => setHoldOpen(true)} disabled={actionBusy}>
              <FileX size={16} /> Send to Hold
            </Button>
          </>
        )}

        {stage === 'BILL_GENERATED' && (isFinance || isAdmin) && (
          <Button onClick={() => setPdcOpen(true)} disabled={actionBusy}>
            <CheckCircle2 size={16} /> Mark PDC Cleared
          </Button>
        )}

        {stage === 'PDC_CLEARED' && (isFinance || isAdmin) && (
          <Button onClick={() => setContactOpen(true)} disabled={actionBusy}>
            <Phone size={16} /> Mark Customer Contacted (starts 48h SLA)
          </Button>
        )}

        {['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'].includes(stage) && (isAccounts || isAdmin) && (
          <Button onClick={() => setAccountsOpen(true)} disabled={actionBusy}>
            <Banknote size={16} /> Log Receipt &amp; Close
          </Button>
        )}

        {wo.qcCertificateNumber && (
          <DownloadPdfButton
            document={<QCVerificationCertificatePdf data={wo} />}
            fileName={`${wo.qcCertificateNumber}.pdf`}
            label="QC Certificate"
          />
        )}
        {wo.bills?.length > 0 && (
          <DownloadPdfButton
            document={<WorkOrderBillPdf data={{ ...wo.bills[wo.bills.length - 1], workOrder: wo }} />}
            fileName={`${wo.billNumber || 'bill'}.pdf`}
            label="Bill PDF"
          />
        )}
      </div>

      {/* Documents panel */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-navy-700 flex items-center gap-2">
            <FileText size={16} /> Closure Documents
          </h2>
          {(stage === 'UNIT_DOCS_PENDING' || stage === 'ON_HOLD') && isUnit && (
            <div className="text-xs text-gray-500">
              {missingUnitDocs.length > 0
                ? <span className="text-red-600 font-medium">Missing: {missingUnitDocs.map((d) => DOC_TYPE_LABELS[d] || d).join(', ')}</span>
                : <span className="text-green-700 font-medium">All required docs uploaded</span>}
            </div>
          )}
        </div>

        {(isUnit || isQC || isFinance || isAccounts || isAdmin) && stage !== 'NOT_STARTED' && stage !== 'CLOSURE_COMPLETE' && (
          <div className="border border-dashed border-navy-200 rounded-lg p-3 mb-4 bg-navy-50/40">
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label="Document Type"
                value={uploadDocType}
                onChange={(e) => setUploadDocType(e.target.value)}
                className="flex-1 min-w-[200px]"
              >
                <option value="">Select doc type…</option>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
              <div className="flex-1 min-w-[240px]">
                <label className="block text-sm font-medium text-gray-700 mb-1">Upload File</label>
                <input
                  type="file"
                  disabled={!uploadDocType || actionBusy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && uploadDocType) {
                      uploadDoc(uploadDocType, f);
                      e.target.value = '';
                    }
                  }}
                  className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-navy-700 file:text-white file:hover:bg-navy-800"
                />
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase border-b">
              <tr>
                <th className="text-left py-2 px-2">Stage</th>
                <th className="text-left py-2 px-2">Doc Type</th>
                <th className="text-left py-2 px-2">File</th>
                <th className="text-left py-2 px-2">Uploaded By</th>
                <th className="text-left py-2 px-2">When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(wo.closureDocs || []).length === 0 ? (
                <tr><td colSpan={6} className="py-4 text-center text-gray-400">No documents yet.</td></tr>
              ) : (wo.closureDocs.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="py-2 px-2"><Badge color="gray">{d.stage}</Badge></td>
                  <td className="py-2 px-2">{DOC_TYPE_LABELS[d.docType] || d.docType}</td>
                  <td className="py-2 px-2">
                    <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="text-navy-700 underline">{d.fileName}</a>
                  </td>
                  <td className="py-2 px-2">{d.uploadedBy?.name || '—'}</td>
                  <td className="py-2 px-2 text-gray-500">{fmtDateTime(d.uploadedAt)}</td>
                  <td className="py-2 px-2">
                    {(d.uploadedById === user?.id || isAdmin) && (
                      <button onClick={() => deleteDoc(d.id)} className="text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hold history */}
      {(wo.holdRequests || []).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h2 className="text-base font-semibold text-navy-700 flex items-center gap-2 mb-3">
            <AlertTriangle size={16} /> Hold History
          </h2>
          <div className="space-y-3">
            {wo.holdRequests.map((h) => (
              <div key={h.id} className={`border rounded-lg p-3 ${h.resolvedAt ? 'border-gray-200 bg-gray-50' : 'border-red-200 bg-red-50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-navy-700">
                    Raised by {h.raisedBy?.name} on {fmtDateTime(h.raisedAt)}
                  </div>
                  {h.resolvedAt ? (
                    <Badge color="green">Resolved by {h.resolvedBy?.name} • {fmtDate(h.resolvedAt)}</Badge>
                  ) : (
                    <div className="flex gap-2">
                      <DownloadPdfButton
                        document={<HoldChecklistPdf data={{ ...h, workOrder: wo }} />}
                        fileName={`hold-${wo.workOrderNumber}.pdf`}
                        label="Print Checklist"
                      />
                      {(isUnit || isAdmin) && stage === 'ON_HOLD' && (
                        <Button size="sm" onClick={() => setResolveOpen(h)}>Resolve Hold</Button>
                      )}
                    </div>
                  )}
                </div>
                {h.reason && <div className="text-xs text-gray-600 mb-2">Reason: {h.reason}</div>}
                <ul className="list-disc list-inside text-xs text-gray-700 space-y-0.5">
                  {(h.missingItems || []).map((it, i) => (
                    <li key={i}><b>{DOC_TYPE_LABELS[it.docType] || it.docType}</b>{it.note ? ` — ${it.note}` : ''}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit summary */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-navy-700 flex items-center gap-2 mb-3">
          <Clock size={16} /> Closure Audit
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <AuditRow label="Closure Started" who={null} when={wo.closureStartedAt} />
          <AuditRow label="Unit Submitted" who={wo.unitDocsSubmittedBy} when={wo.unitDocsSubmittedAt} />
          <AuditRow label="QC Verified" who={wo.qcVerifiedBy} when={wo.qcVerifiedAt} extra={wo.qcCertificateNumber} />
          <AuditRow label="Mgmt Approved" who={wo.mgmtApprovedBy} when={wo.mgmtApprovedAt} />
          <AuditRow label="Finance Reviewed" who={wo.financeReviewedBy} when={wo.financeReviewedAt} />
          <AuditRow label="Bill Generated" who={wo.billCreatedBy} when={wo.billGeneratedAt} extra={wo.billNumber} />
          <AuditRow label="PDC Cleared" who={wo.pdcClearedBy} when={wo.pdcClearedAt} />
          <AuditRow label="Customer Contacted" who={wo.customerContactedBy} when={wo.customerContactedAt} />
          <AuditRow label="Accounts Closed" who={wo.accountsClosedBy} when={wo.accountsClosedAt} />
          <AuditRow label="Closure Completed" who={null} when={wo.closureCompletedAt} />
        </dl>
      </div>

      <BillModal isOpen={billOpen} onClose={() => setBillOpen(false)} wo={wo} onSubmit={(body) => { setBillOpen(false); post('finance-bill', body); }} />
      <HoldModal isOpen={holdOpen} onClose={() => setHoldOpen(false)} onSubmit={(body) => { setHoldOpen(false); post('finance-hold', body); }} />
      <NoteModal isOpen={qcOpen} onClose={() => setQcOpen(false)} title="QC Verify — Issue Certificate" submitLabel="Verify"
        onSubmit={({ note }) => { setQcOpen(false); post('qc-verify', { note }); }} />
      <NoteModal isOpen={mgmtOpen} onClose={() => setMgmtOpen(false)} title="Management Approval" submitLabel="Approve"
        onSubmit={({ note }) => { setMgmtOpen(false); post('mgmt-approve', { note }); }} />
      <NoteModal isOpen={pdcOpen} onClose={() => setPdcOpen(false)} title="Mark PDC Cleared" submitLabel="Confirm"
        onSubmit={({ note }) => { setPdcOpen(false); post('pdc-clear', { note }); }} />
      <NoteModal isOpen={contactOpen} onClose={() => setContactOpen(false)} title="Mark Customer Contacted" submitLabel="Start 48h SLA"
        helperText="This timestamp starts the 48-hour customer-payment SLA. Reminders every 24h to L5 + Finance + QC + Accounts."
        onSubmit={({ note }) => { setContactOpen(false); post('mark-contacted', { note }); }} />
      <AccountsModal isOpen={accountsOpen} onClose={() => setAccountsOpen(false)}
        onSubmit={(body) => { setAccountsOpen(false); post('accounts-log', body); }} />
      <NoteModal isOpen={!!resolveOpen} onClose={() => setResolveOpen(null)} title="Resolve Hold" submitLabel="Resolve & Re-submit"
        helperText="After resolving, the WO returns to QC + Mgmt for re-approval before reaching Finance again."
        onSubmit={({ note }) => { const h = resolveOpen; setResolveOpen(null); post('resolve-hold', { holdId: h.id, note }); }} />
    </div>
  );
}

function AuditRow({ label, who, when, extra }) {
  return (
    <div className="flex items-baseline gap-2 py-1 border-b border-gray-100 last:border-0">
      <dt className="text-xs uppercase tracking-wider text-gray-500 w-44">{label}</dt>
      <dd className="text-sm text-gray-700">
        {when ? (
          <>
            {fmtDateTime(when)}
            {who?.name && <span className="text-gray-500"> • {who.name}</span>}
            {extra && <span className="text-gray-500"> • {extra}</span>}
          </>
        ) : <span className="text-gray-400">—</span>}
      </dd>
    </div>
  );
}

function NoteModal({ isOpen, onClose, title, submitLabel, onSubmit, helperText }) {
  const [note, setNote] = useState('');
  useEffect(() => { if (!isOpen) setNote(''); }, [isOpen]);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      {helperText && <p className="text-xs text-gray-500 mb-3">{helperText}</p>}
      <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit({ note })}>{submitLabel}</Button>
      </div>
    </Modal>
  );
}

function HoldModal({ isOpen, onClose, onSubmit }) {
  const [items, setItems] = useState([{ docType: '', note: '' }]);
  const [reason, setReason] = useState('');
  useEffect(() => { if (!isOpen) { setItems([{ docType: '', note: '' }]); setReason(''); } }, [isOpen]);
  const valid = items.some((it) => it.docType);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send Closure on Hold — Missing Items" size="lg">
      <p className="text-xs text-gray-500 mb-3">
        List the items the unit must attach. After the unit re-submits, the WO returns to QC + Mgmt for re-approval before reaching Finance again.
      </p>
      <Textarea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="mb-3" />
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2 items-start">
            <Select value={it.docType} onChange={(e) => {
              const next = [...items]; next[i].docType = e.target.value; setItems(next);
            }} className="w-60">
              <option value="">Doc type…</option>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Input placeholder="Note (optional)" value={it.note} onChange={(e) => {
              const next = [...items]; next[i].note = e.target.value; setItems(next);
            }} className="flex-1" />
            <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600 px-2 py-2">
              <X size={16} />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setItems([...items, { docType: '', note: '' }])}>
          <Plus size={14} /> Add item
        </Button>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={!valid} onClick={() => onSubmit({ missingItems: items.filter((it) => it.docType), reason })}>
          Send on Hold
        </Button>
      </div>
    </Modal>
  );
}

function BillModal({ isOpen, onClose, wo, onSubmit }) {
  const [items, setItems] = useState([{ description: '', qty: '', rate: '' }]);
  const [gst, setGst] = useState('');
  const [bgNo, setBgNo] = useState('');
  const [pdcDate, setPdcDate] = useState('');
  const [remarks, setRemarks] = useState('');
  useEffect(() => {
    if (isOpen) {
      setItems([{ description: wo?.nomenclature || '', qty: String(wo?.orderQuantity || ''), rate: '' }]);
      setBgNo(wo?.bankGuaranteeNo || '');
      setPdcDate(wo?.pdcDate ? new Date(wo.pdcDate).toISOString().slice(0, 10) : '');
    }
  }, [isOpen, wo]);
  const subtotal = items.reduce((s, it) => s + (Number(it.qty || 0) * Number(it.rate || 0)), 0);
  const total = subtotal + Number(gst || 0);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Generate Bill — WO ${wo?.workOrderNumber || ''}`} size="xl">
      <div className="space-y-2 mb-4">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <Input className="col-span-6" label={i === 0 ? 'Description' : ''} value={it.description}
              onChange={(e) => { const next = [...items]; next[i].description = e.target.value; setItems(next); }} />
            <Input className="col-span-2" label={i === 0 ? 'Qty' : ''} type="number" value={it.qty}
              onChange={(e) => { const next = [...items]; next[i].qty = e.target.value; setItems(next); }} />
            <Input className="col-span-2" label={i === 0 ? 'Rate (₹)' : ''} type="number" value={it.rate}
              onChange={(e) => { const next = [...items]; next[i].rate = e.target.value; setItems(next); }} />
            <div className="col-span-1 text-sm text-gray-600 pb-2">
              ₹{(Number(it.qty || 0) * Number(it.rate || 0)).toLocaleString('en-IN')}
            </div>
            <button type="button" onClick={() => setItems(items.filter((_, j) => j !== i))}
              className="col-span-1 text-gray-400 hover:text-red-600 pb-2">
              <X size={16} />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setItems([...items, { description: '', qty: '', rate: '' }])}>
          <Plus size={14} /> Add line
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Input label="GST (₹)" type="number" value={gst} onChange={(e) => setGst(e.target.value)} />
        <Input label="Bank Guarantee No." value={bgNo} onChange={(e) => setBgNo(e.target.value)} />
        <Input label="PDC Date" type="date" value={pdcDate} onChange={(e) => setPdcDate(e.target.value)} />
      </div>
      <Textarea label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      <div className="flex justify-between items-center mt-4">
        <div className="text-sm text-gray-600">
          Subtotal ₹{subtotal.toLocaleString('en-IN')} + GST ₹{Number(gst || 0).toLocaleString('en-IN')} = <b>₹{total.toLocaleString('en-IN')}</b>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit({
            lineItems: items.filter((it) => it.description),
            gstAmount: Number(gst || 0),
            bankGuaranteeNo: bgNo || null,
            pdcDate: pdcDate || null,
            remarks: remarks || null,
          })}>Generate Bill</Button>
        </div>
      </div>
    </Modal>
  );
}

function AccountsModal({ isOpen, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [close, setClose] = useState(true);
  useEffect(() => { if (!isOpen) { setNote(''); setClose(true); } }, [isOpen]);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Log Receipt">
      <Textarea label="Receipt note" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="flex items-center gap-2 mt-3 text-sm">
        <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
        Close the work order closure once receipt is logged
      </label>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit({ note, close })}>{close ? 'Log & Close' : 'Log Only'}</Button>
      </div>
    </Modal>
  );
}
