import { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList, Plus, CheckCircle2, Clock, XCircle, Building2,
  CalendarClock, TrendingUp, ShieldCheck, PauseCircle,
  LayoutGrid, Table as TableIcon,
  FileText, Receipt, ShieldAlert, Upload, AlertTriangle, Timer, Trash2, Check,
  GitBranch, ArrowRight, ArrowDown, Download, Paperclip, BellRing,
  Banknote, Wallet, FilePlus2, FileCheck2, UserCheck, Truck, RefreshCw,
  Filter, X, Hash,
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
import SearchBar from '../components/shared/SearchBar';
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
  COMPLETED:      { color: 'amber',  label: 'Pending Accounts', Icon: Wallet },
  CLOSED:         { color: 'green',  label: 'Completed (Paid)', Icon: CheckCircle2 },
  CANCELLED:      { color: 'gray',   label: 'Cancelled',        Icon: XCircle },
  REJECTED:       { color: 'red',    label: 'Rejected',         Icon: XCircle },
  ON_HOLD:        { color: 'red',    label: 'On Hold',          Icon: PauseCircle },
};

const STATUS_TABS = [
  'ALL', 'PENDING_ADMIN', 'ADMIN_ACCEPTED', 'ON_HOLD',
  'UNIT_ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED',
];

// Lot (closure cycle) stage display. Finance-side stages are only shown to
// admins / FINANCE / ACCOUNTING (server sanitises them for MANAGER/QC).
const CYCLE_STAGE_META = {
  UNIT_DOCS_PENDING:     { color: 'yellow', label: 'With QC — verification pending' },
  QC_VERIFIED:           { color: 'blue',   label: 'QC Approved — Finance pending' },
  MGMT_APPROVED:         { color: 'blue',   label: 'Finance pending' }, // legacy stage, same treatment
  ON_HOLD:               { color: 'red',    label: 'On Hold — back with unit' },
  INVOICE_SENT:          { color: 'amber',  label: 'Invoice + DC Sent (48h goods-ack)' },
  DELIVERY_ACKNOWLEDGED: { color: 'purple', label: 'Goods Acked (45-day payment countdown)' },
  PAYMENT_RECEIVED:      { color: 'green',  label: 'Paid — Lot Closed' },
};

// One lot = one report PDF. That single document is what QC verifies.
const DOC_TYPE_LABELS = { LOT_REPORT: 'Lot Report' };

// Roles allowed to see closure invoice / SLA / payment fields. Mirrors the
// server's FINANCE_HIDDEN_ROLES sanitizer.
const canSeeFinance = (role) => !['MANAGER', 'QC'].includes(role);

