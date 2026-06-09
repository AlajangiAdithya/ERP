import { useEffect, useMemo, useState, useCallback, Fragment } from 'react';
import {
  ClipboardList, Plus, Send, Pencil, Trash2, Lock,
} from 'lucide-react';
import api from '../api/axios';
import PageHero from '../components/shared/PageHero';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

// ──────────────────────────────────────────────────────────────
// Attendance register — month-grid view.
//
// • Managers: full edit of their own unit. IN/OUT cells are inline-editable;
//   cells that have been modified after first save show a small pencil dot
//   underneath (only managers see this). Hovering the dot reveals who changed
//   what and when.
// • ADMIN / SAFETY: read-only view of every unit's grid. No modification
//   indicators.
// • ACCOUNTING: read-only, and only AFTER the manager has sent the month to
//   accounts. Sees per-employee totals.
//
// Status codes appear in cells instead of times (L, HYD, BAKRID, H, …).
// To enter a status: type the code into the IN cell and leave OUT blank.
// ──────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  L: 'Leave',
  HYD: 'Hyderabad',
  BAKRID: 'Holiday',
  H: 'Holiday',
  WO: 'Weekly Off',
  CL: 'Casual Leave',
  SL: 'Sick Leave',
};

const TIME_RE = /^\d{1,2}:\d{1,2}$/;
const isTimeLike = (s) => TIME_RE.test(String(s || '').trim());

const minutesOfTime = (hhmm) => {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
};

const formatHHmmFromMin = (min) => {
  if (min == null || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const STANDARD_DAY_MIN = 9 * 60;
const OT_THRESHOLD_MIN = 60;

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

const dayOfWeekShort = (year, month, day) => {
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'short' });
};

