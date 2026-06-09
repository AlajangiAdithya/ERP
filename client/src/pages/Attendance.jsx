import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ClipboardList, Plus, Send, Pencil, Trash2, Lock, Calendar, ChevronLeft,
  ChevronRight, BarChart3, Users, User as UserIcon,
} from 'lucide-react';
import api from '../api/axios';
import PageHero from '../components/shared/PageHero';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

// ──────────────────────────────────────────────────────────────
// Attendance register.
//
// Two views, both backed by the same /api/attendance endpoints:
//   • Day view (default) — pick a date, edit every employee's IN/OUT for
//     that day on a single roomy row. Totals + OT compute live.
//   • Month view — pick one employee, see the whole month vertically with
//     one calendar row per day. Easy to scan a person's pattern.
//
// "Send to Accounts" finalizes the month and locks edits.
// Modification trail (dot + history) is shown to the unit's manager only.
// ──────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: '', label: '—' },
  { value: 'L', label: 'L — Leave' },
  { value: 'CL', label: 'CL — Casual Leave' },
  { value: 'SL', label: 'SL — Sick Leave' },
  { value: 'WO', label: 'WO — Weekly Off' },
  { value: 'H', label: 'H — Holiday' },
  { value: 'BAKRID', label: 'BAKRID — Festival' },
  { value: 'HYD', label: 'HYD — Off-site (Hyderabad)' },
];

const STATUS_COLOR = {
  L: 'bg-rose-100 text-rose-700 border-rose-200',
  CL: 'bg-rose-100 text-rose-700 border-rose-200',
  SL: 'bg-rose-100 text-rose-700 border-rose-200',
  WO: 'bg-slate-100 text-slate-600 border-slate-200',
  H: 'bg-amber-100 text-amber-700 border-amber-200',
  BAKRID: 'bg-amber-100 text-amber-700 border-amber-200',
  HYD: 'bg-indigo-100 text-indigo-700 border-indigo-200',
};

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STANDARD_DAY_MIN = 9 * 60;
const OT_THRESHOLD_MIN = 60;

const TIME_RE = /^\d{1,2}:\d{1,2}$/;
const isTimeLike = (s) => TIME_RE.test(String(s || '').trim());

const minutesOfTime = (hhmm) => {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = +m[1]; const mm = +m[2];
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
};

