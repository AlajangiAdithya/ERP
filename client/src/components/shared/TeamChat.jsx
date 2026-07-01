import { useState, useEffect, useRef, useCallback } from 'react';
import { MessagesSquare, Send, Trash2, History, Megaphone, AtSign, CornerUpLeft, Loader2, CheckCircle2, Check } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { formatDateTime } from '../../utils/formatters';

const POLL_MS = 6000;

const initials = (name) => {
  if (!name) return 'U';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

const roleLabel = (role) => (role ? role.replace(/_/g, ' ') : '');

export default function TeamChat({ heightClass = 'h-80' } = {}) {
  const { user } = useAuth();
  const [view, setView] = useState('active'); // 'active' | 'deleted'
  const [messages, setMessages] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  // ── Load the @mention picker list once ──
  useEffect(() => {
    api.get('/messages/recipients')
      .then(({ data }) => setRecipients(data || []))
      .catch(() => setRecipients([]));
  }, []);

  const fetchMessages = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    api.get('/messages', { params: { view, limit: 100 } })
      .then(({ data }) => setMessages(data.messages || []))
      .catch(() => { if (!silent) setMessages([]); })
      .finally(() => setLoading(false));
  }, [view]);

  // ── Initial load + poll, re-armed on view change ──
  useEffect(() => {
    fetchMessages();
    const id = setInterval(() => fetchMessages(true), POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchMessages(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchMessages]);

  // API returns newest-first. Active feed reads like a chat (oldest → newest);
  // the deleted history reads like a log (newest first).
  const ordered = view === 'active' ? [...messages].reverse() : messages;

  // Auto-scroll the active feed to the newest message.
  useEffect(() => {
    if (view === 'active') bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [ordered.length, view]);

  // ── @mention autocomplete ──
  // Usernames may contain spaces, so the query is "everything after the leading
  // @" (not just up to the first space). Suggestions are candidates whose name
  // starts with what's typed; once the username + message is fully typed there
  // are no startsWith matches, so the dropdown closes on its own.
  const mentionMatch = input.match(/^@([^\n]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase().trimStart() : null;
  const suggestions = mentionQuery !== null
    ? [
        { id: '__everyone', username: 'everyone', name: 'Everyone', role: 'BROADCAST' },
        ...recipients,
      ].filter(r => r.username.toLowerCase().startsWith(mentionQuery)).slice(0, 6)
    : [];

  const pickMention = (username) => {
    setInput(`@${username} `);
    setError('');
    inputRef.current?.focus();
  };

  const replyTo = (m) => {
    const handle = m.isBroadcast ? 'everyone' : m.sender?.username;
    if (!handle) return;
    setInput(`@${handle} `);
    inputRef.current?.focus();
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = input.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      await api.post('/messages', { body });
      setInput('');
      if (view !== 'active') setView('active');
      else fetchMessages(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const markDone = async (m) => {
    if (!confirm('Mark this as done? The sender will be notified and can then clear it.')) return;
    try {
      await api.patch(`/messages/${m.id}/done`);
      fetchMessages(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to mark done');
    }
  };

  const remove = async (m) => {
    if (!confirm('Delete this message? It will move to the deleted history.')) return;
    try {
      await api.delete(`/messages/${m.id}`);
      fetchMessages(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete message');
    }
  };

  return (
    <Card className="!p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-navy-50/60 to-transparent">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-navy-100 text-navy-700 ring-1 ring-navy-200">
            <MessagesSquare size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-800">Team Chat</h3>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              Primary channel — type <span className="font-mono text-navy-600">@everyone</span> or{' '}
              <span className="font-mono text-navy-600">@username</span> then your message
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setView('active')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === 'active' ? 'bg-navy-700 text-white' : 'text-navy-600 hover:bg-navy-50'
            }`}
          >
            <MessagesSquare size={13} className="inline mr-1 -mt-0.5" /> Chat
          </button>
          <button
            onClick={() => setView('deleted')}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              view === 'deleted' ? 'bg-navy-700 text-white' : 'text-navy-600 hover:bg-navy-50'
            }`}
          >
            <History size={13} className="inline mr-1 -mt-0.5" /> History
          </button>
        </div>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className={`${heightClass} overflow-y-auto px-3 sm:px-4 py-3 bg-gray-50/40`}>
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : ordered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400">
            <MessagesSquare size={28} className="mb-2 text-gray-300" />
            <p className="text-sm">
              {view === 'active' ? 'No messages yet. Say hello to the team.' : 'No deleted messages.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {ordered.map((m) => {
              const mine = m.sender?.id === user?.id;
              const deleted = !!m.deletedAt;
              const isDirect = !m.isBroadcast && !!m.recipientId;
              const iAmRecipient = m.recipient?.id === user?.id;
              const done = !!m.doneAt;
              // Receiver of an open work request sees the Done button.
              const canMarkDone = isDirect && iAmRecipient && !done && !deleted;
              // Sender may delete a direct message only once it's been marked done;
              // broadcasts (no recipient to close them) can be deleted anytime.
              const canDelete = mine && !deleted && (!isDirect || done);
              return (
                <div key={m.id} className={`flex gap-2.5 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-semibold shadow-sm flex-shrink-0 ${
                    mine ? 'bg-gradient-to-br from-blue-500 to-navy-700' : 'bg-gradient-to-br from-gray-400 to-gray-600'
                  }`}>
                    {initials(m.sender?.name)}
                  </div>

                  {/* Bubble */}
                  <div className={`group max-w-[78%] min-w-0 ${mine ? 'items-end text-right' : 'items-start text-left'} flex flex-col`}>
                    <div className="flex items-center gap-1.5 flex-wrap mb-0.5" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                      <span className="text-[11px] font-semibold text-gray-700">
                        {mine ? 'You' : m.sender?.name}
                      </span>
                      <span className="text-[10px] text-gray-400">@{m.sender?.username}</span>
                      {m.sender?.role && (
                        <span className="text-[9px] uppercase tracking-wide text-gray-400">· {roleLabel(m.sender.role)}</span>
                      )}
                    </div>

                    {/* Target chip */}
                    <div className="mb-1" style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                      {m.isBroadcast ? (
                        <Badge color="purple"><Megaphone size={9} className="inline mr-0.5 -mt-0.5" />@everyone</Badge>
                      ) : mine ? (
                        <Badge color="blue"><AtSign size={9} className="inline mr-0.5 -mt-0.5" />to @{m.recipient?.username || '—'}</Badge>
                      ) : (
                        <Badge color="green"><AtSign size={9} className="inline mr-0.5 -mt-0.5" />to you</Badge>
                      )}
                    </div>

                    <div className={`relative inline-block rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm ${
                      deleted
                        ? 'bg-gray-100 text-gray-400 line-through'
                        : mine
                          ? 'bg-navy-700 text-white rounded-tr-sm'
                          : 'bg-white text-gray-800 ring-1 ring-gray-200 rounded-tl-sm'
                    }`}>
                      {m.body}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5" style={{ flexDirection: mine ? 'row-reverse' : 'row' }}>
                      <span className="text-[10px] text-gray-400">{formatDateTime(m.createdAt)}</span>
                      {deleted && <span className="text-[10px] text-red-400 font-medium">deleted {formatDateTime(m.deletedAt)}</span>}
                      {/* Closed-work indicator — both parties see it once the receiver is done */}
                      {done && !deleted && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 font-medium" title={`Marked done ${formatDateTime(m.doneAt)}`}>
                          <CheckCircle2 size={11} /> Done
                        </span>
                      )}
                      {!deleted && (
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => replyTo(m)} className="text-gray-400 hover:text-navy-600" title="Reply">
                            <CornerUpLeft size={13} />
                          </button>
                          {canDelete && (
                            <button onClick={() => remove(m)} className="text-gray-400 hover:text-red-500" title="Delete (sender only)">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Receiver's "Done" button — closes the work request so the sender can clear it */}
                    {canMarkDone && (
                      <button
                        onClick={() => markDone(m)}
                        className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold shadow-sm hover:bg-emerald-700 transition-colors"
                        style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}
                        title="Mark this work as done"
                      >
                        <Check size={12} /> Done
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      {view === 'active' && (
        <form onSubmit={send} className="border-t border-gray-100 px-3 sm:px-4 py-3 bg-white relative">
          {/* Mention autocomplete */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-3 sm:left-4 mb-1 w-64 bg-white rounded-xl shadow-lg ring-1 ring-gray-200 overflow-hidden z-20">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickMention(s.username)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-navy-50 transition-colors"
                >
                  {s.role === 'BROADCAST' ? (
                    <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0">
                      <Megaphone size={12} />
                    </span>
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-gray-200 text-gray-600 text-[10px] font-semibold flex items-center justify-center flex-shrink-0">
                      {initials(s.name)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-gray-800 truncate">@{s.username}</span>
                    <span className="block text-[10px] text-gray-400 truncate">
                      {s.role === 'BROADCAST' ? 'Send to all employees' : `${s.name} · ${roleLabel(s.role)}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-500 mb-1.5 px-1">{error}</p>}

          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); if (error) setError(''); }}
              onKeyDown={onKeyDown}
              rows={4}
              placeholder="@everyone or @username — then your message…"
              className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-400 max-h-40"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex-shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-xl bg-navy-700 text-white shadow-sm hover:bg-navy-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Send"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