// Flatten the WO + closure cycle into the shape QCVerificationCertificatePdf
// expects: top-level WO scope fields plus the cycle's QC + submission audit.
const qcCertData = (wo, cycle) => ({
  workOrderNumber: wo.workOrderNumber,
  supplyOrderNo: wo.supplyOrderNo,
  customerName: wo.customerName,
  items: (cycle.items || []).map((ci) => ({
    description: ci.item?.description,
    deliveryQty: ci.deliveryQty,
    uom: ci.item?.uom,
  })),
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

// Compact, locale-aware number for stat cards and qty columns (avoids long
// trailing decimals like 3.5999999 → "3.6").
const fmtQty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

// Best-effort "Type of Order" (Material / Service) — captured in remarks on
// import ("Type of Order: Service"). Returns null when not present so the Type
// filter only appears once there is real data to filter on.
const orderType = (wo) => {
  const m = /type of order\s*:\s*([a-z/ ]+)/i.exec(wo.remarks || '');
  return m ? m[1].trim().replace(/\s*\|.*$/, '').trim() : null;
};

// Map itemId → total qty delivered across every lot of this WO.
const deliveredByItem = (wo) => {
  const m = {};
  (wo.closures || []).forEach((c) => (c.items || []).forEach((ci) => {
    m[ci.itemId] = (m[ci.itemId] || 0) + (ci.deliveryQty || 0);
  }));
  return m;
};

export default function WorkOrders() {
  const { user } = useAuth();
  const role = user?.role;
  const canCreate = role === 'SUPPLY_CHAIN' || role === 'ADMIN';

  const [workOrders, setWorkOrders] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState('table'); // 'table' | 'cards'
  const [workflowOpen, setWorkflowOpen] = useState(false);

  // ── Filters (all client-side so every option is auto-derived from the data
  // and filtering is instant — no refetch needed). ──
  const [activeTab, setActiveTab] = useState('ALL'); // status
  const [search, setSearch] = useState('');
  const [customer, setCustomer] = useState('ALL');
  const [unitId, setUnitId] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Load the full set once (and on refresh). The server still scopes MANAGERs
  // to their own unit; everything else is filtered in the browser.
  const load = () => {
    setLoading(true);
    api.get('/work-orders', { params: { limit: 1000 } })
      .then(({ data }) => setWorkOrders(data.workOrders || []))
      .catch(() => setWorkOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [refreshKey]);

  useEffect(() => {
    api.get('/units').then(({ data }) => setUnits(data.units || data || [])).catch(() => setUnits([]));
  }, []);

  // ── Auto-derived filter option lists (sorted, de-duplicated). ──
  const customerOptions = useMemo(
    () => [...new Set(workOrders.map((w) => w.customerName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [workOrders],
  );
  const unitOptions = useMemo(() => {
    const map = new Map();
    workOrders.forEach((w) => { if (w.assignedUnit) map.set(w.assignedUnit.id, w.assignedUnit); });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [workOrders]);
  // Sheet-only unit names (no Unit record yet) get their own filter entries.
  const unitNameOptions = useMemo(
    () => [...new Set(workOrders.filter((w) => !w.assignedUnit && w.assignedUnitName).map((w) => w.assignedUnitName))]
      .sort((a, b) => a.localeCompare(b)),
    [workOrders],
  );
  const typeOptions = useMemo(
    () => [...new Set(workOrders.map(orderType).filter(Boolean))].sort(),
    [workOrders],
  );

  // ── Count per status so the tabs can show live totals. ──
  const statusCounts = useMemo(() => {
    const c = { ALL: workOrders.length };
    workOrders.forEach((w) => { c[w.status] = (c[w.status] || 0) + 1; });
    return c;
  }, [workOrders]);

  // ── Apply every active filter. ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(`${toDate}T23:59:59`) : null;
    return workOrders.filter((w) => {
      if (activeTab !== 'ALL' && w.status !== activeTab) return false;
      if (customer !== 'ALL' && w.customerName !== customer) return false;
      if (unitId !== 'ALL') {
        if (unitId === 'NONE') { if (w.assignedUnit || w.assignedUnitName) return false; }
        else if (unitId.startsWith('NAME:')) { if (w.assignedUnit || w.assignedUnitName !== unitId.slice(5)) return false; }
        else if (w.assignedUnit?.id !== unitId) return false;
      }
      if (type !== 'ALL' && orderType(w) !== type) return false;
      if (from || to) {
        const d = w.supplyOrderDate ? new Date(w.supplyOrderDate) : null;
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (q) {
        const hay = [
          w.workOrderNumber, w.supplyOrderNo, w.customerName, w.nomenclature,
          w.assignedUnit?.name, w.assignedUnit?.code, w.assignedUnitName,
          ...(w.items || []).map((it) => it.description),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [workOrders, activeTab, customer, unitId, type, fromDate, toDate, search]);

  const activeFilterCount =
    (activeTab !== 'ALL' ? 1 : 0) + (customer !== 'ALL' ? 1 : 0) + (unitId !== 'ALL' ? 1 : 0)
    + (type !== 'ALL' ? 1 : 0) + (search.trim() ? 1 : 0) + (fromDate || toDate ? 1 : 0);
  const clearFilters = () => {
    setActiveTab('ALL'); setSearch(''); setCustomer('ALL'); setUnitId('ALL');
    setType('ALL'); setFromDate(''); setToDate('');
  };

  // ── Summary stats over the *filtered* set so the numbers always match what
  // is on screen. Deadline pressure (overdue / due soon), per-order completion
  // and unit coverage are what tracking needs — raw qty sums across unrelated
  // materials hide all of that. ──
  const summary = useMemo(() => {
    const DAY = 86400000;
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * DAY);
    const in30 = new Date(now.getTime() + 30 * DAY);
    const OPEN = ['PENDING_ADMIN', 'ADMIN_ACCEPTED', 'UNIT_ACCEPTED', 'IN_PROGRESS', 'ON_HOLD'];

    let ordered = 0; let delivered = 0;
    let fullyDelivered = 0; let partial = 0;
    let overdueCount = 0; let oldestLateDays = 0; let overdueQty = 0;
    let due7 = 0; let due30 = 0;
    let unassigned = 0; let sheetNamed = 0;

    filtered.forEach((w) => {
      const qty = w.orderQuantity || 0;
      const done = Math.min(w.deliveredQty || 0, qty);
      ordered += qty;
      delivered += done;
      if (qty > 0 && done >= qty) fullyDelivered += 1;
      else if (done > 0) partial += 1;

      const open = OPEN.includes(w.status);
      const pdc = w.effectivePdcDate ? new Date(w.effectivePdcDate) : null;
      if (w.overdue) {
        overdueCount += 1;
        overdueQty += Math.max(0, qty - done);
        if (pdc) oldestLateDays = Math.max(oldestLateDays, Math.floor((now - pdc) / DAY));
      } else if (open && pdc && pdc >= now) {
        if (pdc <= in7) due7 += 1;
        if (pdc <= in30) due30 += 1;
      }
      if (open && !w.assignedUnit) {
        unassigned += 1;
        if (w.assignedUnitName) sheetNamed += 1;
      }
    });

    return {
      deliveredPct: ordered > 0 ? Math.round((delivered / ordered) * 100) : 0,
      fullyDelivered,
      partial,
      notStarted: filtered.length - fullyDelivered - partial,
      overdueCount,
      oldestLateDays,
      overdueQty: Math.round(overdueQty * 100) / 100,
      due7,
      due30,
      unassigned,
      sheetNamed,
    };
  }, [filtered]);

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

      {/* Stats — deadline pressure first (overdue / due soon), then order-level
          completion and unit coverage. All figures track the active filters,
          so they always match the list. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatsCard
          title="Work Orders"
          value={fmtQty(filtered.length)}
          subtitle={`${new Set(filtered.map((w) => w.customerName)).size} customer${new Set(filtered.map((w) => w.customerName)).size === 1 ? '' : 's'}`}
          icon={ClipboardList}
          color="navy"
        />
        <StatsCard
          title="Overdue"
          value={fmtQty(summary.overdueCount)}
          subtitle={summary.overdueCount > 0
            ? `Oldest ${summary.oldestLateDays}d late · ${fmtQty(summary.overdueQty)} qty stuck`
            : 'Nothing past PDC'}
          icon={AlertTriangle}
          color={summary.overdueCount > 0 ? 'red' : 'green'}
        />
        <StatsCard
          title="Due in 7 Days"
          value={fmtQty(summary.due7)}
          subtitle="PDC this week — act now"
          icon={Timer}
          color={summary.due7 > 0 ? 'yellow' : 'green'}
        />
        <StatsCard
          title="Due in 30 Days"
          value={fmtQty(summary.due30)}
          subtitle="PDC within a month"
          icon={CalendarClock}
          color="blue"
        />
        <StatsCard
          title="Delivery Progress"
          value={`${summary.deliveredPct}%`}
          subtitle={`${summary.fullyDelivered} done · ${summary.partial} partial · ${summary.notStarted} not started`}
          icon={TrendingUp}
          color={summary.deliveredPct >= 70 ? 'green' : summary.deliveredPct >= 30 ? 'yellow' : 'navy'}
        />
        <StatsCard
          title="Needs Unit"
          value={fmtQty(summary.unassigned)}
          subtitle={summary.unassigned > 0
            ? `${summary.sheetNamed} named on sheet only`
            : 'All assigned to units'}
          icon={Building2}
          color={summary.unassigned > 0 ? 'yellow' : 'green'}
        />
      </div>

      <Card className="p-4 space-y-4">
        {/* Search + view toggle */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search by customer, supply order no., WO number, or material…"
            />
          </div>
          <div className="inline-flex bg-navy-50 rounded-lg p-0.5 self-start sm:self-auto">
            <button
              onClick={() => setView('table')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${view === 'table' ? 'bg-white shadow text-navy-800' : 'text-navy-600 hover:text-navy-800'}`}
              title="Detailed rows"
            >
              <TableIcon size={13} className="inline mr-1" /> Detailed
            </button>
            <button
              onClick={() => setView('cards')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${view === 'cards' ? 'bg-white shadow text-navy-800' : 'text-navy-600 hover:text-navy-800'}`}
              title="Compact cards"
            >
              <LayoutGrid size={13} className="inline mr-1" /> Compact
            </button>
          </div>
        </div>

        {/* Status tabs with live counts */}
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const count = statusCounts[tab] || 0;
            const on = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  on ? 'bg-navy-800 text-white shadow-sm' : 'bg-navy-50 text-navy-700 hover:bg-navy-100'
                }`}
              >
                {tab === 'ALL' ? 'All' : STATUS_META[tab]?.label || tab}
                <span className={`tnum rounded-full px-1.5 py-0.5 text-[10px] leading-none ${on ? 'bg-white/20 text-white' : 'bg-white text-navy-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Dropdown filters + date range + clear + result count */}
        <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-gray-100">
          <Select
            label="Customer"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            className="min-w-[180px]"
          >
            <option value="ALL">All customers ({customerOptions.length})</option>
            {customerOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select
            label="Unit"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="min-w-[150px]"
          >
            <option value="ALL">All units</option>
            {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            {unitNameOptions.map((n) => <option key={`NAME:${n}`} value={`NAME:${n}`}>{n} (sheet)</option>)}
            <option value="NONE">Not assigned</option>
          </Select>
          {typeOptions.length > 0 && (
            <Select
              label="Order Type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="min-w-[140px]"
            >
              <option value="ALL">All types</option>
              {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          )}
          <div>
            <span className="block text-[13px] font-semibold text-navy-700 mb-1.5">Order date</span>
            <DateRangeFilter fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate} />
          </div>
          {activeFilterCount > 0 && (
            <Button variant="ghost" onClick={clearFilters} className="text-xs">
              <X size={14} className="mr-1" /> Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </Button>
          )}
          <div className="ml-auto self-center flex items-center gap-1.5 text-xs font-medium text-navy-500">
            <Filter size={13} />
            Showing <span className="font-bold text-navy-800 tnum">{filtered.length}</span>
            {filtered.length !== workOrders.length && <span>of {workOrders.length}</span>}
            work order{filtered.length === 1 ? '' : 's'}
          </div>
        </div>
      </Card>

      {loading ? (
        <Card><p className="text-navy-500 text-center py-8">Loading...</p></Card>
      ) : workOrders.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <ClipboardList size={32} className="mx-auto text-navy-300 mb-3" />
            <p className="text-navy-700 font-semibold">No work orders yet</p>
            <p className="text-navy-500 text-sm mt-1">Logged supply orders will appear here.</p>
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Filter size={32} className="mx-auto text-navy-300 mb-3" />
            <p className="text-navy-700 font-semibold">No work orders match your filters</p>
            <p className="text-navy-500 text-sm mt-1">Try a different search or clear the filters.</p>
            <Button variant="secondary" onClick={clearFilters} className="mt-4">
              <X size={14} className="mr-1" /> Clear all filters
            </Button>
          </div>
        </Card>
      ) : view === 'table' ? (
        <DashboardTable workOrders={filtered} onOpen={setDetail} />
      ) : (
        <div className="grid gap-3">
          {filtered.map((w) => {
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
                      {w.pdc3MonthAlertActive && (
                        <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white animate-pulse">
                          <AlertTriangle size={11} /> PDC ≤ 3 months
                        </span>
                      )}
                    </div>
                    <h3 className="font-semibold text-navy-900 truncate">{w.customerName}</h3>
                    <p className="text-sm text-navy-600 truncate">
                      SO: {w.supplyOrderNo} • {formatDate(w.supplyOrderDate)}
                      {w.items?.length ? ` • ${w.items.length} material${w.items.length > 1 ? 's' : ''}` : ''}
                    </p>
                    {w.supplyOrderDescription && (
                      <p className="text-xs text-navy-500 mt-0.5 line-clamp-1">{w.supplyOrderDescription}</p>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-navy-500 mt-2">
                      {(w.assignedUnit || w.assignedUnitName) && (
                        <span className="flex items-center gap-1"><Building2 size={11} />{w.assignedUnit ? w.assignedUnit.name : w.assignedUnitName}</span>
                      )}
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
// Dashboard — wide row-cards. Every WO renders as a full-width card
// showing ALL of the client-specified columns (no horizontal scroll)
// plus a creative alarm strip at the bottom of each row.
// ────────────────────────────────────────────────────────────────────
const ALARM_SEVERITY_META = {
  CRITICAL: {
    pill:    'bg-red-600 text-white border-red-700 shadow-md shadow-red-200 animate-pulse',
    chip:    'bg-red-50 text-red-700 border-red-300',
    dot:     'bg-red-600',
    Icon:    AlertTriangle,
    label:   'Critical',
  },
  WARNING: {
    pill:    'bg-amber-500 text-white border-amber-600 shadow-sm shadow-amber-200',
    chip:    'bg-amber-50 text-amber-800 border-amber-300',
    dot:     'bg-amber-500',
    Icon:    BellRing,
    label:   'Warning',
  },
  INFO: {
    pill:    'bg-sky-500 text-white border-sky-600',
    chip:    'bg-sky-50 text-sky-800 border-sky-300',
    dot:     'bg-sky-500',
    Icon:    Timer,
    label:   'Info',
  },
};

function DashboardTable({ workOrders, onOpen }) {
  const lastExt = (w) => (w.extensions?.length ? w.extensions[w.extensions.length - 1] : null);

  return (
    <div className="space-y-3">
      {workOrders.map((w) => {
        const ext = lastExt(w);
        const meta = STATUS_META[w.status] || { color: 'gray', label: w.status, Icon: ClipboardList };
        const Icon = meta.Icon;
        const deliveredPct = w.orderQuantity > 0
          ? Math.min(100, Math.round((w.deliveredQty / w.orderQuantity) * 100))
          : 0;
        const lotsSent = w.closures?.length || 0;
        const lotsExpected = w.lotsExpected || null;
        const lotPct = lotsExpected ? Math.min(100, Math.round((lotsSent / lotsExpected) * 100)) : null;
        const activeAlarms = (w.alarms || []).filter((a) => a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED');
        const critCount = activeAlarms.filter((a) => a.severity === 'CRITICAL').length;
        const warnCount = activeAlarms.filter((a) => a.severity === 'WARNING').length;
        const accentBorder =
          critCount > 0 ? 'border-l-red-600'
          : warnCount > 0 ? 'border-l-amber-500'
          : w.overdue ? 'border-l-red-500'
          : w.status === 'CLOSED' ? 'border-l-green-500'
          : w.status === 'COMPLETED' ? 'border-l-amber-500'
          : 'border-l-navy-400';

        return (
          <Card
            key={w.id}
            className={`p-0 cursor-pointer hover:shadow-lg transition border-l-4 ${accentBorder}`}
            onClick={() => onOpen(w)}
          >
            {/* Header strip — customer + status on top, then a dedicated full-width
                identity line so the long supply order number has room to breathe. */}
            <div className="px-4 py-2.5 bg-gradient-to-r from-navy-50 to-white border-b border-gray-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Badge color={meta.color}><Icon size={11} className="inline mr-1" />{meta.label}</Badge>
                  <span className="font-semibold text-navy-900 text-sm truncate max-w-[22rem]">{w.customerName}</span>
                  {/* Real unit -> navy chip; sheet-only name (no Unit record) -> amber chip; nothing -> grey. */}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${w.assignedUnit ? 'bg-navy-100 text-navy-700' : w.assignedUnitName ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                    <Building2 size={10} />{w.assignedUnit ? w.assignedUnit.name : (w.assignedUnitName || 'Unassigned')}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {w.overdue && <Badge color="red">Overdue</Badge>}
                  {w.onTime === true && <Badge color="green">On-Time</Badge>}
                  {w.onTime === false && <Badge color="red">Late</Badge>}
                  {w.pdc3MonthAlertActive && (
                    <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-600 text-white animate-pulse">
                      <AlertTriangle size={11} /> PDC ≤ 3m
                    </span>
                  )}
                  {activeAlarms.length > 0 && (
                    <span className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-navy-900 text-white">
                      <BellRing size={11} /> {activeAlarms.length} alarm{activeAlarms.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-navy-500" title="Internal work order number">
                  <Hash size={11} className="text-navy-400" />{w.workOrderNumber}
                </span>
                <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-navy-400">Supply Order</span>
                  <span className="font-mono text-[12px] font-semibold text-navy-800 break-all" title={w.supplyOrderNo}>{w.supplyOrderNo}</span>
                  <span className="text-navy-300">·</span>
                  <span className="text-[11px] text-navy-500">{formatDate(w.supplyOrderDate)}</span>
                </span>
              </div>
            </div>

            {/* Main grid — supply order number now lives in the header strip, so
                these fields get more breathing room (no more congestion). */}
            <div className="px-4 py-3 grid grid-cols-12 gap-x-4 gap-y-3 text-xs">
              <Field label="Materials" className="col-span-6 sm:col-span-3">
                {w.items?.length ? (
                  <div className="text-navy-800 line-clamp-2" title={w.items.map((it) => `${it.description} — ${it.quantity} ${it.uom}`).join('; ')}>
                    {w.items.length === 1
                      ? w.items[0].description
                      : `${w.items.length} materials`}
                  </div>
                ) : <span className="text-navy-400">—</span>}
                <div className="text-navy-500 mt-0.5">
                  <span className="font-semibold text-navy-800 tnum">{fmtQty(w.deliveredQty)}</span>
                  <span> / {fmtQty(w.orderQuantity)} {w.orderUnit} delivered</span>
                </div>
              </Field>
              <Field label="PDC" className="col-span-6 sm:col-span-2">
                <div className="text-navy-800 font-medium">{formatDate(w.effectivePdcDate)}</div>
                <div className="text-navy-500">
                  {w.extensions?.length > 0 ? `${w.extensions.length} ext` : 'original'}
                  {ext?.bankGuaranteeExtendedUpto && ` · BG→${formatDate(ext.bankGuaranteeExtendedUpto)}`}
                </div>
                {ext && (
                  <div className="text-[10px] text-navy-500">
                    Req:{ext.requestLetterStatus || '—'} · PRC:{ext.prcStatus || '—'}
                  </div>
                )}
              </Field>
              <Field label="Approvals" className="col-span-6 sm:col-span-3">
                <div className="flex items-center gap-1">
                  <ShieldCheck size={11} className="text-navy-500" />
                  <span className="text-navy-700">Adm:</span>
                  {w.adminAcceptedAt ? (
                    <span className="text-navy-800">{formatDate(w.adminAcceptedAt)}</span>
                  ) : <span className="text-navy-400">pending</span>}
                </div>
                <div className="flex items-center gap-1">
                  <Building2 size={11} className="text-navy-500" />
                  <span className="text-navy-700">Unit:</span>
                  {w.unitAcceptedAt ? (
                    <span className="text-navy-800">
                      {formatDate(w.unitAcceptedAt)}
                      {w.assignedUnit && <span className="text-navy-500"> · {w.assignedUnit.code}</span>}
                    </span>
                  ) : <span className="text-navy-400">{w.assignedUnit ? w.assignedUnit.code : (w.assignedUnitName || 'pending')}</span>}
                </div>
              </Field>
              <Field label="Bank Guarantee" className="col-span-6 sm:col-span-2">
                {w.bankGuaranteeNo ? (
                  <>
                    <div className="font-mono text-[11px] text-navy-800 truncate" title={w.bankGuaranteeNo}>{w.bankGuaranteeNo}</div>
                    <div className="text-navy-500">{w.bankGuaranteeDate ? formatDate(w.bankGuaranteeDate) : '—'}</div>
                  </>
                ) : <span className="text-navy-400">—</span>}
              </Field>
              <Field label="Insurance" className="col-span-6 sm:col-span-2">
                {w.insuranceNo ? (
                  <>
                    <div className="font-mono text-[11px] text-navy-800 truncate" title={w.insuranceNo}>{w.insuranceNo}</div>
                    <div className="text-navy-500">{w.insuranceDate ? formatDate(w.insuranceDate) : '—'}</div>
                  </>
                ) : <span className="text-navy-400">—</span>}
              </Field>

              {/* Row 2: lots progress + delivery + remarks */}
              <Field label="Lot Progress" className="col-span-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-navy-800">
                    {lotsExpected ? `${lotsSent} / ${lotsExpected}` : `${lotsSent}`}
                  </span>
                  <span className="text-navy-500">lots {lotsExpected ? 'sent' : 'sent (open-ended)'}</span>
                </div>
                <div className="w-full h-1.5 bg-navy-100 rounded-full mt-1 overflow-hidden">
                  <div
                    className={`h-full ${lotPct === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${lotPct != null ? lotPct : deliveredPct}%` }}
                  />
                </div>
                <div className="text-[10px] text-navy-500 mt-0.5">Qty {w.deliveredQty}/{w.orderQuantity} ({deliveredPct}%)</div>
              </Field>
              <Field label="Delivery Details" className="col-span-5">
                <div className="text-navy-700 line-clamp-2" title={w.deliveryDetails || ''}>
                  {w.deliveryDetails || <span className="text-navy-400">—</span>}
                </div>
              </Field>
              <Field label="Remarks" className="col-span-4">
                <div className="text-navy-700 line-clamp-2" title={w.remarks || ''}>
                  {w.remarks || <span className="text-navy-400">—</span>}
                </div>
              </Field>
            </div>

            {/* Alarms strip — creative pulse chips at the bottom */}
            {activeAlarms.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100 bg-gradient-to-r from-rose-50/50 via-amber-50/50 to-white flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-navy-600 inline-flex items-center gap-1">
                  <BellRing size={11} /> Live Alarms
                </span>
                {activeAlarms.slice(0, 6).map((a) => {
                  const sev = ALARM_SEVERITY_META[a.severity] || ALARM_SEVERITY_META.INFO;
                  const SevIcon = sev.Icon;
                  return (
                    <span
                      key={a.id}
                      className={`text-[10px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${sev.pill}`}
                      title={a.triggerContext || a.title}
                    >
                      <SevIcon size={10} />
                      {a.title}
                      {a.status === 'ACKNOWLEDGED' && <Check size={10} className="opacity-80" />}
                    </span>
                  );
                })}
                {activeAlarms.length > 6 && (
                  <span className="text-[10px] text-navy-500">+{activeAlarms.length - 6} more</span>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

const Field = ({ label, children, className = '' }) => (
  <div className={`min-w-0 ${className}`}>
    <div className="text-[10px] uppercase tracking-wider text-navy-400 font-semibold mb-0.5">{label}</div>
    <div className="text-xs text-navy-700 leading-tight">{children}</div>
  </div>
);

// ────────────────────────────────────────────────────────────────────
// Create
// ────────────────────────────────────────────────────────────────────
function CreateWorkOrderModal({ units, onClose, onCreated }) {
  const [form, setForm] = useState({
    supplyOrderNo: '', supplyOrderDate: '', supplyOrderDescription: '',
    customerName: '', customerContact: '',
    pdcDate: '', deliveryClause: '', lotsExpected: '',
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
  // BG date auto-tracks PDC + 2 months until the user types their own date.
  const [bgDateTouched, setBgDateTouched] = useState(false);

  // Material line items — S.No / Description / Quantity / UOM. At least one row.
  const [items, setItems] = useState([{ description: '', quantity: '', uom: 'Nos' }]);
  const setItem = (i, k, v) => setItems((rows) => rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addItem = () => setItems((rows) => [...rows, { description: '', quantity: '', uom: 'Nos' }]);
  const removeItem = (i) => setItems((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows));

  // PDC + 2 calendar months, as yyyy-mm-dd for the date input.
  const pdcPlus2Months = (pdcStr) => {
    if (!pdcStr) return '';
    const d = new Date(pdcStr);
    if (Number.isNaN(d.getTime())) return '';
    d.setMonth(d.getMonth() + 2);
    return d.toISOString().slice(0, 10);
  };

  const setField = (k, v) => setForm((f) => {
    const next = { ...f, [k]: v };
    // Auto-derive BG date from PDC unless the user already overrode it.
    if (k === 'pdcDate' && !bgDateTouched) next.bankGuaranteeDate = pdcPlus2Months(v);
    return next;
  });

  const cleanItems = items
    .map((r) => ({ description: r.description.trim(), quantity: Number(r.quantity), uom: (r.uom || '').trim() || 'Nos' }))
    .filter((r) => r.description && Number.isFinite(r.quantity) && r.quantity > 0);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!cleanItems.length) {
      setError('Add at least one material with a description and quantity.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { ...form };
      payload.items = cleanItems;
      payload.lotsExpected = form.lotsExpected ? Number(form.lotsExpected) : null;
      await api.post('/work-orders', payload);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to log work order');
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
          <Textarea label="Supply Order Description" rows={2} value={form.supplyOrderDescription} onChange={(e) => setField('supplyOrderDescription', e.target.value)} />
        </Section>

        <Section title="Customer">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Customer Name *" value={form.customerName} onChange={(e) => setField('customerName', e.target.value)} required />
            <Input label="Customer Details (Contact)" value={form.customerContact} onChange={(e) => setField('customerContact', e.target.value)} placeholder="Name, designation, mobile" />
          </div>
        </Section>

        <Section title="Order & Delivery">
          {/* Material line items — add a row per material. Followed lot-wise through delivery. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-wider font-semibold text-navy-500">Materials *</p>
              <Button type="button" variant="secondary" onClick={addItem}>
                <Plus size={14} className="mr-1" /> Add Row
              </Button>
            </div>
            <div className="overflow-x-auto border border-navy-100 rounded-md">
              <table className="w-full text-sm">
                <thead className="bg-navy-50 text-navy-600">
                  <tr>
                    <th className="text-left px-2 py-1.5 w-10">S.No</th>
                    <th className="text-left px-2 py-1.5">Description</th>
                    <th className="text-left px-2 py-1.5 w-28">Quantity</th>
                    <th className="text-left px-2 py-1.5 w-24">UOM</th>
                    <th className="px-2 py-1.5 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, i) => (
                    <tr key={i} className="border-t border-navy-50">
                      <td className="px-2 py-1 text-navy-500 text-center">{i + 1}</td>
                      <td className="px-2 py-1">
                        <Input value={row.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Material description" />
                      </td>
                      <td className="px-2 py-1">
                        <Input type="number" step="any" min="0" value={row.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} />
                      </td>
                      <td className="px-2 py-1">
                        <Input value={row.uom} onChange={(e) => setItem(i, 'uom', e.target.value)} placeholder="Nos" />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeItem(i)}
                          disabled={items.length === 1}
                          className="text-navy-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="Remove row"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="PDC Date *" type="date" value={form.pdcDate} onChange={(e) => setField('pdcDate', e.target.value)} required />
            <Input label="No. of Lots Expected" type="number" min="1" value={form.lotsExpected} onChange={(e) => setField('lotsExpected', e.target.value)} placeholder="e.g. 3 (leave blank for 1)" />
            <Input label="Delivery Clause" value={form.deliveryClause} onChange={(e) => setField('deliveryClause', e.target.value)} placeholder="Prorata / On or before / In lots" />
          </div>
        </Section>

        <Section title="Bank Guarantee & Insurance (BG date auto = PDC + 2 months — editable)">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input label="Bank Guarantee No" value={form.bankGuaranteeNo} onChange={(e) => setField('bankGuaranteeNo', e.target.value)} />
            <Input
              label={`BG Date ${bgDateTouched ? '(manual)' : '(auto: PDC + 2 months)'}`}
              type="date"
              value={form.bankGuaranteeDate}
              onChange={(e) => { setBgDateTouched(true); setField('bankGuaranteeDate', e.target.value); }}
            />
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

        <Section title="Unit Assignment (admin can change it while verifying)">
          <Select label="Assign Unit Manager *" value={form.assignedUnitId} onChange={(e) => setField('assignedUnitId', e.target.value)} required>
            <option value="">Select unit...</option>
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
// Red blinking alert shown on the WO header when PDC is ≤ 90 days away.
// BOTH the admin AND the assigned unit manager must each file their own
// status remark (extension needed / issues) before the blinking stops.
function PdcAlertButton({ wo, canAck, pendingLabel, busy, onAck }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const daysToPdc = wo.effectivePdcDate
    ? Math.ceil((new Date(wo.effectivePdcDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const label = daysToPdc != null
    ? `PDC in ${daysToPdc}d — ${pendingLabel}`
    : `PDC alert — ${pendingLabel}`;

  if (!canAck) {
    return (
      <span className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded bg-red-100 text-red-800 animate-pulse">
        <AlertTriangle size={11} /> {label}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white animate-pulse hover:bg-red-700"
        title="3-month PDC alert — click to file your status remark"
      >
        <AlertTriangle size={11} /> {label}
      </button>
      {open && (
        <Modal isOpen onClose={() => setOpen(false)} title="3-month PDC alert — file your remark" size="md">
          <div className="space-y-3">
            <p className="text-sm text-navy-600">
              Effective PDC for <strong>{wo.workOrderNumber}</strong> is {formatDate(wo.effectivePdcDate)}
              {daysToPdc != null ? ` (${daysToPdc} day${daysToPdc === 1 ? '' : 's'} left)` : ''}. Write your
              status remark — is an extension needed, any issue, anything blocking? Both admin and the unit
              manager must file a remark before the alert stops. All remarks are saved on the WO permanently.
            </p>
            <Textarea
              label="Status remark *"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Extension needed — material delay at supplier / On track, no issues"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                disabled={busy || !note.trim()}
                onClick={async () => { await onAck(note.trim()); setOpen(false); setNote(''); }}
              >
                Save Remark
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

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
  // Server now restricts: BG/Insurance/Extensions are SUPPLY_CHAIN + ADMIN only
  // (accounts can no longer mutate BG/Insurance; PDC extensions also dropped MANAGER).
  const canManageExtensions = isSupplyChain || isAdmin;
  const canEditDelivery = isSupplyChain || isAdmin || isAccounting;
  const canEditBgInsurance = isSupplyChain || isAdmin;
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
          {wo.pdc3MonthAdminAckPending && (
            <PdcAlertButton
              wo={wo}
              canAck={isAdmin}
              pendingLabel="admin remark needed"
              busy={busy}
              onAck={(note) => handleAction(() => api.post(`/work-orders/${wo.id}/pdc-alert/acknowledge`, { note }))}
            />
          )}
          {wo.pdc3MonthMgrAckPending && (
            <PdcAlertButton
              wo={wo}
              canAck={isUnitManager}
              pendingLabel="unit manager remark needed"
              busy={busy}
              onAck={(note) => handleAction(() => api.post(`/work-orders/${wo.id}/pdc-alert/acknowledge`, { note }))}
            />
          )}
          {wo.pdc3MonthAckAt && wo.pdc3MonthAckBy && (
            <span className="text-[11px] text-navy-500 inline-flex items-center gap-1" title={wo.pdc3MonthAckNote || ''}>
              <ShieldCheck size={11} /> PDC remark (admin): {wo.pdc3MonthAckBy.name}
            </span>
          )}
          {wo.pdc3MonthMgrAckAt && wo.pdc3MonthMgrAckBy && (
            <span className="text-[11px] text-navy-500 inline-flex items-center gap-1" title={wo.pdc3MonthMgrAckNote || ''}>
              <ShieldCheck size={11} /> PDC remark (unit): {wo.pdc3MonthMgrAckBy.name}
            </span>
          )}
        </div>

        <div className="border-b flex gap-2 flex-wrap">
          {['overview', 'bg-insurance', 'extensions', 'closures', 'delivery', 'remarks', 'alarms'].map((s) => {
            const activeAlarmCount = (wo.alarms || []).filter((a) => a.status === 'ACTIVE').length;
            const isAlarms = s === 'alarms';
            return (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`px-3 py-2 text-xs uppercase tracking-wider font-semibold inline-flex items-center gap-1.5 ${section === s ? 'border-b-2 border-navy-700 text-navy-800' : 'text-navy-400'} ${isAlarms && activeAlarmCount > 0 ? 'text-red-600' : ''}`}
              >
                {s === 'extensions' ? `Extensions (${wo.extensions.length})`
                  : s === 'closures' ? `Lots (${(wo.closures || []).length})`
                  : s === 'bg-insurance' ? 'BG / Insurance'
                  : s === 'remarks' ? 'Remarks & History'
                  : s === 'alarms' ? (
                    <>Alarms {activeAlarmCount > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-[10px] animate-pulse">{activeAlarmCount}</span>
                    )}</>
                  ) : s}
              </button>
            );
          })}
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
        {section === 'alarms' && (
          <AlarmsTab
            wo={wo}
            currentUser={currentUser}
            busy={busy}
            onSync={() => handleAction(() => api.post(`/work-orders/${wo.id}/alarms/sync`))}
            onAck={(alarmId, remark) => handleAction(() => api.post(`/work-orders/${wo.id}/alarms/${alarmId}/acknowledge`, { remark }))}
            onResolve={(alarmId, remark) => handleAction(() => api.post(`/work-orders/${wo.id}/alarms/${alarmId}/resolve`, { remark }))}
            onAddNote={(alarmId, body) => handleAction(() => api.post(`/work-orders/${wo.id}/alarms/${alarmId}/notes`, { body }))}
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

  const delivered = deliveredByItem(wo);

  return (
    <div className="space-y-1">
      <Row label="Supply Order No / Date" value={`${wo.supplyOrderNo}, Dt. ${formatDate(wo.supplyOrderDate)}`} />
      <Row label="Description" value={wo.supplyOrderDescription} />
      <Row label="Customer" value={wo.customerName} />
      <Row label="Customer Contact" value={wo.customerContact} />

      {/* Materials — per-item ordered / delivered / remaining across all lots */}
      <div className="py-1.5 border-b border-navy-50">
        <div className="text-navy-500 text-sm mb-1">Materials</div>
        {wo.items?.length ? (
          <div className="overflow-x-auto border border-navy-100 rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-navy-50 text-navy-600">
                <tr>
                  <th className="text-left px-2 py-1 w-8">S.No</th>
                  <th className="text-left px-2 py-1">Description</th>
                  <th className="text-right px-2 py-1">Ordered</th>
                  <th className="text-right px-2 py-1">Delivered</th>
                  <th className="text-right px-2 py-1">Remaining</th>
                  <th className="text-left px-2 py-1">UOM</th>
                </tr>
              </thead>
              <tbody>
                {wo.items.map((it) => {
                  const d = delivered[it.id] || 0;
                  const rem = Math.max(0, it.quantity - d);
                  return (
                    <tr key={it.id} className="border-t border-navy-50">
                      <td className="px-2 py-1 text-navy-500 text-center">{it.lineNo}</td>
                      <td className="px-2 py-1 text-navy-800">{it.description}</td>
                      <td className="px-2 py-1 text-right font-medium">{it.quantity}</td>
                      <td className="px-2 py-1 text-right text-blue-700">{d}</td>
                      <td className={`px-2 py-1 text-right ${rem > 0 ? 'text-yellow-700' : 'text-green-700'}`}>{rem}</td>
                      <td className="px-2 py-1 text-navy-600">{it.uom}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-navy-800 text-sm">{wo.orderQuantity} {wo.orderUnit}</div>
        )}
      </div>

      <Row label="PDC (effective)" value={`${formatDate(wo.effectivePdcDate)}${wo.extensions.length ? ` (after ${wo.extensions.length} extension${wo.extensions.length > 1 ? 's' : ''})` : ''}`} />
      <Row label="Original PDC" value={formatDate(wo.pdcDate)} />
      <Row label="Delivery Clause" value={wo.deliveryClause} />
      <Row label="Delivered (across lots)" value={`${wo.deliveredQty} / ${wo.orderQuantity} ${wo.orderUnit}`} />
      <Row label="Assigned Unit" value={wo.assignedUnit ? `${wo.assignedUnit.name} (${wo.assignedUnit.code})` : wo.assignedUnitName ? `${wo.assignedUnitName} (as per order sheet)` : null} />
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
      {wo.completedAt && <Row label="Delivered (all lots) at" value={formatDate(wo.completedAt)} />}
      {wo.status === 'COMPLETED' && (
        <Row label="Closure status" value="Delivered — Pending Accounts. Work order stays open until full payment of every lot is received." />
      )}
      {wo.status === 'CLOSED' && (
        <Row label="Closure status" value={`Completed & fully paid${wo.onTime != null ? ` — delivery was ${wo.onTime ? 'on time' : 'late'} vs PDC` : ''}.`} />
      )}
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

// Timeline colour → border + icon tint.
const TL_COLORS = {
  sky:    'border-sky-400 text-sky-600 bg-sky-50',
  blue:   'border-blue-400 text-blue-600 bg-blue-50',
  indigo: 'border-indigo-400 text-indigo-600 bg-indigo-50',
  red:    'border-red-400 text-red-600 bg-red-50',
  amber:  'border-amber-400 text-amber-700 bg-amber-50',
  yellow: 'border-yellow-400 text-yellow-700 bg-yellow-50',
  orange: 'border-orange-400 text-orange-600 bg-orange-50',
  violet: 'border-violet-400 text-violet-600 bg-violet-50',
  green:  'border-green-400 text-green-600 bg-green-50',
  pink:   'border-pink-400 text-pink-600 bg-pink-50',
  rose:   'border-rose-400 text-rose-600 bg-rose-50',
  gray:   'border-gray-300 text-gray-500 bg-gray-50',
};

const tlTime = (d) => {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// Collect EVERY remark / action across the whole WO lifecycle into one
// chronological timeline — who did what, what they wrote, and how it went.
// `alarms` (passed in) is the full alarm set including resolved ones so the
// audit history is complete. Finance-only fields are already null for
// MANAGER/QC (server-sanitised), so those guards naturally hide them.
function buildWoTimeline(wo, alarms) {
  const items = [];
  const nm = (u) => u?.name || '—';
  const push = (at, e) => { if (at) items.push({ at: new Date(at), ...e }); };
  const joinB = (...parts) => parts.filter(Boolean).join('\n');

  // ── Work order level ──
  push(wo.createdAt, {
    color: 'sky', Icon: FilePlus2, title: 'Work order logged', actor: nm(wo.createdBy),
    body: `SO ${wo.supplyOrderNo} · ${wo.customerName} · Qty ${wo.orderQuantity} ${wo.orderUnit} · PDC ${formatDate(wo.pdcDate)}`,
  });
  if (wo.adminAcceptedAt) push(wo.adminAcceptedAt, {
    color: 'blue', Icon: ShieldCheck, title: 'Admin verified & accepted', actor: nm(wo.adminAcceptedBy),
    body: wo.adminAcceptanceNote || null,
  });
  if (wo.unitAcceptedAt) push(wo.unitAcceptedAt, {
    color: 'indigo', Icon: UserCheck, title: 'Unit manager accepted', actor: nm(wo.unitAcceptedBy),
    body: wo.unitAcceptanceNote || null,
  });
  if (wo.status === 'ON_HOLD' && wo.unitAcceptanceNote && !wo.unitAcceptedAt) push(wo.updatedAt, {
    color: 'red', Icon: PauseCircle, title: 'Unit rejected — on hold for reassignment', actor: nm(wo.unitAcceptedBy),
    body: wo.unitAcceptanceNote,
  });
  if (wo.pdc3MonthAckAt) push(wo.pdc3MonthAckAt, {
    color: 'red', Icon: AlertTriangle, title: 'PDC 3-month remark (Admin)', actor: nm(wo.pdc3MonthAckBy),
    body: wo.pdc3MonthAckNote || null,
  });
  if (wo.pdc3MonthMgrAckAt) push(wo.pdc3MonthMgrAckAt, {
    color: 'red', Icon: AlertTriangle, title: 'PDC 3-month remark (Unit Manager)', actor: nm(wo.pdc3MonthMgrAckBy),
    body: wo.pdc3MonthMgrAckNote || null,
  });
  if (wo.deliveryDetailsUpdatedAt) push(wo.deliveryDetailsUpdatedAt, {
    color: 'gray', Icon: Truck, title: 'Delivery details updated', actor: nm(wo.deliveryDetailsUpdatedBy),
    body: wo.deliveryDetails || null,
  });

  // ── PDC extensions ──
  (wo.extensions || []).forEach((ext) => push(ext.grantedAt, {
    color: 'amber', Icon: CalendarClock,
    title: `PDC Extension #${ext.extensionNo} → ${formatDate(ext.newPdcDate)}`, actor: nm(ext.grantedBy),
    body: joinB(
      ext.reason,
      ext.bankGuaranteeExtendedUpto ? `BG extended upto ${formatDate(ext.bankGuaranteeExtendedUpto)}` : null,
      ext.requestLetterStatus ? `Request letter: ${ext.requestLetterStatus}` : null,
      ext.prcStatus ? `PRC: ${ext.prcStatus}` : null,
    ) || null,
  }));

  // ── Bank Guarantee / Insurance history ──
  (wo.bgEntries || []).forEach((b) => push(b.addedAt, {
    color: 'gray', Icon: ShieldCheck, title: `Bank Guarantee ${b.bgNo}`, actor: nm(b.addedBy),
    body: joinB(
      b.bgDate ? `BG date ${formatDate(b.bgDate)}` : null,
      b.validUpto ? `Valid upto ${formatDate(b.validUpto)}` : null,
      b.note,
    ) || null,
  }));
  (wo.insuranceEntries || []).forEach((b) => push(b.addedAt, {
    color: 'gray', Icon: ShieldCheck, title: `Insurance ${b.insuranceNo}`, actor: nm(b.addedBy),
    body: joinB(b.validUpto ? `Valid upto ${formatDate(b.validUpto)}` : null, b.note) || null,
  }));

  // ── Per-lot chain ──
  (wo.closures || []).forEach((c) => {
    const L = `Lot #${c.cycleNumber}`;
    const itemLines = (c.items || []).length
      ? c.items.map((ci) => `• ${ci.item?.description}: ${ci.deliveryQty} ${ci.item?.uom || ''}`.trim()).join('\n')
      : `Qty ${c.deliveryQty} ${wo.orderUnit}`;
    push(c.deliveredAt || c.createdAt, {
      color: 'violet', Icon: Upload, title: `${L} — work done, report sent to QC`, actor: nm(c.openedBy),
      body: joinB(itemLines, c.deliveryNote) || null,
    });
    if (c.qcVerifiedAt) push(c.qcVerifiedAt, {
      color: 'orange', Icon: FileCheck2, title: `${L} — QC approved`, actor: nm(c.qcVerifiedBy),
      body: joinB(c.qcRemark, c.qcCertificateNumber ? `Certificate ${c.qcCertificateNumber}` : null) || null,
    });
    (c.holdRequests || []).forEach((h) => {
      push(h.raisedAt, {
        color: 'red', Icon: ShieldAlert, title: `${L} — put on hold by QC`, actor: nm(h.raisedBy),
        body: joinB(
          h.reason,
          Array.isArray(h.missingItems) && h.missingItems.length
            ? h.missingItems.map((m) => `• ${m.docType}${m.note ? ` — ${m.note}` : ''}`).join('\n')
            : null,
        ) || null,
      });
      if (h.resolvedAt) push(h.resolvedAt, {
        color: 'green', Icon: RefreshCw, title: `${L} — hold cleared, new report resent to QC`, actor: nm(h.resolvedBy),
        body: h.resolvedNote || null,
      });
    });
    if (c.invoiceSentAt) push(c.invoiceSentAt, {
      color: 'yellow', Icon: Receipt, title: `${L} — Invoice sent`, actor: nm(c.invoiceSentBy),
      body: c.invoiceNumber ? `Invoice #${c.invoiceNumber}` : null,
    });
    if (c.dcSentAt) push(c.dcSentAt, {
      color: 'yellow', Icon: Truck, title: `${L} — Delivery challan sent`, actor: nm(c.dcSentBy),
      body: c.deliveryChallanNumber ? `DC #${c.deliveryChallanNumber}` : null,
    });
    if (c.deliveryAckAt) push(c.deliveryAckAt, {
      color: 'amber', Icon: UserCheck, title: `${L} — Goods ack received (45-day window started)`, actor: nm(c.deliveryAckBy),
      body: c.deliveryAckNote || null,
    });
    (c.weeklyFollowups || []).forEach((f) => push(f.contactedAt, {
      color: 'pink', Icon: BellRing, title: `${L} — Week ${f.weekNumber} incoming-money status`, actor: nm(f.contactedBy),
      body: joinB(f.customerResponse ? `Status: ${f.customerResponse}` : null, f.note ? `Note: ${f.note}` : null) || null,
    }));
    if (c.paymentReceivedAt) push(c.paymentReceivedAt, {
      color: 'green', Icon: Wallet, title: `${L} — Payment received (lot closed)`, actor: nm(c.paymentReceivedBy),
      body: c.paymentNote || null,
    });
  });

  // ── Alarms + their remark threads (all statuses) ──
  (alarms || []).forEach((a) => {
    push(a.createdAt, {
      color: 'rose', Icon: BellRing, title: `Alarm raised: ${a.title}`, actor: 'System',
      body: a.triggerContext || null,
    });
    (a.notes || []).forEach((n) => push(n.createdAt, {
      color: 'rose', Icon: FilePlus2,
      title: `Alarm remark${n.kind && n.kind !== 'COMMENT' ? ` (${n.kind.toLowerCase()})` : ''} — ${a.title}`,
      actor: n.author?.name || 'System', body: n.body || null,
    }));
  });

  // Oldest → newest so it reads as the story of the work order.
  return items.sort((x, y) => x.at - y.at);
}

function RemarksTab({ wo, canEdit, busy, onSave }) {
  const [text, setText] = useState(wo.remarks || '');
  const [allAlarms, setAllAlarms] = useState(wo.alarms || []);

  // Pull the full alarm set (incl. resolved) so the history is complete.
  useEffect(() => {
    let live = true;
    api.get(`/work-orders/${wo.id}/alarms`, { params: { includeResolved: 1 } })
      .then(({ data }) => { if (live) setAllAlarms(data.alarms || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [wo.id]);

  const timeline = buildWoTimeline(wo, allAlarms);

  return (
    <div className="space-y-5">
      {/* Free-text shared notes (still editable by anyone with access) */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Open Notes</p>
        <p className="text-[11px] text-navy-500">Shared scratch-pad — any role with access can add or edit.</p>
        {canEdit ? (
          <>
            <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
            <Button disabled={busy} onClick={() => onSave(text)}>Save Notes</Button>
          </>
        ) : (
          <div className="text-sm text-navy-700 whitespace-pre-wrap p-3 bg-navy-50 rounded">{wo.remarks || '—'}</div>
        )}
      </div>

      {/* Full lifecycle history — every remark + action, who did what, in order */}
      <div className="space-y-2 border-t pt-4">
        <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">
          Full History &amp; Remark Trail ({timeline.length})
        </p>
        <p className="text-[11px] text-navy-500">
          Every action and remark across the whole work order — admin/unit acceptance, PDC remarks, each lot's
          work-done, QC remarks, holds, finance dispatch, goods ack, weekly money-status, payments and alarm remarks — in order.
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-navy-400 italic">No activity recorded yet.</p>
        ) : (
          <ol className="relative ml-2 border-l-2 border-navy-100 space-y-3 pt-1">
            {timeline.map((it, idx) => {
              const c = TL_COLORS[it.color] || TL_COLORS.gray;
              const Icon = it.Icon || FilePlus2;
              return (
                <li key={idx} className="relative pl-5">
                  <span className={`absolute -left-[11px] top-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${c}`}>
                    <Icon size={11} />
                  </span>
                  <div className="rounded-lg border border-navy-100 bg-white p-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-navy-800">{it.title}</span>
                      <span className="text-[10px] text-navy-400">{tlTime(it.at)}</span>
                    </div>
                    <div className="text-[11px] text-navy-500 mt-0.5 inline-flex items-center gap-1">
                      <UserCheck size={10} /> {it.actor}
                    </div>
                    {it.body && (
                      <p className="text-xs text-navy-700 whitespace-pre-wrap mt-1 pl-2 border-l-2 border-navy-100">{it.body}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Alarms tab — live + acknowledged alarms with a per-alarm remark
// thread. Acknowledge & resolve each take a remark that is stored on
// the alarm row AND appended to the immutable note thread, so the full
// audit history is always visible.
// ────────────────────────────────────────────────────────────────────
function AlarmsTab({ wo, currentUser, busy, onSync, onAck, onResolve, onAddNote }) {
  const alarms = wo.alarms || [];
  const active = alarms.filter((a) => a.status === 'ACTIVE');
  const ackd   = alarms.filter((a) => a.status === 'ACKNOWLEDGED');
  // PLANNING is the level-below-admin overseer — it can address (acknowledge /
  // resolve / note) work-order alarms for every unit, alongside management.
  const isMgmt = ['ADMIN', 'FINANCE', 'ACCOUNTING', 'PLANNING'].includes(currentUser?.role);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-navy-800">
            {active.length} active · {ackd.length} acknowledged
          </p>
          <p className="text-[11px] text-navy-500">
            Alarms recompute automatically every 10 minutes. Every action below stores a remark in the audit trail.
          </p>
        </div>
        <Button variant="secondary" disabled={busy} onClick={onSync}>
          <RefreshCw size={14} className="inline mr-1" /> Recompute now
        </Button>
      </div>

      {alarms.length === 0 ? (
        <div className="p-6 text-center bg-green-50 border border-green-200 rounded-md">
          <CheckCircle2 className="mx-auto text-green-600 mb-2" size={28} />
          <p className="text-sm font-medium text-green-800">No live alarms — this WO is clean.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alarms.map((a) => (
            <AlarmCard
              key={a.id}
              wo={wo}
              alarm={a}
              canManage={isMgmt}
              busy={busy}
              onAck={(remark) => onAck(a.id, remark)}
              onResolve={(remark) => onResolve(a.id, remark)}
              onAddNote={(body) => onAddNote(a.id, body)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlarmCard({ wo, alarm, canManage, busy, onAck, onResolve, onAddNote }) {
  const sev = ALARM_SEVERITY_META[alarm.severity] || ALARM_SEVERITY_META.INFO;
  const SevIcon = sev.Icon;
  const [ackRemark, setAckRemark] = useState('');
  const [resolveRemark, setResolveRemark] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [expand, setExpand] = useState(true);
  const closure = alarm.closureId
    ? (wo.closures || []).find((c) => c.id === alarm.closureId)
    : null;

  const submitAck = () => {
    if (!ackRemark.trim()) { alert('A remark is required when acknowledging an alarm.'); return; }
    onAck(ackRemark.trim());
    setAckRemark('');
  };
  const submitResolve = () => {
    if (!resolveRemark.trim()) { alert('A remark is required when resolving an alarm.'); return; }
    onResolve(resolveRemark.trim());
    setResolveRemark('');
  };
  const submitNote = () => {
    if (!noteBody.trim()) return;
    onAddNote(noteBody.trim());
    setNoteBody('');
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${sev.chip}`}>
      <button
        type="button"
        onClick={() => setExpand((v) => !v)}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-white/40 transition"
      >
        <span className={`mt-0.5 w-2 h-2 rounded-full ${sev.dot} ${alarm.status === 'ACTIVE' ? 'animate-pulse' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <SevIcon size={14} />
            <span className="font-semibold text-sm">{alarm.title}</span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/60 border border-current/20">
              {alarm.type.replace(/_/g, ' ')}
            </span>
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${alarm.status === 'ACTIVE' ? 'bg-white text-current border border-current/30' : 'bg-current/20'}`}>
              {alarm.status}
            </span>
            {closure && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/60 border border-current/20">
                Lot #{closure.cycleNumber}
              </span>
            )}
          </div>
          {alarm.triggerContext && (
            <p className="text-[11px] text-current/80 mt-0.5">{alarm.triggerContext}</p>
          )}
          <p className="text-[10px] text-current/60 mt-0.5">
            Raised {formatDate(alarm.createdAt)}
            {alarm.acknowledgedAt && ` · ack'd ${formatDate(alarm.acknowledgedAt)}${alarm.acknowledgedBy ? ` by ${alarm.acknowledgedBy.name}` : ''}`}
          </p>
        </div>
        <ArrowDown size={14} className={`mt-1 transition-transform ${expand ? 'rotate-180' : ''}`} />
      </button>

      {expand && (
        <div className="px-3 pb-3 pt-1 bg-white/70 space-y-3">
          {/* Ack/resolve stored remarks */}
          {alarm.ackRemark && (
            <div className="text-[11px] p-2 rounded border border-amber-200 bg-amber-50">
              <span className="font-semibold text-amber-800">Ack remark:</span>{' '}
              <span className="text-amber-900">{alarm.ackRemark}</span>
            </div>
          )}
          {alarm.resolveRemark && (
            <div className="text-[11px] p-2 rounded border border-green-200 bg-green-50">
              <span className="font-semibold text-green-800">Resolve remark:</span>{' '}
              <span className="text-green-900">{alarm.resolveRemark}</span>
            </div>
          )}

          {/* Notes thread — every remark is captured here */}
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-navy-500 mb-1">
              Remark thread ({alarm.notes?.length || 0})
            </p>
            {alarm.notes?.length ? (
              <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {alarm.notes.map((n) => (
                  <li key={n.id} className={`text-[11px] p-2 rounded border ${n.kind === 'SYSTEM' ? 'bg-navy-50 border-navy-200' : n.kind === 'ACK' ? 'bg-amber-50 border-amber-200' : n.kind === 'RESOLVE' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center gap-1 text-[10px] text-navy-500 mb-0.5">
                      <UserCheck size={10} />
                      <span className="font-semibold">{n.author?.name || 'System'}</span>
                      <span>·</span>
                      <span>{formatDate(n.createdAt)}</span>
                      {n.kind && <span className="ml-1 px-1 rounded bg-navy-100 text-navy-600 text-[9px] uppercase">{n.kind}</span>}
                    </div>
                    <div className="text-navy-800 whitespace-pre-wrap">{n.body}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-navy-400 italic">No remarks yet.</p>
            )}
            <div className="flex gap-1.5 mt-2">
              <Input
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add a remark to this alarm…"
                className="flex-1"
              />
              <Button variant="secondary" disabled={busy || !noteBody.trim()} onClick={submitNote}>
                <FilePlus2 size={14} />
              </Button>
            </div>
          </div>

          {/* Ack + resolve actions */}
          {canManage && alarm.status === 'ACTIVE' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-current/10 pt-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 mb-1">Acknowledge</p>
                <Textarea
                  rows={2}
                  value={ackRemark}
                  onChange={(e) => setAckRemark(e.target.value)}
                  placeholder="Why are you acknowledging this? (required)"
                />
                <Button
                  className="mt-1.5 w-full bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={busy || !ackRemark.trim()}
                  onClick={submitAck}
                >
                  <Check size={14} className="inline mr-1" /> Acknowledge
                </Button>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold text-green-700 mb-1">Resolve</p>
                <Textarea
                  rows={2}
                  value={resolveRemark}
                  onChange={(e) => setResolveRemark(e.target.value)}
                  placeholder="Action taken to resolve this (required)"
                />
                <Button
                  className="mt-1.5 w-full bg-green-600 hover:bg-green-700 text-white"
                  disabled={busy || !resolveRemark.trim()}
                  onClick={submitResolve}
                >
                  <CheckCircle2 size={14} className="inline mr-1" /> Resolve
                </Button>
              </div>
            </div>
          )}
          {canManage && alarm.status === 'ACKNOWLEDGED' && (
            <div className="border-t border-current/10 pt-3">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-green-700 mb-1">Resolve</p>
              <Textarea
                rows={2}
                value={resolveRemark}
                onChange={(e) => setResolveRemark(e.target.value)}
                placeholder="Action taken to resolve this (required)"
              />
              <Button
                className="mt-1.5 bg-green-600 hover:bg-green-700 text-white"
                disabled={busy || !resolveRemark.trim()}
                onClick={submitResolve}
              >
                <CheckCircle2 size={14} className="inline mr-1" /> Resolve
              </Button>
            </div>
          )}
          {!canManage && alarm.status === 'ACTIVE' && (
            <p className="text-[11px] text-navy-500 italic border-t border-current/10 pt-2">
              Only Admin, Finance and Accounting can acknowledge or resolve alarms — you can still add remarks above.
            </p>
          )}
        </div>
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
  const hasItems = (wo.items || []).length > 0;
  const delivered = deliveredByItem(wo);
  // Per-item remaining = ordered − delivered across all prior lots.
  const itemRemaining = (it) => Math.max(0, it.quantity - (delivered[it.id] || 0));
  const lotsOpenLimit = wo.lotsExpected ? closures.length < wo.lotsExpected : true;
  const canStartCycle = canOpenCycle
    && remaining > 0
    && lotsOpenLimit
    && ['UNIT_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(wo.status);

  // Per-item lot qty keyed by itemId. openForm keeps note/date (+ legacy qty).
  const [lotQtys, setLotQtys] = useState({});
  const [openForm, setOpenForm] = useState({ deliveryQty: '', deliveryNote: '', deliveredAt: '' });
  const [lotFile, setLotFile] = useState(null);
  const setLotQty = (itemId, v) => setLotQtys((m) => ({ ...m, [itemId]: v }));

  // The per-item rows the manager actually filled in for this lot.
  const lotItemRows = (wo.items || [])
    .map((it) => ({ itemId: it.id, deliveryQty: Number(lotQtys[it.id]) }))
    .filter((r) => Number.isFinite(r.deliveryQty) && r.deliveryQty > 0);
  const lotItemsTotal = lotItemRows.reduce((s, r) => s + r.deliveryQty, 0);
  const canSubmitLot = lotFile && (hasItems ? lotItemRows.length > 0 : Number(openForm.deliveryQty) > 0);

  const submitOpen = (e) => {
    e.preventDefault();
    if (!canSubmitLot) return;
    const fd = new FormData();
    fd.append('file', lotFile);
    if (hasItems) {
      fd.append('items', JSON.stringify(lotItemRows));
    } else {
      fd.append('deliveryQty', openForm.deliveryQty);
    }
    if (openForm.deliveryNote) fd.append('deliveryNote', openForm.deliveryNote);
    if (openForm.deliveredAt) fd.append('deliveredAt', openForm.deliveredAt);
    onAction(() => api.post(`/work-orders/${wo.id}/closures`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }));
    setOpenForm({ deliveryQty: '', deliveryNote: '', deliveredAt: '' });
    setLotQtys({});
    setLotFile(null);
  };

  const lotsSent = closures.length;
  const lotsExpected = wo.lotsExpected || null;
  const nextLotNo = lotsSent + 1;
  const lotProgress = lotsExpected
    ? `Lot ${lotsSent} of ${lotsExpected} sent`
    : `${lotsSent} lot${lotsSent === 1 ? '' : 's'} sent`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2 text-sm">
        <div className="p-3 bg-navy-50 rounded-md">
          <p className="text-xs text-navy-500">WO Qty</p>
          <p className="font-bold text-navy-800">{wo.orderQuantity} {wo.orderUnit}</p>
        </div>
        <div className="p-3 bg-blue-50 rounded-md">
          <p className="text-xs text-blue-700">Delivered in lots</p>
          <p className="font-bold text-blue-800">{alreadyCovered} {wo.orderUnit}</p>
        </div>
        <div className="p-3 bg-yellow-50 rounded-md">
          <p className="text-xs text-yellow-700">Qty remaining</p>
          <p className="font-bold text-yellow-800">{remaining} {wo.orderUnit}</p>
        </div>
        <div className={`p-3 rounded-md ${lotsExpected && lotsSent >= lotsExpected ? 'bg-green-50' : 'bg-purple-50'}`}>
          <p className={`text-xs ${lotsExpected && lotsSent >= lotsExpected ? 'text-green-700' : 'text-purple-700'}`}>Lot progress</p>
          <p className={`font-bold ${lotsExpected && lotsSent >= lotsExpected ? 'text-green-800' : 'text-purple-800'}`}>{lotProgress}</p>
        </div>
      </div>

      {!showFinance && (
        <p className="text-[11px] text-navy-500 italic">
          Invoice and payment details are restricted to Finance, Accounts and Level-5 management.
        </p>
      )}

      {closures.length === 0 ? (
        <p className="text-sm text-navy-500">No lots sent yet.</p>
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
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">
            Work Done — Lot {nextLotNo}{lotsExpected ? ` of ${lotsExpected}` : ''}: enter the qty of each material going in this lot, upload the ONE lot report PDF, and it goes straight to QC
          </p>

          {hasItems ? (
            <div className="overflow-x-auto border border-navy-100 rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-navy-50 text-navy-600">
                  <tr>
                    <th className="text-left px-2 py-1.5 w-8">S.No</th>
                    <th className="text-left px-2 py-1.5">Description</th>
                    <th className="text-right px-2 py-1.5">Ordered</th>
                    <th className="text-right px-2 py-1.5">Remaining</th>
                    <th className="text-left px-2 py-1.5 w-32">This Lot Qty</th>
                    <th className="text-left px-2 py-1.5 w-20">UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {wo.items.map((it) => {
                    const rem = itemRemaining(it);
                    return (
                      <tr key={it.id} className="border-t border-navy-50">
                        <td className="px-2 py-1 text-navy-500 text-center">{it.lineNo}</td>
                        <td className="px-2 py-1 text-navy-800">{it.description}</td>
                        <td className="px-2 py-1 text-right">{it.quantity}</td>
                        <td className={`px-2 py-1 text-right ${rem > 0 ? 'text-yellow-700' : 'text-green-700'}`}>{rem}</td>
                        <td className="px-2 py-1">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            max={rem}
                            value={lotQtys[it.id] ?? ''}
                            onChange={(e) => setLotQty(it.id, e.target.value)}
                            disabled={rem <= 0}
                            placeholder={rem <= 0 ? 'Done' : '0'}
                          />
                        </td>
                        <td className="px-2 py-1 text-navy-600">{it.uom}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Input
              label={`Lot Qty * (max ${remaining})`}
              type="number"
              step="any"
              min="0.01"
              max={remaining}
              value={openForm.deliveryQty}
              onChange={(e) => setOpenForm({ ...openForm, deliveryQty: e.target.value })}
            />
          )}

          {hasItems && lotItemRows.length > 0 && (
            <p className="text-[11px] text-navy-600">
              This lot: <span className="font-semibold">{lotItemRows.length}</span> material{lotItemRows.length > 1 ? 's' : ''} · total <span className="font-semibold">{lotItemsTotal}</span> {wo.orderUnit}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              label="Work Done On"
              type="date"
              value={openForm.deliveredAt}
              onChange={(e) => setOpenForm({ ...openForm, deliveredAt: e.target.value })}
            />
            <Input
              label="Lot Details / Note"
              value={openForm.deliveryNote}
              onChange={(e) => setOpenForm({ ...openForm, deliveryNote: e.target.value })}
              placeholder={`e.g. Lot ${nextLotNo}${lotsExpected ? ` of ${lotsExpected}` : ''} details`}
            />
            <Input
              label="Lot Report PDF *"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setLotFile(e.target.files?.[0] || null)}
            />
          </div>
          <Button type="submit" disabled={busy || !canSubmitLot}>
            <Check size={12} className="mr-1" /> Work Done — Send Lot {nextLotNo} to QC
          </Button>
          {!lotFile && <p className="text-[11px] text-navy-500 italic">Upload exactly one lot report PDF to enable.</p>}
          {lotFile && hasItems && lotItemRows.length === 0 && (
            <p className="text-[11px] text-navy-500 italic">Enter a quantity for at least one material.</p>
          )}
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
  const showFinance = canSeeFinance(role);

  const meta = CYCLE_STAGE_META[cycle.stage] || { color: 'gray', label: cycle.stage };
  const docs = cycle.docs || [];

  const openHold = (cycle.holdRequests || []).find((h) => !h.resolvedAt);

  const [qcNote, setQcNote] = useState('');
  const [invSentForm, setInvSentForm] = useState({ invoiceNumber: '', invoiceDate: '', description: '' });
  const [dcSentForm, setDcSentForm] = useState({ deliveryChallanNumber: '' });
  const [payNote, setPayNote] = useState('');
  const [deliveryAckForm, setDeliveryAckForm] = useState({ note: '', signedUrl: '' });
  const [followupForm, setFollowupForm] = useState({ customerResponse: '', note: '' });
  const [holdItems, setHoldItems] = useState([{ docType: '', note: '' }]);
  const [holdReason, setHoldReason] = useState('');
  const [resubmitFile, setResubmitFile] = useState(null);
  const [resubmitNote, setResubmitNote] = useState('');

  // Finance-pending = QC approved (or legacy MGMT_APPROVED rows).
  const financePending = ['QC_VERIFIED', 'MGMT_APPROVED'].includes(cycle.stage);

  // 48h goods-ack countdown — only meaningful while INVOICE_SENT.
  const hoursLeft = cycle.slaDeadlineAt
    ? Math.round((new Date(cycle.slaDeadlineAt).getTime() - Date.now()) / (1000 * 60 * 60))
    : null;
  const breached = cycle.stage === 'INVOICE_SENT' && hoursLeft != null && hoursLeft <= 0;

  // 45-day payment countdown — day-by-day while DELIVERY_ACKNOWLEDGED.
  const paymentDaysLeft = cycle.paymentDueAt
    ? Math.ceil((new Date(cycle.paymentDueAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const paymentDelayed = cycle.stage === 'DELIVERY_ACKNOWLEDGED' && paymentDaysLeft != null && paymentDaysLeft < 0;
  const lastFollowup = (cycle.weeklyFollowups || []).slice(-1)[0] || null;
  const nextFollowupDueIn = lastFollowup
    ? Math.ceil((new Date(lastFollowup.contactedAt).getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24))
    : (cycle.deliveryAckAt
      ? Math.ceil((new Date(cycle.deliveryAckAt).getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24))
      : null);
  const followupDueNow = cycle.stage === 'DELIVERY_ACKNOWLEDGED' && nextFollowupDueIn != null && nextFollowupDueIn <= 0;

  const deleteDoc = (docId) => {
    if (!confirm('Delete this document?')) return;
    onAction(() => api.delete(`/work-orders/${wo.id}/closures/${cycle.id}/docs/${docId}`));
  };

  const qcVerify = () => {
    if (!qcNote.trim()) return;
    onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/qc-verify`, {
      note: qcNote.trim(),
    }));
  };
  const markInvoiceSent = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/mark-invoice-sent`, {
    invoiceNumber: invSentForm.invoiceNumber.trim() || null,
    invoiceDate: invSentForm.invoiceDate || null,
    description: invSentForm.description || null,
  }));
  const markDcSent = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/mark-dc-sent`, {
    deliveryChallanNumber: dcSentForm.deliveryChallanNumber.trim() || null,
  }));
  const paymentReceived = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/payment-received`, { note: payNote || null }));
  const deliveryAck = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/delivery-ack`, {
    note: deliveryAckForm.note || null,
    signedDocUrl: deliveryAckForm.signedUrl || null,
  }));
  const submitFollowup = () => onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/weekly-followup`, {
    customerResponse: followupForm.customerResponse || null,
    note: followupForm.note || null,
  }));
  const holdCycle = () => {
    const cleaned = holdItems.filter((h) => h.docType.trim());
    if (!cleaned.length) return;
    onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/hold`, {
      missingItems: cleaned,
      reason: holdReason || null,
    }));
  };
  const resubmitLot = () => {
    if (!resubmitFile) return;
    const fd = new FormData();
    fd.append('file', resubmitFile);
    if (resubmitNote) fd.append('note', resubmitNote);
    onAction(() => api.post(`/work-orders/${wo.id}/closures/${cycle.id}/resubmit`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }));
    setResubmitFile(null);
    setResubmitNote('');
  };

  return (
    <div className="border border-navy-100 rounded-lg p-4 space-y-3 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-navy-800">Lot #{cycle.cycleNumber}</span>
          <Badge color={meta.color}>{meta.label}</Badge>
          <span className="text-xs text-navy-500">{cycle.deliveryQty} {wo.orderUnit}</span>
          {cycle.deliveredAt && <span className="text-xs text-navy-400">Delivered {formatDate(cycle.deliveredAt)}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showFinance && cycle.stage === 'INVOICE_SENT' && hoursLeft != null && (
            <Badge color={breached ? 'red' : hoursLeft <= 12 ? 'yellow' : 'blue'}>
              {breached
                ? <><AlertTriangle size={11} className="inline mr-1" />48h breached — {Math.abs(hoursLeft)}h over, no goods ack</>
                : <><Timer size={11} className="inline mr-1" />{hoursLeft}h left of 48h for goods ack</>}
            </Badge>
          )}
          {showFinance && cycle.stage === 'DELIVERY_ACKNOWLEDGED' && paymentDaysLeft != null && (
            <Badge color={paymentDelayed ? 'red' : paymentDaysLeft <= 7 ? 'yellow' : 'green'}>
              {paymentDelayed
                ? <><AlertTriangle size={11} className="inline mr-1" />Payment delayed {Math.abs(paymentDaysLeft)} day(s)</>
                : <><Wallet size={11} className="inline mr-1" />{paymentDaysLeft} days left of 45</>}
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

      {/* Per-material breakdown of this lot */}
      {(cycle.items || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {cycle.items.map((ci) => (
            <span key={ci.id} className="text-[11px] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-navy-50 border border-navy-100 text-navy-700">
              <span className="text-navy-400">{ci.item?.lineNo}.</span>
              {ci.item?.description}
              <span className="font-semibold text-navy-800">{ci.deliveryQty} {ci.item?.uom}</span>
            </span>
          ))}
        </div>
      )}

      {cycle.deliveryNote && <p className="text-xs text-navy-600">{cycle.deliveryNote}</p>}

      {/* Audit chain */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-navy-600">
        <div>Work done by: {cycle.openedBy?.name || '—'}</div>
        {cycle.unitDocsSubmittedBy && <div>Lot report sent to QC: {cycle.unitDocsSubmittedBy.name} ({formatDate(cycle.unitDocsSubmittedAt)})</div>}
        {cycle.qcVerifiedBy && <div>QC approved: {cycle.qcVerifiedBy.name} ({formatDate(cycle.qcVerifiedAt)}) {cycle.qcCertificateNumber && <span className="text-navy-400 font-mono">[{cycle.qcCertificateNumber}]</span>}</div>}
        {showFinance && cycle.invoiceSentBy && <div>Invoice sent: {cycle.invoiceSentBy.name} ({formatDate(cycle.invoiceSentAt)}) {cycle.invoiceNumber && <span className="text-navy-400 font-mono">[{cycle.invoiceNumber}]</span>}</div>}
        {showFinance && cycle.dcSentBy && <div>DC sent: {cycle.dcSentBy.name} ({formatDate(cycle.dcSentAt)}) {cycle.deliveryChallanNumber && <span className="text-navy-400 font-mono">[{cycle.deliveryChallanNumber}]</span>}</div>}
        {showFinance && cycle.deliveryAckBy && <div>Goods ack received: {cycle.deliveryAckBy.name} ({formatDate(cycle.deliveryAckAt)})</div>}
        {showFinance && cycle.paymentDueAt && cycle.stage === 'DELIVERY_ACKNOWLEDGED' && <div>Payment due by: {formatDate(cycle.paymentDueAt)}</div>}
        {showFinance && cycle.paymentReceivedBy && <div>Payment received: {cycle.paymentReceivedBy.name} ({formatDate(cycle.paymentReceivedAt)})</div>}
      </div>

      {/* QC remark — permanent record, visible to all roles on the lot */}
      {cycle.qcRemark && (
        <div className="text-[11px] p-2 rounded border border-blue-200 bg-blue-50">
          <span className="font-semibold text-blue-800">QC remark:</span>{' '}
          <span className="text-blue-900 whitespace-pre-wrap">{cycle.qcRemark}</span>
        </div>
      )}

      {/* Open hold banner — unit finishes the pending work, uploads a fresh
          lot report and resends the lot to QC */}
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
            <div className="mt-2 space-y-2 border-t border-red-200 pt-2">
              <p className="font-semibold text-red-800">Finish the work, then upload the corrected lot report and resend to QC:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input label="New Lot Report PDF *" type="file" accept=".pdf,application/pdf" onChange={(e) => setResubmitFile(e.target.files?.[0] || null)} />
                <Input label="Note (what was fixed)" value={resubmitNote} onChange={(e) => setResubmitNote(e.target.value)} />
              </div>
              <Button disabled={busy || !resubmitFile} onClick={resubmitLot}>
                <Upload size={12} className="mr-1" /> Upload New Lot Report &amp; Resend to QC
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lot report(s) — one per submission; newest is the live one */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Lot Report{docs.length === 1 ? '' : 's'} ({docs.length})</p>
        </div>
        {docs.length === 0 ? (
          <p className="text-xs text-navy-400">No lot report uploaded.</p>
        ) : (
          <ul className="text-xs space-y-1">
            {docs.map((d, i) => (
              <li key={d.id} className="flex items-center justify-between border border-navy-100 rounded px-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText size={11} className="text-navy-500 flex-shrink-0" />
                  <span className="font-mono text-[10px] text-navy-500 flex-shrink-0">{DOC_TYPE_LABELS[d.docType] || d.docType}</span>
                  {i === docs.length - 1 && docs.length > 1 && <span className="text-[10px] text-green-700 flex-shrink-0">(latest)</span>}
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline truncate">{d.fileName}</a>
                  <span className="text-navy-400 flex-shrink-0">· {d.uploadedBy?.name || '—'} · {formatDate(d.uploadedAt)}</span>
                </div>
                {(d.uploadedById === currentUser?.id || isAdmin) && cycle.stage === 'UNIT_DOCS_PENDING' && (
                  <button onClick={() => deleteDoc(d.id)} className="text-red-500 hover:text-red-700 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Stage-specific actions */}
      {cycle.stage === 'UNIT_DOCS_PENDING' && (isUnitManager || isAdmin) && !isQc && (
        <p className="text-[11px] text-navy-500 italic border-t pt-2">
          Lot report is with QC for verification. QC will approve with a remark or send the lot back on hold.
        </p>
      )}

      {cycle.stage === 'UNIT_DOCS_PENDING' && cycle.unitDocsSubmittedAt && (isQc || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">QC Verification — remark is mandatory</p>
          <Textarea
            label="QC Remark *"
            rows={2}
            value={qcNote}
            onChange={(e) => setQcNote(e.target.value)}
            placeholder="Verification findings — saved permanently on this lot"
          />
          <div className="flex gap-2">
            <Button onClick={qcVerify} disabled={busy || !qcNote.trim()}>
              <FileCheck2 size={12} className="mr-1" /> Approve &amp; Forward to Finance
            </Button>
            <HoldControls items={holdItems} setItems={setHoldItems} reason={holdReason} setReason={setHoldReason} onSubmit={holdCycle} busy={busy} />
          </div>
          {!qcNote.trim() && <p className="text-[11px] text-navy-500 italic">Write your remark to enable approval.</p>}
        </div>
      )}

      {financePending && (isFinance || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">
            Finance Dispatch — attach the physical invoice &amp; delivery challan to the material (no upload), then click each button
          </p>
          <p className="text-[11px] text-navy-500">
            The 48-hour goods-ack timer starts automatically the moment BOTH buttons are clicked.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Invoice Sent */}
            <div className={`p-3 rounded border ${cycle.invoiceSentAt ? 'bg-green-50 border-green-300' : 'bg-white border-navy-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-navy-800 inline-flex items-center gap-1"><Receipt size={13} /> Invoice</span>
                {cycle.invoiceSentAt && <Badge color="green"><Check size={11} className="inline mr-1" />Sent {formatDate(cycle.invoiceSentAt)}</Badge>}
              </div>
              {cycle.invoiceSentAt ? (
                cycle.invoiceNumber && <p className="text-[11px] font-mono text-navy-500">#{cycle.invoiceNumber}</p>
              ) : (
                <div className="space-y-2">
                  <Input label="Invoice No (optional)" value={invSentForm.invoiceNumber} onChange={(e) => setInvSentForm({ ...invSentForm, invoiceNumber: e.target.value })} placeholder="e.g. INV/26-27/0042" />
                  <Input label="Invoice Date" type="date" value={invSentForm.invoiceDate} onChange={(e) => setInvSentForm({ ...invSentForm, invoiceDate: e.target.value })} />
                  <Button onClick={markInvoiceSent} disabled={busy} className="w-full">
                    <Receipt size={12} className="mr-1" /> Invoice Sent
                  </Button>
                </div>
              )}
            </div>
            {/* DC Sent */}
            <div className={`p-3 rounded border ${cycle.dcSentAt ? 'bg-green-50 border-green-300' : 'bg-white border-navy-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-navy-800 inline-flex items-center gap-1"><Truck size={13} /> Delivery Challan</span>
                {cycle.dcSentAt && <Badge color="green"><Check size={11} className="inline mr-1" />Sent {formatDate(cycle.dcSentAt)}</Badge>}
              </div>
              {cycle.dcSentAt ? (
                cycle.deliveryChallanNumber && <p className="text-[11px] font-mono text-navy-500">#{cycle.deliveryChallanNumber}</p>
              ) : (
                <div className="space-y-2">
                  <Input label="DC No (optional)" value={dcSentForm.deliveryChallanNumber} onChange={(e) => setDcSentForm({ deliveryChallanNumber: e.target.value })} placeholder="e.g. DC/26-27/0042" />
                  <Button onClick={markDcSent} disabled={busy} className="w-full">
                    <Truck size={12} className="mr-1" /> DC Sent
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {cycle.stage === 'INVOICE_SENT' && (isFinance || isAdmin) && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Goods Acknowledgement — 48h timer running</p>
          <p className="text-[11px] text-navy-500">
            The driver must come back with the customer-signed receipt within 48 hours. When it's in your hand, click the button — the timer stops and Accounts' 45-day payment countdown starts.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input label="Signed receipt URL (optional)" value={deliveryAckForm.signedUrl} onChange={(e) => setDeliveryAckForm({ ...deliveryAckForm, signedUrl: e.target.value })} />
            <Input label="Ack note" value={deliveryAckForm.note} onChange={(e) => setDeliveryAckForm({ ...deliveryAckForm, note: e.target.value })} placeholder="Who signed, when the driver returned, etc." />
          </div>
          <Button onClick={deliveryAck} disabled={busy}>
            <UserCheck size={12} className="mr-1" /> Goods Ack Received — Stop 48h Timer, Start 45-day Window
          </Button>
        </div>
      )}

      {cycle.stage === 'INVOICE_SENT' && isAccounting && (
        <p className="text-[11px] text-navy-500 italic border-t pt-2">
          Awaiting Finance's goods acknowledgement before the 45-day payment countdown opens.
        </p>
      )}

      {cycle.stage === 'DELIVERY_ACKNOWLEDGED' && (
        <div className="border-t pt-3 space-y-3">
          {/* 45-day countdown — moves day by day (45 → 44 → 43 …) */}
          {showFinance && paymentDaysLeft != null && (
            <div className={`p-3 rounded-lg border text-center ${paymentDelayed ? 'bg-red-50 border-red-300' : paymentDaysLeft <= 7 ? 'bg-yellow-50 border-yellow-300' : 'bg-purple-50 border-purple-200'}`}>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-navy-500">45-day Payment Countdown</p>
              <p className={`text-2xl font-bold ${paymentDelayed ? 'text-red-700' : paymentDaysLeft <= 7 ? 'text-yellow-700' : 'text-purple-700'}`}>
                {paymentDelayed ? `${Math.abs(paymentDaysLeft)} day(s) OVERDUE` : `${paymentDaysLeft} days left`}
              </p>
              <p className="text-[11px] text-navy-500">Due by {formatDate(cycle.paymentDueAt)} · started at goods ack ({formatDate(cycle.deliveryAckAt)})</p>
            </div>
          )}

          {/* Weekly incoming-money status update (Accounts) */}
          {(isAccounting || isAdmin) && (
            <div className={`p-3 rounded border ${followupDueNow ? 'bg-yellow-50 border-yellow-300 animate-pulse' : 'bg-navy-50 border-navy-200'}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider font-semibold text-navy-700">
                  Weekly Incoming-Money Status Update
                  {followupDueNow && <span className="ml-2 text-red-700">· DUE NOW</span>}
                </p>
                {nextFollowupDueIn != null && !followupDueNow && (
                  <span className="text-[11px] text-navy-500">Next due in {nextFollowupDueIn}d</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input label="Money status / customer response" value={followupForm.customerResponse} onChange={(e) => setFollowupForm({ ...followupForm, customerResponse: e.target.value })} placeholder="e.g. Payment in process, expected next week" />
                <Input label="Internal note" value={followupForm.note} onChange={(e) => setFollowupForm({ ...followupForm, note: e.target.value })} />
              </div>
              <Button
                onClick={() => { submitFollowup(); setFollowupForm({ customerResponse: '', note: '' }); }}
                disabled={busy}
                className="mt-2"
              >
                <BellRing size={12} className="mr-1" /> Log This Week's Status
              </Button>
            </div>
          )}

          {/* Weekly status history — every update saved */}
          {(cycle.weeklyFollowups || []).length > 0 && (
            <div className="text-xs">
              <p className="uppercase tracking-wider font-semibold text-navy-500 mb-1">Weekly status history</p>
              <ul className="space-y-1">
                {cycle.weeklyFollowups.map((f) => (
                  <li key={f.id} className="border border-navy-100 rounded px-2 py-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-navy-700">Week {f.weekNumber} · {f.contactedBy?.name || '—'}</span>
                      <span className="text-navy-400">{formatDate(f.contactedAt)}</span>
                    </div>
                    {f.customerResponse && <p className="text-navy-600 mt-1">Status: {f.customerResponse}</p>}
                    {f.note && <p className="text-navy-500">Note: {f.note}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Payment-received (Accounts) */}
          {(isAccounting || isAdmin) && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs uppercase tracking-wider font-semibold text-navy-500">Confirm Payment Received</p>
              <Input label="Payment note" value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="UTR / payment reference" />
              <Button onClick={paymentReceived} disabled={busy}>
                <Check size={12} className="mr-1" /> Payment Received — Close Lot
              </Button>
              <p className="text-[11px] text-navy-500 italic">
                If this is the final lot and the full quantity is covered, the whole Work Order closes automatically.
              </p>
            </div>
          )}
        </div>
      )}

      {cycle.stage === 'PAYMENT_RECEIVED' && (
        <div className="border-t pt-2">
          <Badge color="green"><Check size={11} className="inline mr-1" />Lot closed — payment received</Badge>
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
    title: '1. Supply Chain Fills the Work Order',
    who: 'Supply Chain (or Admin)',
    what: 'Fill the Work Order form (same fields as the printed WORK ORDER format — customer, SO number/date, quantity, terms & scope, PDC date, delivery clause, inspection agency, QAP, tooling, FIM, packing, transport, site, coordinator) and assign the unit manager who will execute it. The Bank Guarantee date auto-fills as PDC + 2 months — you can edit it.',
    statusBefore: '—',
    statusAfter: 'PENDING_ADMIN',
    uploads: ['All WO form fields', 'Unit assignment (required)', 'BG / Insurance details (BG date auto = PDC + 2 months, editable)'],
    downloads: ['Work Order PDF — printable from the WO row'],
    color: 'from-sky-500 to-blue-600',
    ring: 'ring-sky-200',
  },
  {
    icon: ShieldCheck,
    title: '2. Admin Verifies the Whole Thing',
    who: 'Admin',
    what: 'Admin opens the WO, checks every field, and can CHANGE the unit manager assignment if needed. Then clicks Accept — the WO goes to the assigned unit. Admin can also reject it.',
    statusBefore: 'PENDING_ADMIN',
    statusAfter: 'ADMIN_ACCEPTED  (or REJECTED)',
    uploads: ['Acceptance note (optional)', 'Unit change (optional)'],
    downloads: ['—'],
    color: 'from-blue-500 to-indigo-600',
    ring: 'ring-blue-200',
  },
  {
    icon: UserCheck,
    title: '3. Unit Manager Accepts or Rejects',
    who: 'Manager of the assigned unit',
    what: 'The unit manager either Accepts (work starts) or Rejects (WO goes ON_HOLD). When on hold, the Admin/Supply Chain changes the unit — or keeps the same unit — and sends it again. The next manager then accepts and starts the work.',
    statusBefore: 'ADMIN_ACCEPTED',
    statusAfter: 'UNIT_ACCEPTED  (or ON_HOLD if rejected → reassigned → ADMIN_ACCEPTED again)',
    uploads: ['Acceptance / rejection note'],
    downloads: ['—'],
    color: 'from-indigo-500 to-violet-600',
    ring: 'ring-indigo-200',
  },
  {
    icon: Upload,
    title: '4. Work Done — Lot by Lot: One Lot Report PDF → QC',
    who: 'Manager (or Admin)',
    what: 'The work goes out in lots (e.g. 2 lots). When a lot\'s work is done, the manager clicks "Work Done", fills the lot details (quantity, date, note) and uploads ONE lot report PDF. That single click sends the lot straight to QC. The final lot is the final closure of the work order.',
    statusBefore: 'WO is UNIT_ACCEPTED / IN_PROGRESS',
    statusAfter: 'Lot created at UNIT_DOCS_PENDING — already with QC',
    uploads: ['Lot quantity + details', 'ONE Lot Report PDF (required)'],
    downloads: ['The lot report is re-downloadable from the lot card'],
    color: 'from-violet-500 to-purple-600',
    ring: 'ring-violet-200',
  },
  {
    icon: FileCheck2,
    title: '5. QC Verifies — Remark Mandatory — Forwards to Finance (or Holds)',
    who: 'QC (or Admin)',
    what: 'QC checks the lot report and the work. To approve, QC MUST write a remark — it is saved on the lot forever — then the lot goes straight to Finance (no management step). If something is wrong, QC puts the lot ON HOLD with a missing-items checklist; the unit finishes the work, uploads a fresh lot report and resends it to QC.',
    statusBefore: 'UNIT_DOCS_PENDING',
    statusAfter: 'QC_VERIFIED  (or ON_HOLD → resubmit → UNIT_DOCS_PENDING again)',
    uploads: ['QC remark (mandatory)'],
    downloads: ['QC Verification Certificate PDF — "QC Cert" button on the lot card'],
    color: 'from-amber-500 to-orange-500',
    ring: 'ring-amber-200',
  },
  {
    icon: Banknote,
    title: '6. Finance Clicks "Invoice Sent" + "DC Sent" → 48h Timer Starts',
    who: 'Finance (or Admin)',
    what: 'Finance attaches the physical invoice and delivery challan WITH the material going to the customer (nothing is uploaded into the ERP — numbers are optional records). Finance clicks the "Invoice Sent" button and the "DC Sent" button as each goes out. The moment BOTH are clicked, the 48-hour goods-acknowledgement timer starts.',
    statusBefore: 'QC_VERIFIED',
    statusAfter: 'INVOICE_SENT  (48-hour goods-ack clock running)',
    uploads: ['Invoice number / date (optional)', 'DC number (optional)'],
    downloads: ['Invoice PDF — "Invoice" button on the lot card (Finance / Accounting / Admin only)'],
    color: 'from-yellow-500 to-amber-600',
    ring: 'ring-yellow-200',
  },
  {
    icon: Truck,
    title: '7. Goods Ack Received → 48h Timer Stops, 45-day Countdown Starts',
    who: 'Finance (or Admin)',
    what: 'In real life the driver comes back with the customer-signed receipt that the goods were received. Before the 48 hours run out, Finance clicks "Goods Ack Received" — the 48h timer ends and the Accounts function begins: a 45-day payment countdown.',
    statusBefore: 'INVOICE_SENT',
    statusAfter: 'DELIVERY_ACKNOWLEDGED  (45-day payment countdown starts)',
    uploads: ['Signed receipt URL (optional)', 'Ack note'],
    downloads: ['—'],
    color: 'from-amber-500 to-orange-500',
    ring: 'ring-amber-200',
  },
  {
    icon: Wallet,
    title: '8. Accounts: 45-day Countdown + Weekly Money-Status Updates',
    who: 'Accounting (or Admin)',
    what: 'The lot card shows the countdown moving day by day — 45, 44, 43… Every week Accounts must log the status of the incoming money (flashing reminder until they do). Every weekly status is saved. When the money lands, Accounts clicks "Payment Received" — the lot closes.',
    statusBefore: 'DELIVERY_ACKNOWLEDGED',
    statusAfter: 'PAYMENT_RECEIVED  (lot closed)',
    uploads: ['Weekly money-status updates', 'Payment note (UTR / reference)'],
    downloads: ['Weekly status history on the lot card'],
    color: 'from-lime-500 to-green-600',
    ring: 'ring-lime-200',
  },
  {
    icon: CheckCircle2,
    title: '9. Final Lot Paid → Work Order Auto-Closes',
    who: 'System (automatic)',
    what: 'The remaining lots repeat the same chain: manager → QC → finance → goods ack → accounts. When the FINAL lot\'s payment is received and the full order quantity is covered, the whole Work Order closes automatically. Admin/Supply Chain can still short-close manually if ever needed.',
    statusBefore: 'All lots PAYMENT_RECEIVED',
    statusAfter: 'CLOSED',
    uploads: ['—'],
    downloads: ['Final WO PDF reflects CLOSED status'],
    color: 'from-navy-600 to-slate-800',
    ring: 'ring-slate-200',
  },
];

const WO_HOLD_LOOP = {
  title: 'If something is wrong: the On-Hold loop',
  who: 'QC (or Admin) can put a lot on hold during verification',
  body: [
    'If QC finds the work or the lot report is not right, they click "Send Back on Hold" and write a checklist of what is missing.',
    'The lot moves to ON_HOLD and the unit Manager gets notified.',
    'The Manager finishes the pending work, uploads a FRESH lot report PDF and clicks "Resend to QC". The lot goes back to QC for a new verification with a new remark.',
    'A lot that has already reached INVOICE_SENT cannot be put on hold — from there it is handled by Finance / Accounts directly.',
  ],
};

const WO_TIMERS = [
  {
    icon: Timer,
    title: '48-hour Goods-Ack Timer',
    color: 'from-yellow-500 to-amber-600',
    rows: [
      ['Starts when', 'Finance has clicked BOTH "Invoice Sent" and "DC Sent" (physical docs travel with the material).'],
      ['Ends when',   'Finance clicks "Goods Ack Received" (the driver returned with the customer-signed receipt).'],
      ['Where to see it', 'Each INVOICE_SENT lot shows a coloured badge: blue = plenty of time, yellow = under 12h left, red = breached.'],
      ['If breached',  'The lot is marked SLA Breached. Management, Finance and Accounting all get an escalation notification automatically.'],
    ],
  },
  {
    icon: Wallet,
    title: '45-day Payment Countdown (Accounts)',
    color: 'from-amber-500 to-orange-600',
    rows: [
      ['Starts when', 'Finance clicks "Goods Ack Received" — lot moves to DELIVERY_ACKNOWLEDGED.'],
      ['How it shows', 'Day-by-day countdown on the lot card: 45 days → 44 → 43 … red once expired.'],
      ['Ends when',   'Accounts clicks "Payment Received" — lot moves to PAYMENT_RECEIVED. Final lot paid = WO auto-closed.'],
      ['If breached',  'Lot is flagged "Payment Delayed". Management, Finance, Accounting and Admin all get a notification.'],
    ],
  },
  {
    icon: BellRing,
    title: 'Weekly Incoming-Money Status (Accounts)',
    color: 'from-pink-500 to-rose-600',
    rows: [
      ['What it does', 'Every 7 days while a lot is in the 45-day window, a flashing reminder appears for Accounting + Admin.'],
      ['How to clear it', 'Open the lot, write the status of the incoming money (what the customer said), and log it. The reminder re-arms 7 days later.'],
      ['Where it is saved', 'Every weekly update is stored permanently in the lot\'s weekly status history.'],
      ['When it stops', 'As soon as Accounts clicks "Payment Received".'],
    ],
  },
  {
    icon: AlertTriangle,
    title: '3-month PDC Alert — BOTH Admin + Unit Manager',
    color: 'from-red-500 to-rose-700',
    rows: [
      ['What it does', 'When the effective PDC date is 90 days (3 months) away, a red blinking alert appears on the WO for the Admin AND the assigned unit manager.'],
      ['How to clear it', 'EACH of them must write their own status remark — extension needed? any issue? anything else? The alert keeps blinking until BOTH remarks are filed.'],
      ['Where it is saved', 'Both remarks are saved permanently on the WO (visible in the header), alongside all alarm remarks in the Alarms tab.'],
    ],
  },
  {
    icon: RefreshCw,
    title: 'Background jobs that run on their own',
    color: 'from-slate-500 to-gray-700',
    rows: [
      ['Hourly (:05)',  'INVOICE_SENT lots — 24-hour reminder if due.'],
      ['Every 30 min',  '48-hour goods-ack breach check.'],
      ['Every 30 min (:15/:45)', '45-day payment-window breach check.'],
      ['Hourly (:20)',  'Weekly money-status nudge for lots in the 45-day window.'],
      ['Daily (09:10)', '3-month PDC alert notification (Admin + Managers).'],
      ['Every 10 min',  'Work-order alarms recompute (PDC near/overdue, lot stuck at QC, lot on hold, SLA breach, payment due/overdue, BG expiring).'],
    ],
  },
];

const WO_FILE_INDEX = {
  uploads: [
    { what: 'Work Order form (all WORK ORDER.docx fields) + unit assignment', where: '"Log Work Order" button on this page (Supply Chain / Admin)' },
    { what: 'Bank Guarantee entry (number + valid-upto)', where: 'WO detail → BG / Insurance tab → "Add BG" (Supply Chain / Admin only)' },
    { what: 'Insurance entry (number + valid-upto)',     where: 'WO detail → BG / Insurance tab → "Add Insurance" (Supply Chain / Admin only)' },
    { what: 'ONE Lot Report PDF per lot (work done)',    where: 'WO detail → Lots tab → "Work Done" form (Manager)' },
    { what: 'Fresh Lot Report PDF after a hold',         where: 'Lot card (ON_HOLD) → "Upload New Lot Report & Resend to QC" (Manager)' },
    { what: 'QC remark (mandatory)',                     where: 'Lot card → "QC Verification" panel (QC / Admin)' },
    { what: 'Invoice / DC numbers (optional, physical docs travel with material)', where: 'Lot card → "Invoice Sent" + "DC Sent" buttons (Finance / Admin)' },
    { what: 'Goods ack note + signed receipt URL',       where: 'Lot card (INVOICE_SENT) → "Goods Ack Received" (Finance / Admin)' },
    { what: 'Weekly incoming-money status',              where: 'Lot card (45-day window) → flashing weekly panel (Accounting / Admin)' },
    { what: 'Payment received note (UTR / cheque #)',    where: 'Lot card (45-day window) → "Payment Received" (Accounting / Admin)' },
    { what: 'PDC extension request (BG must extend too)', where: 'WO detail → Extensions tab → "Add Extension" (Supply Chain / Admin only)' },
    { what: '3-month PDC status remark (Admin AND Unit Manager)', where: 'WO header → red blinking PDC button (each files their own remark)' },
  ],
  downloads: [
    { what: 'Work Order PDF',                where: 'WO detail header → "Download PDF"' },
    { what: 'QC Verification Certificate',   where: 'Lot card → "QC Cert" button' },
    { what: 'Customer Invoice PDF',          where: 'Lot card → "Invoice" button (Finance / Accounting / Admin only)' },
    { what: 'Hold Checklist PDF',            where: 'Lot card → "Hold Checklist" button (only when a hold is open)' },
    { what: 'Weekly money-status history',   where: 'Lot card (45-day window) → "Weekly status history" list' },
    { what: 'Any uploaded lot report',       where: 'Lot card → lot reports list → click filename' },
  ],
};

function WorkOrderWorkflowModal({ onClose }) {
  return (
    <Modal isOpen onClose={onClose} title="Work Order Workflow & Documents" size="full">
      <div className="space-y-6">
        <p className="text-sm text-gray-700 leading-relaxed">
          This is the full journey of a Work Order, written in plain English. Each step lists
          <strong> who acts</strong>, <strong>what they need to upload</strong>, <strong>what they can download</strong>,
          and the status the WO (or lot) is in before and after. The timers
          (48-hour goods-ack, 45-day payment countdown, weekly money-status, 3-month PDC alert) and the
          on-hold loop are explained at the bottom.
        </p>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900 leading-relaxed">
          <p className="font-semibold mb-1">Quick rules to remember</p>
          <ul className="list-disc list-inside space-y-1 text-[13px]">
            <li><strong>Supply Chain</strong> fills the Work Order and assigns the unit manager; <strong>Admin</strong> verifies everything and may change the unit before accepting.</li>
            <li><strong>Bank Guarantee date</strong> auto-fills as <strong>PDC date + 2 months</strong> and stays editable. PDC / BG / Insurance are Supply Chain (Admin override).</li>
            <li>Work goes out in <strong>lots</strong>. Each lot = one lot-report PDF → QC → Finance → goods ack → Accounts. The <strong>final lot</strong> is the final closure of the WO.</li>
            <li><strong>QC remark is mandatory</strong> to approve a lot. QC can instead put a lot on hold; the unit re-uploads the lot report and resends to QC.</li>
            <li>The <strong>48-hour goods-ack timer</strong> starts when Finance has clicked BOTH "Invoice Sent" and "DC Sent", and stops at "Goods Ack Received".</li>
            <li>The <strong>45-day payment countdown</strong> starts at goods ack and shows day-by-day. Accounts log a weekly money-status update and confirm payment.</li>
            <li>The <strong>3-month PDC alert</strong> needs BOTH the Admin AND the unit manager to each file their own status remark before it stops.</li>
            <li>When the <strong>final lot is paid</strong> and full quantity is covered, the Work Order <strong>closes automatically</strong>.</li>
          </ul>
        </div>

        {/* MAIN CHAIN */}
        <section>
          <h2 className="text-xs uppercase tracking-wider font-bold text-navy-700 mb-3">The 9-step journey</h2>
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
          <h2 className="text-xs uppercase tracking-wider font-bold text-navy-700 mb-3">How the timers & alerts work</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
