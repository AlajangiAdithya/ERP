// Last 30 audit entries — a quick "what's happening right now" feed. SUPERADMIN
// actions are never logged, so the owner stays invisible in this list.
import { useEffect, useState } from 'react';
import { Radio, RefreshCw, ScrollText } from 'lucide-react';
import api from '../../api/axios';

const fmt = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const actionTone = (a) => {
  if (!a) return 'bg-gray-100 text-gray-700';
  if (a === 'LOGIN' || a === 'LOGOUT') return 'bg-sky-100 text-sky-700';
  if (a === 'CREATE') return 'bg-emerald-100 text-emerald-700';
  if (a === 'UPDATE') return 'bg-amber-100 text-amber-700';
  if (a === 'DELETE') return 'bg-rose-100 text-rose-700';
  return 'bg-purple-100 text-purple-700';
};

export default function SuperAdminActivity() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/superadmin/recent-activity');
      setLogs(data.logs || []);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  return (
    <div className="space-y-4 -m-6 p-4 sm:p-6 bg-slate-50 min-h-screen">
      <div className="rounded-2xl bg-gradient-to-r from-slate-700 to-slate-900 text-white p-4 sm:p-5 shadow flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-300">
            <Radio size={13} /> Owner · Activity
          </div>
          <div className="text-lg sm:text-xl font-bold mt-1 flex items-center gap-2"><ScrollText size={18} /> Live activity feed</div>
          <div className="text-[11px] sm:text-xs text-slate-300 mt-0.5">Last 30 events · refreshes every 10s</div>
        </div>
        <button onClick={load} className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {err && <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{err}</div>}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {logs.length === 0 && !loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">No recent activity.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {logs.map((l) => (
              <li key={l.id} className="p-3 sm:p-4 flex items-start gap-3">
                <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${actionTone(l.action)}`}>
                  {l.action}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">
                    {l.entity}
                    {l.entityId && <span className="text-gray-400 text-[11px] font-mono ml-1.5">{l.entityId.slice(0, 8)}…</span>}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    {l.user ? <>by <strong>{l.user.name || l.user.username}</strong> ({l.user.role})</> : <em>system</em>}
                    {l.ipAddress && <span className="text-gray-400 font-mono ml-1.5">· {l.ipAddress}</span>}
                  </div>
                  {l.details && (
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5 break-all">
                      {typeof l.details === 'object' ? JSON.stringify(l.details).slice(0, 140) : String(l.details).slice(0, 140)}
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-gray-400 whitespace-nowrap">{fmt(l.createdAt)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
