import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search as SearchIcon, Check, Lock } from 'lucide-react';

// Machine switcher for the sheet header.
//
// This is where Excel's tab strip went. Eighty-one machines will not fit as
// tabs, and a horizontally scrolling tab row is worse than either option, so
// instead switching machine is one click into a searchable list grouped by
// unit. Type to filter by name or RAPS ID.

export default function MachinePicker({ machines, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the filter on open so typing works straight away.
    searchRef.current?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = machines.find((m) => m.id === value) || null;

  // Group by unit so a long list stays navigable. Unassigned machines sort last
  // rather than being hidden - they still need logging.
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = needle
      ? machines.filter((m) => `${m.name} ${m.rapsId} ${m.place || ''}`.toLowerCase().includes(needle))
      : machines;

    const map = new Map();
    hits.forEach((m) => {
      const key = m.unit?.name || 'Unassigned';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    });
    return [...map.entries()].sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
  }, [machines, q]);

  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { setOpen((v) => !v); setQ(''); }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex w-full items-center justify-between gap-3 rounded-lg border border-navy-200 bg-white
          px-3.5 py-2 text-left text-sm font-semibold text-navy-800 transition-colors
          hover:border-navy-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30
          sm:w-[22rem]"
      >
        <span className="min-w-0 truncate">
          {selected ? selected.name : 'Choose a machine'}
          {selected && <span className="ml-2 font-mono text-[11px] font-normal text-gray-500">{selected.rapsId}</span>}
        </span>
        <ChevronDown size={15} className="shrink-0 text-gray-400" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Machines"
          className="absolute left-0 top-full z-30 mt-2 w-full min-w-[20rem] overflow-hidden rounded-xl border
            border-navy-100 bg-white shadow-xl ring-1 ring-navy-900/5 sm:w-[26rem]"
        >
          <div className="border-b border-navy-100 p-2">
            <div className="relative">
              <SearchIcon size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name or RAPS ID…"
                aria-label="Search machines"
                className="w-full rounded-lg border border-navy-200 bg-white py-2 pl-9 pr-3 text-sm text-navy-800
                  placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto overscroll-contain py-1">
            {total === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-500">
                No machine matches “{q.trim()}”.
              </p>
            )}

            {groups.map(([unitName, list]) => (
              <div key={unitName}>
                <p className="sticky top-0 bg-navy-50/90 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-navy-600 backdrop-blur">
                  {unitName} · {list.length}
                </p>
                {list.map((m) => {
                  const active = m.id === value;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { onChange(m.id); setOpen(false); }}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors
                        ${active ? 'bg-blue-50/70' : 'hover:bg-navy-50'}`}
                    >
                      <Check size={14} className={active ? 'shrink-0 text-blue-700' : 'shrink-0 text-transparent'} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-navy-800">{m.name}</span>
                        <span className="block truncate font-mono text-[11px] text-gray-500">{m.rapsId}</span>
                      </span>
                      {/* Read-only is worth showing here, before the click, so
                          nobody opens a sheet expecting to be able to type. */}
                      {m.canEdit === false && (
                        <Lock size={12} className="shrink-0 text-gray-400" title="View only" aria-label="View only" />
                      )}
                      {m.hours > 0 && (
                        <span className="shrink-0 tabular-nums text-[11px] font-semibold text-navy-500">{m.hours}h</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
