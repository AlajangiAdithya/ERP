// Shared, non-technical table-row editor used by both the SUPERADMIN
// "Real-time Corrections" page and the DATA_EDITOR "Edit Data" page.
//
// The whole point is to let a non-technical operator change a stored value
// WITHOUT hand-writing JSON: every field gets its own labelled input, typed
// from the existing value (text / number / yes-no / JSON). An "Advanced (JSON)"
// escape hatch is still there for power edits.

import { useState } from 'react';
import { Save, X } from 'lucide-react';

// Columns Prisma manages itself. The DATA_EDITOR page keeps these off-limits;
// the SUPERADMIN page offers them (flagged as system fields) so every column in
// a row is genuinely editable.
export const AUTO_FIELDS = ['id', 'createdAt', 'updatedAt'];

// Prisma DateTime columns arrive as ISO-8601 strings over JSON, so they are
// indistinguishable from text unless we look at the shape.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const isIsoDate = (v) => typeof v === 'string' && ISO_DATE_RE.test(v);

export function inferType(val) {
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (isIsoDate(val)) return 'datetime';
  if (val !== null && typeof val === 'object') return 'json';
  return 'text';
}

// ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in local time.
export function isoToLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// …and back again on save. Returns null for a cleared field.
export function localInputToIso(local) {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
}

