import { useState, useEffect } from 'react';
import {
  ClipboardList, Plus, Send, CheckCircle2, Clock, XCircle, Building2,
  CalendarClock, TrendingUp, ShieldCheck, PauseCircle,
  LayoutGrid, Table as TableIcon,
  FileText, Receipt, ShieldAlert, Upload, AlertTriangle, Timer, Trash2, Check,
  GitBranch, ArrowRight, ArrowDown, Download, Paperclip, BellRing, Stamp,
  Banknote, Wallet, FilePlus2, FileCheck2, UserCheck, Truck, RefreshCw,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Textarea, Select } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import StatsCard from '../components/shared/StatsCard';
import PageHero from '../components/shared/PageHero';
import { formatDate } from '../utils/formatters';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';
import InvoicePdf from '../components/pdf/InvoicePdf';
import QCVerificationCertificatePdf from '../components/pdf/QCVerificationCertificatePdf';
import HoldChecklistPdf from '../components/pdf/HoldChecklistPdf';

const STATUS_META = {
  PENDING_ADMIN:  { color: 'yellow', label: 'Awaiting Admin',   Icon: Clock },
  ADMIN_ACCEPTED: { color: 'blue',   label: 'Admin Accepted',   Icon: ShieldCheck },
  UNIT_ACCEPTED:  { color: 'blue',   label: 'Unit Accepted',    Icon: CheckCircle2 },
  IN_PROGRESS:    { color: 'yellow', label: 'In Progress',      Icon: Clock },
  COMPLETED:      { color: 'green',  label: 'Completed',        Icon: CheckCircle2 },
  CLOSED:         { color: 'navy',   label: 'Closed',           Icon: CheckCircle2 },
  CANCELLED:      { color: 'gray',   label: 'Cancelled',        Icon: XCircle },
  REJECTED:       { color: 'red',    label: 'Rejected',         Icon: XCircle },
  ON_HOLD:        { color: 'red',    label: 'On Hold',          Icon: PauseCircle },
};

const STATUS_TABS = [
  'ALL', 'PENDING_ADMIN', 'ADMIN_ACCEPTED', 'ON_HOLD',
  'UNIT_ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED',
];

// Closure cycle stage display + ordering. INVOICE_SENT and PAYMENT_RECEIVED are
// finance-side and only shown to L5 admins / FINANCE / ACCOUNTING (server-side
// sanitization nulls them for MANAGER/QC anyway).
const CYCLE_STAGE_META = {
  UNIT_DOCS_PENDING: { color: 'gray',   label: 'Unit Docs Pending' },
  QC_VERIFIED:       { color: 'blue',   label: 'QC Verified' },
  MGMT_APPROVED:     { color: 'blue',   label: 'Mgmt Approved' },
  ON_HOLD:           { color: 'red',    label: 'On Hold' },
  INVOICE_SENT:      { color: 'yellow', label: 'Invoice Sent (SLA)' },
  PAYMENT_RECEIVED:  { color: 'green',  label: 'Payment Received' },
};

const UNIT_DOC_TYPES = [
  { value: 'WORK_COMPLETION_REPORT', label: 'Work Completion Report', required: true },
  { value: 'TEST_REPORT',            label: 'Test Report',            required: true },
  { value: 'DISPATCH_CHECKLIST',     label: 'Dispatch Checklist',     required: true },
  { value: 'AS_BUILT_DRAWING',       label: 'As-Built Drawing',       required: false },
  { value: 'COMPLETION_PHOTOS',      label: 'Completion Photos',      required: false },
];

// Roles allowed to see closure invoice / SLA / payment fields. Mirrors the
// server's FINANCE_HIDDEN_ROLES sanitizer.
const canSeeFinance = (role) => !['MANAGER', 'QC'].includes(role);

const L5_USERNAMES = new Set(['sureshbabu', 'rameshbabu', 'madhubabu']);
const isL5 = (user) => user?.role === 'ADMIN' && L5_USERNAMES.has(user?.username);

// Flatten the WO + closure cycle into the shape QCVerificationCertificatePdf
// expects: top-level WO scope fields plus the cycle's QC + submission audit.
const qcCertData = (wo, cycle) => ({
  workOrderNumber: wo.workOrderNumber,
  supplyOrderNo: wo.supplyOrderNo,
  customerName: wo.customerName,
  nomenclature: wo.nomenclature,
  orderQuantity: cycle.deliveryQty,
  orderUnit: wo.orderUnit,
  pdcDate: wo.effectivePdcDate,
  inspectionAgency: wo.inspectionAgency,
  qapNo: wo.qapNo,
  qcCertificateNumber: cycle.qcCertificateNumber,
  qcVerifiedAt: cycle.qcVerifiedAt,
  qcVerifiedBy: cycle.qcVerifiedBy,
  unitDocsSubmittedAt: cycle.unitDocsSubmittedAt,
  unitDocsSubmittedBy: cycle.unitDocsSubmittedBy,
  closureDocs: (cycle.docs || []).map((d) => ({ ...d, stage: 'UNIT_DOCS_PENDING' })),
});

