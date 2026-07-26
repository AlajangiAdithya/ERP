import { useState, useEffect, useRef } from 'react';
import { Search, X, FileText } from 'lucide-react';
import api from '../../api/axios';
import Badge from '../ui/Badge';

// Purchase-request number picker for the MIV clearance screen.
//
// Stores only ever mention the PR NUMBER, so the box is deliberately forgiving:
// type any part of a PR number *or* a material name and pick from the dropdown,
// or just type the number and leave it — the server resolves a bare number too
// (case-insensitive), so a paper-form habit of writing the number still works.
//
// `value` is { id, requestNumber } or null. `onChange` gets the same shape, or
// null when cleared. `onTypedNumber` receives the raw text so the caller can
// submit an unpicked number as-is.
export default function PrNumberPicker({
  value,
  onChange,
  onTypedNumber,
  disabled = false,
  label = 'Issued against PR No.',
  help = 'Optional — leave blank if this material is not against any purchase request.',
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  // Close the dropdown on an outside click so it never sits over the buttons.
  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced lookup. An empty query still searches — it returns the newest PRs,
  // which is usually what Stores wants (the material just came in).
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/purchase-requests/lookup', { params: { q: query || undefined } })
        .then(({ data }) => { if (!cancelled) setResults(data.requests || []); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open]);

  const pick = (pr) => {
    onChange?.({ id: pr.id, requestNumber: pr.requestNumber });
    setQuery('');
    setOpen(false);
  };

  const clear = () => {
    onChange?.(null);
    onTypedNumber?.('');
    setQuery('');
  };

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>

      {value ? (
        // Picked state — a chip, so it's obvious the link is set.
        <div className="flex items-center gap-2 px-3 py-2 border border-green-300 bg-green-50 rounded-md">
          <FileText size={14} className="text-green-700" />
          <span className="font-mono text-sm font-semibold text-green-900">{value.requestNumber}</span>
          {!disabled && (
            <button
              type="button"
              onClick={clear}
              className="ml-auto text-green-800 hover:text-green-950"
              title="Clear the PR link"
            >
              <X size={14} />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); onTypedNumber?.(e.target.value); setOpen(true); }}
            placeholder="Type the PR number (or a material name) …"
            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500 disabled:bg-gray-100"
          />
        </div>
      )}

      <p className="mt-1 text-xs text-gray-500">{help}</p>

      {open && !value && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg">
          {loading ? (
            <div className="px-3 py-3 text-xs text-gray-500">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-500">
              No purchase requests match “{query}”. You can still type the number and save it as-is.
            </div>
          ) : (
            results.map((pr) => (
              <button
                type="button"
                key={pr.id}
                onClick={() => pick(pr)}
                className="w-full text-left px-3 py-2 hover:bg-navy-50 border-b border-gray-100 last:border-b-0"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-navy-800">{pr.requestNumber}</span>
                  <Badge color="gray">{pr.status}</Badge>
                  {pr.unit?.code && <Badge color="blue">{pr.unit.code}</Badge>}
                  {pr.workOrder?.workOrderNumber && (
                    <span className="text-[11px] text-gray-500">WO {pr.workOrder.workOrderNumber}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {pr.manager?.name || '—'}
                  {' · '}
                  {(pr.items || []).map((i) => i.productName).join(', ') || 'no items'}
                  {pr._count?.items > (pr.items || []).length && ` +${pr._count.items - pr.items.length} more`}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