const formatHHmmFromMin = (min) => {
  if (min == null || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
};

const computeDayTotals = (entry) => {
  if (!entry || entry.statusCode) return { total: null, ot: null };
  const a = minutesOfTime(entry.inTime);
  const b = minutesOfTime(entry.outTime);
  if (a == null || b == null) return { total: null, ot: null };
  const span = b - a;
  if (span <= 0) return { total: null, ot: null };
  const over = span - STANDARD_DAY_MIN;
  return { total: span, ot: over >= OT_THRESHOLD_MIN ? over : 0 };
};

const ymdLocal = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseYmd = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

// ──────────────────────────────────────────────────────────────
export default function Attendance() {
  const today = new Date();
  const [view, setView] = useState('day');           // 'day' | 'month'
  const [dayDate, setDayDate] = useState(ymdLocal(today));
  const [monthYear, setMonthYear] = useState(today.getFullYear());
  const [monthIdx, setMonthIdx] = useState(today.getMonth() + 1); // 1..12

  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');

  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(false);

  const [focusedEmpId, setFocusedEmpId] = useState(null);
  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showHistory, setShowHistory] = useState(null);
  const [showSummary, setShowSummary] = useState(false);

  // The grid's year/month is driven by either dayDate (day view) or
  // monthYear+monthIdx (month view) so we only fetch what we need.
  const activeYM = useMemo(() => {
    if (view === 'day') {
      const d = parseYmd(dayDate);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    }
    return { year: monthYear, month: monthIdx };
  }, [view, dayDate, monthYear, monthIdx]);

  // ── load units once ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/attendance/units');
        setUnits(data.units || []);
        if (data.units?.length && !unitId) setUnitId(data.units[0].id);
      } catch (err) {
        console.error('Load attendance units failed', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadGrid = useCallback(async () => {
    if (!unitId) return;
    setLoading(true);
    try {
      const { data } = await api.get('/attendance/grid', {
        params: { unitId, year: activeYM.year, month: activeYM.month },
      });
      setEmployees(data.employees || []);
      setEntries(data.entries || []);
      setSubmission(data.submission || null);
      setCanEdit(!!data.canEdit);
      setIsManager(!!data.isManager);
      if (!focusedEmpId && data.employees?.length) {
        setFocusedEmpId(data.employees[0].id);
      }
    } catch (err) {
      console.error('Load attendance grid failed', err);
      if (err.response?.status === 403) {
        setEmployees([]); setEntries([]); setSubmission(null);
        setCanEdit(false); setIsManager(false);
      }
      alert(err.response?.data?.error || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [unitId, activeYM.year, activeYM.month, focusedEmpId]);

  useEffect(() => { reloadGrid(); }, [reloadGrid]);

  const entryMap = useMemo(() => {
    const map = new Map();
    for (const e of entries) map.set(`${e.employeeId}|${e.date}`, e);
    return map;
  }, [entries]);

  // ── save handler ────────────────────────────────────────────
  const saveCell = async (employeeId, date, fields) => {
    if (!canEdit) return;
    try {
      const { data } = await api.put('/attendance/entry', { employeeId, date, ...fields });
      setEntries((prev) => {
        const key = `${employeeId}|${date}`;
        const filtered = prev.filter((e) => `${e.employeeId}|${e.date}` !== key);
        filtered.push(data);
        return filtered;
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save');
      reloadGrid();
    }
  };

  const sendToAccounts = async () => {
    if (!confirm(`Send ${MONTH_NAMES[activeYM.month - 1]} ${activeYM.year} attendance to Accounts? The month will be locked from edits.`)) return;
    try {
      await api.post('/attendance/submit', { unitId, year: activeYM.year, month: activeYM.month });
      reloadGrid();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit');
    }
  };

  // ── day navigation ──────────────────────────────────────────
  const shiftDay = (delta) => {
    const d = parseYmd(dayDate);
    d.setDate(d.getDate() + delta);
    setDayDate(ymdLocal(d));
  };

  // ── per-employee summary (current loaded month) ─────────────
  const computeMonthSummary = useCallback((empId) => {
    let days = 0; let total = 0; let ot = 0;
    const statuses = {};
    for (const e of entries) {
      if (e.employeeId !== empId) continue;
      if (e.statusCode) {
        statuses[e.statusCode] = (statuses[e.statusCode] || 0) + 1;
        continue;
      }
      const { total: t, ot: o } = computeDayTotals(e);
      if (t != null) { days += 1; total += t; ot += o || 0; }
    }
    return { days, total, ot, statuses };
  }, [entries]);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1500px] mx-auto">
      <PageHero
        title="Attendance Register"
        subtitle={
          isManager
            ? 'Edit each day\'s IN / OUT for your unit. Total hours and OT compute automatically.'
            : 'Live view of unit attendance. The unit\'s manager is the only one who can edit cells.'
        }
        eyebrow="Daily & Monthly"
        icon={ClipboardList}
        actions={(
          <div className="flex flex-wrap gap-2 items-center">
            {units.length > 1 && (
              <select
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="px-3 py-1.5 rounded-md text-sm bg-white/10 border border-white/20 text-white"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id} className="text-gray-900">{u.name}</option>
                ))}
              </select>
            )}
            <Button variant="secondary" size="sm" onClick={() => setShowSummary(true)}>
              <BarChart3 size={14} /> Summary
            </Button>
            {canEdit && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setShowAddEmp(true)}>
                  <Plus size={14} /> Employee
                </Button>
                <Button variant="primary" size="sm" onClick={sendToAccounts}>
                  <Send size={14} /> Send to Accounts
                </Button>
              </>
            )}
          </div>
        )}
      />

      {/* View toggle + period nav */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg bg-white shadow-sm border border-gray-200 p-1">
          <button
            onClick={() => setView('day')}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition
              ${view === 'day' ? 'bg-navy-700 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            <Users size={14} /> Day View
          </button>
          <button
            onClick={() => setView('month')}
            className={`px-3.5 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 transition
              ${view === 'month' ? 'bg-navy-700 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
          >
            <Calendar size={14} /> Month View
          </button>
        </div>

        {view === 'day' ? (
          <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 shadow-sm px-2 py-1">
            <button
              onClick={() => shiftDay(-1)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
              aria-label="Previous day"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              value={dayDate}
              onChange={(e) => setDayDate(e.target.value)}
              className="px-2 py-1 text-sm border-0 focus:outline-none focus:ring-0 bg-transparent"
            />
            <button
              onClick={() => shiftDay(1)}
              className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
              aria-label="Next day"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setDayDate(ymdLocal(new Date()))}
              className="ml-1 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-navy-50 rounded"
            >
              Today
            </button>
            <span className="ml-1 px-2 text-sm text-gray-600">
              {parseYmd(dayDate).toLocaleDateString('en-US', { weekday: 'long' })}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 shadow-sm px-2 py-1">
            <select
              value={monthIdx}
              onChange={(e) => setMonthIdx(parseInt(e.target.value, 10))}
              className="px-2 py-1 text-sm border-0 focus:outline-none bg-transparent"
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={monthYear}
              onChange={(e) => setMonthYear(parseInt(e.target.value, 10))}
              className="px-2 py-1 text-sm border-0 focus:outline-none bg-transparent"
            >
              {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}

        {submission && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
            <Lock size={12} />
            Locked — sent to Accounts on {new Date(submission.submittedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 text-sm">
          Loading…
        </div>
      ) : !unitId ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 text-sm">
          No unit available.
        </div>
      ) : !employees.length ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500 text-sm">
          {canEdit ? 'No employees yet. Click "Employee" to add the first one.' : 'No employees in this unit.'}
        </div>
      ) : view === 'day' ? (
        <DayView
          employees={employees}
          date={dayDate}
          entryMap={entryMap}
          canEdit={canEdit}
          isManager={isManager}
          onSave={saveCell}
          onShowHistory={setShowHistory}
          onEditEmp={canEdit ? setShowAddEmp : null}
        />
      ) : (
        <MonthView
          employees={employees}
          year={activeYM.year}
          month={activeYM.month}
          entryMap={entryMap}
          canEdit={canEdit}
          isManager={isManager}
          focusedEmpId={focusedEmpId}
          onFocus={setFocusedEmpId}
          onSave={saveCell}
          onShowHistory={setShowHistory}
          monthSummary={computeMonthSummary}
        />
      )}

      {/* Modals */}
      {showAddEmp && (
        <EmployeeModal
          unitId={unitId}
          initial={typeof showAddEmp === 'object' ? showAddEmp : null}
          onClose={() => setShowAddEmp(false)}
          onSaved={() => { setShowAddEmp(false); reloadGrid(); }}
        />
      )}
      {showHistory && (
        <Modal isOpen onClose={() => setShowHistory(null)} title="Modification history" size="lg">
          <HistoryView entry={showHistory} />
        </Modal>
      )}
      {showSummary && (
        <Modal
          isOpen
          onClose={() => setShowSummary(false)}
          title={`${MONTH_NAMES[activeYM.month - 1]} ${activeYM.year} — Monthly Summary`}
          size="xl"
        >
          <MonthlySummary unitId={unitId} year={activeYM.year} month={activeYM.month} />
        </Modal>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// DAY VIEW
// ──────────────────────────────────────────────────────────────
function DayView({ employees, date, entryMap, canEdit, isManager, onSave, onShowHistory, onEditEmp }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
            <th className="px-4 py-3 text-left w-12">#</th>
            <th className="px-4 py-3 text-left">Employee</th>
            <th className="px-3 py-3 text-center w-28">IN</th>
            <th className="px-3 py-3 text-center w-28">OUT</th>
            <th className="px-3 py-3 text-center w-40">Status</th>
            <th className="px-3 py-3 text-center w-24">Hours</th>
            <th className="px-3 py-3 text-center w-24">OT</th>
            <th className="px-3 py-3 w-12" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {employees.map((emp) => {
            const entry = entryMap.get(`${emp.id}|${date}`);
            return (
              <DayRow
                key={emp.id}
                emp={emp}
                date={date}
                entry={entry}
                canEdit={canEdit}
                isManager={isManager}
                onSave={onSave}
                onShowHistory={onShowHistory}
                onEditEmp={onEditEmp}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DayRow({ emp, date, entry, canEdit, isManager, onSave, onShowHistory, onEditEmp }) {
  const [inVal, setInVal] = useState(entry?.inTime || '');
  const [outVal, setOutVal] = useState(entry?.outTime || '');
  const [status, setStatus] = useState(entry?.statusCode || '');

  useEffect(() => {
    setInVal(entry?.inTime || '');
    setOutVal(entry?.outTime || '');
    setStatus(entry?.statusCode || '');
  }, [entry?.inTime, entry?.outTime, entry?.statusCode, entry?.id]);

  const { total, ot } = computeDayTotals(entry);
  const wasModified = isManager && !!entry?.modifiedAt;

  const commitTime = (field, val) => {
    const v = val.trim();
    if (v === (field === 'inTime' ? (entry?.inTime || '') : (entry?.outTime || ''))) return;
    if (v !== '' && !isTimeLike(v)) {
      alert(`${field === 'inTime' ? 'IN' : 'OUT'} must be HH:mm`);
      if (field === 'inTime') setInVal(entry?.inTime || '');
      else setOutVal(entry?.outTime || '');
      return;
    }
    const fields = { [field]: v || null };
    // Setting a time clears any status code on the same cell.
    if (v && entry?.statusCode) fields.statusCode = null;
    onSave(emp.id, date, fields);
  };

  const commitStatus = (v) => {
    if (v === (entry?.statusCode || '')) return;
    if (v) onSave(emp.id, date, { statusCode: v, inTime: null, outTime: null });
    else onSave(emp.id, date, { statusCode: null });
  };

  return (
    <tr className="hover:bg-blue-50/40 transition">
      <td className="px-4 py-3 text-gray-500 font-medium">{emp.serialNo}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center text-xs font-semibold">
            {(emp.name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="font-medium text-gray-900 leading-tight">{emp.name}</div>
            {emp.empCode && <div className="text-xs text-gray-500">E.ID {emp.empCode}</div>}
          </div>
          {onEditEmp && (
            <button
              type="button"
              onClick={() => onEditEmp(emp)}
              className="ml-1 p-1 rounded hover:bg-navy-100 text-navy-600"
              aria-label="Edit employee"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        {canEdit ? (
          <input
            type="time"
            value={inVal}
            onChange={(e) => setInVal(e.target.value)}
            onBlur={(e) => commitTime('inTime', e.target.value)}
            disabled={!!status}
            className="w-24 px-2 py-1.5 text-sm text-center border border-gray-200 rounded-md focus:ring-2 focus:ring-navy-500 focus:border-navy-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
        ) : (
          <span className="text-gray-800">{entry?.inTime || '—'}</span>
        )}
      </td>
      <td className="px-3 py-3 text-center relative">
        {canEdit ? (
          <input
            type="time"
            value={outVal}
            onChange={(e) => setOutVal(e.target.value)}
            onBlur={(e) => commitTime('outTime', e.target.value)}
            disabled={!!status}
            className="w-24 px-2 py-1.5 text-sm text-center border border-gray-200 rounded-md focus:ring-2 focus:ring-navy-500 focus:border-navy-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
        ) : (
          <span className="text-gray-800">{entry?.outTime || '—'}</span>
        )}
      </td>
      <td className="px-3 py-3 text-center">
        {canEdit ? (
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); commitStatus(e.target.value); }}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : entry?.statusCode ? (
          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${STATUS_COLOR[entry.statusCode] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
            {entry.statusCode}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-center font-medium text-gray-800">
        {formatHHmmFromMin(total) || '—'}
      </td>
      <td className="px-3 py-3 text-center font-semibold text-amber-600">
        {formatHHmmFromMin(ot) || '—'}
      </td>
      <td className="px-3 py-3 text-center">
        {wasModified && (
          <button
            type="button"
            onClick={() => onShowHistory(entry)}
            title={`Modified ${new Date(entry.modifiedAt).toLocaleString()} by ${entry.modifiedByName || ''}`}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-600 hover:bg-orange-200"
          >
            <Pencil size={11} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────
// MONTH VIEW — one employee at a time, day-by-day rows
// ──────────────────────────────────────────────────────────────
function MonthView({
  employees, year, month, entryMap, canEdit, isManager,
  focusedEmpId, onFocus, onSave, onShowHistory, monthSummary,
}) {
  const focused = employees.find((e) => e.id === focusedEmpId) || employees[0];
  const total = monthSummary(focused.id);
  const days = daysInMonth(year, month);
  const dayList = Array.from({ length: days }, (_, i) => i + 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
      {/* Employee picker rail */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100 bg-gray-50">
          Employees
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {employees.map((emp) => {
            const s = monthSummary(emp.id);
            const active = emp.id === focused?.id;
            return (
              <button
                key={emp.id}
                onClick={() => onFocus(emp.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition
                  ${active ? 'bg-navy-50 border-l-2 border-l-navy-600' : 'hover:bg-gray-50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{emp.name}</div>
                    <div className="text-[11px] text-gray-500">
                      {emp.empCode ? `E.ID ${emp.empCode} · ` : ''}{s.days} days
                    </div>
                  </div>
                  {s.ot > 0 && (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      OT {Math.floor(s.ot/60)}h
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Monthly day grid for focused employee */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center font-semibold">
              <UserIcon size={16} />
            </div>
            <div>
              <div className="text-base font-semibold text-gray-900">{focused.name}</div>
              <div className="text-xs text-gray-500">
                {focused.empCode ? `E.ID ${focused.empCode} · ` : ''}{MONTH_SHORT[month - 1]} {year}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <StatTile label="Days" value={total.days} />
            <StatTile label="Total" value={formatHHmmFromMin(total.total) || '0h'} />
            <StatTile label="OT" value={formatHHmmFromMin(total.ot) || '0h'} accent="amber" />
          </div>
        </div>

        <div className="max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left w-16">Date</th>
                <th className="px-3 py-2 text-left w-20">Day</th>
                <th className="px-3 py-2 text-center w-28">IN</th>
                <th className="px-3 py-2 text-center w-28">OUT</th>
                <th className="px-3 py-2 text-center w-40">Status</th>
                <th className="px-3 py-2 text-center w-24">Hours</th>
                <th className="px-3 py-2 text-center w-20">OT</th>
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dayList.map((d) => {
                const ymd = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dt = new Date(year, month - 1, d);
                const dow = dt.toLocaleDateString('en-US', { weekday: 'short' });
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                const entry = entryMap.get(`${focused.id}|${ymd}`);
                return (
                  <MonthDayRow
                    key={d}
                    empId={focused.id}
                    date={ymd}
                    day={d}
                    dow={dow}
                    isWeekend={isWeekend}
                    entry={entry}
                    canEdit={canEdit}
                    isManager={isManager}
                    onSave={onSave}
                    onShowHistory={onShowHistory}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MonthDayRow({ empId, date, day, dow, isWeekend, entry, canEdit, isManager, onSave, onShowHistory }) {
  const [inVal, setInVal] = useState(entry?.inTime || '');
  const [outVal, setOutVal] = useState(entry?.outTime || '');
  const [status, setStatus] = useState(entry?.statusCode || '');

  useEffect(() => {
    setInVal(entry?.inTime || '');
    setOutVal(entry?.outTime || '');
    setStatus(entry?.statusCode || '');
  }, [entry?.inTime, entry?.outTime, entry?.statusCode, entry?.id]);

  const { total, ot } = computeDayTotals(entry);
  const wasModified = isManager && !!entry?.modifiedAt;

  const commitTime = (field, val) => {
    const v = val.trim();
    const cur = field === 'inTime' ? (entry?.inTime || '') : (entry?.outTime || '');
    if (v === cur) return;
    if (v !== '' && !isTimeLike(v)) {
      alert(`${field === 'inTime' ? 'IN' : 'OUT'} must be HH:mm`);
      if (field === 'inTime') setInVal(cur); else setOutVal(cur);
      return;
    }
    const fields = { [field]: v || null };
    if (v && entry?.statusCode) fields.statusCode = null;
    onSave(empId, date, fields);
  };

  const commitStatus = (v) => {
    if (v === (entry?.statusCode || '')) return;
    if (v) onSave(empId, date, { statusCode: v, inTime: null, outTime: null });
    else onSave(empId, date, { statusCode: null });
  };

  return (
    <tr className={isWeekend ? 'bg-gray-50/60' : ''}>
      <td className="px-3 py-2 font-medium text-gray-800">{day}</td>
      <td className={`px-3 py-2 text-xs ${isWeekend ? 'text-rose-600 font-medium' : 'text-gray-500'}`}>{dow}</td>
      <td className="px-3 py-2 text-center">
        {canEdit ? (
          <input
            type="time"
            value={inVal}
            onChange={(e) => setInVal(e.target.value)}
            onBlur={(e) => commitTime('inTime', e.target.value)}
            disabled={!!status}
            className="w-24 px-2 py-1.5 text-sm text-center border border-gray-200 rounded-md focus:ring-2 focus:ring-navy-500 focus:border-navy-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
        ) : (
          <span className="text-gray-800">{entry?.inTime || '—'}</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {canEdit ? (
          <input
            type="time"
            value={outVal}
            onChange={(e) => setOutVal(e.target.value)}
            onBlur={(e) => commitTime('outTime', e.target.value)}
            disabled={!!status}
            className="w-24 px-2 py-1.5 text-sm text-center border border-gray-200 rounded-md focus:ring-2 focus:ring-navy-500 focus:border-navy-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
        ) : (
          <span className="text-gray-800">{entry?.outTime || '—'}</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {canEdit ? (
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); commitStatus(e.target.value); }}
            className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : entry?.statusCode ? (
          <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${STATUS_COLOR[entry.statusCode] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
            {entry.statusCode}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-center font-medium text-gray-800">{formatHHmmFromMin(total) || '—'}</td>
      <td className="px-3 py-2 text-center font-semibold text-amber-600">{formatHHmmFromMin(ot) || '—'}</td>
      <td className="px-3 py-2 text-center">
        {wasModified && (
          <button
            type="button"
            onClick={() => onShowHistory(entry)}
            title={`Modified ${new Date(entry.modifiedAt).toLocaleString()} by ${entry.modifiedByName || ''}`}
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-600 hover:bg-orange-200"
          >
            <Pencil size={11} />
          </button>
        )}
      </td>
    </tr>
  );
}

function StatTile({ label, value, accent }) {
  const colors = accent === 'amber'
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-navy-50 text-navy-700 border-navy-200';
  return (
    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg border ${colors}`}>
      <div className="text-[10px] uppercase tracking-wide font-semibold opacity-80">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// EMPLOYEE / HISTORY / SUMMARY MODALS
// ──────────────────────────────────────────────────────────────
function EmployeeModal({ unitId, initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || '');
  const [empCode, setEmpCode] = useState(initial?.empCode || '');
  const [serialNo, setSerialNo] = useState(initial?.serialNo || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        empCode: empCode.trim() || null,
        serialNo: serialNo ? parseInt(serialNo, 10) : undefined,
      };
      if (initial?.id) {
        await api.put(`/attendance/employees/${initial.id}`, payload);
      } else {
        await api.post('/attendance/employees', { ...payload, unitId });
      }
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial?.id) return;
    if (!confirm(`Remove ${initial.name} from the register? (Past entries are kept.)`)) return;
    setBusy(true);
    try {
      await api.delete(`/attendance/employees/${initial.id}`);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={initial?.id ? 'Edit employee' : 'Add employee'}>
      <form onSubmit={submit} className="space-y-3">
        <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        <Input label="E.ID (employee code)" value={empCode} onChange={(e) => setEmpCode(e.target.value)} />
        <Input label="SL NO (leave blank to auto-assign)" value={serialNo} onChange={(e) => setSerialNo(e.target.value)} type="number" min={1} />
        <div className="flex justify-between pt-2 border-t">
          <div>
            {initial?.id && (
              <Button type="button" variant="danger" size="sm" onClick={remove} disabled={busy}>
                <Trash2 size={14} /> Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>
              {initial?.id ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function HistoryView({ entry }) {
  const list = Array.isArray(entry.history) ? entry.history : [];
  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-gray-500">
        Cell first saved: {new Date(entry.firstSavedAt).toLocaleString()}
      </div>
      {list.length === 0 ? (
        <div className="text-gray-500 italic">No modifications recorded.</div>
      ) : (
        <ol className="space-y-2">
          {list.map((h, i) => (
            <li key={i} className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{new Date(h.at).toLocaleString()}</span>
                <span>by {h.byName || '—'}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="font-semibold text-red-600 mb-0.5">From</div>
                  <div>IN: {h.from?.inTime || '—'}</div>
                  <div>OUT: {h.from?.outTime || '—'}</div>
                  <div>Status: {h.from?.statusCode || '—'}</div>
                </div>
                <div>
                  <div className="font-semibold text-green-600 mb-0.5">To</div>
                  <div>IN: {h.to?.inTime || '—'}</div>
                  <div>OUT: {h.to?.outTime || '—'}</div>
                  <div>Status: {h.to?.statusCode || '—'}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MonthlySummary({ unitId, year, month }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/attendance/monthly-summary', { params: { unitId, year, month } });
        setData(data);
      } catch (err) {
        alert(err.response?.data?.error || 'Failed to load summary');
      } finally {
        setLoading(false);
      }
    })();
  }, [unitId, year, month]);

  if (loading) return <div className="text-center text-gray-500 py-6">Loading…</div>;
  if (!data) return null;
  return (
    <div className="space-y-3 text-sm">
      {data.submission ? (
        <div className="bg-green-50 border border-green-200 text-green-800 text-xs rounded px-3 py-2">
          Submitted to Accounts on {new Date(data.submission.submittedAt).toLocaleString()} by {data.submission.submittedBy?.name || '—'}.
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-xs rounded px-3 py-2">
          Not yet sent to Accounts. Totals shown are live.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-2 py-2 border">SL</th>
              <th className="px-2 py-2 border">Name</th>
              <th className="px-2 py-2 border">E.ID</th>
              <th className="px-2 py-2 border text-center">Days</th>
              <th className="px-2 py-2 border text-center">Total Hrs</th>
              <th className="px-2 py-2 border text-center">OT Hrs</th>
              <th className="px-2 py-2 border">Leaves / Status</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-2 py-1.5 border">{r.serialNo}</td>
                <td className="px-2 py-1.5 border font-medium">{r.name}</td>
                <td className="px-2 py-1.5 border">{r.empCode || '—'}</td>
                <td className="px-2 py-1.5 border text-center">{r.daysWorked}</td>
                <td className="px-2 py-1.5 border text-center">{formatHHmmFromMin(r.totalMinutes) || '—'}</td>
                <td className="px-2 py-1.5 border text-center font-semibold text-amber-700">
                  {formatHHmmFromMin(r.otMinutes) || '—'}
                </td>
                <td className="px-2 py-1.5 border text-[10px]">
                  {Object.entries(r.statusCounts || {}).map(([k, v]) => `${k}:${v}`).join('  ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
