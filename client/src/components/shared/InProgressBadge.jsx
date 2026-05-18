import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ShoppingCart, FileText, X } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { useAutoRefresh } from '../../context/NotificationContext';

// Floating, always-visible badge for the in-progress PR and PO counts.
// Mounted once at the layout level. Hidden when there is nothing in flight.
export default function InProgressBadge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const refreshKey = useAutoRefresh();
  const [summary, setSummary] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.get('/purchase-requests/in-progress-summary')
      .then(({ data }) => { if (!cancelled) setSummary(data); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [user, refreshKey]);

  if (!user || hidden || !summary) return null;

  const prCount = summary.prCount || 0;
  const poCount = summary.poCount || 0;
  if (prCount === 0 && poCount === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 select-none">
      {expanded ? (
        <div className="bg-white rounded-lg shadow-xl border border-navy-200 w-72 overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-3 py-2 bg-navy-700 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Activity size={14} className="animate-pulse" /> In Progress
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setExpanded(false)}
                className="p-1 hover:bg-navy-600 rounded"
                aria-label="Minimize"
                title="Minimize"
              >
                <span className="text-xs">−</span>
              </button>
              <button
                onClick={() => setHidden(true)}
                className="p-1 hover:bg-navy-600 rounded"
                aria-label="Dismiss"
                title="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          <button
            onClick={() => { setExpanded(false); navigate('/purchase-requests'); }}
            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 flex items-start gap-2"
          >
            <FileText size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">
                {prCount} purchase request{prCount !== 1 ? 's' : ''} active
              </div>
              {(summary.prSamples || []).slice(0, 3).map(pr => (
                <div key={pr.id} className="text-xs text-gray-500 truncate">
                  • {pr.requestNumber} ({pr.unit?.code || pr.unit?.name || '—'}) — {pr.status}
                </div>
              ))}
              {prCount > (summary.prSamples?.length || 0) && (
                <div className="text-xs text-gray-400">+ {prCount - (summary.prSamples?.length || 0)} more…</div>
              )}
            </div>
          </button>

          <button
            onClick={() => { setExpanded(false); navigate('/purchase-orders'); }}
            className="w-full text-left px-3 py-2 hover:bg-green-50 flex items-start gap-2"
          >
            <ShoppingCart size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-800">
                {poCount} purchase order{poCount !== 1 ? 's' : ''} active
              </div>
              {(summary.poSamples || []).slice(0, 3).map(po => (
                <div key={po.id} className="text-xs text-gray-500 truncate">
                  • {po.orderNumber} — {po.status}
                </div>
              ))}
              {poCount > (summary.poSamples?.length || 0) && (
                <div className="text-xs text-gray-400">+ {poCount - (summary.poSamples?.length || 0)} more…</div>
              )}
            </div>
          </button>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="bg-navy-700 hover:bg-navy-800 text-white rounded-full shadow-lg pl-3 pr-4 py-2 flex items-center gap-2 transition-all"
          title="View in-progress PRs and POs"
        >
          <Activity size={16} className="animate-pulse" />
          <span className="text-xs font-semibold tracking-wide">IN PROGRESS</span>
          <span className="flex items-center gap-1 ml-1">
            <span className="bg-white text-navy-700 text-xs font-bold px-1.5 py-0.5 rounded-full" title={`${prCount} active PRs`}>PR {prCount}</span>
            <span className="bg-white text-navy-700 text-xs font-bold px-1.5 py-0.5 rounded-full" title={`${poCount} active POs`}>PO {poCount}</span>
          </span>
        </button>
      )}
    </div>
  );
}