export default function WorkOrders() {
  const { user } = useAuth();
  const role = user?.role;
  const canCreate = role === 'SUPPLY_CHAIN' || role === 'ADMIN';

  const [workOrders, setWorkOrders] = useState([]);
  const [stats, setStats] = useState({ completedCount: 0, onTimeCount: 0, onTimePercent: null });
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [view, setView] = useState('table'); // 'table' | 'cards'
  const [workflowOpen, setWorkflowOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/work-orders', { params: {
      status: activeTab === 'ALL' ? undefined : activeTab,
      limit: 200,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    } })
      .then(({ data }) => {
        setWorkOrders(data.workOrders || []);
        setStats(data.stats || { completedCount: 0, onTimeCount: 0, onTimePercent: null });
      })
      .catch(() => setWorkOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [activeTab, refreshKey, fromDate, toDate]);

  useEffect(() => {
    if (canCreate || role === 'ADMIN') {
      api.get('/units').then(({ data }) => setUnits(data.units || data || [])).catch(() => setUnits([]));
    }
  }, [canCreate, role]);

  const pending = workOrders.filter((w) => w.status === 'PENDING_ADMIN').length;
  const inProgress = workOrders.filter((w) => ['UNIT_ACCEPTED', 'IN_PROGRESS', 'ADMIN_ACCEPTED'].includes(w.status)).length;
  const overdue = workOrders.filter((w) => w.overdue).length;
  const openCycles = workOrders.reduce(
    (s, w) => s + (w.closures?.filter((c) => c.stage !== 'PAYMENT_RECEIVED').length || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <PageHero
        title="Work Orders"
        subtitle="Supply orders → admin approval → unit acceptance → qty-wise delivery → per-batch closure cycles."
        eyebrow="Supply Chain"
        icon={ClipboardList}
        actions={
          <>
            <Button variant="secondary" onClick={() => setWorkflowOpen(true)}>
              <GitBranch size={16} className="mr-1.5" /> View Workflow
            </Button>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)}>
                <Plus size={16} className="mr-1.5" /> Log Supply Order
              </Button>
            )}
          </>
        }
      />

      {workflowOpen && <WorkOrderWorkflowModal onClose={() => setWorkflowOpen(false)} />}

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatsCard
          title="On-Time Delivery"
          value={stats.onTimePercent != null ? `${stats.onTimePercent}%` : '—'}
          subtitle={`${stats.onTimeCount}/${stats.completedCount} completed on time`}
          icon={TrendingUp}
          color={stats.onTimePercent == null ? 'navy' : stats.onTimePercent >= 90 ? 'green' : stats.onTimePercent >= 70 ? 'yellow' : 'red'}
        />
        <StatsCard
          title="Awaiting Admin"
          value={pending}
          subtitle="Logged, pending admin"
          icon={Clock}
          color="yellow"
        />
        <StatsCard
          title="Open Closure Cycles"
          value={openCycles}
          subtitle="Across all WOs"
          icon={Receipt}
          color={openCycles > 0 ? 'blue' : 'navy'}
        />
        <StatsCard
          title="In Progress"
          value={inProgress}
          subtitle="Active work orders"
          icon={Send}
          color="blue"
        />
        <StatsCard
          title="Overdue"
          value={overdue}
          subtitle="Past effective PDC"
          icon={CalendarClock}
          color={overdue > 0 ? 'red' : 'green'}
        />
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
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <DateRangeFilter fromDate={fromDate} toDate={toDate} setFromDate={setFromDate} setToDate={setToDate} />
          <div className="inline-flex bg-navy-50 rounded-md p-0.5">
            <button
              onClick={() => setView('table')}
              className={`px-2.5 py-1 text-xs font-medium rounded ${view === 'table' ? 'bg-white shadow text-navy-800' : 'text-navy-600'}`}
              title="Dashboard table"
            >
              <TableIcon size={12} className="inline mr-1" /> Table
            </button>
            <button
              onClick={() => setView('cards')}
              className={`px-2.5 py-1 text-xs font-medium rounded ${view === 'cards' ? 'bg-white shadow text-navy-800' : 'text-navy-600'}`}
              title="Card view"
            >
              <LayoutGrid size={12} className="inline mr-1" /> Cards
            </button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><p className="text-navy-500 text-center py-8">Loading...</p></Card>
      ) : workOrders.length === 0 ? (
        <Card><p className="text-navy-500 text-center py-8">No work orders found.</p></Card>
      ) : view === 'table' ? (
        <DashboardTable workOrders={workOrders} onOpen={setDetail} />
      ) : (
        <div className="grid gap-3">
          {workOrders.map((w) => {
            const meta = STATUS_META[w.status] || { color: 'gray', label: w.status, Icon: ClipboardList };
            const Icon = meta.Icon;
            const deliveredPct = w.orderQuantity > 0 ? Math.min(100, Math.round((w.deliveredQty / w.orderQuantity) * 100)) : 0;
            return (
              <Card key={w.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => setDetail(w)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-xs text-navy-500">
                        {w.workOrderNumber}
                      </span>
                      <Badge color={meta.color}><Icon size={11} className="inline mr-1" />{meta.label}</Badge>
                      {w.overdue && <Badge color="red">Overdue</Badge>}
                      {w.onTime === true && <Badge color="green">On-Time</Badge>}
                      {w.onTime === false && <Badge color="red">Late</Badge>}
                    </div>
                    <h3 className="font-semibold text-navy-900 truncate">{w.customerName}</h3>
                    <p className="text-sm text-navy-600 truncate">
                      SO: {w.supplyOrderNo} • {formatDate(w.supplyOrderDate)}
                      {w.nomenclature ? ` • ${w.nomenclature}` : ''}
                    </p>
                    {w.supplyOrderDescription && (
                      <p className="text-xs text-navy-500 mt-0.5 line-clamp-1">{w.supplyOrderDescription}</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-navy-500 mt-2">
                      {w.assignedUnit && <span className="flex items-center gap-1"><Building2 size={11} />{w.assignedUnit.name}</span>}
                      <span>PDC: {formatDate(w.effectivePdcDate)}{w.extensions?.length ? ` (ext ${w.extensions.length})` : ''}</span>
                      <span>Qty: {w.deliveredQty}/{w.orderQuantity} {w.orderUnit}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-navy-500">Progress</p>
                    <p className="font-semibold text-navy-900">{deliveredPct}%</p>
                    <div className="w-24 h-1.5 bg-navy-100 rounded-full mt-1 overflow-hidden">
                      <div
                        className={`h-full ${deliveredPct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                        style={{ width: `${deliveredPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateWorkOrderModal
          units={units}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); setRefreshKey((k) => k + 1); }}
        />
      )}

      {detail && (
        <WorkOrderDetailModal
          workOrderId={detail.id}
          currentUser={user}
          units={units}
          onClose={() => setDetail(null)}
          onUpdated={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Dashboard table — matches the client-specified column list.
// ────────────────────────────────────────────────────────────────────
function DashboardTable({ workOrders, onOpen }) {
  const lastExt = (w) => (w.extensions?.length ? w.extensions[w.extensions.length - 1] : null);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[1800px]">
          <thead className="bg-navy-50 text-navy-700 sticky top-0">
            <tr className="text-left">
              <Th>Supply Order No</Th>
              <Th>SO Date</Th>
              <Th>Internal WO No</Th>
              <Th>Admin Approval</Th>
              <Th>Unit Acceptance</Th>
              <Th>Nomenclature</Th>
              <Th>Order Qty</Th>
              <Th>PDC</Th>
              <Th>Bank Guarantee (No · Date)</Th>
              <Th>Insurance (No · Date)</Th>
              <Th>PDC Extension (Req · PRC)</Th>
              <Th>BG Extended Upto</Th>
              <Th>Delivery Details</Th>
              <Th>Remarks</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {workOrders.map((w, i) => {
              const ext = lastExt(w);
              const meta = STATUS_META[w.status] || { color: 'gray', label: w.status };
              return (
                <tr
                  key={w.id}
                  className={`border-t border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                  onClick={() => onOpen(w)}
                >
                  <Td className="font-medium text-navy-800">{w.supplyOrderNo}</Td>
                  <Td>{formatDate(w.supplyOrderDate)}</Td>
                  <Td className="font-mono text-[11px]">{w.workOrderNumber}</Td>
                  <Td>
                    {w.adminAcceptedAt ? (
                      <div>
                        <div>{formatDate(w.adminAcceptedAt)}</div>
                        {w.adminAcceptedBy && <div className="text-navy-500">{w.adminAcceptedBy.name}</div>}
                      </div>
                    ) : <span className="text-navy-400">—</span>}
                  </Td>
                  <Td>
                    {w.unitAcceptedAt ? (
                      <div>
                        <div>{formatDate(w.unitAcceptedAt)}</div>
                        {w.unitAcceptedBy && <div className="text-navy-500">{w.unitAcceptedBy.name}</div>}
                        {w.assignedUnit && <div className="text-navy-400">{w.assignedUnit.code}</div>}
                      </div>
                    ) : <span className="text-navy-400">—</span>}
                  </Td>
                  <Td>{w.nomenclature || <span className="text-navy-400">—</span>}</Td>
                  <Td>{w.orderQuantity} {w.orderUnit}</Td>
                  <Td>
                    <div>{formatDate(w.effectivePdcDate)}</div>
                    {w.extensions?.length > 0 && (
                      <div className="text-navy-400">{w.extensions.length} ext</div>
                    )}
                  </Td>
                  <Td>
                    {w.bankGuaranteeNo
                      ? <>{w.bankGuaranteeNo}{w.bankGuaranteeDate ? ` · ${formatDate(w.bankGuaranteeDate)}` : ''}</>
                      : <span className="text-navy-400">—</span>}
                  </Td>
                  <Td>
                    {w.insuranceNo
                      ? <>{w.insuranceNo}{w.insuranceDate ? ` · ${formatDate(w.insuranceDate)}` : ''}</>
                      : <span className="text-navy-400">—</span>}
                  </Td>
                  <Td>
                    {ext ? (
                      <div>
                        <div>Req: {ext.requestLetterStatus || '—'}</div>
                        <div>PRC: {ext.prcStatus || '—'}</div>
                      </div>
                    ) : <span className="text-navy-400">—</span>}
                  </Td>
                  <Td>{ext?.bankGuaranteeExtendedUpto ? formatDate(ext.bankGuaranteeExtendedUpto) : <span className="text-navy-400">—</span>}</Td>
                  <Td className="max-w-[200px] truncate" title={w.deliveryDetails || ''}>
                    {w.deliveryDetails || <span className="text-navy-400">—</span>}
                  </Td>
                  <Td className="max-w-[200px] truncate" title={w.remarks || ''}>
                    {w.remarks || <span className="text-navy-400">—</span>}
                  </Td>
                  <Td>
                    <Badge color={meta.color}>{meta.label}</Badge>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const Th = ({ children }) => (
  <th className="px-2.5 py-2 text-[11px] uppercase tracking-wider font-semibold whitespace-nowrap">{children}</th>
);
const Td = ({ children, className = '' }) => (
  <td className={`px-2.5 py-2 align-top text-navy-700 ${className}`}>{children}</td>
);

// ────────────────────────────────────────────────────────────────────
// Create
// ────────────────────────────────────────────────────────────────────
function CreateWorkOrderModal({ units, onClose, onCreated }) {
  const [form, setForm] = useState({
    supplyOrderNo: '', supplyOrderDate: '', supplyOrderDescription: '', nomenclature: '',
    customerName: '', customerContact: '',
    orderQuantity: '', orderUnit: 'Nos', pdcDate: '', deliveryClause: '',
    fimDetails: '', inspectionAgency: '', qapNo: '',
    drawingsDetails: '', processDrawingsDetails: '',
    toolingScope: '', packingDetails: '', transportationDetails: '',
    majorWorksAtSite: '', projectCoordinator: '', otherInformation: '',
    orderTermsAndScope: '', remarks: '',
    bankGuaranteeNo: '', bankGuaranteeDate: '',
    insuranceNo: '', insuranceDate: '',
    assignedUnitId: '', ionNumber: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { ...form };
      payload.orderQuantity = Number(form.orderQuantity);
      if (!payload.assignedUnitId) delete payload.assignedUnitId;
      await api.post('/work-orders', payload);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log supply order');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Log Supply Order (→ Awaiting Admin)" size="xl">
      <form onSubmit={submit} className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <Section title="External Supply Order">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Supply Order No *" value={form.supplyOrderNo} onChange={(e) => setField('supplyOrderNo', e.target.value)} required />
            <Input label="Supply Order Date *" type="date" value={form.supplyOrderDate} onChange={(e) => setField('supplyOrderDate', e.target.value)} required />
            <Input label="ION No (header)" value={form.ionNumber} onChange={(e) => setField('ionNumber', e.target.value)} placeholder="e.g. RAPS/UNIT-5/26-27/02" />
          </div>
          <Input label="Nomenclature" value={form.nomenclature} onChange={(e) => setField('nomenclature', e.target.value)} placeholder="Short item name" />
          <Textarea label="Supply Order Description" rows={2} value={form.supplyOrderDescription} onChange={(e) => setField('supplyOrderDescription', e.target.value)} />
        </Section>

        <Section title="Customer">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Customer Name *" value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} required />
            <Input label="Customer Details (Contact)" value={form.customerContact} onChange={(e) => setField('customerContact', e.target.value)} placeholder="Name, designation, mobile" />
          </div>
        </Section>

        <Section title="Order & Delivery">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input label="Order Quantity *" type="number" step="any" value={form.orderQuantity} onChange={(e) => setField('orderQuantity', e.target.value)} required />
            <Input label="Unit (UOM)" value={form.orderUnit} onChange={(e) => setField('orderUnit', e.target.value)} />
            <Input label="PDC Date *" type="date" value={form.pdcDate} onChange={(e) => setField('pdcDate', e.target.value)} required />
            <Input label="Delivery Clause" value={form.deliveryClause} onChange={(e) => setField('deliveryClause', e.target.value)} placeholder="Prorata / On or before / In lots" />
          </div>
        </Section>

        <Section title="Bank Guarantee & Insurance (Accounts / Supply Chain may also edit later)">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input label="Bank Guarantee No" value={form.bankGuaranteeNo} onChange={(e) => setField('bankGuaranteeNo', e.target.value)} />
            <Input label="BG Date" type="date" value={form.bankGuaranteeDate} onChange={(e) => setField('bankGuaranteeDate', e.target.value)} />
            <Input label="Insurance No" value={form.insuranceNo} onChange={(e) => setField('insuranceNo', e.target.value)} />
            <Input label="Insurance Date" type="date" value={form.insuranceDate} onChange={(e) => setField('insuranceDate', e.target.value)} />
          </div>
        </Section>

        <Section title="Scope & Specs (from PDF form)">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Textarea label="FIM Details" rows={2} value={form.fimDetails} onChange={(e) => setField('fimDetails', e.target.value)} />
            <Input label="Inspection Agency" value={form.inspectionAgency} onChange={(e) => setField('inspectionAgency', e.target.value)} placeholder="R&QA, ASL/QA, QC ANSP" />
            <Input label="QAP No" value={form.qapNo} onChange={(e) => setField('qapNo', e.target.value)} />
            <Input label="Drawings Details" value={form.drawingsDetails} onChange={(e) => setField('drawingsDetails', e.target.value)} />
            <Input label="Process Drawings Details" value={form.processDrawingsDetails} onChange={(e) => setField('processDrawingsDetails', e.target.value)} />
            <Input label="Tooling (RAPS / Customer scope)" value={form.toolingScope} onChange={(e) => setField('toolingScope', e.target.value)} />
            <Input label="Packing Details" value={form.packingDetails} onChange={(e) => setField('packingDetails', e.target.value)} />
            <Input label="Transportation Details" value={form.transportationDetails} onChange={(e) => setField('transportationDetails', e.target.value)} />
            <Input label="Major works at site" value={form.majorWorksAtSite} onChange={(e) => setField('majorWorksAtSite', e.target.value)} placeholder="e.g. Unit-5" />
            <Input label="Project Co-Ordinator" value={form.projectCoordinator} onChange={(e) => setField('projectCoordinator', e.target.value)} />
          </div>
          <Textarea label="Order Terms & Conditions / Scope" rows={3} value={form.orderTermsAndScope} onChange={(e) => setField('orderTermsAndScope', e.target.value)} />
          <Textarea label="Other Information" rows={2} value={form.otherInformation} onChange={(e) => setField('otherInformation', e.target.value)} />
          <Textarea label="Remarks" rows={2} value={form.remarks} onChange={(e) => setField('remarks', e.target.value)} />
        </Section>

        <Section title="Suggested Unit Assignment (admin can change)">
          <Select label="Assign Unit (optional)" value={form.assignedUnitId} onChange={(e) => setField('assignedUnitId', e.target.value)}>
            <option value="">— Decide on admin acceptance —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
          </Select>
        </Section>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit to Admin'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Detail / action modal
// ────────────────────────────────────────────────────────────────────
function WorkOrderDetailModal({ workOrderId, currentUser, units, onClose, onUpdated }) {
  const [wo, setWo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState('overview');

  const fetchOne = () => {
    setLoading(true);
    api.get(`/work-orders/${workOrderId}`)
      .then(({ data }) => setWo(data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(fetchOne, [workOrderId]);

  if (loading) {
    return <Modal isOpen onClose={onClose} title="Work Order" size="lg"><p className="text-center py-8 text-navy-500">Loading...</p></Modal>;
  }
  if (!wo) {
    return <Modal isOpen onClose={onClose} title="Work Order" size="lg"><p className="text-red-600">{error || 'Not found'}</p></Modal>;
  }

  const role = currentUser?.role;
  const isCreator = role === 'SUPPLY_CHAIN' || role === 'ADMIN';
  const isAdmin = role === 'ADMIN';
  const isSupplyChain = role === 'SUPPLY_CHAIN';
  const isAccounting = role === 'ACCOUNTING';
  const isUnitManager = role === 'MANAGER' && currentUser.unitId === wo.assignedUnitId;
  const canReassign = (isSupplyChain || isAdmin) && wo.status === 'ON_HOLD';
  const canManageExtensions = isSupplyChain || isUnitManager;
  const canEditDelivery = isSupplyChain || isAdmin || isAccounting;
  const canEditBgInsurance = isSupplyChain || isAdmin || isAccounting;
  // Anyone who can see the WO can edit remarks.
  const canEditRemarks = true;
  const meta = STATUS_META[wo.status];

  const handleAction = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      fetchOne();
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Work Order ${wo.workOrderNumber}`} size="xl">
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {error && <div className="p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div className="flex items-center gap-2 flex-wrap">
          <Badge color={meta.color}>{meta.label}</Badge>
          {wo.onTime === true && <Badge color="green">On-Time</Badge>}
          {wo.onTime === false && <Badge color="red">Late</Badge>}
          {wo.overdue && <Badge color="red">Overdue</Badge>}
          {wo.ionNumber && <span className="text-xs text-navy-500 font-mono">ION: {wo.ionNumber}</span>}
        </div>

        <div className="border-b flex gap-2 flex-wrap">
          {['overview', 'bg-insurance', 'extensions', 'invoices', 'closures', 'delivery', 'remarks'].map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`px-3 py-2 text-xs uppercase tracking-wider font-semibold ${section === s ? 'border-b-2 border-navy-700 text-navy-800' : 'text-navy-400'}`}
            >
              {s === 'extensions' ? `Extensions (${wo.extensions.length})`
                : s === 'invoices' ? `Invoices (${wo.invoices.length})`
                : s === 'closures' ? `Closures (${(wo.closures || []).length})`
                : s === 'bg-insurance' ? 'BG / Insurance'
                : s}
            </button>
          ))}
        </div>

        {section === 'overview' && <OverviewTab wo={wo} />}
        {section === 'bg-insurance' && (
          <BgInsuranceTab
            wo={wo}
            canEdit={canEditBgInsurance}
            busy={busy}
            onAddBg={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/bg-entries`, payload))}
            onAddInsurance={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/insurance-entries`, payload))}
          />
        )}
        {section === 'extensions' && (
          <ExtensionsTab
            wo={wo}
            canManage={canManageExtensions}
            busy={busy}
            onAdd={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/extensions`, payload))}
            onUpdate={(extId, payload) => handleAction(() => api.patch(`/work-orders/${wo.id}/extensions/${extId}`, payload))}
          />
        )}
        {section === 'invoices' && (
          <InvoicesTab wo={wo} canLog={isUnitManager || isSupplyChain} busy={busy} onAdd={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/invoices`, payload))} />
        )}
        {section === 'closures' && (
          <ClosuresTab
            wo={wo}
            currentUser={currentUser}
            busy={busy}
            onAction={handleAction}
          />
        )}
        {section === 'delivery' && (
          <DeliveryDetailsTab
            wo={wo}
            canEdit={canEditDelivery}
            busy={busy}
            onSave={(deliveryDetails) => handleAction(() => api.put(`/work-orders/${wo.id}/delivery-details`, { deliveryDetails }))}
          />
        )}
        {section === 'remarks' && (
          <RemarksTab
            wo={wo}
            canEdit={canEditRemarks}
            busy={busy}
            onSave={(remarks) => handleAction(() => api.patch(`/work-orders/${wo.id}/remarks`, { remarks }))}
          />
        )}

        {/* Action footer */}
        <div className="border-t pt-3 flex flex-wrap justify-end gap-2">
          {isAdmin && wo.status === 'PENDING_ADMIN' && (
            <AdminAcceptControls
              wo={wo} units={units} busy={busy}
              onAccept={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/admin-accept`, { accept: true, ...payload }))}
              onReject={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/admin-accept`, { accept: false, ...payload }))}
            />
          )}
          {isUnitManager && wo.status === 'ADMIN_ACCEPTED' && (
            <UnitAcceptControl
              busy={busy}
              onAccept={(note) => handleAction(() => api.post(`/work-orders/${wo.id}/unit-accept`, { accept: true, note }))}
              onReject={(note) => handleAction(() => api.post(`/work-orders/${wo.id}/unit-accept`, { accept: false, note }))}
            />
          )}
          {canReassign && (
            <ReassignControl
              wo={wo} units={units} busy={busy}
              onReassign={(payload) => handleAction(() => api.post(`/work-orders/${wo.id}/reassign`, payload))}
            />
          )}
          {isCreator && !['CLOSED', 'CANCELLED', 'REJECTED'].includes(wo.status) && (
            <Button variant="secondary" disabled={busy} onClick={() => {
              const reason = window.prompt('Cancel this WO?\n\nEnter a reason (required):');
              if (!reason || !reason.trim()) return;
              handleAction(() => api.post(`/work-orders/${wo.id}/cancel`, { reason: reason.trim() }));
            }}>
              Cancel WO
            </Button>
          )}
          {isCreator && (wo.status === 'COMPLETED' || wo.status === 'IN_PROGRESS') && wo.status !== 'CLOSED' && (
            <Button disabled={busy} onClick={async () => {
              const shortfall = (wo.orderQuantity || 0) - (wo.deliveredQty || 0);
              const intro = shortfall > 0
                ? `Close WO with shortfall of ${shortfall} ${wo.orderUnit}?\n\nReason is required.`
                : `Close this WO?\n\nReason (optional):`;
              const reason = window.prompt(intro, '');
              if (reason === null) return;
              if (shortfall > 0 && !reason.trim()) {
                alert('Reason is required for short-close.');
                return;
              }
              handleAction(() => api.post(`/work-orders/${wo.id}/close`, {
                reason: reason.trim() || undefined,
                force: shortfall > 0 ? true : undefined,
              }));
            }}>
              Close WO
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function OverviewTab({ wo }) {
  const Row = ({ label, value }) => (
    <div className="grid grid-cols-3 gap-2 text-sm py-1.5 border-b border-navy-50">
      <div className="text-navy-500">{label}</div>
      <div className="col-span-2 text-navy-800 whitespace-pre-wrap break-words">{value || '—'}</div>
    </div>
  );

  return (
    <div className="space-y-1">
      <Row label="Supply Order No / Date" value={`${wo.supplyOrderNo}, Dt. ${formatDate(wo.supplyOrderDate)}`} />
      <Row label="Nomenclature" value={wo.nomenclature} />
      <Row label="Description" value={wo.supplyOrderDescription} />
      <Row label="Customer" value={wo.customerName} />
      <Row label="Customer Contact" value={wo.customerContact} />
      <Row label="Order Quantity" value={`${wo.orderQuantity} ${wo.orderUnit}`} />
      <Row label="PDC (effective)" value={`${formatDate(wo.effectivePdcDate)}${wo.extensions.length ? ` (after ${wo.extensions.length} extension${wo.extensions.length > 1 ? 's' : ''})` : ''}`} />
      <Row label="Original PDC" value={formatDate(wo.pdcDate)} />
      <Row label="Delivery Clause" value={wo.deliveryClause} />
      <Row label="Delivered / Invoiced" value={`${wo.deliveredQty} / ${wo.invoicedQty} ${wo.orderUnit}`} />
      <Row label="Assigned Unit" value={wo.assignedUnit ? `${wo.assignedUnit.name} (${wo.assignedUnit.code})` : null} />
      <Row label="FIM Details" value={wo.fimDetails} />
      <Row label="Inspection Agency" value={wo.inspectionAgency} />
      <Row label="QAP No" value={wo.qapNo} />
      <Row label="Drawings Details" value={wo.drawingsDetails} />
      <Row label="Process Drawings" value={wo.processDrawingsDetails} />
      <Row label="Tooling" value={wo.toolingScope} />
      <Row label="Packing" value={wo.packingDetails} />
      <Row label="Transportation" value={wo.transportationDetails} />
      <Row label="Major works at site" value={wo.majorWorksAtSite} />
      <Row label="Project Co-Ordinator" value={wo.projectCoordinator} />
      <Row label="Order Terms & Conditions / Scope" value={wo.orderTermsAndScope} />
      <Row label="Other Information" value={wo.otherInformation} />
      <Row label="Created by" value={wo.createdBy ? `${wo.createdBy.name} (${formatDate(wo.createdAt)})` : null} />
      <Row label="Admin acceptance" value={wo.adminAcceptedBy ? `${wo.adminAcceptedBy.name} (${formatDate(wo.adminAcceptedAt)})${wo.adminAcceptanceNote ? `\n${wo.adminAcceptanceNote}` : ''}` : null} />
      <Row label="Unit acceptance" value={wo.unitAcceptedBy ? `${wo.unitAcceptedBy.name} (${formatDate(wo.unitAcceptedAt)})${wo.unitAcceptanceNote ? `\n${wo.unitAcceptanceNote}` : ''}` : null} />
      {wo.completedAt && <Row label="Completed at" value={`${formatDate(wo.completedAt)}${wo.onTime != null ? ` — ${wo.onTime ? 'On time' : 'Late'}` : ''}`} />}
    </div>
  );
}

// ── BG / Insurance — append-only history ──
// Newest entry is the active value (server mirrors it back onto the WO).
// Visible to all; editable by SUPPLY_CHAIN / ACCOUNTING / ADMIN.
function BgInsuranceTab({ wo, canEdit, busy, onAddBg, onAddInsurance }) {
  const [bgForm, setBgForm] = useState({ bgNo: '', bgDate: '', validUpto: '', note: '' });
  const [insForm, setInsForm] = useState({ insuranceNo: '', insuranceDate: '', validUpto: '', note: '' });

  const submitBg = (e) => {
    e.preventDefault();
    if (!bgForm.bgNo.trim()) return;
    onAddBg({
      bgNo: bgForm.bgNo.trim(),
      bgDate: bgForm.bgDate || null,
      validUpto: bgForm.validUpto || null,
      note: bgForm.note || null,
    });
    setBgForm({ bgNo: '', bgDate: '', validUpto: '', note: '' });
  };

  const submitIns = (e) => {
    e.preventDefault();
    if (!insForm.insuranceNo.trim()) return;
    onAddInsurance({
      insuranceNo: insForm.insuranceNo.trim(),
      insuranceDate: insForm.insuranceDate || null,
      validUpto: insForm.validUpto || null,
      note: insForm.note || null,
    });
    setInsForm({ insuranceNo: '', insuranceDate: '', validUpto: '', note: '' });
  };

  const bgEntries = wo.bgEntries || [];
  const insEntries = wo.insuranceEntries || [];

  return (
    <div className="space-y-6">
      {/* Bank Guarantee */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Bank Guarantee — history</p>
          {bgEntries[0] && (
            <Badge color="green">Active: {bgEntries[0].bgNo}</Badge>
          )}
        </div>
        {bgEntries.length === 0 ? (
          <p className="text-sm text-navy-500">No BG entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th className="text-left px-2 py-1.5">BG No</th>
                  <th className="text-left px-2 py-1.5">BG Date</th>
                  <th className="text-left px-2 py-1.5">Valid Upto</th>
                  <th className="text-left px-2 py-1.5">Added</th>
                  <th className="text-left px-2 py-1.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {bgEntries.map((e, i) => (
                  <tr key={e.id} className={`border-b border-navy-50 ${i === 0 ? 'bg-green-50/40' : ''}`}>
                    <td className="px-2 py-1.5 font-mono text-xs">{e.bgNo}{i === 0 && <span className="ml-1 text-[10px] text-green-700">(active)</span>}</td>
                    <td className="px-2 py-1.5">{e.bgDate ? formatDate(e.bgDate) : '—'}</td>
                    <td className="px-2 py-1.5">{e.validUpto ? formatDate(e.validUpto) : '—'}</td>
                    <td className="px-2 py-1.5 text-navy-600">{e.addedBy?.name || '—'} · {formatDate(e.addedAt)}</td>
                    <td className="px-2 py-1.5 text-navy-600">{e.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <form onSubmit={submitBg} className="border-t pt-3 space-y-2">
            <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Append BG entry (becomes active)</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <Input label="BG No *" value={bgForm.bgNo} onChange={(e) => setBgForm({ ...bgForm, bgNo: e.target.value })} required />
              <Input label="BG Date" type="date" value={bgForm.bgDate} onChange={(e) => setBgForm({ ...bgForm, bgDate: e.target.value })} />
              <Input label="Valid Upto" type="date" value={bgForm.validUpto} onChange={(e) => setBgForm({ ...bgForm, validUpto: e.target.value })} />
              <Input label="Note" value={bgForm.note} onChange={(e) => setBgForm({ ...bgForm, note: e.target.value })} />
            </div>
            <Button type="submit" disabled={busy || !bgForm.bgNo.trim()}>Add BG Entry</Button>
          </form>
        )}
      </div>

      {/* Insurance */}
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Insurance — history</p>
          {insEntries[0] && (
            <Badge color="green">Active: {insEntries[0].insuranceNo}</Badge>
          )}
        </div>
        {insEntries.length === 0 ? (
          <p className="text-sm text-navy-500">No insurance entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-navy-50 text-navy-700">
                <tr>
                  <th className="text-left px-2 py-1.5">Insurance No</th>
                  <th className="text-left px-2 py-1.5">Date</th>
                  <th className="text-left px-2 py-1.5">Valid Upto</th>
                  <th className="text-left px-2 py-1.5">Added</th>
                  <th className="text-left px-2 py-1.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {insEntries.map((e, i) => (
                  <tr key={e.id} className={`border-b border-navy-50 ${i === 0 ? 'bg-green-50/40' : ''}`}>
                    <td className="px-2 py-1.5 font-mono text-xs">{e.insuranceNo}{i === 0 && <span className="ml-1 text-[10px] text-green-700">(active)</span>}</td>
                    <td className="px-2 py-1.5">{e.insuranceDate ? formatDate(e.insuranceDate) : '—'}</td>
                    <td className="px-2 py-1.5">{e.validUpto ? formatDate(e.validUpto) : '—'}</td>
                    <td className="px-2 py-1.5 text-navy-600">{e.addedBy?.name || '—'} · {formatDate(e.addedAt)}</td>
                    <td className="px-2 py-1.5 text-navy-600">{e.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <form onSubmit={submitIns} className="border-t pt-3 space-y-2">
            <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Append Insurance entry (becomes active)</p>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <Input label="Insurance No *" value={insForm.insuranceNo} onChange={(e) => setInsForm({ ...insForm, insuranceNo: e.target.value })} required />
              <Input label="Insurance Date" type="date" value={insForm.insuranceDate} onChange={(e) => setInsForm({ ...insForm, insuranceDate: e.target.value })} />
              <Input label="Valid Upto" type="date" value={insForm.validUpto} onChange={(e) => setInsForm({ ...insForm, validUpto: e.target.value })} />
              <Input label="Note" value={insForm.note} onChange={(e) => setInsForm({ ...insForm, note: e.target.value })} />
            </div>
            <Button type="submit" disabled={busy || !insForm.insuranceNo.trim()}>Add Insurance Entry</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function ExtensionsTab({ wo, canManage, busy, onAdd, onUpdate }) {
  const [form, setForm] = useState({
    newPdcDate: '', reason: '', bankGuaranteeExtendedUpto: '',
    requestLetterStatus: '', prcStatus: '',
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.newPdcDate || !form.bankGuaranteeExtendedUpto) return;
    onAdd(form);
    setForm({ newPdcDate: '', reason: '', bankGuaranteeExtendedUpto: '', requestLetterStatus: '', prcStatus: '' });
  };

  return (
    <div className="space-y-3">
      {wo.extensions.length === 0 ? (
        <p className="text-sm text-navy-500">No extensions logged. Effective PDC = original PDC ({formatDate(wo.pdcDate)}).</p>
      ) : (
        <div className="space-y-2">
          {wo.extensions.map((ext) => (
            <ExtensionRow
              key={ext.id}
              ext={ext}
              canManage={canManage}
              busy={busy}
              onUpdate={(payload) => onUpdate(ext.id, payload)}
            />
          ))}
        </div>
      )}

      {canManage && (
        <form onSubmit={submit} className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">
            Add PDC Extension — Bank Guarantee must also be extended
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input label="New PDC Date *" type="date" value={form.newPdcDate} onChange={(e) => setForm({ ...form, newPdcDate: e.target.value })} required />
            <Input label="BG Extended Upto *" type="date" value={form.bankGuaranteeExtendedUpto} onChange={(e) => setForm({ ...form, bankGuaranteeExtendedUpto: e.target.value })} required />
            <Input label="Request Letter Status" value={form.requestLetterStatus} onChange={(e) => setForm({ ...form, requestLetterStatus: e.target.value })} placeholder="e.g. Sent / Acknowledged / Pending" />
            <Input label="PRC Status" value={form.prcStatus} onChange={(e) => setForm({ ...form, prcStatus: e.target.value })} placeholder="e.g. Issued / Pending" />
          </div>
          <Input label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Button type="submit" disabled={busy || !form.newPdcDate || !form.bankGuaranteeExtendedUpto}>Log Extension</Button>
        </form>
      )}
    </div>
  );
}

function ExtensionRow({ ext, canManage, busy, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    requestLetterStatus: ext.requestLetterStatus || '',
    prcStatus: ext.prcStatus || '',
    bankGuaranteeExtendedUpto: ext.bankGuaranteeExtendedUpto ? ext.bankGuaranteeExtendedUpto.slice(0, 10) : '',
  });

  return (
    <div className="p-3 bg-navy-50 rounded-md">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="font-semibold text-navy-800">Extension #{ext.extensionNo}</span>
        <span className="text-sm text-navy-600">New PDC: {formatDate(ext.newPdcDate)}</span>
      </div>
      {ext.reason && <p className="text-xs text-navy-600 mt-1">{ext.reason}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-navy-600 mt-2">
        <div><span className="text-navy-500">BG Extended Upto:</span> {ext.bankGuaranteeExtendedUpto ? formatDate(ext.bankGuaranteeExtendedUpto) : '—'}</div>
        <div><span className="text-navy-500">Req Letter:</span> {ext.requestLetterStatus || '—'}</div>
        <div><span className="text-navy-500">PRC:</span> {ext.prcStatus || '—'}</div>
      </div>
      <p className="text-xs text-navy-400 mt-1">Granted {formatDate(ext.grantedAt)}</p>

      {canManage && (
        editing ? (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input label="BG Extended Upto" type="date" value={form.bankGuaranteeExtendedUpto} onChange={(e) => setForm({ ...form, bankGuaranteeExtendedUpto: e.target.value })} />
            <Input label="Request Letter Status" value={form.requestLetterStatus} onChange={(e) => setForm({ ...form, requestLetterStatus: e.target.value })} />
            <Input label="PRC Status" value={form.prcStatus} onChange={(e) => setForm({ ...form, prcStatus: e.target.value })} />
            <div className="sm:col-span-3 flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => { onUpdate(form); setEditing(false); }} disabled={busy}>Save</Button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="text-xs text-navy-600 hover:text-navy-800 underline mt-2">
            Update statuses
          </button>
        )
      )}
    </div>
  );
}

function DeliveryDetailsTab({ wo, canEdit, busy, onSave }) {
  const [text, setText] = useState(wo.deliveryDetails || '');
  return (
    <div className="space-y-3">
      <p className="text-xs text-navy-500">
        Filled by Supply Chain or Accounts. Free-text log of delivery progress, dispatch notes, courier details, etc.
      </p>
      {canEdit ? (
        <>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Lot 1 dispatched on 12-May-26 via XYZ Logistics, LR # 1234..." />
          <Button disabled={busy} onClick={() => onSave(text)}>Save Delivery Details</Button>
        </>
      ) : (
        <div className="text-sm text-navy-700 whitespace-pre-wrap p-3 bg-navy-50 rounded">{wo.deliveryDetails || '—'}</div>
      )}
      {wo.deliveryDetailsUpdatedBy && (
        <p className="text-xs text-navy-400">
          Last updated by {wo.deliveryDetailsUpdatedBy.name} on {formatDate(wo.deliveryDetailsUpdatedAt)}
        </p>
      )}
    </div>
  );
}

function RemarksTab({ wo, canEdit, busy, onSave }) {
  const [text, setText] = useState(wo.remarks || '');
  return (
    <div className="space-y-3">
      <p className="text-xs text-navy-500">
        Open notes — any role with access to this WO can add or edit remarks.
      </p>
      {canEdit ? (
        <>
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
          <Button disabled={busy} onClick={() => onSave(text)}>Save Remarks</Button>
        </>
      ) : (
        <div className="text-sm text-navy-700 whitespace-pre-wrap p-3 bg-navy-50 rounded">{wo.remarks || '—'}</div>
      )}
    </div>
  );
}

function InvoicesTab({ wo, canLog, busy, onAdd }) {
  const [form, setForm] = useState({ invoiceNo: '', invoiceDate: '', quantity: '', remarks: '' });
  const remaining = Math.max(0, wo.orderQuantity - wo.deliveredQty);

  const submit = (e) => {
    e.preventDefault();
    if (!form.invoiceNo || !form.invoiceDate || !form.quantity) return;
    onAdd({
      ...form,
      quantity: Number(form.quantity),
    });
    setForm({ invoiceNo: '', invoiceDate: '', quantity: '', remarks: '' });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="p-3 bg-navy-50 rounded-md">
          <p className="text-xs text-navy-500">Ordered</p>
          <p className="font-bold text-navy-800">{wo.orderQuantity} {wo.orderUnit}</p>
        </div>
        <div className="p-3 bg-green-50 rounded-md">
          <p className="text-xs text-green-700">Delivered</p>
          <p className="font-bold text-green-800">{wo.deliveredQty} {wo.orderUnit}</p>
        </div>
        <div className="p-3 bg-yellow-50 rounded-md">
          <p className="text-xs text-yellow-700">Remaining</p>
          <p className="font-bold text-yellow-800">{remaining} {wo.orderUnit}</p>
        </div>
      </div>

      {wo.invoices.length === 0 ? (
        <p className="text-sm text-navy-500">No delivery invoices logged yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-navy-50 text-navy-700">
              <tr>
                <th className="text-left px-2 py-1.5">Invoice No</th>
                <th className="text-left px-2 py-1.5">Date</th>
                <th className="text-right px-2 py-1.5">Qty</th>
                <th className="text-left px-2 py-1.5">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {wo.invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-navy-50">
                  <td className="px-2 py-1.5 font-mono text-xs">{inv.invoiceNo}</td>
                  <td className="px-2 py-1.5">{formatDate(inv.invoiceDate)}</td>
                  <td className="px-2 py-1.5 text-right">{inv.quantity}</td>
                  <td className="px-2 py-1.5 text-navy-600">{inv.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canLog && remaining > 0 && (
        <form onSubmit={submit} className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Log Delivery Invoice (qty-wise, no amount)</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Input label="Invoice No *" value={form.invoiceNo} onChange={(e) => setForm({ ...form, invoiceNo: e.target.value })} required />
            <Input label="Invoice Date *" type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} required />
            <Input label="Quantity *" type="number" step="any" min="0.01" max={remaining} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
            <Input label="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
          </div>
          <Button type="submit" disabled={busy}>Log Invoice</Button>
        </form>
      )}
    </div>
  );
}

function AdminAcceptControls({ wo, units, busy, onAccept, onReject }) {
  const [note, setNote] = useState('');
  const [assignedUnitId, setAssignedUnitId] = useState(wo.assignedUnitId || '');
  return (
    <div className="w-full space-y-2 border-t pt-3">
      <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Admin Acceptance</p>
      <Select label="Assign to Unit *" value={assignedUnitId} onChange={(e) => setAssignedUnitId(e.target.value)}>
        <option value="">Select unit...</option>
        {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
      </Select>
      <Textarea label="Acceptance note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="danger" disabled={busy} onClick={() => onReject({ note })}>Reject</Button>
        <Button disabled={busy || !assignedUnitId} onClick={() => onAccept({ note, assignedUnitId })}>Accept &amp; Assign</Button>
      </div>
    </div>
  );
}

function UnitAcceptControl({ busy, onAccept, onReject }) {
  const [note, setNote] = useState('');
  return (
    <div className="w-full space-y-2 border-t pt-3">
      <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Unit Decision</p>
      <Textarea
        label="Note (required when rejecting)"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason for rejection or remarks on acceptance"
      />
      <div className="flex justify-end gap-2">
        <Button variant="danger" disabled={busy || !note.trim()} onClick={() => onReject(note)}>
          Reject
        </Button>
        <Button disabled={busy} onClick={() => onAccept(note)}>Accept</Button>
      </div>
      <p className="text-xs text-navy-500">
        Rejecting puts this WO on hold. Supply Chain or Admin can reassign it to another unit.
      </p>
    </div>
  );
}

function ReassignControl({ wo, units, busy, onReassign }) {
  const [assignedUnitId, setAssignedUnitId] = useState(wo.assignedUnitId || '');
  const [note, setNote] = useState('');
  return (
    <div className="w-full space-y-2 border-t pt-3">
      <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Reassign Work Order</p>
      {wo.unitAcceptanceNote && (
        <p className="text-xs text-red-700 bg-red-50 p-2 rounded">
          Rejection note: {wo.unitAcceptanceNote}
        </p>
      )}
      <Select label="Assign to Unit *" value={assignedUnitId} onChange={(e) => setAssignedUnitId(e.target.value)}>
        <option value="">Select unit...</option>
        {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
      </Select>
      <Textarea label="Reassignment note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end">
        <Button disabled={busy || !assignedUnitId} onClick={() => onReassign({ assignedUnitId, note })}>
          Reassign &amp; Send to Unit
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Closure cycles — per delivery batch.
// Finance / payment / SLA fields are sanitized server-side for MANAGER + QC,
// but UI also gates them with canSeeFinance for clarity.
// ────────────────────────────────────────────────────────────────────
function ClosuresTab({ wo, currentUser, busy, onAction }) {
  const role = currentUser?.role;
  const isUnitManager = role === 'MANAGER' && currentUser.unitId === wo.assignedUnitId;
  const isAdmin = role === 'ADMIN';
  const canOpenCycle = isUnitManager || isAdmin;
  const showFinance = canSeeFinance(role);

  const closures = wo.closures || [];
  const alreadyCovered = closures.reduce((s, c) => s + (c.deliveryQty || 0), 0);
  const remaining = Math.max(0, wo.orderQuantity - alreadyCovered);
  const canStartCycle = canOpenCycle
    && remaining > 0
    && ['UNIT_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(wo.status);

  const [openForm, setOpenForm] = useState({ deliveryQty: '', deliveryNote: '', deliveredAt: '' });

  const submitOpen = (e) => {
    e.preventDefault();
    if (!openForm.deliveryQty) return;
    onAction(() => api.post(`/work-orders/${wo.id}/closures`, {
      deliveryQty: Number(openForm.deliveryQty),
      deliveryNote: openForm.deliveryNote || null,
      deliveredAt: openForm.deliveredAt || null,
    }));
    setOpenForm({ deliveryQty: '', deliveryNote: '', deliveredAt: '' });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="p-3 bg-navy-50 rounded-md">
          <p className="text-xs text-navy-500">WO Qty</p>
          <p className="font-bold text-navy-800">{wo.orderQuantity} {wo.orderUnit}</p>
        </div>
        <div className="p-3 bg-blue-50 rounded-md">
          <p className="text-xs text-blue-700">In closure cycles</p>
          <p className="font-bold text-blue-800">{alreadyCovered} {wo.orderUnit}</p>
        </div>
        <div className="p-3 bg-yellow-50 rounded-md">
          <p className="text-xs text-yellow-700">Awaiting cycle</p>
          <p className="font-bold text-yellow-800">{remaining} {wo.orderUnit}</p>
        </div>
      </div>

      {!showFinance && (
        <p className="text-[11px] text-navy-500 italic">
          Invoice and payment details are restricted to Finance, Accounts and Level-5 management.
        </p>
      )}

      {closures.length === 0 ? (
        <p className="text-sm text-navy-500">No closure cycles opened yet.</p>
      ) : (
        <div className="space-y-3">
          {closures.map((c) => (
            <ClosureCycleCard
              key={c.id}
              wo={wo}
              cycle={c}
              currentUser={currentUser}
              busy={busy}
              onAction={onAction}
            />
          ))}
        </div>
      )}

      {canStartCycle && (
        <form onSubmit={submitOpen} className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Open new closure cycle (delivery batch)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              label={`Batch Qty * (max ${remaining})`}
              type="number"
              step="any"
              min="0.01"
              max={remaining}
              value={openForm.deliveryQty}
              onChange={(e) => setOpenForm({ ...openForm, deliveryQty: e.target.value })}
              required
            />
            <Input
              label="Delivered On"
              type="date"
              value={openForm.deliveredAt}
              onChange={(e) => setOpenForm({ ...openForm, deliveredAt: e.target.value })}
            />
            <Input
              label="Batch Note"
              value={openForm.deliveryNote}
              onChange={(e) => setOpenForm({ ...openForm, deliveryNote: e.target.value })}
              placeholder="e.g. Lot-2 of 5"
            />
          </div>
          <Button type="submit" disabled={busy || !openForm.deliveryQty}>Open Cycle</Button>
        </form>
      )}
    </div>
  );
}

function ClosureCycleCard({ wo, cycle, currentUser, busy, onAction }) {
  const role = currentUser?.role;
  const isUnitManager = role === 'MANAGER' && currentUser.unitId === wo.assignedUnitId;
  const isAdmin = role === 'ADMIN';
  const isQc = role === 'QC';
  const isFinance = role === 'FINANCE';
  const isAccounting = role === 'ACCOUNTING';
  const l5 = isL5(currentUser);
  const showFinance = canSeeFinance(role);

  const meta = CYCLE_STAGE_META[cycle.stage] || { color: 'gray', label: cycle.stage };
  const docs = cycle.docs || [];
  const docTypes = new Set(docs.map((d) => d.docType));
  const missingRequired = UNIT_DOC_TYPES.filter((d) => d.required && !docTypes.has(d.value));

  const openHold = (cycle.holdRequests || []).find((h) => !h.resolvedAt);

  const [docType, setDocType] = useState(UNIT_DOC_TYPES[0].value);
  const [docFile, setDocFile] = useState(null);
  const [docNote, setDocNote] = useState('');
  const [qcNote, setQcNote] = useState('');
  const [qcCertUrl, setQcCertUrl] = useState('');
  const [mgmtNote, setMgmtNote] = useState('');
  const [invForm, setInvForm] = useState({ invoiceDate: '', description: '', invoiceFileUrl: '' });
  const [payNote, setPayNote] = useState('');
  const [holdItems, setHoldItems] = useState([{ docType: '', note: '' }]);
  const [holdReason, setHoldReason] = useState('');
  const [resolveNote, setResolveNote] = useState('');

  // SLA chip — only meaningful while INVOICE_SENT
  const hoursLeft = cycle.slaDeadlineAt
    ? Math.round((new Date(cycle.slaDeadlineAt).getTime() - Date.now()) / (1000 * 60 * 60))
    : null;
  const breached = cycle.stage === 'INVOICE_SENT' && hoursLeft != null && hoursLeft <= 0;

  const canUploadDoc = isUnitManager || isAdmin || (isQc && cycle.stage === 'UNIT_DOCS_PENDING')
    || (isFinance && ['MGMT_APPROVED', 'INVOICE_SENT'].includes(cycle.stage))
    || (isAccounting && cycle.stage === 'INVOICE_SENT');

  const uploadDoc = (e) => {
    e.preventDefault();
    if (!docFile || !docType) return;
    const fd = new FormData();
    fd.append('file', docFile);
    fd.append('docType', docType);
    if (docNote) fd.append('note', docNote);
    onAction(() => api.post(
      `/work-orders/${wo.id}/closures/${cycle.id}/docs`,
      fd,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    ));
    setDocFile(null);
    setDocNote('');
  };

  const deleteDoc = (docId) => {
    if (!confirm('Delete this document?')) return;
    onAction(() => api.delete(`/work-orders/${wo.id}/closures/${cycle.id}/docs/${docId}`));
  };

  const submitToQc = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/submit-to-qc`));
  const qcVerify = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/qc-verify`, {
    certificateUrl: qcCertUrl || null,
    note: qcNote || null,
  }));
  const mgmtApprove = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/mgmt-approve`, { note: mgmtNote || null }));
  const sendInvoice = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/send-invoice`, {
    invoiceDate: invForm.invoiceDate || null,
    description: invForm.description || null,
    invoiceFileUrl: invForm.invoiceFileUrl || null,
  }));
  const paymentReceived = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/payment-received`, { note: payNote || null }));
  const holdCycle = () => {
    const cleaned = holdItems.filter((h) => h.docType.trim());
    if (!cleaned.length) return;
    onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/hold`, {
      missingItems: cleaned,
      reason: holdReason || null,
    }));
  };
  const resolveHold = () => {
    if (!openHold) return;
    onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/resolve-hold`, {
      holdId: openHold.id,
      note: resolveNote || null,
    }));
  };

  return (
    <div className="border border-navy-100 rounded-lg p-4 space-y-3 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-navy-800">Cycle #{cycle.cycleNumber}</span>
          <Badge color={meta.color}>{meta.label}</Badge>
          <span className="text-xs text-navy-500">{cycle.deliveryQty} {wo.orderUnit}</span>
          {cycle.deliveredAt && <span className="text-xs text-navy-400">Delivered {formatDate(cycle.deliveredAt)}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showFinance && cycle.stage === 'INVOICE_SENT' && hoursLeft != null && (
            <Badge color={breached ? 'red' : hoursLeft <= 12 ? 'yellow' : 'blue'}>
              {breached
                ? <><AlertTriangle size={11} className="inline mr-1" />Breached {Math.abs(hoursLeft)}h</>
                : <><Timer size={11} className="inline mr-1" />{hoursLeft}h left</>}
            </Badge>
          )}
          {cycle.qcVerifiedAt && (
            <DownloadPdfButton
              document={<QCVerificationCertificatePdf data={qcCertData(wo, cycle)} />}
              fileName={`${cycle.qcCertificateNumber || wo.workOrderNumber}-QC.pdf`}
              label="QC Cert"
              className="!py-1 !px-2"
            />
          )}
          {showFinance && cycle.invoiceSentAt && (
            <DownloadPdfButton
              document={<InvoicePdf data={{ ...cycle, workOrder: wo }} />}
              fileName={`${cycle.invoiceNumber || wo.workOrderNumber}-INV.pdf`}
              label="Invoice"
              className="!py-1 !px-2"
            />
          )}
          {openHold && (
            <DownloadPdfButton
              document={<HoldChecklistPdf data={{ ...openHold, workOrder: wo }} />}
              fileName={`hold-${wo.workOrderNumber}-c${cycle.cycleNumber}.pdf`}
              label="Hold Checklist"
              className="!py-1 !px-2"
            />
          )}
        </div>
      </div>

      {cycle.deliveryNote && <p className="text-xs text-navy-600">{cycle.deliveryNote}</p>}

      {/* Audit chain */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-navy-600">
        <div>Opened by: {cycle.openedBy?.name || '—'}</div>
        {cycle.unitDocsSubmittedBy && <div>Docs submitted: {cycle.unitDocsSubmittedBy.name} ({formatDate(cycle.unitDocsSubmittedAt)})</div>}
        {cycle.qcVerifiedBy && <div>QC verified: {cycle.qcVerifiedBy.name} ({formatDate(cycle.qcVerifiedAt)}) {cycle.qcCertificateNumber && <span className="text-navy-400 font-mono">[{cycle.qcCertificateNumber}]</span>}</div>}
        {cycle.mgmtApprovedBy && <div>Mgmt approved: {cycle.mgmtApprovedBy.name} ({formatDate(cycle.mgmtApprovedAt)})</div>}
        {showFinance && cycle.invoiceSentBy && <div>Invoice sent: {cycle.invoiceSentBy.name} ({formatDate(cycle.invoiceSentAt)}) {cycle.invoiceNumber && <span className="text-navy-400 font-mono">[{cycle.invoiceNumber}]</span>}</div>}
        {showFinance && cycle.paymentReceivedBy && <div>Payment received: {cycle.paymentReceivedBy.name} ({formatDate(cycle.paymentReceivedAt)})</div>}
      </div>

      {/* Open hold banner */}
      {openHold && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs space-y-1">
          <div className="flex items-center gap-1 font-semibold text-red-800">
            <ShieldAlert size={12} /> On hold — raised by {openHold.raisedBy?.name} ({formatDate(openHold.raisedAt)})
          </div>
          {openHold.reason && <p className="text-red-700">Reason: {openHold.reason}</p>}
          {Array.isArray(openHold.missingItems) && openHold.missingItems.length > 0 && (
            <ul className="list-disc list-inside text-red-700">
              {openHold.missingItems.map((m, i) => (
                <li key={i}>{m.docType}{m.note ? ` — ${m.note}` : ''}</li>
              ))}
            </ul>
          )}
          {(isUnitManager || isAdmin) && (
            <div className="flex gap-2 items-end mt-2">
              <div className="flex-1">
                <Input label="Resolution note (after re-uploading missing docs)" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
              </div>
              <Button disabled={busy} onClick={resolveHold}>Resolve Hold</Button>
            </div>
          )}
        </div>
      )}

      {/* Documents */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Documents ({docs.length})</p>
          {cycle.qcCertificateUrl && (
            <a href={cycle.qcCertificateUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1">
              <FileText size={11} /> QC Certificate
            </a>
          )}
        </div>
        {docs.length === 0 ? (
          <p className="text-xs text-navy-400">No docs uploaded.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between border border-navy-100 rounded px-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={11} className="text-navy-500 flex-shrink-0" />
                  <span className="font-mono text-[10px] text-navy-500 flex-shrink-0">{d.docType}</span>
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate">{d.fileName}</a>
                  <span className="text-navy-400 flex-shrink-0">· {d.uploadedBy?.name || '—'}</span>
                </div>
                {(d.uploadedById === currentUser?.id || isAdmin) && (
                  <button onClick={() => deleteDoc(d.id)} className="text-red-500 hover:text-red-700 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canUploadDoc && (
          <form onSubmit={uploadDoc} className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_2fr_auto] gap-2 items-end pt-1">
            <Select label="Doc Type" value={docType} onChange={(e) => setDocType(e.target.value)}>
              {UNIT_DOC_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}{d.required ? ' *' : ''}</option>)}
            </Select>
            <Input label="File" type="file" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
            <Input label="Note" value={docNote} onChange={(e) => setDocNote(e.target.value)} />
            <Button type="submit" disabled={busy || !docFile}><Upload size={12} className="mr-1" />Upload</Button>
          </form>
        )}
      </div>

      {/* Stage-specific actions */}
      {cycle.stage === 'UNIT_DOCS_PENDING' && (isUnitManager || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          {missingRequired.length > 0 ? (
            <p className="text-xs text-red-600">
              Missing required docs: {missingRequired.map((d) => d.label).join(', ')}
            </p>
          ) : (
            <Button onClick={submitToQc} disabled={busy}><Check size={12} className="mr-1" />Submit to QC</Button>
          )}
        </div>
      )}

      {cycle.stage === 'UNIT_DOCS_PENDING' && cycle.unitDocsSubmittedAt && (isQc || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">QC Verification</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input label="Certificate URL (optional, paste link if PDF lives elsewhere)" value={qcCertUrl} onChange={(e) => setQcCertUrl(e.target.value)} />
            <Input label="Note" value={qcNote} onChange={(e) => setQcNote(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={qcVerify} disabled={busy}>Issue Certificate & Verify</Button>
            <HoldControls items={holdItems} setItems={setHoldItems} reason={holdReason} setReason={setHoldReason} onSubmit={holdCycle} busy={busy} />
          </div>
        </div>
      )}

      {cycle.stage === 'QC_VERIFIED' && l5 && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Level-5 Approval</p>
          <Input label="Approval Note" value={mgmtNote} onChange={(e) => setMgmtNote(e.target.value)} />
          <div className="flex gap-2">
            <Button onClick={mgmtApprove} disabled={busy}>Approve & Send to Finance</Button>
          </div>
        </div>
      )}
      {cycle.stage === 'QC_VERIFIED' && isAdmin && !l5 && (
        <p className="text-[11px] text-navy-500 italic border-t pt-2">
          Awaiting Level-5 management sign-off (sureshbabu / rameshbabu / madhubabu).
        </p>
      )}

      {cycle.stage === 'MGMT_APPROVED' && (isFinance || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Send Invoice (starts 48h SLA — no amount)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input label="Invoice Date" type="date" value={invForm.invoiceDate} onChange={(e) => setInvForm({ ...invForm, invoiceDate: e.target.value })} />
            <Input label="Description (scope)" value={invForm.description} onChange={(e) => setInvForm({ ...invForm, description: e.target.value })} />
            <Input label="Invoice File URL (optional)" value={invForm.invoiceFileUrl} onChange={(e) => setInvForm({ ...invForm, invoiceFileUrl: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button onClick={sendInvoice} disabled={busy}><Receipt size={12} className="mr-1" />Send Invoice & Start SLA</Button>
            <HoldControls items={holdItems} setItems={setHoldItems} reason={holdReason} setReason={setHoldReason} onSubmit={holdCycle} busy={busy} />
          </div>
        </div>
      )}

      {cycle.stage === 'INVOICE_SENT' && (isAccounting || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Confirm Payment Received</p>
          <Input label="Note" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="UTR / payment reference, customer ack" />
          <Button onClick={paymentReceived} disabled={busy}>
            <Check size={12} className="mr-1" /> Payment Received — Close Cycle
          </Button>
        </div>
      )}

      {cycle.stage === 'PAYMENT_RECEIVED' && (
        <div className="border-t pt-2">
          <Badge color="green"><Check size={11} className="inline mr-1" />Cycle closed</Badge>
          {showFinance && cycle.paymentNote && <p className="text-xs text-navy-600 mt-1">Note: {cycle.paymentNote}</p>}
        </div>
      )}
    </div>
  );
}

function HoldControls({ items, setItems, reason, setReason, onSubmit, busy }) {
  const [open, setOpen] = useState(false);
  const setItem = (i, k, v) => setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  const addRow = () => setItems([...items, { docType: '', note: '' }]);
  const removeRow = (i) => setItems(items.filter((_, idx) => idx !== i));

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={busy}>
        <ShieldAlert size={12} className="mr-1" /> Send Back on Hold
      </Button>
    );
  }
  return (
    <div className="w-full space-y-2 p-3 bg-red-50 rounded">
      <p className="text-xs uppercase tracking-wider font-semibold text-red-700">Send back with missing-items checklist</p>
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <Input label="Doc Type" value={it.docType} onChange={(e) => setItem(i, 'docType', e.target.value)} placeholder="e.g. TEST_REPORT" />
          <Input label="Note" value={it.note} onChange={(e) => setItem(i, 'note', e.target.value)} />
          <Button variant="secondary" onClick={() => removeRow(i)} disabled={items.length === 1}>Remove</Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={addRow}>+ Add Row</Button>
      </div>
      <Input label="Overall Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
        <Button onClick={onSubmit} disabled={busy || !items.some((it) => it.docType.trim())}>Send on Hold</Button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Work Order Workflow — plain-English reference chart.
// Mirrors what Procurement has. Read-only: explains who does what, what files
// they upload/download, and how the 48h / 24h timers work.
// ───────────────────────────────────────────────────────────────────────────

const WO_FLOW_STEPS = [
  {
    icon: FilePlus2,
    title: '1. Log the Supply Order',
    who: 'Supply Chain (or Admin)',
    what: 'Open the "Log Supply Order" form on this page and fill in the customer order details — customer name, supply order number and date, quantity, delivery date (PDC), drawings, packing, transport, etc.',
    statusBefore: '—',
    statusAfter: 'PENDING_ADMIN',
    uploads: ['Bank Guarantee number/date (optional, can be added later from the BG tab)', 'Insurance details (optional, from the Insurance tab)'],
    downloads: ['Work Order PDF — auto-generated and printable from the WO row once admin accepts'],
    color: 'from-sky-500 to-blue-600',
    ring: 'ring-sky-200',
  },
  {
    icon: ShieldCheck,
    title: '2. Admin Accepts',
    who: 'Admin',
    what: 'Admin opens the WO from the dashboard, picks the unit that will execute the work, and clicks Accept. Without this step the unit cannot see the WO.',
    statusBefore: 'PENDING_ADMIN',
    statusAfter: 'ADMIN_ACCEPTED',
    uploads: ['Acceptance note (optional)'],
    downloads: ['Admin Acceptance form (visible in the WO detail panel)'],
    color: 'from-blue-500 to-indigo-600',
    ring: 'ring-blue-200',
  },
  {
    icon: UserCheck,
    title: '3. Unit Manager Accepts',
    who: 'Manager of the assigned unit',
    what: 'The unit manager reviews the WO and either Accepts (work starts) or Rejects (work goes On Hold). If rejected, Supply Chain re-assigns it to a different unit using the Reassign button.',
    statusBefore: 'ADMIN_ACCEPTED',
    statusAfter: 'UNIT_ACCEPTED  (or ON_HOLD if rejected)',
    uploads: ['Acceptance / rejection note'],
    downloads: ['—'],
    color: 'from-indigo-500 to-violet-600',
    ring: 'ring-indigo-200',
  },
  {
    icon: Truck,
    title: '4. Deliver in Batches and Log Each Delivery',
    who: 'Manager (or Supply Chain)',
    what: 'When the unit ships a batch to the customer, log it under the Invoices tab: invoice number, date and quantity shipped. Each entry adds to the delivered quantity. Once delivered = ordered, the WO flips to COMPLETED automatically.',
    statusBefore: 'UNIT_ACCEPTED',
    statusAfter: 'IN_PROGRESS  →  COMPLETED (when fully delivered)',
    uploads: ['Invoice reference number + date (file upload is part of the closure cycle below)'],
    downloads: ['Delivery history visible inline on the Invoices tab'],
    color: 'from-emerald-500 to-green-600',
    ring: 'ring-emerald-200',
  },
  {
    icon: GitBranch,
    title: '5. Open a Closure Cycle for the Batch',
    who: 'Manager (or Admin)',
    what: 'For every delivered batch, open a new closure cycle from the Closures tab and enter how many units this cycle covers. You can run several cycles in parallel — one per batch.',
    statusBefore: 'WO is UNIT_ACCEPTED / IN_PROGRESS / COMPLETED',
    statusAfter: 'Cycle starts at  UNIT_DOCS_PENDING',
    uploads: ['Delivery note (optional text)'],
    downloads: ['—'],
    color: 'from-violet-500 to-purple-600',
    ring: 'ring-violet-200',
  },
  {
    icon: Upload,
    title: '6. Upload the 3 Required Docs and Send to QC',
    who: 'Manager',
    what: 'Inside the cycle, upload these three files (the system will not let you continue without them). Then click Submit to QC. QC will be notified automatically.',
    statusBefore: 'UNIT_DOCS_PENDING',
    statusAfter: 'still UNIT_DOCS_PENDING but now awaiting QC',
    uploads: [
      'Work Completion Report  (required)',
      'Test Report  (required)',
      'Dispatch Checklist  (required)',
      'As-Built Drawing  (optional)',
      'Completion Photos  (optional)',
    ],
    downloads: ['Each uploaded doc can be re-downloaded from the cycle panel'],
    color: 'from-fuchsia-500 to-pink-600',
    ring: 'ring-fuchsia-200',
  },
  {
    icon: FileCheck2,
    title: '7. QC Verifies the Batch',
    who: 'QC (or Admin)',
    what: 'QC opens the cycle, checks the uploaded docs and the physical work, and clicks QC Verify. The system generates a QC Verification Certificate number automatically. QC can attach a certificate file URL.',
    statusBefore: 'UNIT_DOCS_PENDING (with docs submitted)',
    statusAfter: 'QC_VERIFIED',
    uploads: ['Optional: link to the signed QC certificate file'],
    downloads: ['QC Verification Certificate PDF — "QC Cert" button on the cycle row'],
    color: 'from-amber-500 to-orange-500',
    ring: 'ring-amber-200',
  },
  {
    icon: Stamp,
    title: '8. Management (L5) Approves',
    who: 'Only the 3 Level-5 Admins (sureshbabu, rameshbabu, madhubabu)',
    what: 'One of the L5 admins reviews the QC sign-off and clicks Mgmt Approve. Finance is notified to raise the invoice.',
    statusBefore: 'QC_VERIFIED',
    statusAfter: 'MGMT_APPROVED',
    uploads: ['Approval note (optional)'],
    downloads: ['—'],
    color: 'from-orange-500 to-red-500',
    ring: 'ring-orange-200',
  },
  {
    icon: Banknote,
    title: '9. Finance Sends the Invoice  →  starts the 48-hour timer',
    who: 'Finance (or Admin)',
    what: 'Finance generates and sends the invoice to the customer, then clicks Send Invoice in this app. The system creates an Invoice number, stamps the time, and starts the 48-hour payment timer. Management is notified.',
    statusBefore: 'MGMT_APPROVED',
    statusAfter: 'INVOICE_SENT  (48-hour SLA clock starts)',
    uploads: ['Invoice date', 'Invoice description (optional)', 'Link to the invoice PDF file (optional)'],
    downloads: ['Invoice PDF — "Invoice" button on the cycle row (visible to Finance / Accounting / L5 only)'],
    color: 'from-yellow-500 to-amber-600',
    ring: 'ring-yellow-200',
  },
  {
    icon: Wallet,
    title: '10. Accounts Confirms Payment Received',
    who: 'Accounting (or Admin)',
    what: 'When the customer pays, Accounting clicks Payment Received and adds a note. This stops the 48-hour timer and closes the cycle. Management is notified.',
    statusBefore: 'INVOICE_SENT',
    statusAfter: 'PAYMENT_RECEIVED  (cycle is now closed)',
    uploads: ['Payment note (e.g. UTR / cheque #)'],
    downloads: ['Invoice PDF still available'],
    color: 'from-lime-500 to-green-600',
    ring: 'ring-lime-200',
  },
  {
    icon: CheckCircle2,
    title: '11. Close the Whole Work Order',
    who: 'Supply Chain (or Admin)',
    what: 'Once every cycle has reached Payment Received AND delivered quantity equals ordered quantity, the WO can be closed. If anything is short, the system will warn you and ask for a reason before allowing a "short close".',
    statusBefore: 'COMPLETED  (with all cycles paid)',
    statusAfter: 'CLOSED',
    uploads: ['Reason text (mandatory only when short-closing)'],
    downloads: ['Final WO PDF reflects CLOSED status'],
    color: 'from-navy-600 to-slate-800',
    ring: 'ring-slate-200',
  },
];

const WO_HOLD_LOOP = {
  title: 'If something is wrong: the On-Hold loop',
  who: 'Anyone in QC / Finance / Admin can put a cycle on hold',
  body: [
    'If QC finds the docs are wrong, or Finance sees the batch is not ready for invoicing, they click "Send Back on Hold" and write a checklist of what is missing.',
    'The cycle moves to ON_HOLD and the Manager gets notified.',
    'The Manager fixes the issue, re-uploads docs and clicks Resolve Hold. The cycle goes back to "UNIT_DOCS_PENDING" — QC and Mgmt have to approve again.',
    'A cycle that has already reached INVOICE_SENT cannot be put on hold — at that point any change is handled through Finance / Accounts directly.',
  ],
};

const WO_TIMERS = [
  {
    icon: Timer,
    title: '48-hour SLA — Payment Window',
    color: 'from-yellow-500 to-amber-600',
    rows: [
      ['Starts when', 'Finance clicks "Send Invoice" on a closure cycle.'],
      ['Ends when',   'Accounting clicks "Payment Received" on the same cycle.'],
      ['Where to see it', 'Each cycle row shows a coloured badge: blue = plenty of time, yellow = under 12h left, red = breached.'],
      ['If breached',  'The cycle is marked SLA Breached. Management, Finance and Accounting all get an escalation notification automatically.'],
    ],
  },
  {
    icon: BellRing,
    title: '24-hour Reminder — Nudge to Accounts',
    color: 'from-blue-500 to-indigo-600',
    rows: [
      ['What it does', 'Every 24 hours while a cycle is sitting at INVOICE_SENT, the system sends a reminder notification to L5 Management, Finance and Accounting with how many hours are left.'],
      ['How often',   'A background job runs every hour and fires the reminder exactly once per 24h window per cycle.'],
      ['Who is NOT notified', 'Manager and QC — payment chasing is not their scope.'],
      ['When it stops', 'As soon as Accounting clicks "Payment Received".'],
    ],
  },
  {
    icon: RefreshCw,
    title: 'Background jobs that run on their own',
    color: 'from-slate-500 to-gray-700',
    rows: [
      ['Hourly',     'Checks INVOICE_SENT cycles and fires the 24-hour reminder if due.'],
      ['Every 30 min', 'Checks if any cycle has crossed its 48-hour deadline and marks it as Breached + sends escalation.'],
      ['Safe to re-run', 'Both jobs are idempotent — they will never send the same reminder twice in the same window.'],
    ],
  },
];

const WO_FILE_INDEX = {
  uploads: [
    { what: 'Bank Guarantee entry (number + valid-upto)', where: 'WO detail → BG tab → "Add BG"' },
    { what: 'Insurance entry (number + valid-upto)',     where: 'WO detail → Insurance tab → "Add Insurance"' },
    { what: 'Delivery invoice (qty-wise, doc-only)',     where: 'WO detail → Invoices tab → "Log Invoice"' },
    { what: 'Closure docs — 3 required + 2 optional',    where: 'WO detail → Closures tab → cycle row → "Upload File"' },
    { what: 'QC certificate file URL (optional)',        where: 'Closure cycle → "QC Verify" form' },
    { what: 'Invoice file URL (optional)',                where: 'Closure cycle → "Send Invoice" form' },
    { what: 'PDC extension request',                       where: 'WO detail → Extensions tab → "Add Extension" (also extends BG)' },
  ],
  downloads: [
    { what: 'Work Order PDF',                where: 'WO detail header → "Download PDF"' },
    { what: 'QC Verification Certificate',   where: 'Closure cycle row → "QC Cert" button' },
    { what: 'Customer Invoice PDF',          where: 'Closure cycle row → "Invoice" button (Finance / Accounting / L5 only)' },
    { what: 'Hold Checklist PDF',            where: 'Closure cycle row → "Hold Checklist" button (only when a hold is open)' },
    { what: 'Any uploaded closure doc',      where: 'Closure cycle panel → docs list → click filename' },
  ],
};

function WorkOrderWorkflowModal({ onClose }) {
  return (
    <Modal isOpen onClose={onClose} title="Work Order Workflow & Documents" size="full">
      <div className="space-y-6">
        <p className="text-sm text-gray-700 leading-relaxed">
          This is the full journey of a Work Order, written in plain English. Each step lists
          <strong> who acts</strong>, <strong>what they need to upload</strong>, <strong>what they can download</strong>,
          and the status the WO (or closure cycle) is in before and after. The two timers
          and the on-hold loop are explained at the bottom.
        </p>

        {/* MAIN CHAIN */}
        <section>
          <h2 className="text-xs uppercase tracking-wider font-bold text-navy-700 mb-3">The 11-step journey</h2>
          <div className="space-y-3">
            {WO_FLOW_STEPS.map((step, idx) => {
              const Icon = step.icon;
              return (
                <div key={step.title}>
                  <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className={`h-1 bg-gradient-to-r ${step.color}`} />
                    <div className="p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                        {/* Icon + number */}
                        <div className="flex items-center gap-3 sm:flex-col sm:items-center sm:w-20 shrink-0">
                          <div className={`relative w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} text-white flex items-center justify-center shadow-md ring-2 ${step.ring}`}>
                            <Icon size={22} strokeWidth={2.2} />
                            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white text-[10px] font-bold text-navy-700 ring-1 ring-gray-200 flex items-center justify-center">
                              {idx + 1}
                            </span>
                          </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 min-w-0">
                          <h3 className="text-base font-semibold text-navy-800">{step.title}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            <span className="font-medium text-gray-700">Who does it:</span> {step.who}
                          </p>

                          <p className="mt-2 text-sm text-gray-700 leading-relaxed">{step.what}</p>

                          {/* Status change */}
                          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className="font-semibold uppercase tracking-wider text-gray-400">Status:</span>
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 font-mono text-gray-700 border border-gray-200">
                              {step.statusBefore}
                            </span>
                            <ArrowRight size={11} className="text-gray-400" />
                            <span className="px-2 py-0.5 rounded-md bg-green-50 font-mono text-green-800 border border-green-200">
                              {step.statusAfter}
                            </span>
                          </div>

                          {/* Uploads + Downloads side by side */}
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div className="rounded-lg bg-blue-50/50 border border-blue-100 p-3">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-700 mb-1.5">
                                <Upload size={12} /> You upload
                              </div>
                              <ul className="space-y-1">
                                {step.uploads.map((u) => (
                                  <li key={u} className="text-sm text-navy-800 flex gap-1.5">
                                    <span className="text-blue-400 mt-0.5">•</span>
                                    <span>{u}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 p-3">
                              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
                                <Download size={12} /> You can download
                              </div>
                              <ul className="space-y-1">
                                {step.downloads.map((d) => (
                                  <li key={d} className="text-sm text-navy-800 flex gap-1.5">
                                    <span className="text-emerald-400 mt-0.5">•</span>
                                    <span>{d}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {idx < WO_FLOW_STEPS.length - 1 && (
                    <div className="flex justify-center py-1.5">
                      <ArrowDown size={18} className="text-gray-300" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* HOLD LOOP */}
        <section className="rounded-2xl border border-red-100 bg-red-50/40 p-5">
          <div className="flex items-center gap-2 mb-2">
            <PauseCircle size={18} className="text-red-600" />
            <h2 className="text-base font-semibold text-red-800">{WO_HOLD_LOOP.title}</h2>
          </div>
          <p className="text-xs text-red-700 mb-2"><strong>Who:</strong> {WO_HOLD_LOOP.who}</p>
          <ul className="space-y-1.5">
            {WO_HOLD_LOOP.body.map((line, i) => (
              <li key={i} className="text-sm text-gray-800 flex gap-2">
                <span className="text-red-400 mt-0.5">{i + 1}.</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* TIMERS */}
        <section>
          <h2 className="text-xs uppercase tracking-wider font-bold text-navy-700 mb-3">How the timers work</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {WO_TIMERS.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.title} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className={`h-1 bg-gradient-to-r ${t.color}`} />
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${t.color} text-white flex items-center justify-center shadow`}>
                        <Icon size={18} />
                      </div>
                      <h3 className="text-sm font-semibold text-navy-800">{t.title}</h3>
                    </div>
                    <dl className="space-y-2">
                      {t.rows.map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{k}</dt>
                          <dd className="text-sm text-gray-800 leading-snug">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* FILE INDEX */}
        <section>
          <h2 className="text-xs uppercase tracking-wider font-bold text-navy-700 mb-3">Where to upload &amp; download (quick index)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-2xl border border-blue-100 bg-white shadow-sm overflow-hidden">
              <div className="bg-blue-50 px-4 py-2 flex items-center gap-2 border-b border-blue-100">
                <Upload size={14} className="text-blue-700" />
                <span className="text-sm font-semibold text-blue-800">Things you upload</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {WO_FILE_INDEX.uploads.map((row) => (
                  <li key={row.what} className="p-3 text-sm">
                    <div className="font-medium text-navy-800">{row.what}</div>
                    <div className="text-xs text-gray-600 mt-0.5">→ {row.where}</div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-emerald-100 bg-white shadow-sm overflow-hidden">
              <div className="bg-emerald-50 px-4 py-2 flex items-center gap-2 border-b border-emerald-100">
                <Download size={14} className="text-emerald-700" />
                <span className="text-sm font-semibold text-emerald-800">Things you can download</span>
              </div>
              <ul className="divide-y divide-gray-100">
                {WO_FILE_INDEX.downloads.map((row) => (
                  <li key={row.what} className="p-3 text-sm">
                    <div className="font-medium text-navy-800">{row.what}</div>
                    <div className="text-xs text-gray-600 mt-0.5">→ {row.where}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 flex items-start gap-2">
          <Paperclip size={14} className="mt-0.5 shrink-0" />
          <span>
            Tip: some buttons only show up for certain roles. If a "Download" or "Approve" button is
            missing from a row, it usually means your role is not allowed to act on that step (for
            example, only L5 admins can do Mgmt-Approve, and only Finance / Accounting / L5 can
            see invoice and payment fields).
          </span>
        </div>
      </div>
    </Modal>
  );
}
