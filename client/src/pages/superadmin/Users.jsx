// SUPERADMIN-only user manager. Mobile-first card list with quick actions:
// impersonate, reset password, toggle active, kill sessions. Bypasses the
// regular ADMIN management page and edits the DB directly via
// /api/superadmin/users-list + the row mutation endpoints.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, RefreshCw, Eye, EyeOff, KeyRound, LogOut, UserCheck, UserX,
  ChevronRight, Users as UsersIcon, ShieldCheck, X, Copy, Check,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const ROLES = [
  'ADMIN', 'SUPERADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER',
  'ACCOUNTING', 'FINANCE', 'QC', 'LAB', 'METROLOGY', 'NDT', 'RND',
  'SAFETY', 'SUPPLY_CHAIN', 'DESIGNS', 'PLANNING', 'LOGISTICS', 'SITE_OFFICE',
];

export default function SuperAdminUsers() {
  const navigate = useNavigate();
  const { impersonate } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [showPwIds, setShowPwIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);
  const [resetting, setResetting] = useState(null); // { user, value }

  async function load() {
    setLoading(true); setErr('');
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (roleFilter) params.set('role', roleFilter);
      if (activeFilter) params.set('active', activeFilter);
      const { data } = await api.get(`/superadmin/users-list?${params.toString()}`);
      setUsers(data.users || []);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, roleFilter, activeFilter]);

  const togglePwView = (id) => {
    setShowPwIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const copyPw = async (id, pw) => {
    if (!pw) return;
    try { await navigator.clipboard.writeText(pw); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); } catch {}
  };

  async function toggleActive(u) {
    setBusyId(u.id); setErr('');
    try {
      await api.post(`/superadmin/users/${u.id}/toggle-active`);
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusyId(null); }
  }

  async function killSessions(u) {
    if (!window.confirm(`Sign ${u.name || u.username} out of every device?`)) return;
    setBusyId(u.id); setErr('');
    try {
      const { data } = await api.post(`/superadmin/users/${u.id}/kill-sessions`);
      load();
      window.alert(`Killed ${data.killed} session(s).`);
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusyId(null); }
  }

  async function doReset() {
    if (!resetting?.value || resetting.value.length < 4) { setErr('Password must be at least 4 characters'); return; }
    setBusyId(resetting.user.id); setErr('');
    try {
      await api.post(`/superadmin/users/${resetting.user.id}/reset-password`, { password: resetting.value });
      setResetting(null);
      load();
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusyId(null); }
  }

  async function doImpersonate(u) {
    if (!window.confirm(`Log in as ${u.name || u.username}? You can return to owner anytime.`)) return;
    setBusyId(u.id); setErr('');
    try {
      await impersonate(u.id);
      navigate('/');
    } catch (e) { setErr(e.response?.data?.error || e.message); }
    finally { setBusyId(null); }
  }

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.isActive).length,
    inactive: users.filter((u) => !u.isActive).length,
  }), [users]);

  return (
    <div className="space-y-4 -m-6 p-4 sm:p-6 bg-slate-50 min-h-screen">
      <div className="rounded-2xl bg-gradient-to-r from-purple-700 to-indigo-700 text-white p-4 sm:p-5 shadow">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-purple-100/80">
          <ShieldCheck size={13} /> Owner · Users
        </div>
        <div className="flex items-center justify-between mt-1">
          <div>
            <div className="text-lg sm:text-xl font-bold flex items-center gap-2"><UsersIcon size={20} /> User Control</div>
            <div className="text-[11px] sm:text-xs text-purple-100/80 mt-0.5">{counts.total} shown · {counts.active} active · {counts.inactive} inactive</div>
          </div>
          <button onClick={load} className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-sm flex items-center gap-1">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between">
          <span>{err}</span>
          <button onClick={() => setErr('')}><X size={14} /></button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl p-3 border border-gray-200 space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or username…"
            className="w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="px-3 py-2 text-sm border rounded-lg">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} className="px-3 py-2 text-sm border rounded-lg">
            <option value="">Any status</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>
        </div>
      </div>

      {/* User cards */}
      {loading && users.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">Loading…</div>
      ) : users.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">No users match.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {users.map((u) => {
            const pwOpen = showPwIds.has(u.id);
            return (
              <div key={u.id} className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${u.isActive ? 'border-gray-200' : 'border-rose-200 opacity-90'}`}>
                <div className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${u.isActive ? 'bg-purple-100 text-purple-700' : 'bg-rose-100 text-rose-700'}`}>
                      {(u.name || u.username || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold text-gray-900 truncate">{u.name || u.username}</div>
                        {u.role === 'SUPERADMIN' && <span className="text-[9px] uppercase tracking-wider bg-purple-700 text-white px-1.5 py-0.5 rounded">Owner</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">@{u.username} · {u.role}{u.unit ? ` · ${u.unit.name}` : ''}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">Sessions: {u._count?.sessions ?? 0} · {u.isActive ? <span className="text-emerald-600">active</span> : <span className="text-rose-600">inactive</span>}</div>
                    </div>
                  </div>

                  {/* Password reveal */}
                  {u.plainPassword !== undefined && (
                    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-2 flex items-center gap-2">
                      <KeyRound size={13} className="text-gray-500 flex-shrink-0" />
                      <span className="font-mono text-[12px] text-gray-700 flex-1 truncate select-all">
                        {pwOpen ? (u.plainPassword || <em className="text-gray-400">— not stored —</em>) : '••••••••'}
                      </span>
                      {u.plainPassword && (
                        <>
                          <button onClick={() => togglePwView(u.id)} className="text-gray-500 hover:text-gray-900" title={pwOpen ? 'Hide' : 'Show'}>
                            {pwOpen ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button onClick={() => copyPw(u.id, u.plainPassword)} className="text-gray-500 hover:text-gray-900" title="Copy">
                            {copiedId === u.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => doImpersonate(u)}
                      disabled={busyId === u.id || !u.isActive || u.role === 'SUPERADMIN'}
                      className="px-2 py-2 text-xs rounded-lg bg-purple-700 text-white font-semibold hover:bg-purple-800 disabled:opacity-40 flex items-center justify-center gap-1"
                      title={u.role === 'SUPERADMIN' ? 'Cannot impersonate owner' : 'Log in as this user'}
                    >
                      <ChevronRight size={13} /> Log in as
                    </button>
                    <button
                      onClick={() => setResetting({ user: u, value: '' })}
                      disabled={busyId === u.id}
                      className="px-2 py-2 text-xs rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <KeyRound size={13} /> Reset PW
                    </button>
                    <button
                      onClick={() => killSessions(u)}
                      disabled={busyId === u.id || (u._count?.sessions ?? 0) === 0}
                      className="px-2 py-2 text-xs rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <LogOut size={13} /> Kill sessions
                    </button>
                    <button
                      onClick={() => toggleActive(u)}
                      disabled={busyId === u.id || u.role === 'SUPERADMIN'}
                      className={`px-2 py-2 text-xs rounded-lg font-semibold disabled:opacity-40 flex items-center justify-center gap-1 ${
                        u.isActive ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {u.isActive ? <><UserX size={13} /> Deactivate</> : <><UserCheck size={13} /> Activate</>}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reset password modal */}
      {resetting && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-3">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound size={18} className="text-blue-600" />
              <div className="font-semibold text-gray-900">Reset password</div>
              <button onClick={() => setResetting(null)} className="ml-auto text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            <div className="text-xs text-gray-500">
              For <span className="font-mono">{resetting.user.username}</span>. The user will be signed out of every device.
            </div>
            <input
              type="text" autoFocus value={resetting.value}
              onChange={(e) => setResetting((r) => ({ ...r, value: e.target.value }))}
              placeholder="New password (min 4 chars)"
              className="w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
            <div className="flex gap-2">
              <button onClick={() => setResetting(null)} className="flex-1 px-3 py-2 text-sm border rounded-lg">Cancel</button>
              <button onClick={doReset} disabled={busyId === resetting.user.id} className="flex-1 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
