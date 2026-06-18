import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Trash2, RotateCcw, CheckCircle2, Truck, PackageCheck,
  Send, ShieldCheck, Calculator, Stamp, XCircle, Clock, AlertCircle, LayoutList,
  DoorOpen, FileText, Upload, FileDown, ClipboardList, Briefcase,
  GitBranch, ArrowRight, ArrowDown, User, Workflow, Eye, Filter,
} from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import { UOM_OPTIONS } from '../utils/units';
import DateRangeFilter from '../components/shared/DateRangeFilter';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import { checkFileSize } from '../utils/fileGuard';
import { formatDate, formatDateTime } from '../utils/formatters';
import GatePassPdf from '../components/pdf/GatePassPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

// The two formats a gate pass can take. The toggle at the top of the page
// switches which register format (columns + workflow) is shown, and seeds the
// kind chosen when a new gate pass is created.
//  • OUTSIDE   → Outward register (RAMS/GPR/01) — delivered to a site office.
//  • LOCAL_JOB → Local Job Work register (RAPS/JL-JW) — returns to stores.
const KIND_VIEWS = [
  { key: 'OUTSIDE',   label: 'Outward (RAMS/GPR/01)',   Icon: DoorOpen },
  { key: 'LOCAL_JOB', label: 'Local Job (RAPS/JL-JW)',  Icon: Briefcase },
];

const STATUS_TABS = [
  { key: 'ALL', label: 'All', Icon: LayoutList },
  { key: 'PENDING_STORE', label: 'Pending Store', Icon: Clock },
  { key: 'PENDING_ACCOUNTS', label: 'Pending Accounts', Icon: Calculator },
  { key: 'PENDING_STORE_REVIEW', label: 'Pending Store Review', Icon: PackageCheck },
  { key: 'PENDING_LOGISTICS', label: 'Pending Logistics', Icon: Truck },
  { key: 'IN_TRANSIT', label: 'In Transit', Icon: Send },
  { key: 'PENDING_RETURN', label: 'Pending Return', Icon: RotateCcw },
  { key: 'CLOSED', label: 'Closed', Icon: CheckCircle2 },
  { key: 'REJECTED', label: 'Rejected', Icon: XCircle },
];

const STATUS_META = {
  DRAFT:                { color: 'gray',   label: 'Draft' },
  PENDING_STORE:        { color: 'yellow', label: 'Pending Store' },
  PENDING_ACCOUNTS:     { color: 'yellow', label: 'Pending Accounts' },
  PENDING_STORE_REVIEW: { color: 'yellow', label: 'Pending Store Review' },
  PENDING_LOGISTICS:    { color: 'yellow', label: 'Pending Logistics' },
  IN_TRANSIT:           { color: 'blue',   label: 'In Transit' },
  PENDING_RETURN:       { color: 'yellow', label: 'Pending Return' },
  PENDING_APPROVAL:     { color: 'yellow', label: 'Pending Approval' },
  APPROVED:             { color: 'blue',   label: 'Approved' },
  RETURNED:             { color: 'green',  label: 'Returned' },
  CLOSED:               { color: 'gray',   label: 'Closed' },
  REJECTED:             { color: 'red',    label: 'Rejected' },
  OPEN:                 { color: 'yellow', label: 'Open (legacy)' },
};
// Status colour → sheet Pill tone.
const TONE_BY_COLOR = { gray: 'gray', yellow: 'amber', blue: 'blue', green: 'green', red: 'red', purple: 'purple', orange: 'amber' };
const statusTone = (s) => TONE_BY_COLOR[STATUS_META[s]?.color] || 'gray';

const KIND_META = {
  LOCAL_JOB: { color: 'purple', label: 'Local Job' },
  OUTSIDE:   { color: 'blue',   label: 'Outside' },
};

const PASS_TYPE_LABEL = {
  RETURNABLE: 'Returnable',
  NON_RETURNABLE: 'Non-Returnable',
  DELIVERY_CHALLAN: 'Delivery Challan',
};

const blankItem = () => ({
  description: '', quantity: 1, unit: 'pcs',
  dispatchedTo: '', itemPurpose: '', probableReturnDate: '',
  itemPassType: 'RETURNABLE',
  contactPersonDetails: '',
});

// Each role lands on the tab where they actually have work to do.
const DEFAULT_TAB_BY_ROLE = {
  LOGISTICS: 'PENDING_LOGISTICS',
  ACCOUNTING: 'PENDING_ACCOUNTS',
  FINANCE: 'PENDING_ACCOUNTS',
  STORE_MANAGER: 'PENDING_STORE',
  MANAGER: 'PENDING_STORE',
  ADMIN: 'ALL',
};

// ──────────────────────────────────────────────────────────────────────────────
// Returnable-due helpers: a returnable gate pass that has not yet been closed
// surfaces a blinking indicator once we're within 24h of its earliest probable
// return date, and stays blinking after the due date until Stores acks.
// ──────────────────────────────────────────────────────────────────────────────
const OPEN_RETURN_STATUSES = ['PENDING_LOGISTICS', 'IN_TRANSIT', 'PENDING_RETURN'];

function returnDueInfo(g) {
  if (!g || g.passType !== 'RETURNABLE') return null;
  if (!OPEN_RETURN_STATUSES.includes(g.status)) return null;
  const dates = (g.items || [])
    .map((it) => it.probableReturnDate)
    .filter(Boolean)
    .map((d) => new Date(d));
  if (!dates.length) return null;
  const earliest = new Date(Math.min(...dates.map((d) => d.getTime())));
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDue = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate()).getTime();
  const daysUntil = Math.round((startOfDue - startOfToday) / 86400000);
  if (daysUntil > 1) return null;
  return {
    earliest,
    daysUntil,
    overdue: daysUntil < 0,
    dueToday: daysUntil === 0,
    dueTomorrow: daysUntil === 1,
  };
}