// Readable date for the rows list. Midnight-local values are date-only in
// practice (probableReturnDate, customerGatePassDate…), so the time is dropped
// rather than printing a meaningless 00:00.
export function formatDateCell(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const datePart = d.toLocaleDateString();
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return datePart;
  return `${datePart} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// Build the field descriptors for editing an existing row. Always skips the
// server's resolved-label helper keys (anything starting with "_"); id/timestamps
// are included only when `includeSystem` is set, and carry a `system` flag so the
// form can mark them. When a column is a foreign key whose name we resolved, that
// name rides along as a `hint` so the editor can show "productId = Acetone".
export function editFieldsFor(row, { includeSystem = false } = {}) {
  return Object.keys(row)
    .filter((k) => !k.startsWith('_') && (includeSystem || !AUTO_FIELDS.includes(k)))
    .map((k) => ({
      key: k,
      type: inferType(row[k]),
      value: row[k],
      wasNull: row[k] == null,
      hint: row._labels?.[k] || null,
      system: AUTO_FIELDS.includes(k),
    }));
}

// "productId" → "Product", "workOrderId" → "Work Order". Display only.
export function prettyHeader(col) {
  return col.replace(/Id$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
}

// The readable label the server resolved for a foreign-key column, else the raw
// stored value.
export function cellValue(row, col) {
  return row._labels && row._labels[col] != null ? row._labels[col] : row[col];
}

// Turn the per-field form values back into a typed payload for the API.
// omitEmpty=true (used for Insert) drops blank fields so Prisma can apply
// its own defaults / required-field handling.
export function buildPayload(fields, values, omitEmpty) {
  const out = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (f.type === 'boolean') { out[f.key] = !!raw; continue; }
    let v;
    if (f.type === 'datetime') {
      v = localInputToIso(raw);
      if (omitEmpty && v === null) continue;
      out[f.key] = v;
      continue;
    }
    if (f.type === 'number') {
      if (raw === '' || raw == null) v = null;
      else { const n = Number(raw); v = Number.isNaN(n) ? raw : n; }
    } else if (f.type === 'json') {
      if (raw === '' || raw == null) v = null;
      else v = JSON.parse(raw); // throws on bad JSON → caught by caller
    } else {
      if (raw === '') v = f.wasNull ? null : (omitEmpty ? null : '');
      else v = raw;
    }
    if (omitEmpty && (v === null || v === '')) continue;
    out[f.key] = v;
  }
  return out;
}

// Read-only pretty-print of a cell value for the rows list.
export function renderCell(val) {
  if (val === null || val === undefined) return <span className="text-gray-400">∅</span>;
  if (typeof val === 'boolean') return <span className={val ? 'text-green-700' : 'text-red-700'}>{String(val)}</span>;
  if (isIsoDate(val)) return <span className="whitespace-nowrap">{formatDateCell(val)}</span>;
  if (typeof val === 'object') return <span className="text-xs font-mono text-gray-600">{JSON.stringify(val).slice(0, 80)}</span>;
  const s = String(val);
  return s.length > 80 ? s.slice(0, 80) + '…' : s;
}

export function FieldInput({ field, value, onChange }) {
  const base = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none';
  if (field.type === 'boolean') {
    return (
      <select value={value ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')} className={base}>
        <option value="true">Yes (true)</option>
        <option value="false">No (false)</option>
      </select>
    );
  }
  if (field.type === 'datetime') {
    return (
      <div className="flex items-center gap-2">
        <input type="datetime-local" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} />
        {value && (
          <button type="button" onClick={() => onChange('')} className="text-xs text-gray-500 hover:text-red-600 shrink-0">Clear</button>
        )}
      </div>
    );
  }
  if (field.type === 'number') {
    return <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} placeholder="number" />;
  }
  if (field.type === 'json') {
    return <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} className={`${base} font-mono text-xs`} placeholder='e.g. {"key":"value"}' />;
  }
  const long = typeof value === 'string' && value.length > 60;
  return long
    ? <textarea value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={3} className={base} />
    : <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={base} placeholder={field.wasNull ? 'empty' : ''} />;
}

// Full-screen-on-mobile, centered-on-desktop modal that edits a row field by
// field. Falls back to raw JSON via the Advanced toggle (auto-on when we have
// no fields to infer, e.g. inserting into an empty table).
export function RowEditor({ title, subtitle, fields, omitEmpty, submitLabel, busy, error, onSave, onCancel, allowAdvanced = true }) {
  const [values, setValues] = useState(() => {
    const init = {};
    fields.forEach((f) => {
      if (f.type === 'boolean') init[f.key] = !!f.value;
      else if (f.type === 'json') init[f.key] = f.value == null ? '' : JSON.stringify(f.value);
      else if (f.type === 'datetime') init[f.key] = f.value == null ? '' : isoToLocalInput(f.value);
      else init[f.key] = f.value == null ? '' : String(f.value);
    });
    return init;
  });
  const [advanced, setAdvanced] = useState(allowAdvanced && fields.length === 0);
  const [jsonText, setJsonText] = useState(() => {
    const obj = {};
    fields.forEach((f) => { if (f.value !== undefined && f.value !== null) obj[f.key] = f.value; });
    return JSON.stringify(obj, null, 2) || '{\n  \n}';
  });
  const [localErr, setLocalErr] = useState('');

  const set = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

  function submit() {
    setLocalErr('');
    try {
      const payload = advanced ? JSON.parse(jsonText) : buildPayload(fields, values, omitEmpty);
      onSave(payload);
    } catch (e) {
      setLocalErr('Invalid JSON: ' + e.message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onCancel}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 truncate">{title}</div>
            {subtitle && <div className="text-xs text-gray-500 truncate">{subtitle}</div>}
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-700 shrink-0"><X size={20} /></button>
        </div>

        <div className="px-4 py-4 overflow-y-auto space-y-3">
          {(error || localErr) && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{localErr || error}</div>
          )}

          {!advanced && fields.some((f) => f.system) && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
              System columns are editable here. Changing <span className="font-mono">id</span> is rejected by the
              database if another row references it, and <span className="font-mono">updatedAt</span> is always
              re-stamped on save.
            </div>
          )}

          {advanced ? (
            <div>
              <div className="text-xs text-gray-600 mb-1">{omitEmpty ? 'JSON for new row (omit id/createdAt):' : 'Partial JSON — only the fields you change:'}</div>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full h-56 px-3 py-2 font-mono text-xs border border-gray-300 rounded-lg"
              />
            </div>
          ) : (
            fields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {f.key}
                  {f.hint && <span className="ml-1.5 text-purple-700 font-normal">= {f.hint}</span>}
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">{f.type}</span>
                  {f.system && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1">system</span>
                  )}
                </label>
                <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-between gap-2">
          {allowAdvanced && fields.length > 0 ? (
            <button onClick={() => setAdvanced((a) => !a)} className="text-xs text-purple-700 hover:underline">
              {advanced ? '← Simple form' : 'Advanced (JSON)'}
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onCancel} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save size={15} /> {busy ? 'Saving…' : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
