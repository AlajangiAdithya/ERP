import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, Clock,
  MapPin, Repeat, X,
} from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import PageHero from '../components/shared/PageHero';

// ── Colour palette (static Tailwind classes so JIT keeps them) ──
const COLOR_MAP = {
  blue:   { chip: 'bg-blue-100 text-blue-800 border-blue-200',     dot: 'bg-blue-500' },
  green:  { chip: 'bg-green-100 text-green-800 border-green-200',   dot: 'bg-green-500' },
  red:    { chip: 'bg-red-100 text-red-800 border-red-200',         dot: 'bg-red-500' },
  amber:  { chip: 'bg-amber-100 text-amber-800 border-amber-200',   dot: 'bg-amber-500' },
  purple: { chip: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-500' },
  pink:   { chip: 'bg-pink-100 text-pink-800 border-pink-200',      dot: 'bg-pink-500' },
  teal:   { chip: 'bg-teal-100 text-teal-800 border-teal-200',      dot: 'bg-teal-500' },
  gray:   { chip: 'bg-gray-100 text-gray-700 border-gray-200',      dot: 'bg-gray-500' },
};
const COLORS = Object.keys(COLOR_MAP);
const CATEGORY_PRESETS = ['Work', 'Personal', 'Meeting', 'Deadline', 'Reminder', 'Holiday'];
const RECURRENCE_OPTS = [
  ['NONE', 'Does not repeat'],
  ['DAILY', 'Daily'],
  ['WEEKLY', 'Weekly'],
  ['MONTHLY', 'Monthly'],
  ['YEARLY', 'Yearly'],
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Date helpers (Sunday-start week, local time) ──
const pad2 = (n) => String(n).padStart(2, '0');
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek  = (d) => addDays(startOfDay(d), -new Date(d).getDay());
const startOfMonth = (d) => { const x = startOfDay(d); x.setDate(1); return x; };
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const overlapsDay = (start, end, day) =>
  start.getTime() <= endOfDay(day).getTime() && end.getTime() >= startOfDay(day).getTime();

const toDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toLocalInput = (d) => `${toDateInput(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtTime = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const fmtDayLong = (d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

const emptyForm = (day) => {
  const base = day ? new Date(day) : new Date();
  if (!day) base.setMinutes(0, 0, 0);
  const start = new Date(base); start.setHours(day ? 9 : base.getHours() + 1, 0, 0, 0);
  const end = new Date(start); end.setHours(start.getHours() + 1);
  return {
    id: null, title: '', description: '', location: '',
    allDay: false,
    startLocal: toLocalInput(start), endLocal: toLocalInput(end),
    startDate: toDateInput(start), endDate: toDateInput(start),
    category: '', color: 'blue', recurrence: 'NONE', recurUntil: '',
  };
};

export default function Calendar() {
  const [view, setView] = useState('month');     // month | week | day
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState([]);       // occurrences in the visible window
  const [agenda, setAgenda] = useState([]);       // upcoming occurrences (today .. +30d)
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Visible window for the current view.
  const window_ = useMemo(() => {
    if (view === 'day') return { from: startOfDay(cursor), to: endOfDay(cursor) };
    if (view === 'week') { const s = startOfWeek(cursor); return { from: s, to: endOfDay(addDays(s, 6)) }; }
    const s = startOfWeek(startOfMonth(cursor));
    return { from: s, to: endOfDay(addDays(s, 41)) };
  }, [view, cursor]);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/calendar/events', {
        params: { from: window_.from.toISOString(), to: window_.to.toISOString() },
      });
      setEvents((data.events || []).map((e) => ({ ...e, _s: new Date(e.start), _e: new Date(e.end) })));
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [window_]);

  const fetchAgenda = useCallback(async () => {
    try {
      const from = startOfDay(new Date());
      const to = endOfDay(addDays(from, 30));
      const { data } = await api.get('/calendar/events', {
        params: { from: from.toISOString(), to: to.toISOString() },
      });
      setAgenda((data.events || []).map((e) => ({ ...e, _s: new Date(e.start), _e: new Date(e.end) })));
    } catch {
      setAgenda([]);
    }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchAgenda(); }, [fetchAgenda]);

  const categories = useMemo(() => {
    const set = new Set();
    events.forEach((e) => { if (e.category) set.add(e.category); });
    return Array.from(set).sort();
  }, [events]);

  const shown = useMemo(
    () => (categoryFilter === 'ALL' ? events : events.filter((e) => e.category === categoryFilter)),
    [events, categoryFilter],
  );

  const eventsForDay = useCallback(
    (day) => shown.filter((e) => overlapsDay(e._s, e._e, day)).sort((a, b) => a._s - b._s),
    [shown],
  );

  // ── Navigation ──
  const step = (dir) => {
    if (view === 'day') setCursor((c) => addDays(c, dir));
    else if (view === 'week') setCursor((c) => addDays(c, dir * 7));
    else { const x = new Date(cursor); x.setMonth(x.getMonth() + dir); setCursor(startOfDay(x)); }
  };
  const goToday = () => setCursor(startOfDay(new Date()));

  const headerLabel = useMemo(() => {
    if (view === 'day') return cursor.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (view === 'week') {
      const s = startOfWeek(cursor); const e = addDays(s, 6);
      return `${s.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    }
    return cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  }, [view, cursor]);

  // ── Modal open helpers ──
  const openCreate = (day) => { setError(''); setForm(emptyForm(day)); setModalOpen(true); };
  const openEdit = (occ) => {
    setError('');
    const s = new Date(occ.baseStart); const e = new Date(occ.baseEnd);
    setForm({
      id: occ.id, title: occ.title, description: occ.description || '', location: occ.location || '',
      allDay: !!occ.allDay,
      startLocal: toLocalInput(s), endLocal: toLocalInput(e),
      startDate: toDateInput(s), endDate: toDateInput(e),
      category: occ.category || '', color: occ.color || 'blue',
      recurrence: occ.recurrence || 'NONE',
      recurUntil: occ.recurUntil ? toDateInput(new Date(occ.recurUntil)) : '',
    });
    setModalOpen(true);
  };

  const buildPayload = () => {
    const startAt = form.allDay ? `${form.startDate}T00:00` : form.startLocal;
    const endAt = form.allDay ? `${form.endDate || form.startDate}T23:59` : form.endLocal;
    return {
      title: form.title, description: form.description, location: form.location,
      startAt, endAt, allDay: form.allDay,
      category: form.category, color: form.color,
      recurrence: form.recurrence,
      recurUntil: form.recurrence !== 'NONE' ? (form.recurUntil || null) : null,
    };
  };

  const save = async () => {
    if (!form.title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = buildPayload();
      if (form.id) await api.put(`/calendar/events/${form.id}`, payload);
      else await api.post('/calendar/events', payload);
      setModalOpen(false);
      fetchEvents(); fetchAgenda();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save event');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form.id) return;
    if (!window.confirm('Delete this event? If it repeats, the whole series is removed.')) return;
    setSaving(true);
    try {
      await api.delete(`/calendar/events/${form.id}`);
      setModalOpen(false);
      fetchEvents(); fetchAgenda();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete event');
    } finally {
      setSaving(false);
    }
  };

  const today = startOfDay(new Date());

  // ── Event chip ──
  const Chip = ({ occ, showTime = true }) => {
    const c = COLOR_MAP[occ.color] || COLOR_MAP.blue;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); openEdit(occ); }}
        className={`w-full text-left truncate rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-tight hover:brightness-95 ${c.chip}`}
        title={`${occ.title}${occ.location ? ' · ' + occ.location : ''}`}
      >
        {occ.recurrence !== 'NONE' && <Repeat size={9} className="inline mr-0.5 -mt-0.5" />}
        {showTime && !occ.allDay && <span className="tabular-nums">{fmtTime(occ._s)} </span>}
        {occ.title}
      </button>
    );
  };

  // ── Month grid ──
  const renderMonth = () => {
    const first = startOfWeek(startOfMonth(cursor));
    const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
    return (
      <div className="grid grid-cols-7 gap-px bg-navy-100 rounded-xl overflow-hidden border border-navy-100">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-navy-50 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-navy-500">{d}</div>
        ))}
        {cells.map((day) => {
          const inMonth = day.getMonth() === cursor.getMonth();
          const isToday = sameDay(day, today);
          const dayEvents = eventsForDay(day);
          return (
            <div
              key={day.toISOString()}
              onClick={() => openCreate(day)}
              className={`min-h-[96px] p-1.5 cursor-pointer transition-colors ${inMonth ? 'bg-white hover:bg-navy-50/60' : 'bg-gray-50/70 text-gray-400'}`}
            >
              <div className="flex justify-end">
                <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-navy-700 text-white' : inMonth ? 'text-navy-700' : 'text-gray-400'}`}>
                  {day.getDate()}
                </span>
              </div>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map((occ, i) => <Chip key={occ.id + i} occ={occ} />)}
                {dayEvents.length > 3 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setView('day'); setCursor(startOfDay(day)); }}
                    className="text-[10px] font-semibold text-navy-500 hover:text-navy-700 pl-1"
                  >
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Week grid (7 day-columns, agenda style per column) ──
  const renderWeek = () => {
    const first = startOfWeek(cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
    return (
      <div className="grid grid-cols-7 gap-px bg-navy-100 rounded-xl overflow-hidden border border-navy-100">
        {days.map((day) => {
          const isToday = sameDay(day, today);
          const dayEvents = eventsForDay(day);
          return (
            <div key={day.toISOString()} onClick={() => openCreate(day)} className="bg-white hover:bg-navy-50/40 cursor-pointer min-h-[320px] flex flex-col">
              <div className={`text-center py-2 border-b border-navy-100 ${isToday ? 'bg-navy-700 text-white' : 'bg-navy-50 text-navy-600'}`}>
                <div className="text-[10px] font-bold uppercase">{WEEKDAYS[day.getDay()]}</div>
                <div className="text-base font-semibold">{day.getDate()}</div>
              </div>
              <div className="p-1.5 space-y-1 flex-1">
                {dayEvents.map((occ, i) => <Chip key={occ.id + i} occ={occ} />)}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ── Day view (single timed list) ──
  const renderDay = () => {
    const dayEvents = eventsForDay(cursor);
    return (
      <div className="rounded-xl border border-navy-100 overflow-hidden">
        <div className="bg-navy-50 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm font-semibold text-navy-700">{cursor.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <Button size="sm" variant="secondary" onClick={() => openCreate(cursor)}><Plus size={14} /> Add</Button>
        </div>
        {dayEvents.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">Nothing scheduled. Click “Add” to create an event.</div>
        ) : (
          <div className="divide-y divide-navy-50">
            {dayEvents.map((occ, i) => {
              const c = COLOR_MAP[occ.color] || COLOR_MAP.blue;
              return (
                <button key={occ.id + i} onClick={() => openEdit(occ)} className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-navy-50/50">
                  <span className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${c.dot}`} />
                  <div className="w-28 flex-shrink-0 text-xs font-semibold text-navy-600 tabular-nums pt-0.5">
                    {occ.allDay ? 'All day' : `${fmtTime(occ._s)} – ${fmtTime(occ._e)}`}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-navy-800 flex items-center gap-1.5">
                      {occ.title}
                      {occ.recurrence !== 'NONE' && <Repeat size={12} className="text-navy-400" />}
                    </div>
                    {occ.location && <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><MapPin size={11} /> {occ.location}</div>}
                    {occ.description && <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">{occ.description}</div>}
                    {occ.category && <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-wide text-navy-400">{occ.category}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── "What's happening" agenda (today + upcoming) ──
  const agendaGroups = useMemo(() => {
    const now = new Date();
    const upcoming = agenda
      .filter((e) => e._e >= now)
      .sort((a, b) => a._s - b._s)
      .slice(0, 25);
    const groups = [];
    let curKey = null;
    upcoming.forEach((e) => {
      const key = toDateInput(e._s);
      if (key !== curKey) { groups.push({ key, day: startOfDay(e._s), items: [] }); curKey = key; }
      groups[groups.length - 1].items.push(e);
    });
    return groups;
  }, [agenda]);

  const dayHeading = (day) => {
    if (sameDay(day, today)) return 'Today';
    if (sameDay(day, addDays(today, 1))) return 'Tomorrow';
    return fmtDayLong(day);
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="My Calendar"
        subtitle="Your personal calendar and reminders — only you can see these."
        eyebrow="Planner"
        icon={CalendarDays}
        actions={<Button variant="secondary" onClick={() => openCreate(null)}><Plus size={16} /> New event</Button>}
      />

      <Card className="p-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1">
            <button onClick={() => step(-1)} className="p-1.5 rounded-lg hover:bg-navy-100 text-navy-600"><ChevronLeft size={18} /></button>
            <button onClick={() => step(1)} className="p-1.5 rounded-lg hover:bg-navy-100 text-navy-600"><ChevronRight size={18} /></button>
            <Button size="sm" variant="secondary" onClick={goToday} className="ml-1">Today</Button>
          </div>
          <h2 className="text-lg font-bold text-navy-800 min-w-[180px]">{headerLabel}</h2>

          <div className="ml-auto flex items-center gap-2">
            {categories.length > 0 && (
              <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="w-40">
                <option value="ALL">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
            <div className="flex rounded-lg border border-navy-200 overflow-hidden">
              {['month', 'week', 'day'].map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-sm font-semibold capitalize ${view === v ? 'bg-navy-700 text-white' : 'bg-white text-navy-600 hover:bg-navy-50'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <>
            {view === 'month' && renderMonth()}
            {view === 'week' && renderWeek()}
            {view === 'day' && renderDay()}
          </>
        )}
      </Card>

      {/* What's happening */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={18} className="text-navy-600" />
          <h3 className="text-base font-bold text-navy-800">What's happening</h3>
          <span className="text-xs text-gray-400">next 30 days</span>
        </div>
        {agendaGroups.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">Nothing coming up. You're all clear.</p>
        ) : (
          <div className="space-y-4">
            {agendaGroups.map((g) => (
              <div key={g.key}>
                <div className="text-[11px] font-bold uppercase tracking-wide text-navy-500 mb-1.5">{dayHeading(g.day)}</div>
                <div className="space-y-1">
                  {g.items.map((e, i) => {
                    const c = COLOR_MAP[e.color] || COLOR_MAP.blue;
                    return (
                      <button key={e.id + i} onClick={() => openEdit(e)} className="w-full text-left flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-navy-50">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                        <span className="text-xs font-semibold text-navy-600 tabular-nums w-20 flex-shrink-0">{e.allDay ? 'All day' : fmtTime(e._s)}</span>
                        <span className="text-sm text-navy-800 truncate">{e.title}</span>
                        {e.location && <span className="text-xs text-gray-400 truncate hidden sm:inline">· {e.location}</span>}
                        {e.recurrence !== 'NONE' && <Repeat size={11} className="text-navy-300 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Event modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit event' : 'New event'} size="lg">
        <div className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}

          <Input label="Title *" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Team review, Pay vendor, Doctor…" autoFocus />

          <label className="flex items-center gap-2 text-sm font-medium text-navy-700">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="rounded border-navy-300" />
            All day
          </label>

          {form.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Start date" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              <Input label="End date" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Input label="Starts" type="datetime-local" value={form.startLocal} onChange={(e) => setForm({ ...form, startLocal: e.target.value })} />
              <Input label="Ends" type="datetime-local" value={form.endLocal} onChange={(e) => setForm({ ...form, endLocal: e.target.value })} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Input label="Category" list="cal-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Work, Personal…" />
              <datalist id="cal-cats">{CATEGORY_PRESETS.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <Input label="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Optional" />
          </div>

          <div>
            <span className="block text-[13px] font-semibold text-navy-700 mb-1.5">Colour</span>
            <div className="flex gap-2">
              {COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setForm({ ...form, color: col })}
                  className={`w-7 h-7 rounded-full ${COLOR_MAP[col].dot} ring-offset-2 transition ${form.color === col ? 'ring-2 ring-navy-500' : 'hover:scale-110'}`}
                  title={col}
                />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Repeat" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
              {RECURRENCE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {form.recurrence !== 'NONE' && (
              <Input label="Repeat until (optional)" type="date" value={form.recurUntil} onChange={(e) => setForm({ ...form, recurUntil: e.target.value })} />
            )}
          </div>

          <Textarea label="Notes" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional details / reminder text" />

          <div className="flex items-center justify-between pt-2 border-t border-navy-100">
            {form.id ? (
              <Button variant="ghost" onClick={remove} disabled={saving} className="text-red-600 hover:bg-red-50"><Trash2 size={16} /> Delete</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}><X size={16} /> Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Save changes' : 'Create event'}</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
