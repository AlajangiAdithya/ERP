import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../api/axios';
import Input from '../ui/Input';
import { formatMaterialCode, codeMatchesCategory, categoryFor } from '../../utils/materialTypes';

// ─── Material Code, counted per category ───
// Every material type owns a block of codes in the register (see
// utils/materialTypes.js). This field asks the server for the next free code
// inside the selected category's block and fills it in, so nobody has to look up
// where the count is up to. It stays editable — the count is a suggestion, and
// the categories with no block ('Others', retired labels) are typed by hand.
//
// `taken` lists codes already used by sibling rows of the same form (the bulk
// "add several products" list), which the server can't know about yet — the
// suggestion steps past them.
export default function MaterialCodeField({
  category,
  value,
  onChange,
  taken = [],
  label = 'Material Code *',
  disabled = false,
  autoFill = true,
  className = '',
}) {
  const [info, setInfo] = useState(null);      // { code, from, to, used, capacity, full }
  const [loading, setLoading] = useState(false);
  // Once the code is typed over by hand we stop overwriting it — but "Use ####"
  // still puts the suggestion back.
  const edited = useRef(false);
  const lastApplied = useRef('');

  // Step the server's suggestion past any code a sibling row has already claimed.
  const freeCode = useCallback((res) => {
    if (!res?.code) return '';
    const busy = new Set(taken.map((t) => String(t ?? '').trim()).filter(Boolean));
    let n = parseInt(res.code, 10);
    while (busy.has(formatMaterialCode(n)) || busy.has(String(n))) {
      n += 1;
      if (res.to && n > res.to) return '';   // block exhausted once siblings are counted
    }
    return formatMaterialCode(n);
  }, [taken]);

  useEffect(() => {
    if (!category) { setInfo(null); return; }
    let alive = true;
    setLoading(true);
    api.get('/products/next-material-code', { params: { category } })
      .then(({ data }) => { if (alive) setInfo(data); })
      .catch(() => { if (alive) setInfo(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // Fill the field on the first suggestion and on every category change, unless
  // the user has typed their own code in.
  useEffect(() => {
    if (!autoFill || disabled || !info) return;
    const suggestion = freeCode(info);
    if (!suggestion) return;
    const current = String(value || '').trim();
    // An untouched field, or one still holding the code we put there last time.
    if (!edited.current || current === '' || current === lastApplied.current) {
      if (current !== suggestion) {
        lastApplied.current = suggestion;
        onChange(suggestion);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, autoFill, disabled]);

  const apply = () => {
    const suggestion = freeCode(info);
    if (!suggestion) return;
    edited.current = false;
    lastApplied.current = suggestion;
    onChange(suggestion);
  };

  const cat = categoryFor(category);
  const hasBlock = !!info?.from || !!cat?.from;
  const from = info?.from ?? cat?.from ?? null;
  const to = info?.to ?? cat?.to ?? null;
  const suggestion = freeCode(info);
  const outOfBlock = !!value && !codeMatchesCategory(value, category);

  return (
    <div className={className}>
      <Input
        label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => { edited.current = true; onChange(e.target.value); }}
        placeholder={hasBlock ? (suggestion || `${formatMaterialCode(from)}–${formatMaterialCode(to)}`) : 'e.g. 1001'}
      />
      <div className="mt-1 text-[11px] leading-snug">
        {loading ? (
          <span className="text-gray-400">Looking up the next free code…</span>
        ) : hasBlock ? (
          <span className="text-gray-500">
            {category} uses <span className="font-mono text-gray-700">{formatMaterialCode(from)}–{formatMaterialCode(to)}</span>
            {info ? ` · ${info.used} of ${info.capacity} used` : ''}
            {info?.full && <span className="ml-1 font-medium text-brand-red">· block is full, enter a code manually</span>}
            {!info?.full && suggestion && suggestion !== String(value || '').trim() && (
              <button
                type="button"
                onClick={apply}
                disabled={disabled}
                className="ml-1.5 inline-flex items-center gap-1 font-medium text-navy-700 hover:underline disabled:text-gray-400"
              >
                <RefreshCw size={10} /> use {suggestion}
              </button>
            )}
          </span>
        ) : (
          <span className="text-gray-500">
            No code block is reserved for {category || 'this material type'} — enter the code manually.
          </span>
        )}
        {outOfBlock && (
          <div className="mt-0.5 font-medium text-amber-700">
            {value} is outside {category}&rsquo;s block ({formatMaterialCode(from)}–{formatMaterialCode(to)}) — it will still save.
          </div>
        )}
      </div>
    </div>
  );
}
