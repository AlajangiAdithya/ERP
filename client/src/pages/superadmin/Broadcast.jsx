// Send a system notification to everyone / a specific role / a specific user.
// Posts to /api/superadmin/broadcast which writes a single Notification row;
// the regular alerts feed renders it on the recipient side without revealing
// the sender (sentById is left null on purpose).
import { useEffect, useState } from 'react';
import { Megaphone, Send, X, CheckCircle2, Users, Tag, User as UserIcon } from 'lucide-react';
import api from '../../api/axios';

const ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER',
  'ACCOUNTING', 'FINANCE', 'QC', 'LAB', 'METROLOGY', 'NDT', 'RND',
  'SAFETY', 'SUPPLY_CHAIN', 'DESIGNS', 'PLANNING', 'LOGISTICS', 'HR', 'SITE_OFFICE',
];

const TYPES = [
  { value: 'BROADCAST', label: 'Broadcast' },
  { value: 'INFO', label: 'Info' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'ALERT', label: 'Alert' },
];

export default function SuperAdminBroadcast() {
  const [audience, setAudience] = useState('ALL'); // ALL | ROLE | USER
  const [role, setRole] = useState('ADMIN');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('BROADCAST');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (audience !== 'USER') return;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: userSearch });
        const { data } = await api.get(`/superadmin/users-list?${params.toString()}`);
        setUsers(data.users || []);
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [audience, userSearch]);

  async function send() {
    setErr(''); setSuccess('');
    if (!title.trim() || !message.trim()) { setErr('Title and message are required.'); return; }
    if (audience === 'USER' && !userId) { setErr('Pick a user.'); return; }
    setBusy(true);
    try {
      const body = { title: title.trim(), message: message.trim(), type };
      if (audience === 'ROLE') body.targetRole = role;
      if (audience === 'USER') body.targetUserId = userId;
      await api.post('/superadmin/broadcast', body);
      setSuccess('Notification sent.');
      setTitle(''); setMessage('');
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4 -m-6 p-4 sm:p-6 bg-slate-50 min-h-screen">
      <div className="rounded-2xl bg-gradient-to-r from-rose-600 to-pink-700 text-white p-4 sm:p-5 shadow">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-rose-100/80">
          <Megaphone size={13} /> Owner · Broadcast
        </div>
        <div className="text-lg sm:text-xl font-bold mt-1">Send a system notification</div>
        <div className="text-[11px] sm:text-xs text-rose-100/80 mt-0.5">Appears in the recipient's Notifications feed without a sender attribution.</div>
      </div>

      {err && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between">
          <span>{err}</span>
          <button onClick={() => setErr('')}><X size={14} /></button>
        </div>
      )}
      {success && (
        <div className="p-3 rounded bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 size={14} /> {success}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-5 space-y-4">
        {/* Audience */}
        <div>
          <div className="text-[11px] uppercase font-semibold tracking-wider text-gray-500 mb-1.5">Audience</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { v: 'ALL', icon: Users, label: 'Everyone' },
              { v: 'ROLE', icon: Tag, label: 'By role' },
              { v: 'USER', icon: UserIcon, label: 'One user' },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setAudience(o.v)}
                className={`px-2 py-2 text-xs rounded-lg border font-semibold flex items-center justify-center gap-1.5 ${
                  audience === o.v ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-gray-700 border-gray-200 hover:border-purple-200'
                }`}
              >
                <o.icon size={13} /> {o.label}
              </button>
            ))}
          </div>
        </div>

        {audience === 'ROLE' && (
          <div>
            <label className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 w-full px-3 py-2.5 text-sm border rounded-lg">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        {audience === 'USER' && (
          <div>
            <label className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">User</label>
            <input
              type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search…"
              className="mt-1 w-full px-3 py-2.5 text-sm border rounded-lg"
            />
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y">
              {users.length === 0 ? (
                <div className="p-3 text-xs text-gray-400 text-center">No users.</div>
              ) : users.slice(0, 50).map((u) => (
                <button
                  key={u.id}
                  onClick={() => setUserId(u.id)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${userId === u.id ? 'bg-purple-50' : 'hover:bg-gray-50'}`}
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${u.isActive ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-500'}`}>
                    {(u.name || u.username).slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate"><span className="font-semibold">{u.name || u.username}</span> · <span className="text-gray-500">{u.role}</span></span>
                  {userId === u.id && <CheckCircle2 size={14} className="text-purple-700" />}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full px-3 py-2.5 text-sm border rounded-lg">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">Title</label>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Short headline"
            className="mt-1 w-full px-3 py-2.5 text-sm border rounded-lg"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase font-semibold tracking-wider text-gray-500">Message</label>
          <textarea
            value={message} onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="What do you want to say?"
            className="mt-1 w-full px-3 py-2.5 text-sm border rounded-lg"
          />
        </div>

        <button
          onClick={send}
          disabled={busy}
          className="w-full py-3 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Send size={15} /> {busy ? 'Sending…' : 'Send notification'}
        </button>
      </div>
    </div>
  );
}
