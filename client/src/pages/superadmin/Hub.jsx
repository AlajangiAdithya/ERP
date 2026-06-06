// SUPERADMIN landing hub. Mobile-first by design — the owner can drive the
// whole system from a phone. Top: live counters. Below: large tap tiles for
// the rest of the owner-only pages.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Crown, Users, Activity, Database, HardDrive, Megaphone, Radio,
  ScrollText, Boxes, FileCheck2, Wrench, ShieldAlert, ChevronRight,
} from 'lucide-react';
import api from '../../api/axios';

const Tile = ({ to, icon: Icon, label, sub, tone = 'purple' }) => {
  const tones = {
    purple: 'from-purple-600 to-indigo-700',
    blue: 'from-sky-600 to-blue-700',
    emerald: 'from-emerald-600 to-teal-700',
    amber: 'from-amber-500 to-orange-600',
    rose: 'from-rose-600 to-pink-700',
    slate: 'from-slate-600 to-slate-800',
  };
  return (
    <Link
      to={to}
      className={`group relative overflow-hidden rounded-2xl p-4 sm:p-5 text-white shadow-lg bg-gradient-to-br ${tones[tone]} active:scale-[0.98] transition-transform`}
    >
      <div className="absolute -right-6 -bottom-6 opacity-10">
        <Icon size={120} strokeWidth={1} />
      </div>
      <div className="relative">
        <div className="flex items-center gap-2">
          <Icon size={20} className="opacity-90" />
          <ChevronRight size={16} className="ml-auto opacity-70 group-hover:translate-x-0.5 transition-transform" />
        </div>
        <div className="mt-3 text-base sm:text-lg font-semibold leading-tight">{label}</div>
        {sub && <div className="mt-0.5 text-[11px] opacity-80">{sub}</div>}
      </div>
    </Link>
  );
};

const Stat = ({ label, value, sub, tone = 'slate' }) => {
  const tones = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    rose: 'text-rose-700',
    purple: 'text-purple-700',
  };
  return (
    <div className="rounded-xl bg-white border border-gray-200 px-3 py-2.5 sm:p-4">
      <div className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`mt-0.5 text-xl sm:text-2xl font-bold leading-tight ${tones[tone]}`}>{value ?? '—'}</div>
      {sub && <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
};

export default function SuperAdminHub() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setErr('');
    try {
      const { data } = await api.get('/superadmin/quick-stats');
      setStats(data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  return (
    <div className="space-y-5 -m-6 p-4 sm:p-6 bg-gradient-to-b from-slate-50 to-white min-h-screen">
      {/* Header — compact on mobile */}
      <div className="rounded-2xl bg-gradient-to-r from-purple-700 via-indigo-700 to-purple-800 text-white p-4 sm:p-6 shadow-lg">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-purple-100/80">
          <Crown size={14} /> Owner Control
        </div>
        <div className="mt-1 text-xl sm:text-2xl font-bold">RAPS ERP — Control Hub</div>
        <div className="text-xs sm:text-sm text-purple-100/80 mt-0.5">Everything you need to drive the system from this device.</div>
      </div>

      {err && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{err}</div>
      )}

      {/* Live stats grid */}
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2 px-1">Live snapshot</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          <Stat label="Active users" value={stats?.users?.active} sub={`${stats?.users?.inactive ?? 0} inactive · ${stats?.users?.total ?? 0} total`} tone="emerald" />
          <Stat label="Open sessions" value={stats?.sessions?.open} sub="logged in right now" tone="purple" />
          <Stat label="Logins (24h)" value={stats?.activity?.logins24h} sub={`${stats?.activity?.audit24h ?? 0} audit events`} />
          <Stat label="Notifications (7d)" value={stats?.notifications?.last7d} sub={`${stats?.notifications?.total ?? 0} all-time`} />
          <Stat label="Products" value={stats?.data?.products} sub="active SKUs" />
          <Stat label="Purchase Reqs" value={stats?.data?.purchaseRequests} />
          <Stat label="Purchase Orders" value={stats?.data?.purchaseOrders} />
          <Stat label="Work Orders" value={stats?.data?.workOrders} sub={`${stats?.data?.qcInspections ?? 0} QC inspections`} />
        </div>
      </div>

      {/* Action tiles */}
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2 px-1">Controls</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <Tile to="/superadmin/users" icon={Users} label="Users" sub="impersonate · reset · disable" tone="purple" />
          <Tile to="/superadmin/broadcast" icon={Megaphone} label="Broadcast" sub="send notice to anyone" tone="rose" />
          <Tile to="/superadmin/corrections" icon={Database} label="Tables" sub="raw row editor" tone="blue" />
          <Tile to="/superadmin/health" icon={Activity} label="System Health" sub="live server + DB" tone="emerald" />
          <Tile to="/superadmin/backups" icon={HardDrive} label="Backups" sub="S3 archive browser" tone="amber" />
          <Tile to="/superadmin/activity" icon={Radio} label="Activity Feed" sub="last 30 audit events" tone="slate" />
        </div>
      </div>

      {/* Shortcuts to read-only views of the main app — handy on phone */}
      <div>
        <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2 px-1">Jump into the app</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
          <Tile to="/" icon={ScrollText} label="Dashboard" tone="slate" />
          <Tile to="/procurement" icon={Boxes} label="Procurement" tone="slate" />
          <Tile to="/qc-inspections" icon={FileCheck2} label="QC Inspections" tone="slate" />
          <Tile to="/work-orders" icon={Wrench} label="Work Orders" tone="slate" />
          <Tile to="/safety" icon={ShieldAlert} label="Safety Monitor" tone="slate" />
          <Tile to="/management" icon={Users} label="User Management" tone="slate" />
        </div>
      </div>

      <div className="text-[10px] text-center text-gray-400 pt-2 pb-6">
        {loading ? 'Loading…' : 'Auto-refresh every 15s · invisible to other users'}
      </div>
    </div>
  );
}
