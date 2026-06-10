import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../../api/axios';

// ─── Approved Supplier List autocomplete ───
// Typed text is matched word-by-word (case-insensitive prefix) against the
// supplier's name, vendor ID and scope of supply. So typing "TCE" surfaces a
// supplier whose scope is "Acetone, TCE, EDC, Toluene" even though the name
// doesn't contain TCE. When the field is empty, `contextQuery` (the row's
// product name) drives the suggestions instead, so the PO sees ASL suppliers
// for that material before typing anything.
// REJECTED / TERMINATED suppliers are never suggested.

// Module-level cache: many rows/cards mount their own autocomplete at once —
// share one in-flight request and reuse the result for up to a minute.
let aslCache = null;
let aslFetchedAt = 0;
let aslInflight = null;

function fetchApprovedSuppliers() {
  if (aslCache && Date.now() - aslFetchedAt < 60000) return Promise.resolve(aslCache);
  if (!aslInflight) {
    aslInflight = api
      .get('/suppliers?limit=all')
      .then(({ data }) => {
        aslCache = (data.suppliers || []).filter(
          (s) => s.approvalStatus !== 'REJECTED' && s.approvalStatus !== 'TERMINATED'
        );
        aslFetchedAt = Date.now();
        return aslCache;
      })
      .finally(() => {
        aslInflight = null;
      });
  }
  return aslInflight;
}

export function useApprovedSuppliers() {
  const [suppliers, setSuppliers] = useState(aslCache || []);
  useEffect(() => {
    let alive = true;
    fetchApprovedSuppliers()
      .then((list) => {
        if (alive) setSuppliers(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return suppliers;
}

const tokenize = (str) =>
  String(str || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

// Word-by-word prefix matching against name / vendor ID / scope of supply.
// requireAll=true (typed search): every typed word must match — precise.
// requireAll=false (product context, e.g. "Acetone 99%"): any word ≥2 chars
// matching is enough, so multi-word product names still hit scope words.
export function matchSuppliers(suppliers, query, limit = 8, requireAll = true) {
  let qWords = tokenize(query);
  if (!requireAll) qWords = qWords.filter((w) => w.length >= 2);
  if (qWords.length === 0) return [];
  const scored = [];
  for (const s of suppliers) {
    const nameWords = tokenize(s.name);
    const allWords = [...nameWords, ...tokenize(s.vendorIdNo), ...tokenize(s.scopeOfSupply)];
    const matched = qWords.filter((q) => allWords.some((w) => w.startsWith(q)));
    if (requireAll ? matched.length < qWords.length : matched.length === 0) continue;
    const nameHit = qWords.every((q) => nameWords.some((w) => w.startsWith(q)));
    scored.push({ s, nameHit, matched: matched.length });
  }
  scored.sort(
    (a, b) =>
      (a.nameHit ? 0 : 1) - (b.nameHit ? 0 : 1) ||
      b.matched - a.matched ||
      a.s.name.localeCompare(b.s.name)
  );
  return scored.slice(0, limit).map((x) => x.s);
}

// One-line "Phone/Email" string for quotation rows, from the ASL record.
export const supplierContactString = (s) =>
  [s.contactPerson, s.contactPhone || s.contact, s.email].filter(Boolean).join(' · ');

const STATUS_STYLE = {
  APPROVED: 'bg-green-100 text-green-700',
  CONDITIONAL: 'bg-amber-100 text-amber-700',
};

// Scope of supply with the words that matched the query highlighted.
function ScopeLine({ scope, qWords }) {
  if (!scope) return null;
  const parts = scope.split(/([^\p{L}\p{N}]+)/u);
  return (
    <div className="text-[11px] text-gray-500 truncate">
      <span className="text-gray-400">Scope:</span>{' '}
      {parts.map((p, i) => {
        const w = p.toLowerCase();
        const hit = w && qWords.some((q) => w.startsWith(q));
        return hit ? (
          <span key={i} className="font-semibold text-navy-700 bg-yellow-100 rounded px-0.5">{p}</span>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </div>
  );
}

export default function SupplierAutocomplete({
  value,
  onChange, // (text) => void — user typed; ASL link should be dropped by caller
  onSelect, // (supplier) => void — picked from the ASL dropdown
  contextQuery = '', // usually the row's product name
  placeholder = 'Supplier name',
  className = '',
  inputClassName = 'w-full px-2 py-1.5 border rounded text-sm',
}) {
  const suppliers = useApprovedSuppliers();
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const wrapRef = useRef(null);

  const query = (value || '').trim();
  const usingContext = !query && !!contextQuery.trim();
  const activeQuery = query || contextQuery;
  const results = useMemo(
    () => matchSuppliers(suppliers, activeQuery, 8, !usingContext),
    [suppliers, activeQuery, usingContext]
  );
  const qWords = useMemo(() => tokenize(activeQuery), [activeQuery]);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const pick = (s) => {
    onSelect(s);
    setOpen(false);
    setHighlightIdx(-1);
  };

  const onKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (highlightIdx >= 0 && highlightIdx < results.length) {
        e.preventDefault();
        pick(results[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlightIdx(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={inputClassName}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-400 border-b bg-gray-50 sticky top-0">
            {usingContext
              ? `Approved suppliers for "${contextQuery.trim()}"`
              : 'Approved Supplier List — matched by name / scope of supply'}
          </div>
          {results.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                // mousedown (not click) so the pick lands before the input blurs
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left px-2 py-1.5 border-b border-gray-50 last:border-b-0 ${i === highlightIdx ? 'bg-navy-50' : 'bg-white'}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                {s.vendorIdNo && (
                  <span className="text-[10px] text-gray-400 font-mono flex-shrink-0">{s.vendorIdNo}</span>
                )}
                {s.approvalStatus && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_STYLE[s.approvalStatus] || 'bg-gray-100 text-gray-600'}`}>
                    {s.approvalStatus === 'CONDITIONAL' ? 'Conditional' : 'Approved'}
                  </span>
                )}
              </div>
              <ScopeLine scope={s.scopeOfSupply} qWords={qWords} />
              {supplierContactString(s) && (
                <div className="text-[11px] text-gray-500 truncate">{supplierContactString(s)}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
