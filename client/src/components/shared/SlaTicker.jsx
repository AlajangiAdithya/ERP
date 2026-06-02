import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Timer, Bell } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const TICKER_ROLES = ['ADMIN', 'FINANCE', 'QC', 'ACCOUNTING'];
const POLL_MS = 30 * 1000;

const STAGE_LABEL = {
  CUSTOMER_CONTACTED: 'pending customer payment',
  ACCOUNTS_TRACKING: 'pending accounts close-out',
};

function hoursLeft(deadlineAt) {
  if (!deadlineAt) return null;
  return Math.round((new Date(deadlineAt).getTime() - Date.now()) / (1000 * 60 * 60));
}

export default function SlaTicker() {
  const { user } = useAuth();
  const [feed, setFeed] = useState([]);
  const [, setTick] = useState(0); // re-render every 30s for live countdown

  const allowed = !!user && TICKER_ROLES.includes(user.role);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    const load = () => {
      api.get('/work-orders/closure/sla-feed')
        .then(({ data }) => { if (!cancelled) setFeed(data.feed || []); })
        .catch(() => { if (!cancelled) setFeed([]); });
    };
    load();
    const t = setInterval(() => { load(); setTick((n) => n + 1); }, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [allowed]);

  const items = useMemo(() => feed.map((r) => ({
    ...r,
    hoursLeft: hoursLeft(r.slaDeadlineAt),
  })), [feed]);

  if (!allowed || items.length === 0) return null;

  const breachedCount = items.filter((i) => i.breached || (i.hoursLeft != null && i.hoursLeft <= 0)).length;

  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-amber-200/70 bg-white/40">
        <div className="flex items-center gap-1.5 text-amber-800 font-semibold text-xs uppercase tracking-wider flex-shrink-0">
          <Bell size={13} />
          Closure SLA
        </div>
        <span className="text-[11px] text-amber-700">
          {items.length} active • {breachedCount > 0 ? `${breachedCount} breached` : 'on track'}
        </span>
        <Link to="/closure-inbox" className="ml-auto text-[11px] font-medium text-navy-700 hover:text-navy-900 underline">
          Open inbox →
        </Link>
      </div>

      <div className="relative overflow-hidden group">
        <div className="flex gap-6 whitespace-nowrap py-2.5 px-4 animate-marquee group-hover:[animation-play-state:paused]">
          {[...items, ...items].map((it, i) => {
            const breached = it.breached || (it.hoursLeft != null && it.hoursLeft <= 0);
            const cls = breached
              ? 'bg-red-100 text-red-800 border-red-300'
              : it.hoursLeft != null && it.hoursLeft <= 12
                ? 'bg-orange-100 text-orange-800 border-orange-300'
                : it.hoursLeft != null && it.hoursLeft <= 24
                  ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                  : 'bg-blue-100 text-blue-800 border-blue-300';
            return (
              <Link
                key={`${it.id}-${i}`}
                to={`/work-orders/${it.id}/closure`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${cls} hover:scale-105 transition-transform`}
              >
                {breached ? <AlertTriangle size={11} /> : <Timer size={11} />}
                <span className="font-mono">{it.workOrderNumber}</span>
                <span>•</span>
                <span>
                  {breached
                    ? `BREACHED ${Math.abs(it.hoursLeft || 0)}h`
                    : `${it.hoursLeft}h left`}
                </span>
                <span>•</span>
                <span>{STAGE_LABEL[it.closureStage] || it.closureStage}</span>
                {it.customerName && <span className="text-[10px] opacity-75">({it.customerName})</span>}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
