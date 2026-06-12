import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle, ShieldCheck, ShieldAlert, ArrowRight } from 'lucide-react';
import api from '../../api/axios';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import SectionHeader from './SectionHeader';
import { formatDate } from '../../utils/formatters';

// PDC (delivery commitment) radar for dashboards. Read-only: pulls the same
// /work-orders list the Work Orders page uses and buckets open WOs by how
// close their effective PDC is. The server already computes daysToPdc,
// overdue and the 3-month ack-pending flags — this just surfaces them.
const OPEN_STATUSES = ['PENDING_ADMIN', 'ADMIN_ACCEPTED', 'UNIT_ACCEPTED', 'IN_PROGRESS', 'ON_HOLD'];

const bucketOf = (wo) => {
  if (wo.overdue) return 'overdue';
  if (wo.daysToPdc == null) return null;
  if (wo.daysToPdc <= 30) return 'critical';
  if (wo.daysToPdc <= 90) return 'warning';
  return null;
};

const BUCKET_META = {
  overdue:  { rank: 0, badge: 'red',    label: (w) => `${Math.abs(w.daysToPdc ?? 0)}d overdue` },
  critical: { rank: 1, badge: 'red',    label: (w) => `${w.daysToPdc}d left` },
  warning:  { rank: 2, badge: 'amber',  label: (w) => `${w.daysToPdc}d left` },
};

