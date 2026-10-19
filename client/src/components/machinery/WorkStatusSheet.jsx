import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Lock, AlertTriangle, Check, BarChart3, Eraser,
} from 'lucide-react';
import api from '../../api/axios';
import Button from '../ui/Button';
import MachinePicker from './MachinePicker';
import MachineInfoPopover from './MachineInfoPopover';
import ExportExcelButton from '../shared/ExportExcelButton';

// The sheet: one machine, one month, a row per day. A faithful copy of
// "WORKING MACHINE STATUS FILE.xlsx" - same two header lines, same eight
// columns - because staff still circulate that file and anything that looks
// different gets ignored in favour of the spreadsheet.
//
// Cells save on blur. Read-only viewers get plain text rather than disabled
// inputs: a manager looking at another unit should be reading data, not
// staring at a wall of greyed-out boxes.

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const hhmm = (mins) => (mins === null || mins === undefined
  ? ''
  : `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`);

const hoursLabel = (mins) => (mins === null || mins === undefined
  ? ''
  : (Math.round((mins / 60) * 10) / 10).toString());

const shiftMonth = (month, delta) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

// Anything past 16 hours is almost always a mistyped OFF time rather than a
// genuine overnight run, so flag it without refusing to store it.
const LONG_RUN_MINUTES = 16 * 60;

const COLS = [
  { key: 'serial', label: 'S.No' },
  { key: 'logDate', label: 'DATE' },
  { key: 'work', label: 'work' },
  { key: 'onPerson', label: 'MC Operator / ON Person' },
  { key: 'onTime', label: 'ON Time' },
  { key: 'offPerson', label: 'MC Operator / OFF Person' },
  { key: 'offTime', label: 'OFF Time' },
  { key: 'remarks', label: 'Remarks / Result' },
];