function ReturnDueBadge({ info, compact = false }) {
  if (!info) return null;
  const cls = info.overdue
    ? 'bg-red-100 text-red-700 border-red-300'
    : 'bg-amber-100 text-amber-800 border-amber-300';
  const label = info.overdue
    ? `Return overdue (${Math.abs(info.daysUntil)}d)`
    : info.dueToday
      ? 'Return due today'
      : 'Return due tomorrow';
  return (
    <span
      title={`Probable return: ${info.earliest.toLocaleDateString()}`}
      className={`inline-flex items-center gap-1 ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'} font-medium rounded border animate-pulse ${cls}`}
    >
      <span className={`inline-block ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'} rounded-full ${info.overdue ? 'bg-red-500' : 'bg-amber-500'}`}></span>
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Inline actions — which workflow steps a given role can take on a row, right
// now. Mirrors the server's stage/role gating so the buttons only ever appear
// when the action will actually succeed.
// ──────────────────────────────────────────────────────────────────────────────
function availableActions(g, role) {
  const isAdmin = role === 'ADMIN';
  const isV2 = !!g.kind;
  const isOutside = g.kind === 'OUTSIDE';
  const isLocalJob = g.kind === 'LOCAL_JOB';
  const isReturnable = g.passType === 'RETURNABLE';
  const acts = [];

  if (g.status === 'PENDING_STORE' && (role === 'STORE_MANAGER' || isAdmin)) acts.push('store-approve');
  if (g.status === 'PENDING_ACCOUNTS' && isOutside && (role === 'ACCOUNTING' || role === 'FINANCE' || isAdmin)) acts.push('accounts-invoice');
  if (g.status === 'PENDING_STORE_REVIEW' && (role === 'STORE_MANAGER' || isAdmin)) acts.push('store-review');
  if (g.status === 'PENDING_LOGISTICS' && isV2 && (role === 'LOGISTICS' || isAdmin)) acts.push('logistics');
  if (g.status === 'IN_TRANSIT' && isOutside && (role === 'LOGISTICS' || isAdmin)) acts.push('arrival-ack');
  if ((role === 'STORE_MANAGER' || isAdmin) && (
    (g.status === 'IN_TRANSIT' && isLocalJob) ||
    (g.status === 'PENDING_RETURN' && isOutside && isReturnable)
  )) acts.push('stores-ack');

  const stageRole = {
    PENDING_STORE: ['STORE_MANAGER', 'ADMIN'],
    PENDING_ACCOUNTS: ['ACCOUNTING', 'FINANCE', 'ADMIN'],
    PENDING_STORE_REVIEW: ['STORE_MANAGER', 'ADMIN'],
    PENDING_LOGISTICS: ['LOGISTICS', 'ADMIN'],
  }[g.status];
  if (stageRole && stageRole.includes(role) && isV2) acts.push('reject');

  return acts;
}

const ACTION_DEFS = {
  'store-approve':   { title: 'Stores Approval',     short: 'Approve',  tone: 'amber', Icon: ShieldCheck },
  'accounts-invoice':{ title: 'Accounts — Invoice',  short: 'Invoice',  tone: 'amber', Icon: Calculator },
  'store-review':    { title: 'Stores Final Review', short: 'Review',   tone: 'amber', Icon: PackageCheck },
  'logistics':       { title: 'Logistics — Dispatch',short: 'Vehicle',  tone: 'blue',  Icon: Truck },
  'arrival-ack':     { title: 'Acknowledge Arrival', short: 'Arrival',  tone: 'blue',  Icon: Stamp },
  'stores-ack':      { title: 'Close Gate Pass',     short: 'Close',    tone: 'green', Icon: CheckCircle2 },
};

export default function GatePass() {
  const { user } = useAuth();
  const role = user?.role;
  const canCreate = ['MANAGER', 'ADMIN', 'PLANNING'].includes(role);
  const [view, setView] = useState('OUTSIDE'); // 'OUTSIDE' | 'LOCAL_JOB'
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB_BY_ROLE[role] || 'PENDING_STORE');
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showFlow, setShowFlow] = useState(false);
  const [detail, setDetail] = useState(null);     // read-only view
  const [actionFor, setActionFor] = useState(null); // { gatePass, type }
  const [refreshKey, setRefreshKey] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/gatepasses', {
      params: {
        direction: 'OUTWARD',
        limit: 500,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      },
    })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .catch(() => setGatePasses([]))
      .finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey, fromDate, toDate]);

  // Rows belonging to the chosen register format. Outward also picks up legacy
  // (kind=null) FIM send-out rows so they stay visible somewhere.
  const viewRows = useMemo(() => gatePasses.filter((g) => (
    view === 'LOCAL_JOB' ? g.kind === 'LOCAL_JOB' : (g.kind === 'OUTSIDE' || !g.kind)
  )), [gatePasses, view]);

  const counts = useMemo(() => {
    const c = { ALL: viewRows.length };
    viewRows.forEach((g) => { c[g.status] = (c[g.status] || 0) + 1; });
    return c;
  }, [viewRows]);

  const filtered = useMemo(
    () => (activeTab === 'ALL' ? viewRows : viewRows.filter((g) => g.status === activeTab)),
    [viewRows, activeTab]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-6">
      <PageHero
        title="Gate Pass"
        subtitle="OUTWARD movement in one register sheet — pick Outward (delivered to a site office) or Local Job (returns to stores). Every step is actioned right in the row."
        eyebrow="Outward Movement"
        icon={DoorOpen}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setShowFlow(true)}>
              <Workflow size={16} /> View Workflow
            </Button>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)}>
                <Plus size={16} /> Create Gate Pass
              </Button>
            )}
          </div>
        }
      />

      {/* Register format toggle — swaps the sheet columns + workflow. */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200">
        {KIND_VIEWS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              view === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <Icon size={14} className="inline mr-1.5" />{label}
          </button>
        ))}
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-navy-500">
            <Filter size={13} /> Showing <span className="font-bold text-navy-800">{filtered.length}</span> of {viewRows.length}
          </div>
          <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map(({ key, label, Icon }) => {
            const on = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${on ? 'bg-navy-800 text-white shadow-sm' : 'bg-navy-50 text-navy-700 hover:bg-navy-100'}`}>
                <Icon size={13} /> {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] leading-none ${on ? 'bg-white/20 text-white' : 'bg-white text-navy-500'}`}>{counts[key] || 0}</span>
              </button>
            );
          })}
        </div>
      </Card>

      {loading ? (
        <Card><p className="text-navy-500 text-center py-8">Loading…</p></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <DoorOpen size={32} className="mx-auto text-navy-300 mb-3" />
            <p className="text-navy-700 font-semibold">No gate passes here</p>
            <p className="text-navy-500 text-sm mt-1">
              {activeTab === 'ALL'
                ? `No ${view === 'LOCAL_JOB' ? 'local job' : 'outward'} gate passes yet.`
                : `Nothing in ${STATUS_META[activeTab]?.label.toLowerCase()}.`}
            </p>
          </div>
        </Card>
      ) : (
        <GatePassSheet
          rows={filtered}
          view={view}
          role={role}
          onView={setDetail}
          onAction={(gatePass, type) => setActionFor({ gatePass, type })}
        />
      )}

      {showCreate && (
        <CreateGatePassModal
          defaultKind={view}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}

      {detail && (
        <DetailModal gatePass={detail} onClose={() => setDetail(null)} />
      )}

      {actionFor && (
        <ActionModal
          gatePass={actionFor.gatePass}
          type={actionFor.type}
          onClose={() => setActionFor(null)}
          onDone={() => { setActionFor(null); refresh(); }}
        />
      )}

      {showFlow && <WorkflowModal onClose={() => setShowFlow(false)} />}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// The Excel-style register sheet — one row per gate pass, columns adapt to the
// chosen format, every workflow step actioned inline from the row.
// ────────────────────────────────────────────────────────────────────
function GatePassSheet({ rows, view, role, onView, onAction }) {
  const isLocal = view === 'LOCAL_JOB';
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-[11.5px] border-separate border-spacing-0">
          <thead className="sticky top-0 z-20">
            <tr>
              <Th sticky>Pass No.</Th>
              {isLocal && <Th>JW / PO No.</Th>}
              <Th>Date</Th>
              {isLocal ? (
                <>
                  <Th>Item(s)</Th>
                  <Th>Purpose</Th>
                  <Th>Probable Rtn.</Th>
                  <Th>Issued To Dept</Th>
                  <Th groupEnd>Return Date</Th>
                </>
              ) : (
                <>
                  <Th>Dispatched To / Dest.</Th>
                  <Th>Item(s)</Th>
                  <Th>Pass Type</Th>
                  <Th groupEnd>Invoice / DC</Th>
                </>
              )}
              <Th>Vehicle</Th>
              <Th>Raised By</Th>
              <Th>Status / Stage</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g, i) => {
              const meta = STATUS_META[g.status] || { label: g.status, color: 'gray' };
              const zebra = i % 2 ? 'bg-brand-gray' : 'bg-white';
              const accent =
                g.status === 'CLOSED' ? 'border-l-green-500'
                : g.status === 'REJECTED' ? 'border-l-red-500'
                : g.status === 'IN_TRANSIT' ? 'border-l-blue-500'
                : g.status?.startsWith('PENDING') ? 'border-l-amber-500'
                : 'border-l-navy-300';
              const due = returnDueInfo(g);
              const earliest = earliestReturn(g);
              const acts = availableActions(g, role);
              const vehicleNode = g.assignedVehicle ? (
                <span className="text-[10px]">
                  <span className="font-mono">{g.assignedVehicle.regNumber}</span>
                  {g.assignedVehicle.driverName && <span className="text-gray-500"> · {g.assignedVehicle.driverName}</span>}
                </span>
              ) : g.vehicleNo
                ? <span className="text-[10px]">{g.vehicleNo}{g.driverName ? ` · ${g.driverName}` : ''}</span>
                : <span className="text-gray-400">Pending</span>;

              return (
                <tr key={g.id} className={`group ${zebra} hover:bg-navy-50 transition-colors`}>
                  <Td sticky className={`border-l-4 ${accent}`}>
                    <button onClick={() => onView(g)} className="font-mono text-[11px] font-semibold text-navy-800 hover:text-navy-600 hover:underline">
                      {g.passNumber}
                    </button>
                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      {g.kind
                        ? <Pill tone={g.kind === 'LOCAL_JOB' ? 'purple' : 'blue'}>{KIND_META[g.kind]?.label}</Pill>
                        : <Pill tone="gray">Legacy / FIM</Pill>}
                      <ReturnDueBadge info={due} compact />
                    </div>
                  </Td>

                  {isLocal && <Td className="font-mono text-[10px] text-navy-700">{g.jobWorkNo || <Dash />}</Td>}
                  <Td>{formatDate(g.date)}</Td>

                  {isLocal ? (
                    <>
                      <Td nowrap={false} className="min-w-[180px] max-w-[260px]"><ItemsCell items={g.items} /></Td>
                      <Td nowrap={false} className="max-w-[160px]"><span className="text-gray-600 line-clamp-2">{joinField(g.items, 'itemPurpose') || <Dash />}</span></Td>
                      <Td>{earliest ? formatDate(earliest) : <Dash />}</Td>
                      <Td nowrap={false} className="max-w-[140px]">{joinField(g.items, 'dispatchedTo') || g.partyName || <Dash />}</Td>
                      <Td groupEnd>{g.actualReturnDate ? formatDate(g.actualReturnDate) : <Dash />}</Td>
                    </>
                  ) : (
                    <>
                      <Td nowrap={false} className="max-w-[170px]">{g.partyName || <Dash />}</Td>
                      <Td nowrap={false} className="min-w-[180px] max-w-[260px]"><ItemsCell items={g.items} /></Td>
                      <Td className="text-gray-600">{g.passType ? PASS_TYPE_LABEL[g.passType] : <Dash />}</Td>
                      <Td groupEnd className="text-[10px] text-gray-600">
                        {g.invoiceNo || g.dcNo
                          ? <>{g.invoiceNo && <div>Inv: {g.invoiceNo}</div>}{g.dcNo && <div>DC: {g.dcNo}</div>}</>
                          : <Dash />}
                      </Td>
                    </>
                  )}

                  <Td nowrap={false} className="max-w-[150px]">
                    {vehicleNode}
                    {g.privateVehicle && <div className="mt-0.5"><Pill tone="purple">Private / Hired</Pill></div>}
                  </Td>
                  <Td nowrap={false} className="max-w-[130px]">{g.createdBy?.name || <Dash />}</Td>
                  <Td nowrap={false} className="max-w-[160px]">
                    <Pill tone={statusTone(g.status)}>{meta.label}</Pill>
                    {g.rejectedReason && <div className="text-[10px] text-rose-700 mt-0.5 line-clamp-2" title={g.rejectedReason}>⚠ {g.rejectedReason}</div>}
                  </Td>

                  {/* Action */}
                  <Td nowrap={false} className="min-w-[150px]">
                    <div className="flex flex-col gap-1 items-start">
                      {acts.filter((t) => t !== 'reject').map((t) => {
                        const def = ACTION_DEFS[t];
                        const label = t === 'logistics' && (g.assignedVehicleId || g.privateVehicle) ? 'Dispatch' : def.short;
                        const Icon = def.Icon;
                        return (
                          <ActBtn key={t} tone={def.tone} onClick={() => onAction(g, t)}>
                            <Icon size={11} /> {label}
                          </ActBtn>
                        );
                      })}
                      <div className="flex items-center gap-1 flex-wrap">
                        <DownloadPdfButton
                          document={<GatePassPdf data={g} />}
                          fileName={`${g.passNumber}.pdf`}
                          label="PDF"
                          className="!px-2 !py-1 !text-[10px]"
                        />
                        <IconBtn title="View details" onClick={() => onView(g)}><Eye size={13} /></IconBtn>
                        {acts.includes('reject') && (
                          <IconBtn title="Reject" danger onClick={() => onAction(g, 'reject')}><XCircle size={13} /></IconBtn>
                        )}
                      </div>
                    </div>
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

// Compact stacked list of a pass's items inside one cell.
function ItemsCell({ items = [] }) {
  if (!items.length) return <Dash />;
  const show = items.slice(0, 3);
  return (
    <div className="space-y-0.5">
      {show.map((it, i) => (
        <div key={it.id || i} className="text-[10.5px]">
          <span className="text-navy-800">{it.description}</span>
          {it.quantity != null && <span className="text-gray-400"> · {it.quantity} {it.unit || ''}</span>}
        </div>
      ))}
      {items.length > 3 && <div className="text-[10px] text-gray-400">+{items.length - 3} more</div>}
    </div>
  );
}

const earliestReturn = (g) => {
  const ds = (g.items || []).map((i) => i.probableReturnDate).filter(Boolean).map((d) => new Date(d));
  if (!ds.length) return null;
  return new Date(Math.min(...ds.map((d) => d.getTime())));
};
const joinField = (items, key) => {
  const s = [...new Set((items || []).map((i) => i[key]).filter(Boolean))];
  return s.length ? s.join('; ') : null;
};

// ─── Excel-sheet primitives (shared look with the Inward register) ──────────
function Th({ children, sticky = false, groupEnd = false }) {
  return (
    <th className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-navy-500 bg-navy-50 border-b border-navy-100 whitespace-nowrap
      ${sticky ? 'sticky left-0 z-30 bg-navy-50' : ''} ${groupEnd ? 'border-r-2 border-navy-100' : ''}`}>
      {children}
    </th>
  );
}
function Td({ children, sticky = false, groupEnd = false, nowrap = true, className = '' }) {
  return (
    <td className={`px-3 py-2.5 align-top border-b border-gray-100 text-navy-700
      ${nowrap ? 'whitespace-nowrap' : ''} ${sticky ? 'sticky left-0 z-10 bg-inherit' : ''} ${groupEnd ? 'border-r-2 border-gray-100' : ''} ${className}`}>
      {children}
    </td>
  );
}
const Dash = () => <span className="text-gray-300 select-none">—</span>;

const PILL_TONES = {
  gray:   'bg-gray-100 text-gray-600 ring-gray-200',
  amber:  'bg-amber-50 text-amber-700 ring-amber-200',
  blue:   'bg-blue-50 text-blue-700 ring-blue-200',
  green:  'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red:    'bg-rose-50 text-rose-700 ring-rose-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
};
const Pill = ({ tone = 'gray', children }) => (
  <span className={`inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full ring-1 ${PILL_TONES[tone]}`}>{children}</span>
);

const ACT_TONES = {
  amber: 'bg-amber-500 hover:bg-amber-600',
  blue:  'bg-blue-600 hover:bg-blue-700',
  green: 'bg-emerald-600 hover:bg-emerald-700',
};
const ActBtn = ({ tone = 'blue', busy, onClick, children }) => (
  <button onClick={onClick} disabled={busy}
    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-white transition disabled:opacity-50 ${ACT_TONES[tone]}`}>
    {children}
  </button>
);
const IconBtn = ({ title, danger, onClick, children }) => (
  <button title={title} onClick={onClick}
    className={`p-1.5 rounded-md transition ${danger ? 'text-gray-400 hover:text-rose-600 hover:bg-rose-100' : 'text-navy-600 hover:text-navy-800 hover:bg-navy-100'}`}>
    {children}
  </button>
);

// ────────────────────────────────────────────────────────────────────
// Action popup — launched from a row button. Renders just the focused box for
// the chosen workflow step; reuses the same step components as before.
// ────────────────────────────────────────────────────────────────────
function ActionModal({ gatePass, type, onClose, onDone }) {
  const [g, setG] = useState(gatePass);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const reload = async () => {
    try { const { data } = await api.get(`/gatepasses/${g.id}`); setG(data); }
    catch { /* ignore */ }
  };

  const act = async (url, body, method = 'put') => {
    setError(''); setBusy(true);
    try { await api[method](url, body || {}); onDone(); }
    catch (err) { setError(err.response?.data?.error || 'Action failed'); setBusy(false); }
  };

  const isReturnable = g.passType === 'RETURNABLE';
  const title = type === 'reject' ? 'Reject Gate Pass' : (ACTION_DEFS[type]?.title || 'Action');

  return (
    <Modal isOpen onClose={onClose} title={`${title} — ${g.passNumber}`} size="md">
      <div className="space-y-3">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        {type === 'store-approve' && (
          <StoreApproveBox g={g} busy={busy} onSubmit={(b) => act(`/gatepasses/${g.id}/store-approve`, b)} />
        )}
        {type === 'accounts-invoice' && (
          <AccountsInvoiceBox busy={busy} onSubmit={(b) => act(`/gatepasses/${g.id}/accounts-invoice`, b)} />
        )}
        {type === 'store-review' && (
          <StoreReviewBox busy={busy} onSubmit={(b) => act(`/gatepasses/${g.id}/store-review`, b)} />
        )}
        {type === 'logistics' && (
          <LogisticsBox g={g} busy={busy} onAssigned={reload} onDispatched={onDone} setError={setError} />
        )}
        {type === 'arrival-ack' && (
          <LogisticsArrivalAckBox isReturnable={isReturnable} busy={busy} onSubmit={(b) => act(`/gatepasses/${g.id}/arrival-ack`, b)} />
        )}
        {type === 'stores-ack' && (
          <StoresAckBox g={g} busy={busy} onSubmit={(b) => act(`/gatepasses/${g.id}/stores-ack`, b)} />
        )}
        {type === 'reject' && (
          <div className="p-3 bg-red-50 border border-red-200 rounded space-y-2">
            <Textarea label="Rejection reason *" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="danger" size="sm" disabled={busy || !rejectReason.trim()}
                onClick={() => act(`/gatepasses/${g.id}/reject`, { reason: rejectReason.trim() })}>
                Confirm Reject
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CreateGatePassModal({ defaultKind = 'LOCAL_JOB', onClose, onCreated }) {
  const [kind, setKind] = useState(defaultKind === 'OUTSIDE' ? 'OUTSIDE' : 'LOCAL_JOB');
  const [siteName, setSiteName] = useState('');
  const [jobWorkNo, setJobWorkNo] = useState('');
  const [jobWorkDate, setJobWorkDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateItem = (idx, k, v) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [k]: v };
    setItems(copy);
  };
  const addItem = () => setItems([...items, blankItem()]);
  const removeItem = (idx) => setItems(items.length === 1 ? items : items.filter((_, i) => i !== idx));

  const submit = async () => {
    setError('');
    if (items.some(i => !i.description.trim())) return setError('Each item needs a name/description');
    if (items.some(i => !i.quantity || Number(i.quantity) <= 0)) return setError('Each item needs a positive quantity');
    if (items.some(i => i.itemPassType === 'RETURNABLE' && !i.probableReturnDate)) {
      return setError('Returnable items need a probable date of return');
    }

    setSaving(true);
    try {
      await api.post('/gatepasses', {
        direction: 'OUTWARD',
        kind,
        siteName: siteName.trim() || undefined,
        jobWorkNo: kind === 'LOCAL_JOB' ? (jobWorkNo.trim() || undefined) : undefined,
        jobWorkDate: kind === 'LOCAL_JOB' ? (jobWorkDate || undefined) : undefined,
        remarks: remarks.trim() || undefined,
        items: items.map(i => ({
          description: i.description.trim(),
          quantity: Number(i.quantity),
          unit: i.unit || 'pcs',
          dispatchedTo: i.dispatchedTo?.trim() || null,
          itemPurpose: i.itemPurpose?.trim() || null,
          probableReturnDate: i.probableReturnDate || null,
          itemPassType: i.itemPassType === 'DELIVERY_CHALLAN' ? 'NON_RETURNABLE' : (i.itemPassType || null),
          contactPersonDetails: i.contactPersonDetails?.trim() || null,
        })),
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create gate pass request');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Modal isOpen onClose={onClose} title="Gate Pass Request" size="full">
      <div className="space-y-6">
        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

        <div>
          <p className="text-xs font-medium text-gray-700 mb-2">Gate Pass Type</p>
          <div className="flex gap-2">
            {['LOCAL_JOB', 'OUTSIDE'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-4 py-2 rounded-md border text-sm font-medium transition-colors ${
                  kind === k
                    ? 'bg-navy-700 text-white border-navy-700'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}>
                {KIND_META[k].label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {kind === 'LOCAL_JOB'
              ? 'Local Job: material/work going to a vendor — returns to stores when work is done.'
              : 'Outside: material being delivered to another RAPS office — Logistics confirms arrival.'}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input label="Site / Unit" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="Site or unit" />
          {kind === 'LOCAL_JOB' && (
            <>
              <Input
                label="Job Work / RAPS PO Order No."
                value={jobWorkNo}
                onChange={e => setJobWorkNo(e.target.value)}
                placeholder="e.g. JW/2026/001 or RAPS/PO/2026/001"
              />
              <Input
                type="date"
                label="Date"
                value={jobWorkDate}
                onChange={e => setJobWorkDate(e.target.value)}
              />
            </>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Pass No. and Date are auto-generated. Pass details and Transport are filled by Logistics on dispatch / acknowledgement. The Store Incharge will approve first, then Logistics assigns the vehicle.
        </p>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800">Components (RAMS/GPR/01)</h4>
            <Button variant="secondary" size="sm" onClick={addItem}><Plus size={14} /> Add row</Button>
          </div>

          <div className="border border-gray-200 rounded-md overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 1040 }}>
              <colgroup>
                <col style={{ width: '36px' }} />
                <col style={{ width: '200px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '80px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '160px' }} />
                <col style={{ width: '150px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '180px' }} />
                <col style={{ width: '40px' }} />
              </colgroup>
              <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
                <tr className="text-left">
                  <th className="px-3 py-2.5 text-center font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Name of component</th>
                  <th className="px-3 py-2.5 text-center font-medium">Qty</th>
                  <th className="px-3 py-2.5 text-center font-medium">UOM</th>
                  <th className="px-3 py-2.5 font-medium">Dispatched to</th>
                  <th className="px-3 py-2.5 font-medium">Purpose</th>
                  <th className="px-3 py-2.5 font-medium">Probable return</th>
                  <th className="px-3 py-2.5 font-medium">Pass type</th>
                  <th className="px-3 py-2.5 font-medium">Remarks / Contact</th>
                  <th className="px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 text-center text-gray-500">{idx + 1}</td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.description} onChange={e => updateItem(idx, 'description', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="number" min="0" step="any" className={`${cellInput} text-right`}
                        value={it.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <select className={`${cellInput} text-center`}
                        value={it.unit} onChange={e => updateItem(idx, 'unit', e.target.value)}>
                        {UOM_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.dispatchedTo} onChange={e => updateItem(idx, 'dispatchedTo', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.itemPurpose} onChange={e => updateItem(idx, 'itemPurpose', e.target.value)} />
                    </td>
                    <td className="px-2 py-2">
                      <input type="date" className={cellInput}
                        value={it.probableReturnDate} onChange={e => updateItem(idx, 'probableReturnDate', e.target.value)}
                        disabled={it.itemPassType !== 'RETURNABLE'} />
                    </td>
                    <td className="px-2 py-2">
                      <select className={cellInput}
                        value={it.itemPassType} onChange={e => updateItem(idx, 'itemPassType', e.target.value)}>
                        <option value="RETURNABLE">Returnable</option>
                        <option value="NON_RETURNABLE">Non-Returnable</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input className={cellInput}
                        value={it.contactPersonDetails} onChange={e => updateItem(idx, 'contactPersonDetails', e.target.value)} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 disabled:opacity-30"
                        disabled={items.length === 1} title="Remove row">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500 mt-2">
            Pass details are auto-generated by the system. Transport details are added by Logistics along with delivery acknowledgement. Remarks can be added by anyone.
          </p>
        </div>

        <Textarea label="Remarks" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            <Send size={14} /> {saving ? 'Submitting…' : 'Submit to Stores'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Read-only detail view — full fields, approval trail, items and the PDF.
// Every workflow action now lives inline in the sheet; this modal only informs.
function DetailModal({ gatePass: g, onClose }) {
  const isLocalJob = g.kind === 'LOCAL_JOB';
  const dueInfo = returnDueInfo(g);

  return (
    <Modal isOpen onClose={onClose} title={`Gate Pass ${g.passNumber}`} size="xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color={STATUS_META[g.status]?.color || 'gray'}>{STATUS_META[g.status]?.label || g.status}</Badge>
            {g.kind && <Badge color={KIND_META[g.kind]?.color}>{KIND_META[g.kind]?.label}</Badge>}
            <ReturnDueBadge info={dueInfo} />
          </div>
          <DownloadPdfButton
            document={<GatePassPdf data={g} />}
            fileName={`${g.passNumber}.pdf`}
            label="View Gate Pass PDF"
          />
        </div>

        <ApprovalTrail g={g} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <Field label="Date" value={formatDate(g.date)} />
          <Field label="Site / Unit" value={g.siteName} />
          {isLocalJob && <Field label="Job Work / RAPS PO Order No." value={g.jobWorkNo} icon={FileText} />}
          {isLocalJob && <Field label="JW / PO Date" value={g.jobWorkDate ? formatDate(g.jobWorkDate) : ''} />}
          <Field label="Dispatched-to (summary)" value={g.partyName} />
          {(g.assignedVehicle || g.vehicleNo) && (
            <Field
              label={g.privateVehicle ? 'Vehicle (Private / Hired)' : 'Vehicle'}
              value={g.assignedVehicle
                ? `${g.assignedVehicle.regNumber}${g.assignedVehicle.driverName ? ` · ${g.assignedVehicle.driverName}` : ''}${g.assignedVehicle.driverPhone ? ` · ${g.assignedVehicle.driverPhone}` : ''}`
                : `${g.vehicleNo || '—'}${g.driverName ? ` · ${g.driverName}` : ''}${g.driverPhone ? ` · ${g.driverPhone}` : ''}`}
            />
          )}
          {g.invoiceNo && <Field label="Invoice No." value={g.invoiceNo} />}
          {g.dcNo && <Field label="DC No." value={g.dcNo} />}
          {g.dispatchedAt && <Field label="Dispatched At" value={formatDateTime(g.dispatchedAt)} />}
          {g.reachedDate && <Field label="Reached On" value={formatDate(g.reachedDate)} />}
          {g.actualReturnDate && <Field label="Actual Return" value={formatDate(g.actualReturnDate)} />}
          <Field label="Raised By" value={g.createdBy?.name} />
          <Field label="Raised At" value={formatDateTime(g.createdAt)} />
        </div>

        {g.signedDeliveryPdfUrl && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-800 text-sm">
              <FileText size={16} /> Driver-signed delivery PDF available
            </div>
            <a
              href={g.signedDeliveryPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
            >
              <FileDown size={12} /> Download
            </a>
          </div>
        )}

        <ItemsTable items={g.items || []} />

        {g.remarks && (
          <div>
            <h4 className="font-medium text-gray-800 mb-1">Remarks</h4>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{g.remarks}</p>
          </div>
        )}

        {g.rejectedReason && (
          <div className="p-3 bg-red-50 border border-red-200 rounded">
            <p className="text-xs font-medium text-red-700 mb-1">Rejected</p>
            <p className="text-sm text-red-800">{g.rejectedReason}</p>
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function ItemsTable({ items }) {
  return (
    <div>
      <h4 className="font-medium text-gray-800 mb-2">Components</h4>
      <div className="border border-gray-200 rounded overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr className="text-left text-gray-600">
              <th className="px-2 py-1.5">#</th>
              <th className="px-2 py-1.5">Component</th>
              <th className="px-2 py-1.5">Qty</th>
              <th className="px-2 py-1.5">UOM</th>
              <th className="px-2 py-1.5">Type</th>
              <th className="px-2 py-1.5">Dispatched to</th>
              <th className="px-2 py-1.5">Purpose</th>
              <th className="px-2 py-1.5">Probable return</th>
              <th className="px-2 py-1.5">Pass details</th>
              <th className="px-2 py-1.5">Transport</th>
              <th className="px-2 py-1.5">Remarks / Contact</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id || idx} className="border-t border-gray-100">
                <td className="px-2 py-1.5">{idx + 1}</td>
                <td className="px-2 py-1.5">{it.description}</td>
                <td className="px-2 py-1.5">{it.quantity}</td>
                <td className="px-2 py-1.5">{it.unit}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.itemPassType ? PASS_TYPE_LABEL[it.itemPassType] : '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.dispatchedTo || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.itemPurpose || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.probableReturnDate ? formatDate(it.probableReturnDate) : '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.gatePassDetails || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.transportation || '—'}</td>
                <td className="px-2 py-1.5 text-gray-600">{it.contactPersonDetails || it.remarks || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StoreApproveBox({ g, busy, onSubmit }) {
  const isLegacy = !g.kind;
  const [driverName, setDriverName] = useState(g.driverName || '');
  const [vehicleNo, setVehicleNo] = useState(g.vehicleNo || '');
  const [remarks, setRemarks] = useState('');

  const submit = () => {
    const body = { remarks: remarks.trim() || undefined };
    if (isLegacy) {
      body.driverName = driverName.trim();
      body.vehicleNo = vehicleNo.trim();
    }
    onSubmit(body);
  };

  const disabled = busy || (isLegacy && (!driverName.trim() || !vehicleNo.trim()));

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">
        {isLegacy
          ? 'Legacy FIM gate pass — capture driver/vehicle and forward to Accounts'
          : g.kind === 'OUTSIDE'
            ? 'Approve and forward to Accounts for invoice details'
            : 'Approve and forward directly to Logistics for dispatch'}
      </p>
      {isLegacy && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input label="Driver name *" value={driverName} onChange={e => setDriverName(e.target.value)} />
          <Input label="Vehicle number *" value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} />
        </div>
      )}
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={disabled} onClick={submit}>
          <ShieldCheck size={14} /> Approve & Forward
        </Button>
      </div>
    </div>
  );
}

function AccountsInvoiceBox({ busy, onSubmit }) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');

  const submit = () => onSubmit({
    invoiceNo: invoiceNo.trim() || undefined,
    dcNo: dcNo.trim() || undefined,
    remarks: remarks.trim() || undefined,
  });

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">Add invoice / DC details and forward to Stores for final review</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input label="Invoice No." value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="e.g. INV/2026/001" />
        <Input label="Delivery Challan No." value={dcNo} onChange={e => setDcNo(e.target.value)} placeholder="e.g. DC/2026/001" />
      </div>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy || (!invoiceNo.trim() && !dcNo.trim())} onClick={submit}>
          <Calculator size={14} /> Save Invoice & Forward
        </Button>
      </div>
    </div>
  );
}

function StoreReviewBox({ busy, onSubmit }) {
  const [remarks, setRemarks] = useState('');
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">Confirm review and forward to Logistics for vehicle assignment</p>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => onSubmit({ remarks: remarks.trim() || undefined })}>
          <PackageCheck size={14} /> Forward to Logistics
        </Button>
      </div>
    </div>
  );
}

const PRIVATE_VEHICLE = '__PRIVATE__';

// "Already on GP-x, GP-y" note for a vehicle, excluding the gate pass being viewed.
function otherAssignments(v, currentId) {
  return (v?.activeAssignments || []).filter((a) => a.id !== currentId);
}

function LogisticsBox({ g, busy, onAssigned, onDispatched, setError }) {
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState(g.assignedVehicleId || '');
  const [pv, setPv] = useState({ regNumber: '', vehicleType: '', driverName: '', driverPhone: '' });
  const [signedPdf, setSignedPdf] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  useEffect(() => {
    api.get('/vehicles', { params: { status: 'ACTIVE' } })
      .then(({ data }) => setVehicles(data.vehicles || []))
      .catch(() => setVehicles([]));
  }, []);

  const isPrivate = vehicleId === PRIVATE_VEHICLE;

  const assign = async () => {
    if (isPrivate) {
      if (!pv.regNumber.trim()) return setError('Enter the private vehicle number');
      if (!pv.driverName.trim()) return setError('Enter the driver name');
    } else if (!vehicleId) {
      return setError('Pick a vehicle');
    }
    setError(''); setLocalBusy(true);
    try {
      const body = isPrivate
        ? {
            privateVehicle: {
              regNumber: pv.regNumber.trim(),
              vehicleType: pv.vehicleType.trim() || undefined,
              driverName: pv.driverName.trim(),
              driverPhone: pv.driverPhone.trim() || undefined,
            },
          }
        : { vehicleId };
      await api.put(`/gatepasses/${g.id}/logistics-assign`, body);
      onAssigned();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to assign vehicle');
    }
    setLocalBusy(false);
  };

  const dispatch = async () => {
    if (g.kind === 'OUTSIDE' && !signedPdf) {
      return setError('Driver-signed delivery PDF is required for Outside dispatches');
    }
    setError(''); setLocalBusy(true);
    try {
      const fd = new FormData();
      if (signedPdf) fd.append('signedPdf', signedPdf);
      if (remarks.trim()) fd.append('remarks', remarks.trim());
      await api.post(`/gatepasses/${g.id}/logistics-dispatch`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onDispatched();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to dispatch');
    }
    setLocalBusy(false);
  };

  const assigned = !!g.assignedVehicleId || !!g.privateVehicle;
  const working = busy || localBusy;

  const selectedVehicle = !isPrivate ? vehicles.find((v) => v.id === vehicleId) : null;
  const selectedOthers = otherAssignments(selectedVehicle, g.id);

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-3">
      <p className="text-xs font-medium text-amber-800">
        {assigned ? 'Vehicle assigned — confirm dispatch' : 'Assign a vehicle from the register, or use a private / hired one'}
      </p>

      {!assigned && (
        <>
          <Select label="Vehicle *" value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
            <option value="">— Select a vehicle —</option>
            <option value={PRIVATE_VEHICLE}>🚗 Private / Hired vehicle (enter details)</option>
            {vehicles.map((v) => {
              const others = otherAssignments(v, g.id);
              return (
                <option key={v.id} value={v.id}>
                  {v.regNumber} · {v.vehicleType || 'Vehicle'} · {v.driverName || 'No driver'}
                  {others.length ? `  — already on ${others.map(a => a.passNumber).join(', ')}` : ''}
                </option>
              );
            })}
          </Select>

          {isPrivate && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 bg-white border border-amber-200 rounded">
              <Input
                label="Vehicle No. *"
                value={pv.regNumber}
                onChange={e => setPv(p => ({ ...p, regNumber: e.target.value }))}
                placeholder="KA01AB1234"
              />
              <Input
                label="Vehicle Type"
                value={pv.vehicleType}
                onChange={e => setPv(p => ({ ...p, vehicleType: e.target.value }))}
                placeholder="Truck / Tempo / Car"
              />
              <Input
                label="Driver Name *"
                value={pv.driverName}
                onChange={e => setPv(p => ({ ...p, driverName: e.target.value }))}
                placeholder="Driver full name"
              />
              <Input
                label="Driver Phone"
                value={pv.driverPhone}
                onChange={e => setPv(p => ({ ...p, driverPhone: e.target.value }))}
                placeholder="10-digit mobile"
              />
            </div>
          )}

          {!isPrivate && selectedOthers.length > 0 && (
            <p className="text-xs text-amber-700 flex items-start gap-1">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                This vehicle is already assigned to {selectedOthers.map(a => a.passNumber).join(', ')}.
                You can still use it if it hasn’t left the campus.
              </span>
            </p>
          )}

          <div className="flex justify-end">
            <Button disabled={working || !vehicleId} onClick={assign}>
              <Truck size={14} /> Assign Vehicle
            </Button>
          </div>
        </>
      )}

      {assigned && (
        <>
          <div className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
            {g.assignedVehicle ? (
              <span>
                <span className="font-mono">{g.assignedVehicle.regNumber}</span>
                {g.assignedVehicle.driverName && <span className="text-gray-500"> · {g.assignedVehicle.driverName}</span>}
                {g.assignedVehicle.driverPhone && <span className="text-gray-500"> · {g.assignedVehicle.driverPhone}</span>}
              </span>
            ) : (
              <span>
                <span className="font-mono">{g.vehicleNo}</span>
                {g.driverName && <span className="text-gray-500"> · {g.driverName}</span>}
                {g.driverPhone && <span className="text-gray-500"> · {g.driverPhone}</span>}
              </span>
            )}
            {g.privateVehicle && <Badge color="purple">Private / Hired</Badge>}
          </div>
          {g.kind === 'OUTSIDE' && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Driver-signed delivery PDF *</label>
              <input
                type="file"
                accept="application/pdf"
                onChange={e => {
                  const f = e.target.files?.[0] || null;
                  if (f && !checkFileSize(f)) { e.target.value = ''; return; }
                  setSignedPdf(f);
                }}
                className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-gray-300 file:bg-gray-50 file:text-gray-700 file:text-xs hover:file:bg-gray-100"
              />
            </div>
          )}
          <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
          <div className="flex justify-end">
            <Button disabled={working || (g.kind === 'OUTSIDE' && !signedPdf)} onClick={dispatch}>
              <Upload size={14} /> Confirm Dispatch
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function LogisticsArrivalAckBox({ busy, isReturnable, onSubmit }) {
  const [reachedDate, setReachedDate] = useState('');
  const [remarks, setRemarks] = useState('');
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">
        Acknowledge arrival at the destination office
        {isReturnable && ' — Stores will close the pass once the material is returned.'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Input
          type="date"
          label="Reached date *"
          value={reachedDate}
          onChange={e => setReachedDate(e.target.value)}
        />
      </div>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy || !reachedDate} onClick={() => onSubmit({ reachedDate, remarks: remarks.trim() || undefined })}>
          <CheckCircle2 size={14} /> {isReturnable ? 'Confirm Arrival' : 'Acknowledge & Close'}
        </Button>
      </div>
    </div>
  );
}

function StoresAckBox({ g, busy, onSubmit }) {
  const [remarks, setRemarks] = useState('');
  const isReturnable = g.passType === 'RETURNABLE';
  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
      <p className="text-xs font-medium text-amber-800">
        {isReturnable
          ? 'Confirm material has been returned to stores'
          : 'Confirm material has reached destination'}
      </p>
      <Textarea label="Remarks (optional)" value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} />
      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => onSubmit({ remarks: remarks.trim() || undefined })}>
          {isReturnable ? <><RotateCcw size={14} /> Acknowledge Return & Close</> : <><CheckCircle2 size={14} /> Acknowledge Arrival & Close</>}
        </Button>
      </div>
    </div>
  );
}

function ApprovalTrail({ g }) {
  const kind = g.kind;
  const stages = [];

  // Common: Raised by
  stages.push({ label: 'Raised', user: g.createdBy, at: g.createdAt, icon: Send });
  // Stores approval
  stages.push({ label: 'Stores Approval', user: g.storeIncharge, at: g.storeInchargeAt, icon: PackageCheck });
  // Accounts (OUTSIDE only)
  if (kind === 'OUTSIDE' || !kind) {
    stages.push({ label: kind === 'OUTSIDE' ? 'Accounts (Invoice)' : 'Accounts', user: g.accountsApprover, at: g.accountsAt, icon: Calculator });
  }
  // Stores Review — OUTSIDE only; LOCAL_JOB skips this stage and goes straight
  // from PENDING_STORE → PENDING_LOGISTICS after the first stores approval.
  if (kind === 'OUTSIDE') {
    const pastStoreReview = !['PENDING_STORE', 'PENDING_ACCOUNTS', 'PENDING_STORE_REVIEW'].includes(g.status);
    stages.push({ label: 'Stores Review', user: g.storeIncharge, at: pastStoreReview ? (g.logisticsAt || g.storeInchargeAt) : null, icon: ClipboardList });
  }
  if (kind) {
    stages.push({ label: 'Logistics Dispatch', user: g.logisticsBy, at: g.dispatchedAt, icon: Truck });
    if (kind === 'OUTSIDE') {
      stages.push({ label: 'Logistics Arrival Ack', user: g.siteOfficeAckBy, at: g.siteOfficeAckAt, icon: Stamp });
      // For returnable outside passes, Stores closes after the material comes back.
      if (g.passType === 'RETURNABLE') {
        stages.push({ label: 'Stores Return Ack', user: g.localReturnedBy, at: g.localReturnedAt, icon: CheckCircle2 });
      }
    } else {
      stages.push({ label: 'Stores Ack', user: g.localReturnedBy, at: g.localReturnedAt || (g.status === 'CLOSED' ? g.approvedAt : null), icon: CheckCircle2 });
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {stages.map(({ label, user, at, icon: Icon }, idx) => (
        <div key={`${label}-${idx}`} className={`p-2 rounded border text-xs ${at ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-1.5 text-gray-700 font-medium">
            <Icon size={12} /> {label}
          </div>
          {at ? (
            <>
              <p className="text-gray-800 mt-0.5 truncate">{user?.name || '—'}</p>
              <p className="text-gray-500 truncate">{formatDateTime(at)}</p>
            </>
          ) : (
            <p className="text-gray-400 mt-0.5 flex items-center gap-1"><AlertCircle size={10} /> Pending</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, icon: Icon }) {
  return (
    <div>
      <p className="text-xs text-gray-500 flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </p>
      <p className="text-gray-800">{value || '—'}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Workflow flowchart — visual reference of who acts at each stage, and how
// LOCAL_JOB differs from OUTSIDE (LOCAL_JOB skips Accounts + Store Review).
// ──────────────────────────────────────────────────────────────────────────────
function WorkflowModal({ onClose }) {
  const LOCAL_JOB_STEPS = [
    { role: 'Unit Manager', action: 'Raise gate pass',          status: 'PENDING_STORE',    icon: Plus,         tone: 'gray' },
    { role: 'Stores',       action: 'Approve & forward',        status: 'PENDING_LOGISTICS', icon: ShieldCheck,  tone: 'amber' },
    { role: 'Logistics',    action: 'Assign vehicle + driver',  status: 'PENDING_LOGISTICS', icon: Truck,        tone: 'amber' },
    { role: 'Logistics',    action: 'Confirm dispatch',         status: 'IN_TRANSIT',        icon: Upload,       tone: 'blue' },
    { role: 'Stores',       action: 'Acknowledge return/reach', status: 'CLOSED',            icon: CheckCircle2, tone: 'green' },
  ];

  const OUTSIDE_STEPS = [
    { role: 'Unit Manager', action: 'Raise gate pass',                                 status: 'PENDING_STORE',         icon: Plus,         tone: 'gray' },
    { role: 'Stores',       action: 'Approve & forward to Accounts',                   status: 'PENDING_ACCOUNTS',      icon: ShieldCheck,  tone: 'amber' },
    { role: 'Accounts',     action: 'Add Invoice / DC details',                        status: 'PENDING_STORE_REVIEW',  icon: Calculator,   tone: 'amber' },
    { role: 'Stores',       action: 'Final review & forward',                          status: 'PENDING_LOGISTICS',     icon: PackageCheck, tone: 'amber' },
    { role: 'Logistics',    action: 'Assign vehicle + driver',                         status: 'PENDING_LOGISTICS',     icon: Truck,        tone: 'amber' },
    { role: 'Logistics',    action: 'Upload signed PDF & dispatch',                    status: 'IN_TRANSIT',            icon: Upload,       tone: 'blue' },
    { role: 'Logistics',    action: 'Acknowledge arrival (closes if non-returnable)',  status: 'PENDING_RETURN',        icon: Stamp,        tone: 'amber' },
    { role: 'Stores',       action: 'Acknowledge return (returnable only)',            status: 'CLOSED',                icon: CheckCircle2, tone: 'green' },
  ];

  return (
    <Modal isOpen onClose={onClose} title="Gate Pass Workflow" size="xl">
      <div className="space-y-6">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-900">
          <p className="font-medium mb-1 flex items-center gap-1.5">
            <GitBranch size={14} /> Two parallel flows
          </p>
          <p className="text-xs text-blue-800">
            The path forks based on the gate pass <span className="font-medium">kind</span> chosen at creation.
            Local Job goes straight from Stores to Logistics. Outside passes through Accounts and a final Stores Review first.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <FlowColumn
            title="Local Job"
            subtitle="Material leaves and returns to stores (RAPS/JL-JW)"
            color="purple"
            steps={LOCAL_JOB_STEPS}
          />
          <FlowColumn
            title="Outside"
            subtitle="Material delivered to a site office (RAMS/GPR/01)"
            color="blue"
            steps={OUTSIDE_STEPS}
          />
        </div>

        <div className="p-3 bg-gray-50 border border-gray-200 rounded text-xs text-gray-700">
          <p className="font-medium mb-1">Notes</p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li>Logistics pre-registers all company vehicles in the <span className="font-medium">Vehicles</span> page; the dispatch picker pulls from that pool.</li>
            <li>For Outside dispatches, a driver-signed delivery PDF is mandatory before confirming dispatch.</li>
            <li>Rejection is allowed at any pending stage — the gate pass moves to REJECTED with the reviewer's reason captured.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function FlowColumn({ title, subtitle, color, steps }) {
  const headerTone = {
    purple: 'bg-purple-50 border-purple-200 text-purple-800',
    blue:   'bg-blue-50 border-blue-200 text-blue-800',
  }[color] || 'bg-gray-50 border-gray-200 text-gray-800';

  return (
    <div className="space-y-3">
      <div className={`p-3 rounded border ${headerTone}`}>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] opacity-80 mt-0.5">{subtitle}</p>
      </div>
      <div className="space-y-2">
        {steps.map((s, idx) => (
          <div key={idx}>
            <FlowStep step={idx + 1} {...s} />
            {idx < steps.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowDown size={14} className="text-gray-400" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowStep({ step, role, action, status, icon: Icon, tone }) {
  const toneClasses = {
    gray:  'bg-gray-50 border-gray-200',
    amber: 'bg-amber-50 border-amber-200',
    blue:  'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
  }[tone] || 'bg-gray-50 border-gray-200';

  const badgeColor = {
    gray:  'gray',
    amber: 'yellow',
    blue:  'blue',
    green: 'green',
  }[tone] || 'gray';

  return (
    <div className={`p-3 rounded border ${toneClasses} flex items-start gap-3`}>
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white border border-gray-300 flex items-center justify-center text-xs font-semibold text-gray-700">
        {step}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
          <User size={11} /> {role}
        </div>
        <p className="text-sm text-gray-900 font-medium mt-0.5 flex items-center gap-1.5">
          <Icon size={13} className="text-gray-500" /> {action}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-gray-500">
          <ArrowRight size={10} /> <Badge color={badgeColor}>{status.replace(/_/g, ' ')}</Badge>
        </div>
      </div>
    </div>
  );
}