function DueBar({ daysToPdc, overdue }) {
  // 90-day window shrinking toward zero; overdue pegs full red.
  const pct = overdue ? 100 : Math.max(4, Math.round(((90 - Math.min(daysToPdc, 90)) / 90) * 100));
  const tone = overdue || daysToPdc <= 14 ? 'bg-red-500' : daysToPdc <= 30 ? 'bg-orange-500' : 'bg-amber-400';
  return (
    <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden" title={overdue ? 'PDC passed' : `${daysToPdc} days to PDC`}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function PdcStatusBoard({ showAllClear = true }) {
  const navigate = useNavigate();
  const [workOrders, setWorkOrders] = useState(null); // null = loading/failed silently

  useEffect(() => {
    let cancelled = false;
    api.get('/work-orders', { params: { limit: 200 } })
      .then(({ data }) => { if (!cancelled) setWorkOrders(data.workOrders || []); })
      .catch(() => { if (!cancelled) setWorkOrders([]); });
    return () => { cancelled = true; };
  }, []);

  if (workOrders === null) return null;

  const open = workOrders.filter((w) => OPEN_STATUSES.includes(w.status));
  const tracked = open
    .map((w) => ({ ...w, bucket: bucketOf(w) }))
    .filter((w) => w.bucket)
    .sort((a, b) => BUCKET_META[a.bucket].rank - BUCKET_META[b.bucket].rank || (a.daysToPdc ?? 0) - (b.daysToPdc ?? 0));

  const overdueCount = tracked.filter((w) => w.bucket === 'overdue').length;
  const criticalCount = tracked.filter((w) => w.bucket === 'critical').length;
  const warningCount = tracked.filter((w) => w.bucket === 'warning').length;
  const ackPending = tracked.filter((w) => w.pdc3MonthAlertActive).length;

  if (tracked.length === 0) {
    if (!showAllClear) return null;
    return (
      <Card>
        <SectionHeader
          icon={CalendarClock}
          tone="green"
          title="PDC Radar"
          subtitle="Work-order delivery commitments — overdue and ≤ 90 day window"
          actions={<Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')}>Work Orders</Button>}
        />
        <div className="flex items-center gap-3 py-4">
          <div className="w-11 h-11 rounded-full bg-green-50 ring-1 ring-green-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">No PDC deadlines at risk</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {open.length === 0 ? 'No open work orders right now.' : `All ${open.length} open work order${open.length === 1 ? '' : 's'} are more than 90 days from their PDC.`}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {(overdueCount > 0 || criticalCount > 0) && (
        <div className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 via-rose-50 to-orange-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative p-2 rounded-xl bg-red-100 text-red-700 ring-1 ring-red-200 flex-shrink-0">
              <AlertTriangle size={18} />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" aria-hidden="true" />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-900">
                {overdueCount > 0 && `${overdueCount} work order${overdueCount === 1 ? '' : 's'} past PDC`}
                {overdueCount > 0 && criticalCount > 0 && ' · '}
                {criticalCount > 0 && `${criticalCount} within 30 days`}
              </p>
              <p className="text-xs text-red-700/80 mt-0.5">
                Delivery commitments need action{ackPending > 0 ? ` — ${ackPending} still awaiting the 3-month status remark` : ''}.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => navigate('/work-orders')}>
            Review now <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
      )}

      <Card>
        <SectionHeader
          icon={CalendarClock}
          tone={overdueCount > 0 ? 'red' : criticalCount > 0 ? 'amber' : 'yellow'}
          title="PDC Radar"
          count={tracked.length}
          subtitle="Delivery commitments overdue or due within 90 days, most urgent first"
          actions={<Button variant="secondary" size="sm" onClick={() => navigate('/work-orders')}>Work Orders</Button>}
        />

        <div className="flex flex-wrap gap-2 mb-4">
          <Badge color="red">{overdueCount} overdue</Badge>
          <Badge color="red">{criticalCount} due ≤ 30d</Badge>
          <Badge color="amber">{warningCount} due ≤ 90d</Badge>
          {ackPending > 0 ? (
            <Badge color="orange">{ackPending} remark{ackPending === 1 ? '' : 's'} pending</Badge>
          ) : (
            <Badge color="green">remarks filed</Badge>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50/60">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">WO #</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Unit</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">PDC</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Countdown</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Delivered</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">3-Month Remark</th>
              </tr>
            </thead>
            <tbody>
              {tracked.slice(0, 10).map((w, i) => {
                const meta = BUCKET_META[w.bucket];
                const deliveredPct = w.orderQuantity > 0 ? Math.round((w.deliveredQty / w.orderQuantity) * 100) : 0;
                return (
                  <tr
                    key={w.id}
                    className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50 cursor-pointer`}
                    onClick={() => navigate('/work-orders')}
                  >
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-navy-700">{w.workOrderNumber}</td>
                    <td className="px-3 py-2.5 text-gray-600 max-w-[180px] truncate">{w.customerName || '—'}</td>
                    <td className="px-3 py-2.5">
                      {w.assignedUnit
                        ? <Badge color="blue">{w.assignedUnit.code || w.assignedUnit.name}</Badge>
                        : w.assignedUnitName
                          ? <Badge color="yellow">{w.assignedUnitName}</Badge>
                          : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                      {formatDate(w.effectivePdcDate)}
                      {w.extensions?.length > 0 && <span className="text-gray-400 ml-1">(ext {w.extensions.length})</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge color={meta.badge}>{meta.label(w)}</Badge>
                        <DueBar daysToPdc={w.daysToPdc} overdue={w.overdue} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 tnum whitespace-nowrap">
                      {w.deliveredQty}/{w.orderQuantity} <span className="text-gray-400">({deliveredPct}%)</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {w.pdc3MonthAlertActive ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                          <ShieldAlert size={12} />
                          {w.pdc3MonthAdminAckPending && w.pdc3MonthMgrAckPending
                            ? 'Admin + Unit pending'
                            : w.pdc3MonthAdminAckPending ? 'Admin pending' : 'Unit pending'}
                        </span>
                      ) : w.bucket === 'overdue' || w.daysToPdc <= 90 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-green-700">
                          <ShieldCheck size={12} /> Filed
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {tracked.length > 10 && (
            <p className="text-xs text-gray-400 mt-2 text-center">+ {tracked.length - 10} more on the Work Orders page</p>
          )}
        </div>
      </Card>
    </div>
  );
}
