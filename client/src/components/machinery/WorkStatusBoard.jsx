import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Factory, ChevronRight, Lock, AlertTriangle, ArrowLeft, Search as SearchIcon, BarChart3,
} from 'lucide-react';
import api from '../../api/axios';
import MachineInfoPopover from './MachineInfoPopover';
import WorkStatusSheet from './WorkStatusSheet';
import MachineYearView from './MachineYearView';

// Working machine status, three levels deep:
//
//   units   → one card per unit, machine count + hours run this month
//   machines→ that unit's machines, one row each
//   sheet   → the month grid for one machine   (+ year, the month-by-month view)
//
// Every level lives in the URL, because "look at the oven for October" is a
// thing people send each other.

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function WorkStatusBoard() {
  const [params, setParams] = useSearchParams();

  const unit = params.get('unit') || '';
  const machineryId = params.get('machine') || '';
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : thisMonth();
  const year = parseInt(params.get('year'), 10) || new Date().getUTCFullYear();
  const view = params.get('view') || (machineryId ? 'sheet' : unit ? 'machines' : 'units');

  const [units, setUnits] = useState([]);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');

  // Merge rather than replace, so changing the month never drops the machine
  // and the browser back button walks the path the user actually took.
  const go = useCallback((patch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      });
      return next;
    });
  }, [setParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // The picker spans every machine regardless of which unit is open, so a
      // jump from a Unit-3 machine to a Unit-5 one is still one click.
      const [unitsRes, machinesRes] = await Promise.all([
        api.get('/machine-work-status/units', { params: { month } }),
        api.get('/machine-work-status/machines', { params: { month } }),
      ]);
      setUnits(unitsRes.data?.units ?? []);
      setMachines(machinesRes.data?.items ?? []);
    } catch (err) {
      setUnits([]);
      setMachines([]);
      setError(err?.response?.data?.error || 'Could not load the machine list.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const unitMachines = useMemo(() => {
    const list = unit === 'unassigned'
      ? machines.filter((m) => !m.unitId)
      : machines.filter((m) => m.unitId === unit);
    const needle = q.trim().toLowerCase();
    return needle
      ? list.filter((m) => `${m.name} ${m.rapsId} ${m.place || ''}`.toLowerCase().includes(needle))
      : list;
  }, [machines, unit, q]);

  const unitLabel = useMemo(() => {
    if (unit === 'unassigned') return 'Unassigned';
    return units.find((u) => u.unitId === unit)?.name || 'Unit';
  }, [units, unit]);

  // ── Year view ───────────────────────────────────────────────
  if (view === 'year' && machineryId) {
    return (
      <MachineYearView
        machineryId={machineryId}
        year={year}
        onChangeYear={(y) => go({ year: y })}
        onBack={() => go({ view: 'sheet' })}
        onOpenMonth={(mo) => go({ view: 'sheet', month: mo })}
      />
    );
  }

  // ── Sheet ───────────────────────────────────────────────────
  if (view === 'sheet' && machineryId) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => go({ view: unit ? 'machines' : 'units', machine: null })}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-600 hover:text-navy-800
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded"
        >
          <ArrowLeft size={15} /> {unit ? `Back to ${unitLabel}` : 'Back to units'}
        </button>

        <WorkStatusSheet
          machines={machines}
          machineryId={machineryId}
          month={month}
          onPickMachine={(id) => {
            const picked = machines.find((m) => m.id === id);
            go({ machine: id, unit: picked?.unitId || (picked ? 'unassigned' : null) });
          }}
          onChangeMonth={(mo) => go({ month: mo })}
          onOpenYear={() => go({ view: 'year', year: parseInt(month.slice(0, 4), 10) })}
        />
      </div>
    );
  }

  // ── Machines in one unit ────────────────────────────────────
  if (view === 'machines' && unit) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => go({ view: 'units', unit: null, machine: null })}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-600 hover:text-navy-800
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 rounded"
          >
            <ArrowLeft size={15} /> All units
          </button>
          <h2 className="text-lg font-bold text-navy-800">{unitLabel}</h2>
          <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-semibold text-navy-600">
            {unitMachines.length} machine{unitMachines.length === 1 ? '' : 's'}
          </span>

          <div className="relative ml-auto">
            <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search this unit…"
              aria-label="Search machines in this unit"
              className="w-full rounded-lg border border-navy-200 bg-white py-2 pl-9 pr-3 text-sm text-navy-800
                placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/25
                sm:w-64"
            />
          </div>
        </div>

        {unitMachines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-navy-200 bg-white px-6 py-14 text-center">
            <p className="text-sm font-semibold text-navy-800">
              {q.trim() ? `No machine matches “${q.trim()}”.` : 'No machines in this unit yet.'}
            </p>
            {!q.trim() && (
              <p className="mt-1 text-sm text-gray-500">
                Add one in Machine Master and it shows up here automatically.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-navy-100 bg-white">
            <ul className="divide-y divide-navy-50">
              {unitMachines.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-navy-50/50">
                  <MachineInfoPopover machine={m} stats={m} />
                  <button
                    type="button"
                    onClick={() => go({ view: 'sheet', machine: m.id, unit: m.unitId || 'unassigned' })}
                    className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-blue-500/30 rounded"
                  >
                    <span className="block truncate text-sm font-semibold text-navy-800">{m.name}</span>
                    <span className="block truncate font-mono text-[11px] text-gray-500">{m.rapsId}</span>
                  </button>

                  <div className="hidden text-right sm:block">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">This month</p>
                    <p className="text-sm font-bold tabular-nums text-navy-800">
                      {m.hours}<span className="ml-0.5 text-[11px] font-semibold text-gray-500">h</span>
                      <span className="ml-2 text-[11px] font-normal text-gray-500">{m.daysRun}d</span>
                    </p>
                  </div>

                  {m.openRows > 0 && (
                    <span
                      title={`${m.openRows} day(s) with an ON time but no OFF time`}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px]
                        font-semibold text-amber-800 ring-1 ring-inset ring-amber-200"
                    >
                      <AlertTriangle size={10} /> {m.openRows}
                    </span>
                  )}
                  {!m.canEdit && <Lock size={13} className="text-gray-300" aria-label="View only" title="View only" />}

                  <button
                    type="button"
                    onClick={() => go({ view: 'year', machine: m.id, year: parseInt(month.slice(0, 4), 10) })}
                    aria-label={`Year view for ${m.name}`}
                    title="Year view"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-navy-500
                      hover:bg-navy-100/70 hover:text-navy-800 transition-colors
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                  >
                    <BarChart3 size={15} />
                  </button>
                  <ChevronRight size={15} className="shrink-0 text-gray-300" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── Units landing ───────────────────────────────────────────
  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl bg-navy-50" />
          ))}
        </div>
      ) : units.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-navy-200 bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-navy-800">No units to show.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {units.map((u) => (
            <button
              key={u.unitId || 'unassigned'}
              type="button"
              onClick={() => go({ view: 'machines', unit: u.unitId || 'unassigned', machine: null })}
              className="group rounded-2xl border border-navy-100 bg-white p-5 text-left shadow-card
                transition-shadow hover:shadow-cardHover
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
                    <Factory size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-navy-800">{u.name}</p>
                    <p className="text-[11px] text-gray-500">
                      {u.machineCount} machine{u.machineCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                {u.canEdit ? (
                  <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase
                    tracking-wide text-green-700 ring-1 ring-inset ring-green-200">
                    Can edit
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[10px]
                    font-bold uppercase tracking-wide text-gray-500 ring-1 ring-inset ring-gray-200">
                    <Lock size={9} /> View
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Hours this month</p>
                  <p className="text-2xl font-bold tabular-nums text-navy-800">{u.hours}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-gray-500">{u.daysRun} machine-days</p>
                  {u.openRows > 0 && (
                    <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                      <AlertTriangle size={10} /> {u.openRows} open
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
