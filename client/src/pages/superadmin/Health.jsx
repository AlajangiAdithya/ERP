// SUPERADMIN-only operational dashboard. Live polls /superadmin/health on a
// configurable cadence (default 5s, pauses when tab hidden) and renders five
// sections: Server (load, mem, swap, disk, uploads dir, uptime), App (pm2
// process list), Database (size, connections, top tables), Activity (logins,
// sessions, recent errors), Backups (last run + S3 totals).

import { useEffect, useRef, useState } from 'react';
import {
  Activity, Cpu, Boxes, Database, Users, Cloud, RefreshCw,
  CheckCircle2, AlertCircle, Clock, HardDrive,
} from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/shared/PageHero';

// Default poll cadence. 5s feels real-time without hammering the EC2 box —
// the heaviest call is `aws s3 ls --recursive`, which costs a few hundred ms.
const DEFAULT_INTERVAL_MS = 5000;
const INTERVAL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '2s', value: 2000 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
];

const fmtBytes = (n) => {
  if (n == null) return '—';
  if (n === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

const fmtDuration = (seconds) => {
  if (seconds == null) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
};

const sinceIso = (iso) => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  return fmtDuration((Date.now() - t) / 1000) + ' ago';
};

const Bar = ({ percent }) => {
  const p = Math.max(0, Math.min(100, percent || 0));
  const color = p >= 85 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="h-2 rounded bg-gray-100 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
};

const Section = ({ title, icon, children, right }) => (
  <div className="bg-white rounded-lg border border-gray-200">
    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 text-gray-700">
      {icon}
      <span className="font-semibold">{title}</span>
      {right && <div className="ml-auto">{right}</div>}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Stat = ({ label, value, sub }) => (
  <div>
    <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    <div className="text-xl font-semibold text-gray-900">{value}</div>
    {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
  </div>
);

export default function Health() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const inFlight = useRef(false);

  // Ticker so the "updated Ns ago" label stays current even between fetches.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function load({ silent = false } = {}) {
    if (inFlight.current) return;          // don't stack requests if the box is slow
    inFlight.current = true;
    if (!silent) setLoading(true);
    setErr('');
    try {
      const { data } = await api.get('/superadmin/health');
      setData(data);
      setLastUpdatedAt(Date.now());
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      if (!silent) setLoading(false);
      inFlight.current = false;
    }
  }

  // Initial fetch.
  useEffect(() => { load(); }, []);

  // Live polling — pauses when the tab is hidden so we don't pummel the EC2 box
  // when no one is looking. Resumes (with an immediate refresh) on focus.
  useEffect(() => {
    if (!intervalMs) return;
    let timer = null;
    const tick = () => { if (!document.hidden) load({ silent: true }); };
    timer = setInterval(tick, intervalMs);
    const onVisible = () => { if (!document.hidden) load({ silent: true }); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);

  const updatedAgoSec = lastUpdatedAt ? Math.max(0, Math.floor((now - lastUpdatedAt) / 1000)) : null;

  return (
    <div className="p-6 space-y-6">
      <PageHero
        title="System Health"
        subtitle="Live operational view — server, app, database, activity, and backups."
        eyebrow="SuperAdmin"
        icon={Activity}
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-white/90 bg-white/10 border border-white/20 rounded-lg">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${intervalMs ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`} />
              {intervalMs
                ? (updatedAgoSec != null ? `Live · updated ${updatedAgoSec}s ago` : 'Live')
                : 'Paused'}
            </div>
            <select
              value={intervalMs}
              onChange={(e) => setIntervalMs(Number(e.target.value))}
              className="px-2 py-1.5 text-xs bg-white/10 hover:bg-white/15 border border-white/20 rounded-lg text-white outline-none"
              title="Auto-refresh interval"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="text-gray-900">{o.label}</option>
              ))}
            </select>
            <button onClick={() => load()} className="px-3 py-2 text-sm bg-white/10 hover:bg-white/15 backdrop-blur-sm border border-white/20 rounded-lg text-white flex items-center gap-1.5 transition-colors">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      {err && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{err}</div>
      )}

      {!data && loading ? (
        <div className="p-8 text-center text-gray-400">Loading…</div>
      ) : !data ? null : (
        <div className="space-y-5">
          {/* ── Server ── */}
          <Section title="Server" icon={<Cpu size={16} className="text-purple-700" />}>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Stat
                label="Load avg"
                value={data.server.loadavg
                  ? `${data.server.loadavg['1m'].toFixed(2)}`
                  : '—'}
                sub={data.server.loadavg
                  ? `5m ${data.server.loadavg['5m'].toFixed(2)} · 15m ${data.server.loadavg['15m'].toFixed(2)}`
                  : null}
              />
              <Stat label="Uptime" value={fmtDuration(data.server.uptimeSeconds)} />
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Memory</div>
                {data.server.memory ? (
                  <>
                    <div className="text-sm font-medium text-gray-900 mb-1">
                      {fmtBytes(data.server.memory.used)} / {fmtBytes(data.server.memory.total)} <span className="text-gray-500 font-normal">({data.server.memory.percent}%)</span>
                    </div>
                    <Bar percent={data.server.memory.percent} />
                  </>
                ) : <span className="text-gray-400">—</span>}
              </div>
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Swap</div>
                {data.server.swap ? (
                  <>
                    <div className="text-sm font-medium text-gray-900 mb-1">
                      {fmtBytes(data.server.swap.used)} / {fmtBytes(data.server.swap.total)} <span className="text-gray-500 font-normal">({data.server.swap.percent}%)</span>
                    </div>
                    <Bar percent={data.server.swap.percent} />
                  </>
                ) : <span className="text-gray-400">—</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                  <HardDrive size={12} /> Disk (root filesystem)
                </div>
                {data.server.disk ? (
                  <>
                    <div className="text-sm font-medium text-gray-900 mb-1">
                      {fmtBytes(data.server.disk.used)} / {fmtBytes(data.server.disk.total)} <span className="text-gray-500 font-normal">({data.server.disk.percent}%)</span>
                      <span className="ml-2 text-xs text-gray-500">· {fmtBytes(data.server.disk.available)} free</span>
                    </div>
                    <Bar percent={data.server.disk.percent} />
                  </>
                ) : <span className="text-gray-400">—</span>}
              </div>
              <Stat
                label="Uploads dir"
                value={fmtBytes(data.server.uploadsBytes)}
                sub="invoices · quotations · PO docs · QC docs · supplier files"
              />
            </div>
          </Section>

          {/* ── App (PM2) ── */}
          <Section title="App processes (PM2)" icon={<Boxes size={16} className="text-purple-700" />}>
            {data.app.processes?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b">
                      <th className="text-left py-2 font-medium">Name</th>
                      <th className="text-left py-2 font-medium">Status</th>
                      <th className="text-left py-2 font-medium">Uptime</th>
                      <th className="text-left py-2 font-medium">Restarts</th>
                      <th className="text-left py-2 font-medium">CPU</th>
                      <th className="text-left py-2 font-medium">Memory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.app.processes.map((p) => (
                      <tr key={p.name} className="border-b last:border-b-0">
                        <td className="py-2 font-mono">{p.name}</td>
                        <td className="py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                            p.status === 'online' ? 'bg-emerald-50 text-emerald-700' :
                            p.status === 'stopped' ? 'bg-gray-100 text-gray-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                            {p.status === 'online' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
                            {p.status || 'unknown'}
                          </span>
                        </td>
                        <td className="py-2">{fmtDuration(p.uptimeMs ? p.uptimeMs / 1000 : null)}</td>
                        <td className={`py-2 ${p.restarts > 5 ? 'text-amber-700 font-semibold' : ''}`}>{p.restarts}</td>
                        <td className="py-2">{p.cpu != null ? `${p.cpu}%` : '—'}</td>
                        <td className="py-2">{fmtBytes(p.memBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="text-sm text-gray-400">PM2 not reachable (either not installed or running under a different user).</div>}
          </Section>

          {/* ── Database ── */}
          <Section title="Database" icon={<Database size={16} className="text-purple-700" />}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Stat label="Size on disk" value={fmtBytes(data.db.sizeBytes)} />
              <Stat
                label="Connections"
                value={data.db.connections?.total ?? '—'}
                sub={data.db.connections
                  ? `${data.db.connections.active} active · ${data.db.connections.idle} idle`
                  : null}
              />
              <Stat label="Tables tracked" value={data.db.topTables?.length ?? '—'} sub="top 5 by size shown below" />
            </div>
            {data.db.topTables?.length > 0 && (
              <div className="overflow-x-auto border-t pt-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase tracking-wide border-b">
                      <th className="text-left py-2 font-medium">Table</th>
                      <th className="text-right py-2 font-medium">Rows</th>
                      <th className="text-right py-2 font-medium">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.db.topTables.map((t) => (
                      <tr key={t.name} className="border-b last:border-b-0">
                        <td className="py-2 font-mono">{t.name}</td>
                        <td className="py-2 text-right">{t.rows.toLocaleString()}</td>
                        <td className="py-2 text-right">{fmtBytes(t.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── Activity ── */}
          <Section title="Activity (last 24h)" icon={<Users size={16} className="text-purple-700" />}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <Stat label="Logins (24h)" value={data.activity.logins24h ?? '—'} />
              <Stat label="Active sessions" value={data.activity.activeSessions ?? '—'} />
              <Stat label="Active users" value={data.activity.totalUsers ?? '—'} />
            </div>
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Recent errors (pm2 error log)</div>
              {data.activity.recentErrors?.length ? (
                <pre className="text-xs font-mono bg-gray-900 text-red-300 p-3 rounded max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {data.activity.recentErrors.join('\n')}
                </pre>
              ) : (
                <div className="text-sm text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 size={14} /> No recent errors in log.
                </div>
              )}
            </div>
          </Section>

          {/* ── Backups ── */}
          <Section title="Backups" icon={<Cloud size={16} className="text-purple-700" />}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">Last successful run</div>
                <div className="text-lg font-semibold text-gray-900 flex items-center gap-1.5">
                  {data.backups.lastSuccessAt ? (
                    <>
                      <CheckCircle2 size={16} className="text-emerald-600" />
                      <span>{sinceIso(data.backups.lastSuccessAt)}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={16} className="text-amber-600" />
                      <span>Never (log empty)</span>
                    </>
                  )}
                </div>
                {data.backups.lastSuccessAt && (
                  <div className="text-xs text-gray-500 mt-0.5 font-mono">{data.backups.lastSuccessAt}</div>
                )}
              </div>
              <Stat
                label="S3 bucket size"
                value={fmtBytes(data.backups.s3?.totalBytes)}
                sub={data.backups.s3?.totalObjects != null ? `${data.backups.s3.totalObjects} objects` : null}
              />
              <Stat label="Bucket name" value={<span className="font-mono text-sm">{data.backups.s3?.bucket || '—'}</span>} />
            </div>
            {data.backups.lastErrorLine && (
              <div className="mt-2 p-2 rounded bg-red-50 border border-red-200 text-xs text-red-800 font-mono break-all flex items-start gap-2">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-sans font-semibold mb-0.5">Last error in backup log:</div>
                  {data.backups.lastErrorLine}
                </div>
              </div>
            )}
          </Section>

          <div className="text-xs text-gray-400 text-center pt-2 flex items-center justify-center gap-1.5">
            <Clock size={12} />
            {intervalMs
              ? <>Live · refresh every {INTERVAL_OPTIONS.find((o) => o.value === intervalMs)?.label} · last update {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : '—'}</>
              : <>Auto-refresh paused · last update {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : '—'}</>
            }
          </div>
        </div>
      )}
    </div>
  );
}