function StatTile({ label, value, suffix, tone = 'plain', onClick, title }) {
  const tones = {
    plain: 'bg-white border-navy-100',
    warn: 'bg-amber-50/80 border-amber-200',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`rounded-xl border px-4 py-3 text-left transition-colors ${tones[tone]}
        ${onClick ? 'hover:border-navy-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30' : ''}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-navy-800">
        {value}
        {suffix && <span className="ml-1 text-xs font-semibold text-gray-500">{suffix}</span>}
      </p>
    </Tag>
  );
}

// One editable cell. Holds its own draft so typing is never fighting a refetch,
// and only pushes to the server when the value actually changed on blur.
function Cell({ value, type = 'text', canEdit, onSave, align = 'left', placeholder }) {
  const [draft, setDraft] = useState(value ?? '');
  const [state, setState] = useState('idle'); // idle | saving | saved | error
  const committed = useRef(value ?? '');
  const ref = useRef(null);

  useEffect(() => {
    // Adopt server values only while the user is not mid-edit, so an incoming
    // refresh never yanks characters out from under someone typing.
    if (document.activeElement !== ref.current) {
      setDraft(value ?? '');
      committed.current = value ?? '';
    }
  }, [value]);

  const commit = async () => {
    const next = draft ?? '';
    if (next === (committed.current ?? '')) return;
    setState('saving');
    try {
      await onSave(next === '' ? null : next);
      committed.current = next;
      setState('saved');
      setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 1200);
    } catch (err) {
      setState('error');
      setDraft(committed.current ?? '');
      const msg = err?.response?.data?.error || 'Could not save that cell.';
      window.alert(msg);
    }
  };

  if (!canEdit) {
    return (
      <span className={`block px-2 py-1.5 text-sm text-navy-800 ${align === 'center' ? 'text-center' : ''}`}>
        {value || <span className="text-gray-300">—</span>}
      </span>
    );
  }

  return (
    <div className="relative">
      <input
        ref={ref}
        type={type}
        value={draft ?? ''}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(committed.current ?? ''); e.currentTarget.blur(); }
        }}
        className={`w-full rounded border-0 bg-transparent px-2 py-1.5 text-sm text-navy-800
          placeholder:text-gray-300 hover:bg-navy-50/60
          focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40
          ${align === 'center' ? 'text-center' : ''}
          ${state === 'error' ? 'ring-2 ring-red-400' : ''}`}
      />
      {state === 'saving' && (
        <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">…</span>
      )}
      {state === 'saved' && (
        <Check size={11} className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-green-600" />
      )}
    </div>
  );
}

export default function WorkStatusSheet({
  machines, machineryId, month, onPickMachine, onChangeMonth, onOpenYear,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);

  const load = useCallback(async () => {
    if (!machineryId) { setData(null); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data: res } = await api.get('/machine-work-status/sheet', {
        params: { machineryId, month },
      });
      setData(res ?? null);
    } catch (err) {
      setData(null);
      setError(err?.response?.data?.error || 'Could not load this sheet.');
    } finally {
      setLoading(false);
    }
  }, [machineryId, month]);

  useEffect(() => { load(); }, [load]);

  // Save one field of one day, then patch that row in place. Refetching the
  // whole month on every keystroke-commit would make the grid flash and lose
  // the user's place.
  const saveCell = async (logDate, field, value) => {
    const { data: row } = await api.post('/machine-work-status/upsert', {
      machineryId, logDate, [field]: value,
    });
    setData((prev) => {
      if (!prev) return prev;
      const days = prev.days.map((d) => (d.logDate === logDate
        ? {
          ...d,
          work: row.work ?? null,
          onPerson: row.onPerson ?? null,
          offPerson: row.offPerson ?? null,
          onMinutes: row.onMinutes ?? null,
          offMinutes: row.offMinutes ?? null,
          runMinutes: row.runMinutes ?? null,
          remarks: row.remarks ?? null,
        }
        : d));
      return { ...prev, days, stats: recompute(days) };
    });
  };

  const clearDay = async (logDate) => {
    if (!window.confirm(`Clear everything recorded for ${logDate}?`)) return;
    try {
      await api.post('/machine-work-status/clear', { machineryId, logDate });
      await load();
    } catch (err) {
      window.alert(err?.response?.data?.error || 'Could not clear that day.');
    }
  };

  const [y, m] = month.split('-').map(Number);
  const canEdit = !!data?.canEdit;
  const machine = data?.machine;
  const stats = data?.stats;

  const visibleDays = useMemo(() => {
    if (!data?.days) return [];
    if (!onlyOpen) return data.days;
    return data.days.filter((d) => d.onMinutes !== null && d.offMinutes === null);
  }, [data, onlyOpen]);

  const unitLabel = machine?.unit?.name || machine?.place || 'Unassigned';

  return (
    <div className="space-y-4">
      {/* Controls: machine switcher, month stepper, export. */}
      <div className="flex flex-wrap items-center gap-3">
        <MachinePicker machines={machines} value={machineryId} onChange={onPickMachine} />

        <div className="inline-flex items-center gap-1 rounded-lg border border-navy-200 bg-white p-1">
          <button
            type="button"
            onClick={() => onChangeMonth(shiftMonth(month, -1))}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-navy-600 hover:bg-navy-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[9.5rem] px-2 text-center text-sm font-semibold text-navy-800">
            {MONTH_NAMES[m - 1]} {y}
          </span>
          <button
            type="button"
            onClick={() => onChangeMonth(shiftMonth(month, 1))}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-navy-600 hover:bg-navy-50
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {machineryId && (
            <Button variant="secondary" size="md" onClick={onOpenYear}>
              <BarChart3 size={15} /> Year view
            </Button>
          )}
          {machineryId && (
            <ExportExcelButton
              endpoint="/machine-work-status/export"
              params={{ machineryId, month }}
              fileName={`Work_Status_${month}.xlsx`}
              label="Export"
            />
          )}
        </div>
      </div>

      {!machineryId && (
        <div className="rounded-2xl border border-dashed border-navy-200 bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-navy-800">Pick a machine to open its sheet</p>
          <p className="mt-1 text-sm text-gray-500">
            {machines.length} machine{machines.length === 1 ? '' : 's'} in the register.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && machineryId && (
        <div className="space-y-2">
          <div className="h-24 animate-pulse rounded-2xl bg-navy-50" />
          <div className="h-64 animate-pulse rounded-2xl bg-navy-50" />
        </div>
      )}

      {!loading && data && machine && (
        <>
          {/* The Excel's own two header lines, kept verbatim. */}
          <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white">
            <div className="border-b border-navy-100 bg-navy-50/60 px-4 py-3 text-center">
              <p className="text-sm font-bold uppercase tracking-wide text-navy-800">
                Work Status — {unitLabel} · {MONTH_NAMES[m - 1]} {y}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-navy-100 px-4 py-2.5">
              <span className="text-sm font-bold text-navy-800">
                MACHINE NAME: <span className="font-semibold">{machine.name}</span>
              </span>
              <span className="text-sm font-bold text-navy-800">
                MACHINE ID: <span className="font-mono text-xs font-semibold">{machine.rapsId}</span>
              </span>
              <MachineInfoPopover machine={machine} stats={stats} />
              {!canEdit && (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5
                  text-xs font-semibold text-gray-600 ring-1 ring-inset ring-gray-200">
                  <Lock size={11} /> View only — {unitLabel}
                </span>
              )}
            </div>

            {/* Stats for the month. Open rows are their own number, not folded
                into the total: "92 hours" misleads if four days never closed. */}
            <div className="grid grid-cols-2 gap-3 border-b border-navy-100 p-4 sm:grid-cols-4">
              <StatTile label="Hours run" value={stats.hours} suffix="h" />
              <StatTile label="Days run" value={stats.daysRun} suffix={`/ ${data.days.length}`} />
              <StatTile label="Avg per running day" value={stats.avgHoursPerRunDay ?? '—'} suffix={stats.avgHoursPerRunDay ? 'h' : ''} />
              <StatTile
                label="Open rows"
                value={stats.openRows}
                tone={stats.openRows ? 'warn' : 'plain'}
                onClick={stats.openRows ? () => setOnlyOpen((v) => !v) : undefined}
                title={stats.openRows ? 'Days with an ON time but no OFF time — click to filter' : undefined}
              />
            </div>

            {onlyOpen && (
              <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
                <AlertTriangle size={14} />
                Showing only days with no OFF time.
                <button
                  type="button"
                  onClick={() => setOnlyOpen(false)}
                  className="ml-auto font-semibold underline hover:no-underline"
                >
                  Show all days
                </button>
              </div>
            )}

            {/* Grid. Header sticks, S.No + DATE freeze on horizontal scroll. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] border-collapse text-sm">
                <thead>
                  <tr className="bg-navy-50">
                    {COLS.map((c, i) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={`border border-navy-100 px-2 py-2 text-center text-[11px] font-bold
                          uppercase tracking-wide text-navy-700
                          ${i === 0 ? 'sticky left-0 z-20 bg-navy-50 w-14' : ''}
                          ${i === 1 ? 'sticky left-14 z-20 bg-navy-50 w-28' : ''}`}
                      >
                        {c.label}
                      </th>
                    ))}
                    <th scope="col" className="border border-navy-100 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-navy-700">
                      Hrs
                    </th>
                    {canEdit && <th scope="col" className="w-10 border border-navy-100" aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {visibleDays.length === 0 && (
                    <tr>
                      <td colSpan={COLS.length + (canEdit ? 2 : 1)} className="border border-navy-100 px-4 py-10 text-center text-sm text-gray-500">
                        No days match that filter.
                      </td>
                    </tr>
                  )}

                  {visibleDays.map((d) => {
                    const isToday = d.logDate === todayIso();
                    const open = d.onMinutes !== null && d.offMinutes === null;
                    const longRun = d.runMinutes !== null && d.runMinutes > LONG_RUN_MINUTES;
                    const dow = new Date(`${d.logDate}T00:00:00Z`).getUTCDay();
                    const weekend = dow === 0;
                    const stick = isToday ? 'bg-blue-50/80' : weekend ? 'bg-gray-50/70' : 'bg-white';

                    return (
                      <tr key={d.logDate} className={isToday ? 'bg-blue-50/60' : weekend ? 'bg-gray-50/50' : undefined}>
                        <td className={`sticky left-0 z-10 w-14 border border-navy-100 px-2 py-1 text-center text-xs font-semibold tabular-nums text-navy-700 ${stick}`}>
                          {d.serial}
                        </td>
                        <td className={`sticky left-14 z-10 w-28 border border-navy-100 px-2 py-1 text-center text-xs tabular-nums text-navy-700 ${stick}`}>
                          {d.logDate.slice(8)}/{d.logDate.slice(5, 7)}
                          {isToday && <span className="ml-1 text-[10px] font-bold text-blue-700">today</span>}
                        </td>
                        <td className="border border-navy-100 p-0 min-w-[14rem]">
                          <Cell value={d.work} canEdit={canEdit} onSave={(v) => saveCell(d.logDate, 'work', v)} />
                        </td>
                        <td className="border border-navy-100 p-0 min-w-[9rem]">
                          <Cell value={d.onPerson} canEdit={canEdit} onSave={(v) => saveCell(d.logDate, 'onPerson', v)} />
                        </td>
                        <td className={`border border-navy-100 p-0 w-28 ${open ? 'bg-amber-50/60' : ''}`}>
                          <Cell value={hhmm(d.onMinutes)} type="time" align="center" canEdit={canEdit} onSave={(v) => saveCell(d.logDate, 'onTime', v)} />
                        </td>
                        <td className="border border-navy-100 p-0 min-w-[9rem]">
                          <Cell value={d.offPerson} canEdit={canEdit} onSave={(v) => saveCell(d.logDate, 'offPerson', v)} />
                        </td>
                        <td className={`border border-navy-100 p-0 w-28 ${open ? 'bg-amber-50/60' : ''}`}>
                          <Cell value={hhmm(d.offMinutes)} type="time" align="center" canEdit={canEdit} onSave={(v) => saveCell(d.logDate, 'offTime', v)} />
                        </td>
                        <td className="border border-navy-100 p-0 min-w-[12rem]">
                          <Cell value={d.remarks} canEdit={canEdit} onSave={(v) => saveCell(d.logDate, 'remarks', v)} />
                        </td>
                        <td className="border border-navy-100 px-2 py-1 text-center text-xs font-semibold tabular-nums text-navy-700">
                          {open ? (
                            <span title="ON recorded with no OFF time" className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle size={11} /> open
                            </span>
                          ) : longRun ? (
                            <span title="Over 16 hours — check the OFF time" className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle size={11} /> {hoursLabel(d.runMinutes)}
                            </span>
                          ) : (
                            hoursLabel(d.runMinutes) || <span className="text-gray-300">—</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="border border-navy-100 px-1 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => clearDay(d.logDate)}
                              aria-label={`Clear ${d.logDate}`}
                              title="Clear this day"
                              className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-300
                                hover:bg-red-50 hover:text-red-600 transition-colors
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
                            >
                              <Eraser size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-navy-50 font-semibold">
                    <td colSpan={8} className="border border-navy-100 px-3 py-2 text-right text-xs uppercase tracking-wide text-navy-700">
                      Total this month
                    </td>
                    <td className="border border-navy-100 px-2 py-2 text-center text-sm tabular-nums text-navy-800">
                      {stats.hours}
                    </td>
                    {canEdit && <td className="border border-navy-100" />}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Keeps the stats strip honest after an inline save without a refetch. Mirrors
// the server's summarise() exactly - if one changes, change both.
function recompute(days) {
  let runMinutes = 0;
  let daysRun = 0;
  let openRows = 0;
  days.forEach((d) => {
    if (d.runMinutes && d.runMinutes > 0) {
      runMinutes += d.runMinutes;
      daysRun += 1;
    } else if (d.onMinutes !== null && d.onMinutes !== undefined && (d.offMinutes === null || d.offMinutes === undefined)) {
      openRows += 1;
    }
  });
  return {
    runMinutes,
    hours: Math.round((runMinutes / 60) * 10) / 10,
    daysRun,
    openRows,
    avgHoursPerRunDay: daysRun ? Math.round((runMinutes / daysRun / 60) * 10) / 10 : null,
  };
}
