import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Inbox, AlertTriangle, Clock, ShieldCheck, PauseCircle, ArrowRight,
  Building2, Timer,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import PageHero from '../components/shared/PageHero';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';

const L5 = ['sureshbabu', 'rameshbabu', 'madhubabu'];

const STAGE_LABEL = {
  NOT_STARTED: 'Not Started',
  UNIT_DOCS_PENDING: 'Unit Docs Pending',
  QC_VERIFIED: 'QC Verified',
  MGMT_APPROVED: 'Mgmt Approved',
  FINANCE_REVIEW: 'Finance Review',
  ON_HOLD: 'On Hold',
  BILL_GENERATED: 'Bill Generated',
  PDC_CLEARED: 'PDC Cleared',
  CUSTOMER_CONTACTED: 'Customer Contacted',
  ACCOUNTS_TRACKING: 'Accounts Tracking',
  CLOSURE_COMPLETE: 'Closure Complete',
};

const STAGE_COLOR = {
  NOT_STARTED: 'gray',
  UNIT_DOCS_PENDING: 'amber',
  QC_VERIFIED: 'blue',
  MGMT_APPROVED: 'purple',
  FINANCE_REVIEW: 'orange',
  ON_HOLD: 'red',
  BILL_GENERATED: 'navy',
  PDC_CLEARED: 'blue',
  CUSTOMER_CONTACTED: 'orange',
  ACCOUNTS_TRACKING: 'yellow',
  CLOSURE_COMPLETE: 'green',
};

const ROLE_HINT = {
  MANAGER: 'Items waiting on your unit — upload documents or resolve holds.',
  QC: 'Submitted by units — verify documentation and issue QC certificate.',
  FINANCE: 'Awaiting bill generation or PDC clearance.',
  ACCOUNTING: 'Customer-contacted closures — log receipt and close.',
  ADMIN: 'All active closures across the chain.',
};

const TABS = [
  { key: 'PENDING_MINE', label: 'Pending Mine' },
  { key: 'ON_HOLD',      label: 'On Hold' },
  { key: 'SLA_ACTIVE',   label: 'SLA Active' },
  { key: 'ALL',          label: 'All' },
];

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

function hoursLeft(deadlineAt) {
  if (!deadlineAt) return null;
  return Math.round((new Date(deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60));
}

function SlaChip({ deadlineAt }) {
  const h = hoursLeft(deadlineAt);
  if (h == null) return null;
  if (h <= 0) {
    return <Badge color="red"><AlertTriangle size={10} className="inline mr-1" />Breached {Math.abs(h)}h</Badge>;
  }
  const color = h <= 12 ? 'red' : h <= 24 ? 'orange' : 'blue';
  return <Badge color={color}><Timer size={10} className="inline mr-1" />{h}h left</Badge>;
}

function pendingForRole(w, role, username) {
  const stage = w.closureStage;
  if (role === 'MANAGER') return ['UNIT_DOCS_PENDING', 'ON_HOLD'].includes(stage);
  if (role === 'QC') return stage === 'UNIT_DOCS_PENDING' && !!w.unitDocsSubmittedAt;
  if (role === 'FINANCE') return ['MGMT_APPROVED', 'BILL_GENERATED', 'PDC_CLEARED'].includes(stage);
  if (role === 'ACCOUNTING') return ['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'].includes(stage);
  if (role === 'ADMIN' && L5.includes(username)) return ['QC_VERIFIED', 'CUSTOMER_CONTACTED'].includes(stage);
  if (role === 'ADMIN') return !['NOT_STARTED', 'CLOSURE_COMPLETE'].includes(stage);
  return false;
}

export default function ClosureInbox() {
  const { user } = useAuth();
  const role = user?.role;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('PENDING_MINE');

  const load = () => {
    setLoading(true);
    api.get('/work-orders/closure/inbox')
      .then(({ data }) => { setRows(data.workOrders || []); setErr(''); })
      .catch((e) => setErr(e?.response?.data?.error || 'Failed to load closure inbox'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    if (tab === 'ALL') return rows;
    if (tab === 'ON_HOLD') return rows.filter((w) => w.closureStage === 'ON_HOLD');
    if (tab === 'SLA_ACTIVE') return rows.filter((w) => !!w.slaDeadlineAt && ['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'].includes(w.closureStage));
    return rows.filter((w) => pendingForRole(w, role, user?.username));
  }, [rows, tab, role, user]);

  const counts = useMemo(() => ({
    PENDING_MINE: rows.filter((w) => pendingForRole(w, role, user?.username)).length,
    ON_HOLD:      rows.filter((w) => w.closureStage === 'ON_HOLD').length,
    SLA_ACTIVE:   rows.filter((w) => !!w.slaDeadlineAt && ['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'].includes(w.closureStage)).length,
    ALL:          rows.length,
  }), [rows, role, user]);

  return (
    <div className="space-y-5">
      <PageHero
        eyebrow="Work Order Closure"
        title="Closure Inbox"
        subtitle={ROLE_HINT[role] || 'Active work-order closures.'}
        icon={Inbox}
      />

      <Card className="p-4">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                tab === t.key ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-700 hover:bg-navy-100'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
                tab === t.key ? 'bg-white/20 text-white' : 'bg-navy-200 text-navy-700'
              }`}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <Card><p className="text-navy-500 text-center py-8">Loading…</p></Card>
      ) : err ? (
        <Card><p className="text-red-600 text-center py-8">{err}</p></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <ShieldCheck size={32} className="mx-auto text-navy-300 mb-2" />
            <p className="text-navy-500">Nothing waiting on you in this view.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((w) => {
            const stage = w.closureStage || 'NOT_STARTED';
            const activeHold = (w.holdRequests || []).find((h) => !h.resolvedAt);
            const docsCount = (w.closureDocs || []).filter((d) => d.stage === 'UNIT_DOCS_PENDING').length;
            return (
              <Link
                key={w.id}
                to={`/work-orders/${w.id}/closure`}
                className="block"
              >
                <Card className="p-4 hover:shadow-md hover:border-navy-300 transition cursor-pointer">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-mono text-xs text-navy-500">{w.workOrderNumber}</span>
                        <Badge color={STAGE_COLOR[stage] || 'gray'}>
                          {stage === 'ON_HOLD' ? <PauseCircle size={11} className="inline mr-1" /> : null}
                          {STAGE_LABEL[stage] || stage}
                        </Badge>
                        {activeHold && (
                          <Badge color="red">
                            {activeHold.missingItems?.length || 0} missing item(s)
                          </Badge>
                        )}
                        {w.slaDeadlineAt && ['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'].includes(stage) && (
                          <SlaChip deadlineAt={w.slaDeadlineAt} />
                        )}
                      </div>
                      <h3 className="font-semibold text-navy-900 truncate">{w.customerName}</h3>
                      <p className="text-sm text-navy-600 truncate">
                        SO: {w.supplyOrderNo} • {fmtDate(w.supplyOrderDate)}
                        {w.nomenclature ? ` • ${w.nomenclature}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-3 text-xs text-navy-500 mt-2">
                        {w.assignedUnit && (
                          <span className="flex items-center gap-1"><Building2 size={11} />{w.assignedUnit.name}</span>
                        )}
                        <span className="flex items-center gap-1"><Clock size={11} />Started {fmtDate(w.closureStartedAt)}</span>
                        <span>Docs: {docsCount}</span>
                        {w.billNumber && <span>Bill: {w.billNumber}</span>}
                      </div>
                    </div>
                    <div className="text-navy-400 flex items-center">
                      <ArrowRight size={18} />
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