const buildEntryMap = (entries) => {
  const map = new Map();
  for (const e of entries || []) {
    map.set(`${e.employeeId}|${e.date}`, e);
  }
  return map;
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Attendance() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const [units, setUnits] = useState([]);
  const [unitId, setUnitId] = useState('');

  const [employees, setEmployees] = useState([]);
  const [entries, setEntries] = useState([]);
  const [submission, setSubmission] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(31);

  const [showAddEmp, setShowAddEmp] = useState(false);
  const [showHistory, setShowHistory] = useState(null); // entry object
  const [showSummary, setShowSummary] = useState(false);

  // ── load units once ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/attendance/units');
        setUnits(data.units || []);
        if (data.units?.length && !unitId) {
          setUnitId(data.units[0].id);
        }
      } catch (err) {
        console.error('Load attendance units failed', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load grid when unit/year/month changes ──────────────────
  const reloadGrid = useCallback(async () => {
    if (!unitId) return;
    setLoading(true);
    try {
      const { data } = await api.get('/attendance/grid', { params: { unitId, year, month } });
      setEmployees(data.employees || []);
      setEntries(data.entries || []);
      setSubmission(data.submission || null);
      setCanEdit(!!data.canEdit);
      setIsManager(!!data.isManager);
      setDays(data.days || 31);
    } catch (err) {
      console.error('Load attendance grid failed', err);
      const msg = err.response?.data?.error || 'Failed to load attendance';
      if (err.response?.status === 403) {
        setEmployees([]); setEntries([]); setSubmission(null);
        setCanEdit(false); setIsManager(false);
      }
      alert(msg);
    } finally {
      setLoading(false);
    }
  }, [unitId, year, month]);

  useEffect(() => { reloadGrid(); }, [reloadGrid]);

  const entryMap = useMemo(() => buildEntryMap(entries), [entries]);
  const dayList = useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);

  const ymdOf = (d) => `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // ── save handler (debounced via onBlur) ─────────────────────
  const saveCell = async (employeeId, day, field, raw) => {
    if (!canEdit) return;
    const date = ymdOf(day);
    const val = String(raw || '').trim();

    // Detect status code vs time
    let payload = { employeeId, date };
    if (field === 'inTime') {
      if (val === '') {
        // Clearing IN also clears any status code so the cell becomes blank.
        payload.inTime = null;
        payload.statusCode = null;
      } else if (isTimeLike(val)) {
        payload.inTime = val;
        // If user clears status while entering time
        const existing = entryMap.get(`${employeeId}|${date}`);
        if (existing?.statusCode) payload.statusCode = null;
      } else {
        // Treat as status code
        payload.statusCode = val.toUpperCase();
        payload.inTime = null;
        payload.outTime = null;
      }
    } else if (field === 'outTime') {
      if (val === '') payload.outTime = null;
      else if (isTimeLike(val)) {
        payload.outTime = val;
      } else {
        alert('OUT must be HH:mm (24h). Enter status codes in the IN column.');
        return;
      }
    }

    try {
      const { data } = await api.put('/attendance/entry', payload);
      setEntries((prev) => {
        const key = `${employeeId}|${date}`;
        const filtered = prev.filter((e) => `${e.employeeId}|${e.date}` !== key);
        filtered.push(data);
        return filtered;
      });
    } catch (err) {
      console.error('Save cell failed', err);
      alert(err.response?.data?.error || 'Failed to save');
      reloadGrid();
    }
  };

  // ── summaries (totals per employee) ─────────────────────────
  const employeeSummary = (empId) => {
    let daysWorked = 0;
    let totalMin = 0;
    let otMin = 0;
    for (const d of dayList) {
      const e = entryMap.get(`${empId}|${ymdOf(d)}`);
      if (!e) continue;
      const { total, ot } = computeDayTotals(e);
      if (total != null) {
        daysWorked += 1;
        totalMin += total;
        otMin += ot || 0;
      }
    }
    return { daysWorked, totalMin, otMin };
  };

  // ── render ──────────────────────────────────────────────────
  const monthName = MONTH_NAMES[month - 1];

  const sendToAccounts = async () => {
    if (!confirm(`Send ${monthName} ${year} attendance to Accounts? Once submitted, this month will be locked from edits.`)) return;
    try {
      await api.post('/attendance/submit', { unitId, year, month });
      reloadGrid();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to submit');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1700px] mx-auto">
      <PageHero
        title="Attendance Register"
        subtitle={
          isManager
            ? 'Maintain your unit\'s daily IN / OUT punches. Total hours and OT are computed automatically.'
            : 'View attendance maintained by each unit\'s manager. Modification details are private to the unit manager.'
        }
        eyebrow="Monthly Attendance"
        icon={ClipboardList}
        actions={(
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value, 10))}
              className="px-3 py-1.5 rounded-md text-sm bg-white/10 border border-white/20 text-white"
            >
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1} className="text-gray-900">{m}</option>
              ))}
            </select>
            <select
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value, 10))}
              className="px-3 py-1.5 rounded-md text-sm bg-white/10 border border-white/20 text-white"
            >
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y} className="text-gray-900">{y}</option>
              ))}
            </select>
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
              Monthly Summary
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

      {submission && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 flex items-center gap-2 text-sm">
          <Lock size={16} />
          <span>
            This month was sent to Accounts on{' '}
            <strong>{new Date(submission.submittedAt).toLocaleString()}</strong>. The register is locked.
          </span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-card border border-navy-100/60 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-500 text-sm">Loading…</div>
        ) : !unitId ? (
          <div className="p-10 text-center text-gray-500 text-sm">No unit available.</div>
        ) : !employees.length ? (
          <div className="p-10 text-center text-gray-500 text-sm">
            {canEdit ? 'No employees yet. Click "Employee" to add the first one.' : 'No employees in this unit.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse text-[11px]" style={{ minWidth: 260 + days * 96 }}>
              <thead className="sticky top-0 bg-navy-700 text-white z-10">
                <tr>
                  <th className="sticky left-0 bg-navy-700 px-2 py-2 text-left w-10 border-r border-white/20">SL</th>
                  <th className="sticky left-10 bg-navy-700 px-2 py-2 text-left min-w-[170px] border-r border-white/20">NAME (E.ID)</th>
                  {dayList.map((d) => (
                    <th key={d} colSpan={2} className="px-1 py-1 text-center border-r border-white/20 min-w-[90px]">
                      <div className="text-[9px] uppercase opacity-70">{dayOfWeekShort(year, month, d)}</div>
                      <div className="text-[12px] font-semibold leading-tight">{d}</div>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center bg-navy-800 min-w-[80px]">DAYS</th>
                  <th className="px-2 py-2 text-center bg-navy-800 min-w-[80px]">TOTAL</th>
                  <th className="px-2 py-2 text-center bg-navy-800 min-w-[70px]">OT</th>
                </tr>
                <tr className="bg-navy-600 text-white text-[10px]">
                  <th className="sticky left-0 bg-navy-600 border-r border-white/20" />
                  <th className="sticky left-10 bg-navy-600 border-r border-white/20" />
                  {dayList.map((d) => (
                    <Fragment key={d}>
                      <th className="px-1 py-1 border-r border-white/10">IN</th>
                      <th className="px-1 py-1 border-r border-white/20">OUT</th>
                    </Fragment>
                  ))}
                  <th className="bg-navy-700" />
                  <th className="bg-navy-700" />
                  <th className="bg-navy-700" />
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, idx) => {
                  const sum = employeeSummary(emp.id);
                  const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                  return (
                    <EmployeeRow
                      key={emp.id}
                      emp={emp}
                      year={year}
                      month={month}
                      dayList={dayList}
                      ymdOf={ymdOf}
                      entryMap={entryMap}
                      canEdit={canEdit}
                      isManager={isManager}
                      onSaveCell={saveCell}
                      onShowHistory={setShowHistory}
                      onEditEmp={canEdit ? () => setShowAddEmp(emp) : null}
                      summary={sum}
                      rowBg={rowBg}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / edit employee modal */}
      {showAddEmp && (
        <EmployeeModal
          unitId={unitId}
          initial={typeof showAddEmp === 'object' ? showAddEmp : null}
          onClose={() => setShowAddEmp(false)}
          onSaved={() => { setShowAddEmp(false); reloadGrid(); }}
        />
      )}

      {/* Modification history modal (managers only) */}
      {showHistory && (
        <Modal isOpen onClose={() => setShowHistory(null)} title="Modification history" size="lg">
          <HistoryView entry={showHistory} />
        </Modal>
      )}

      {/* Monthly summary modal */}
      {showSummary && (
        <Modal isOpen onClose={() => setShowSummary(false)} title={`${monthName} ${year} — Monthly Summary`} size="xl">
          <MonthlySummary unitId={unitId} year={year} month={month} />
        </Modal>
      )}
    </div>
  );
}

// ─── Employee row ──────────────────────────────────────────────
function EmployeeRow({
  emp, dayList, ymdOf, entryMap, canEdit, isManager,
  onSaveCell, onShowHistory, onEditEmp, summary, rowBg,
}) {
  return (
    <>
      {/* Row 1: IN / OUT */}
      <tr className={`${rowBg} border-b border-gray-200`}>
        <td rowSpan={3} className={`sticky left-0 ${rowBg} px-2 py-1 align-top text-gray-700 font-semibold border-r border-gray-200`}>
          {emp.serialNo}
        </td>
        <td rowSpan={3} className={`sticky left-10 ${rowBg} px-2 py-1 align-top border-r border-gray-200`}>
          <div className="font-semibold text-gray-900 leading-tight">{emp.name}</div>
          {emp.empCode && <div className="text-[10px] text-gray-500">E.ID {emp.empCode}</div>}
          {onEditEmp && (
            <button
              type="button"
              onClick={onEditEmp}
              className="mt-1 inline-flex items-center gap-1 text-[10px] text-navy-600 hover:underline"
            >
              <Pencil size={10} /> edit
            </button>
          )}
        </td>
        {dayList.map((d) => {
          const e = entryMap.get(`${emp.id}|${ymdOf(d)}`);
          return (
            <DayInOut
              key={d}
              day={d}
              entry={e}
              canEdit={canEdit}
              isManager={isManager}
              onSave={(field, val) => onSaveCell(emp.id, d, field, val)}
              onShowHistory={onShowHistory}
            />
          );
        })}
        <td rowSpan={3} className="px-2 py-1 text-center bg-blue-50 border-l border-gray-200 font-semibold text-navy-700">
          {summary.daysWorked}
        </td>
        <td rowSpan={3} className="px-2 py-1 text-center bg-blue-50 font-semibold text-navy-700">
          {formatHHmmFromMin(summary.totalMin) || '—'}
        </td>
        <td rowSpan={3} className="px-2 py-1 text-center bg-amber-50 font-semibold text-amber-700">
          {formatHHmmFromMin(summary.otMin) || '—'}
        </td>
      </tr>
      {/* Row 2: Total working hrs */}
      <tr className={`${rowBg} text-[10px] text-gray-600`}>
        {dayList.map((d) => {
          const e = entryMap.get(`${emp.id}|${ymdOf(d)}`);
          const { total } = computeDayTotals(e);
          return (
            <td key={d} colSpan={2} className="px-1 py-0.5 text-center border-r border-gray-200">
              {e?.statusCode ? <span className="italic">{STATUS_LABELS[e.statusCode] || ''}</span> : formatHHmmFromMin(total)}
            </td>
          );
        })}
      </tr>
      {/* Row 3: OT */}
      <tr className={`${rowBg} text-[10px] text-amber-700 border-b-2 border-gray-300`}>
        {dayList.map((d) => {
          const e = entryMap.get(`${emp.id}|${ymdOf(d)}`);
          const { ot } = computeDayTotals(e);
          return (
            <td key={d} colSpan={2} className="px-1 py-0.5 text-center border-r border-gray-200">
              {ot ? formatHHmmFromMin(ot) : ''}
            </td>
          );
        })}
      </tr>
    </>
  );
}

// ─── A single day's IN/OUT pair ───────────────────────────────
function DayInOut({ day, entry, canEdit, isManager, onSave, onShowHistory }) {
  const inVal = entry?.statusCode ? entry.statusCode : (entry?.inTime || '');
  const outVal = entry?.outTime || '';
  const wasModified = isManager && !!entry?.modifiedAt;
  const bg = entry?.statusCode
    ? 'bg-purple-50'
    : (entry?.inTime || entry?.outTime ? '' : 'bg-gray-50/50');

  if (!canEdit) {
    return (
      <>
        <td className={`px-1 py-1 text-center border-r border-gray-200 ${bg} relative`}>
          <span className={entry?.statusCode ? 'text-purple-700 font-semibold' : 'text-gray-800'}>
            {inVal || ''}
          </span>
        </td>
        <td className={`px-1 py-1 text-center border-r border-gray-200 ${bg}`}>
          <span className="text-gray-800">{outVal}</span>
        </td>
      </>
    );
  }

  return (
    <>
      <td className={`px-0.5 py-0.5 border-r border-gray-200 ${bg} relative`}>
        <input
          type="text"
          defaultValue={inVal}
          onBlur={(e) => {
            if (e.target.value === inVal) return;
            onSave('inTime', e.target.value);
          }}
          className="w-full px-1 py-0.5 text-center text-[11px] bg-transparent focus:bg-white focus:ring-1 focus:ring-navy-500 rounded"
          placeholder="HH:mm"
        />
        {wasModified && (
          <button
            type="button"
            onClick={() => onShowHistory(entry)}
            title={`Modified ${new Date(entry.modifiedAt).toLocaleString()} by ${entry.modifiedByName || ''}`}
            className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-1.5 h-1.5 rounded-full bg-orange-500 hover:scale-150 transition"
          />
        )}
      </td>
      <td className={`px-0.5 py-0.5 border-r border-gray-200 ${bg}`}>
        <input
          type="text"
          defaultValue={outVal}
          onBlur={(e) => {
            if (e.target.value === outVal) return;
            onSave('outTime', e.target.value);
          }}
          className="w-full px-1 py-0.5 text-center text-[11px] bg-transparent focus:bg-white focus:ring-1 focus:ring-navy-500 rounded"
          placeholder="HH:mm"
        />
      </td>
    </>
  );
}

// ─── Add / edit employee modal ────────────────────────────────
function EmployeeModal({ unitId, initial, onClose, onSaved }) {
  const [name, setName] = useState(initial?.name || '');
  const [empCode, setEmpCode] = useState(initial?.empCode || '');
  const [serialNo, setSerialNo] = useState(initial?.serialNo || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (initial?.id) {
        await api.put(`/attendance/employees/${initial.id}`, {
          name: name.trim(),
          empCode: empCode.trim() || null,
          serialNo: serialNo ? parseInt(serialNo, 10) : undefined,
        });
      } else {
        await api.post('/attendance/employees', {
          unitId,
          name: name.trim(),
          empCode: empCode.trim() || null,
          serialNo: serialNo ? parseInt(serialNo, 10) : undefined,
        });
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
    if (!confirm(`Remove ${initial.name} from the register? (Their past entries are kept.)`)) return;
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

// ─── History view (manager-only) ──────────────────────────────
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
                  <div className="font-semibold text-red-600">From</div>
                  <div>IN: {h.from?.inTime || '—'}</div>
                  <div>OUT: {h.from?.outTime || '—'}</div>
                  <div>Status: {h.from?.statusCode || '—'}</div>
                </div>
                <div>
                  <div className="font-semibold text-green-600">To</div>
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

// ─── Monthly summary (totals per employee) ────────────────────
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
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="px-2 py-2 border">SL</th>
            <th className="px-2 py-2 border">Name</th>
            <th className="px-2 py-2 border">E.ID</th>
            <th className="px-2 py-2 border text-center">Days Worked</th>
            <th className="px-2 py-2 border text-center">Total Hours</th>
            <th className="px-2 py-2 border text-center">OT Hours</th>
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
  );
}
