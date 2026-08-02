import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import api from '../../api/axios';

// ─── Material description field for the PR form ───
// One field, no modes. The requester just types the description; matching
// catalogue materials drop down as they type. Picking one links the row to that
// product (its id, its UOM and its saved spec library). Typing something with no
// match is simply a new material — it rides on the PR as free text and Stores
// creates it later. The PR table / PDF never show "existing" vs "new".
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
        <div className="px-3 py-2 text-[11px] text-gray-500">
          No match in the catalogue — <span className="font-medium text-amber-700">“{q}” goes through as a new material.</span>
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
        className={className}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {productId ? (
        <div className="flex items-center gap-1 px-1.5 pb-1 pt-0.5 text-[9px] font-medium text-green-600">
          <CheckCircle size={9} /> existing material
          <button
            type="button"
            onClick={onUnlink}
            title="Unlink — raise this line as a new material instead"
            className="text-gray-400 hover:text-red-600"
          >
            <X size={9} />
          </button>
        </div>
      ) : q.length >= 2 && !searching && results.length === 0 ? (
        <div className="px-1.5 pb-1 pt-0.5 text-[9px] italic text-amber-600">new material</div>
      ) : null}
      {menu && createPortal(menu, document.body)}
    </>
  );
}
