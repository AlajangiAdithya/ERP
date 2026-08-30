import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { CheckCircle, X, AlertTriangle, Plus, Pencil } from 'lucide-react';
import { createPortal } from 'react-dom';
import api from '../../api/axios';

// ─── Material picker for the PR form ───
// A requisition line may only name a material that is already in Master Data, so
// this is a picker, not a free-text box: the requester types, matching materials
// drop down, and picking one links the row to that product (its id, its UOM and
// its saved spec library). Text that isn't linked to a material is refused at
// submit — the dropdown offers "Add to Master Data" instead, which creates the
// entry (under the requester's name) and links the row straight away.
//
// `allowFreeText` turns that gate off for the one category that is exempt
// (Tools & Fixtures): suggestions still drop down and picking one still links
// the row, but leaving the text unlinked is a valid line rather than an error.
//
// The dropdown is portalled to <body> with fixed positioning because the PR
// materials table lives inside an `overflow-x-auto` wrapper, which would
// otherwise clip an absolutely-positioned menu.
export default function MaterialNameInput({
  value,
  productId,
  onChange,
  onPick,
  onUnlink,
  // Opens the "add to Master Data" form pre-filled with what was typed. Omitted
  // for roles that may not add materials — they only get the "not in Master
  // Data" warning.
  onAddToMasterData,
  // Set for material types that may be typed in directly. Suppresses the error
  // styling and the "pick from the list" warning on unlinked text.
  allowFreeText = false,
  // Name of the exempt category, used in the hint text.
  freeTextLabel = 'this material type',
  className = '',
  placeholder = 'Start typing description…',
}) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState(null);

  const inputRef = useRef(null);
  const menuRef = useRef(null);
  const timerRef = useRef(null);
  // Set just before a pick so the value change it causes doesn't reopen the list.
  const skipNextRef = useRef(false);

  const q = (value || '').trim();

  // Debounced catalogue lookup on every keystroke (2+ characters).
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (skipNextRef.current) {
      skipNextRef.current = false;
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    setOpen(true);
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/products', { params: { search: q, limit: 8 } });
        setResults(data.products || []);
      } catch {
        setResults([]);
      }
      setHi(-1);
      setSearching(false);
    }, 250);
    return () => timerRef.current && clearTimeout(timerRef.current);
  }, [q]);

  // Keep the floating menu glued to the input while the page/table scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const flip = below < 180 && r.top > below;
      setPos({
        top: flip ? undefined : r.bottom + 4,
        bottom: flip ? window.innerHeight - r.top + 4 : undefined,
        left: Math.max(8, Math.min(r.left, window.innerWidth - 280)),
        width: Math.max(r.width, 260),
        maxHeight: Math.max(140, (flip ? r.top : below) - 16),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Close on any click outside the input *and* the portalled menu.
  useEffect(() => {
    const onDocDown = (e) => {
      if (inputRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const choose = (p) => {
    skipNextRef.current = true;
    setOpen(false);
    setResults([]);
    setHi(-1);
    onPick(p);
  };

  const onKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => (h <= 0 ? results.length - 1 : h - 1));
    } else if (e.key === 'Enter' && hi >= 0) {
      e.preventDefault();
      choose(results[hi]);
    }
  };

  const menu = open && pos && (
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, zIndex: 9999 }}
      className="bg-white border border-gray-300 rounded-md shadow-xl overflow-y-auto"
    >
      {searching && <div className="px-3 py-2 text-[11px] text-gray-400">Searching…</div>}
      {!searching && results.length === 0 && (
        <div className="px-3 py-2">
          <div className="text-[11px] text-gray-600">
            {allowFreeText ? (
              <>
                <span className="font-medium text-navy-800">“{q}” is not in Master Data.</span>{' '}
                That’s fine for {freeTextLabel} — it will be catalogued when the material is
                inwarded. Add it now only if you want it reusable.
              </>
            ) : (
              <>
                <span className="font-medium text-red-700">“{q}” is not in Master Data.</span>{' '}
                A requisition can only ask for a material that is already there.
              </>
            )}
          </div>
          {onAddToMasterData && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOpen(false); onAddToMasterData(q); }}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-navy-300 bg-navy-50 px-2 py-1 text-[11px] font-semibold text-navy-800 hover:bg-navy-100"
            >
              <Plus size={11} /> Add “{q}” to Master Data
            </button>
          )}
        </div>
      )}
      {results.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setHi(i)}
          onClick={() => choose(p)}
          className={`w-full text-left px-3 py-1.5 border-b border-gray-50 last:border-b-0 ${i === hi ? 'bg-navy-50' : 'hover:bg-navy-50'}`}
        >
          <div className="text-xs font-medium text-gray-800 leading-tight">{p.name}</div>
          <div className="text-[10px] text-gray-400 font-mono">
            {p.materialCode || p.sku || '—'}
            {p.unit ? ` · ${p.unit}` : ''}
            {p.category ? ` · ${p.category}` : ''}
          </div>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        autoComplete="off"
        placeholder={placeholder}
        /* Unlinked text is not a valid line, so the field reads as an error —
           except where free text is allowed for this material type. */
        className={`${className}${q.length > 0 && !productId && !allowFreeText ? ' bg-red-50' : ''}`}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {productId ? (
        <div className="flex items-center gap-1 px-1.5 pb-1 pt-0.5 text-[9px] font-medium text-green-600">
          <CheckCircle size={9} /> in master data
          <button
            type="button"
            onClick={onUnlink}
            title="Clear — pick a different material"
            className="text-gray-400 hover:text-red-600"
          >
            <X size={9} />
          </button>
        </div>
      ) : q.length > 0 ? (
        allowFreeText ? (
          <div className="flex items-center gap-1 px-1.5 pb-1 pt-0.5 text-[9px] font-medium text-navy-500">
            <Pencil size={9} /> typed in — catalogued at inward
          </div>
        ) : (
          <div className="flex items-center gap-1 px-1.5 pb-1 pt-0.5 text-[9px] font-medium text-red-600">
            <AlertTriangle size={9} /> not in master data — pick from the list
          </div>
        )
      ) : null}
      {menu && createPortal(menu, document.body)}
    </>
  );
}
