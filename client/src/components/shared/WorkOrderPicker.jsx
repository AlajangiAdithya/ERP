import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, X, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

// Searchable work-order picker used by every form that tags a document to a WO
// (PR, product request, inter-office note, gate pass).
//
// A plain <select> was unusable once the live-WO list grew: the requester had to
// scroll past every other unit's orders to reach their own. So this box
//   1. lets you TYPE to filter (WO no., supply order no., customer, nomenclature,
//      unit — all tokens must match, in any order), and
//   2. lists YOUR unit's work orders first under a sticky header; every other
//      unit follows below, grouped by unit, so scrolling still reaches them all.
//
// `value`/`onChange` speak whichever key the caller stores — `valueKey="id"` for
// forms that persist workOrderId, `"workOrderNumber"` for forms that persist the
// number as text. `specialOptions` are non-WO choices (R&D, Data Generation, …)
// pinned above the list.
//
// The menu renders in a portal so it is never clipped by a modal's or table's
// overflow, and it re-anchors to the trigger on scroll/resize.
export default function WorkOrderPicker({
  workOrders = [],
  value = '',
  onChange,
  valueKey = 'id',
  specialOptions = [],
  emptyLabel = '— No work order —',
  allowClear = true,
  disabled = false,
  unitId,
  className = '',
  menuWidth = 460,
  placeholder = 'Search work orders…',
}) {
  const { user } = useAuth();
  const ownUnitId = unitId !== undefined ? unitId : user?.unit?.id;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState(null);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const itemRefs = useRef([]);

  const unitLabelOf = (wo) => wo.assignedUnit?.name || wo.assignedUnit?.code || wo.assignedUnitName || 'Unassigned';

  // ── Filter, then bucket by unit: own unit first, others alphabetically,
  // "Unassigned" last so it never pushes real units down.
  const groups = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (wo) => {
      if (!tokens.length) return true;
      const hay = [
        wo.workOrderNumber, wo.supplyOrderNo, wo.customerName,
        wo.nomenclature, unitLabelOf(wo), wo.status,
      ].filter(Boolean).join(' ').toLowerCase();
      return tokens.every((t) => hay.includes(t));
    };

    const own = [];
    const others = new Map();
    for (const wo of workOrders) {
      if (!matches(wo)) continue;
      // Some endpoints send the nested unit, others only the flat id/name.
      const woUnitId = wo.assignedUnit?.id || wo.assignedUnitId || null;
      if (ownUnitId && woUnitId === ownUnitId) { own.push(wo); continue; }
      const label = unitLabelOf(wo);
      if (!others.has(label)) others.set(label, []);
      others.get(label).push(wo);
    }

    const out = [];
    if (own.length) {
      const label = user?.unit?.name || user?.unit?.code || 'your unit';
      out.push({ key: 'own', title: `Your unit — ${label}`, own: true, items: own });
    }
    [...others.entries()]
      .sort(([a], [b]) => (a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)))
      .forEach(([label, items]) => out.push({ key: label, title: label, own: false, items }));
    return out;
  }, [workOrders, query, ownUnitId, user]);

  // Flat option list backing keyboard navigation — specials, then every group's
  // rows in display order. Specials are hidden while searching (they aren't WOs).
  const flat = useMemo(() => {
    const rows = [];
    if (!query.trim()) {
      rows.push({ kind: 'empty', value: '', label: emptyLabel });
      specialOptions.forEach((s) => rows.push({ kind: 'special', value: s.value, label: s.label, hint: s.hint }));
    }
    groups.forEach((g) => g.items.forEach((wo) => rows.push({ kind: 'wo', value: wo[valueKey] ?? '', wo, group: g })));
    return rows;
  }, [groups, specialOptions, query, valueKey, emptyLabel]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  // What the closed trigger shows.
  const selected = useMemo(() => {
    if (value === '' || value === null || value === undefined) return null;
    const wo = workOrders.find((w) => String(w[valueKey] ?? '') === String(value));
    if (wo) return { kind: 'wo', wo };
    const special = specialOptions.find((s) => String(s.value) === String(value));
    if (special) return { kind: 'special', label: special.label };
    // Edit mode can hold a WO that has since been cancelled and dropped off the
    // assignable list — show the stored value rather than a blank box.
    return { kind: 'raw', label: String(value) };
  }, [value, workOrders, specialOptions, valueKey]);

  // ── Anchor the portal menu to the trigger, and keep it there.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.bottom, bottom: r.top, left: r.left, width: r.width });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
    else setQuery('');
  }, [open]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const pick = (row) => {
    onChange?.(row.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[activeIndex]) pick(flat[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Menu geometry — flip above the trigger when the space below is too tight.
  const menuStyle = (() => {
    if (!anchor) return { display: 'none' };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(anchor.width, menuWidth), vw - 16);
    const below = vh - anchor.top - 12;
    const above = anchor.bottom - 12;
    const flip = below < 260 && above > below;
    const maxHeight = Math.max(180, Math.min(380, flip ? above : below));
    return {
      position: 'fixed',
      left: Math.max(8, Math.min(anchor.left, vw - width - 8)),
      width,
      maxHeight,
      ...(flip ? { bottom: vh - anchor.bottom + 4 } : { top: anchor.top + 4 }),
    };
  })();

  let rowIndex = -1; // running index into `flat`, for highlight + refs

  return (
    <>
      <div ref={triggerRef} className="relative w-full">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); setOpen(true); }
          }}
          className={className || 'w-full flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm text-left bg-white hover:border-navy-400 focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500 disabled:bg-gray-100'}
        >
          <span className="flex-1 min-w-0 truncate">
            {!selected ? (
              <span className="text-gray-500">{emptyLabel}</span>
            ) : selected.kind === 'wo' ? (
              <>
                <span className="font-semibold text-navy-800">{selected.wo.workOrderNumber}</span>
                {selected.wo.customerName ? <span className="text-gray-600"> — {selected.wo.customerName}</span> : null}
                <span className="text-gray-400"> · {unitLabelOf(selected.wo)}</span>
              </>
            ) : (
              <span className="text-gray-800">{selected.label}</span>
            )}
          </span>
          {allowClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              title="Clear"
              onClick={(e) => { e.stopPropagation(); onChange?.(''); }}
              className="text-gray-400 hover:text-gray-700 flex-shrink-0"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
        </button>
      </div>

      {open && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-[9999] flex flex-col bg-white border border-gray-200 rounded-md shadow-2xl overflow-hidden"
        >
          <div className="relative border-b border-gray-200 flex-shrink-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={placeholder}
              className="w-full pl-8 pr-3 py-2 text-sm focus:outline-none"
            />
          </div>

          <div className="overflow-y-auto">
            {flat.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-500">No work orders match “{query}”.</div>
            ) : (
              <>
                {!query.trim() && (
                  <div className="border-b border-gray-100">
                    {flat.filter((r) => r.kind !== 'wo').map((row) => {
                      rowIndex += 1;
                      const idx = rowIndex;
                      const isSel = String(value ?? '') === String(row.value);
                      return (
                        <button
                          key={`s-${row.value || 'none'}`}
                          type="button"
                          ref={(el) => { itemRefs.current[idx] = el; }}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => pick(row)}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${activeIndex === idx ? 'bg-navy-50' : ''}`}
                        >
                          <span className={row.kind === 'empty' ? 'text-gray-500' : 'text-gray-800 font-medium'}>{row.label}</span>
                          {row.hint && <span className="text-gray-400">{row.hint}</span>}
                          {isSel && <Check size={13} className="ml-auto text-navy-600" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {groups.map((g) => (
                  <div key={g.key}>
                    <div className={`sticky top-0 px-3 py-1 text-[10px] font-bold uppercase tracking-wide border-y ${
                      g.own
                        ? 'bg-navy-50 text-navy-700 border-navy-100'
                        : 'bg-gray-50 text-gray-500 border-gray-100'
                    }`}>
                      {g.title} <span className="font-normal normal-case">({g.items.length})</span>
                    </div>
                    {g.items.map((wo) => {
                      rowIndex += 1;
                      const idx = rowIndex;
                      const rowValue = wo[valueKey] ?? '';
                      const isSel = String(value ?? '') === String(rowValue);
                      return (
                        <button
                          key={wo.id}
                          type="button"
                          ref={(el) => { itemRefs.current[idx] = el; }}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => pick({ kind: 'wo', value: rowValue })}
                          className={`w-full text-left px-3 py-2 border-b border-gray-100 last:border-b-0 ${activeIndex === idx ? 'bg-navy-50' : ''}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-navy-800">{wo.workOrderNumber}</span>
                            {wo.supplyOrderNo && <span className="text-[11px] text-gray-500">SO: {wo.supplyOrderNo}</span>}
                            {isSel && <Check size={13} className="ml-auto text-navy-600" />}
                          </div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {wo.customerName || '—'}
                            {wo.nomenclature ? ` · ${wo.nomenclature}` : ''}
                            {!g.own ? ` · ${unitLabelOf(wo)}` : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
