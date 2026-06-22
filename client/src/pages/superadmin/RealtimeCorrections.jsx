// SUPERADMIN-only direct table editor. Renders the row count + paginated rows
// for any whitelisted Prisma model and lets the operator update/insert/delete
// individual rows. No audit log is written — by design, SUPERADMIN actions are
// invisible to other admins.
//
// Mobile-first: the table list collapses to a dropdown on phones, rows render
// as readable cards (instead of a wide horizontal-scroll table), and editing /
// inserting uses a simple field-by-field form — no hand-written JSON required.
// An "Advanced (JSON)" toggle is still available for power edits.

import { useEffect, useState, useMemo } from 'react';
import { Database, Edit2, Trash2, Plus, Save, X, RefreshCw, FileText, ExternalLink, Search } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/shared/PageHero';

// Fields Prisma manages itself — never offered for manual editing.
const AUTO_FIELDS = ['id', 'createdAt', 'updatedAt'];

function inferType(val) {
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (val !== null && typeof val === 'object') return 'json';
  return 'text';
}

// Turn the per-field form values back into a typed payload for the API.
// omitEmpty=true (used for Insert) drops blank fields so Prisma can apply
// its own defaults / required-field handling.
function buildPayload(fields, values, omitEmpty) {
  const out = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (f.type === 'boolean') { out[f.key] = !!raw; continue; }
    let v;
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

function FieldInput({ field, value, onChange }) {
  const base = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-200 focus:border-purple-400 outline-none';
  if (field.type === 'boolean') {
    return (
      <select value={value ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')} className={base}>
        <option value="true">Yes (true)</option>
        <option value="false">No (false)</option>
      </select>
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
function RowEditor({ title, subtitle, fields, omitEmpty, submitLabel, busy, error, onSave, onCancel }) {
  const [values, setValues] = useState(() => {
    const init = {};
    fields.forEach((f) => {
      if (f.type === 'boolean') init[f.key] = !!f.value;
      else if (f.type === 'json') init[f.key] = f.value == null ? '' : JSON.stringify(f.value);
      else init[f.key] = f.value == null ? '' : String(f.value);
    });
    return init;
  });
  const [advanced, setAdvanced] = useState(fields.length === 0);
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
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">{f.type}</span>
                </label>
                <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-3 border-t flex items-center justify-between gap-2">
          {fields.length > 0 ? (
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

export default function RealtimeCorrections() {
  const [view, setView] = useState('tables'); // 'tables' | 'uploads'
  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [active, setActive] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  // Server-side row search within the active table. rowQuery is the committed
  // term that drives fetches; rowSearchInput is the live text box value.
  const [rowQuery, setRowQuery] = useState('');
  const [rowSearchInput, setRowSearchInput] = useState('');
  const [editRow, setEditRow] = useState(null); // row object being edited
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState([]);
  const [loadingUploads, setLoadingUploads] = useState(false);
  const [uploadFilter, setUploadFilter] = useState('');
  const [uploadTableFilter, setUploadTableFilter] = useState('ALL');
  // Multi-select state for bulk delete. selectedRows holds row ids in the
  // currently active table; selectedUploads holds `${table}|${recordId}|${field}`.
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [selectedUploads, setSelectedUploads] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  useEffect(() => {
    fetchTables();
  }, []);

  useEffect(() => {
    if (active) fetchRows(active, page, rowQuery);
    setSelectedRows(new Set());
  }, [active, page, rowQuery]);

  useEffect(() => {
    if (view === 'uploads') fetchUploads();
  }, [view]);

  async function fetchUploads() {
    setLoadingUploads(true);
    setError('');
    try {
      const { data } = await api.get('/superadmin/uploads');
      setUploads(data.uploads || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setUploads([]);
    } finally {
      setLoadingUploads(false);
    }
  }

  async function deleteUpload(u) {
    if (!window.confirm(`Delete this upload?\n\n${u.label} on ${u.table} / ${u.recordLabel}\n\nThe DB reference will be cleared AND the file will be permanently deleted from the server. This cannot be undone.`)) return;
    try {
      await api.delete('/superadmin/uploads', { data: { table: u.table, recordId: u.recordId, field: u.field } });
      fetchUploads();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function fetchTables() {
    setLoadingTables(true);
    try {
      const { data } = await api.get('/superadmin/tables');
      setTables(data.tables || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoadingTables(false);
    }
  }

  async function fetchRows(name, p, q = '') {
    setLoadingRows(true);
    setError('');
    try {
      const qs = `page=${p}&limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`;
      const { data } = await api.get(`/superadmin/table/${name}?${qs}`);
      setRows(data.rows || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setRows([]);
      setTotal(0);
    } finally {
      setLoadingRows(false);
    }
  }

  function selectTable(name) {
    setActive(name);
    setPage(1);
    setEditRow(null);
    setCreating(false);
    setRowSearchInput('');
    setRowQuery('');
  }

  function runRowSearch(e) {
    if (e) e.preventDefault();
    setPage(1);
    setRowQuery(rowSearchInput.trim());
  }

  function clearRowSearch() {
    setRowSearchInput('');
    setRowQuery('');
    setPage(1);
  }

  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    const keys = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
    // id first
    return ['id', ...Array.from(keys).filter((k) => k !== 'id')];
  }, [rows]);

  // Field descriptors for the per-field create form, inferred from loaded rows.
  const createFields = useMemo(() => {
    return columns
      .filter((c) => !AUTO_FIELDS.includes(c))
      .map((c) => {
        const sample = rows.find((r) => r[c] != null)?.[c];
        return { key: c, type: sample !== undefined ? inferType(sample) : 'text', value: null, wasNull: true };
      });
  }, [columns, rows]);

  function editFieldsFor(row) {
    return Object.keys(row)
      .filter((k) => !AUTO_FIELDS.includes(k))
      .map((k) => ({ key: k, type: inferType(row[k]), value: row[k], wasNull: row[k] == null }));
  }

  async function saveEdit(payload) {
    setSaving(true);
    setModalError('');
    try {
      await api.put(`/superadmin/table/${active}/row/${editRow.id}`, payload);
      setEditRow(null);
      fetchRows(active, page, rowQuery);
    } catch (e) {
      setModalError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveCreate(payload) {
    setSaving(true);
    setModalError('');
    try {
      await api.post(`/superadmin/table/${active}/row`, payload);
      setCreating(false);
      // Clear any active search so the newly-inserted row is visible.
      setRowSearchInput('');
      setRowQuery('');
      setPage(1);
      fetchRows(active, 1, '');
    } catch (e) {
      setModalError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteRow(id) {
    if (!window.confirm(`Delete ${active}/${id}? This is permanent.`)) return;
    try {
      await api.delete(`/superadmin/table/${active}/row/${id}`);
      fetchRows(active, page, rowQuery);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  const renderCell = (val) => {
    if (val === null || val === undefined) return <span className="text-gray-400">∅</span>;
    if (typeof val === 'boolean') return <span className={val ? 'text-green-700' : 'text-red-700'}>{String(val)}</span>;
    if (typeof val === 'object') return <span className="text-xs font-mono text-gray-600">{JSON.stringify(val).slice(0, 80)}</span>;
    const s = String(val);
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  };

  const uploadTableOptions = useMemo(() => {
    const set = new Set(uploads.map((u) => u.table));
    return ['ALL', ...Array.from(set).sort()];
  }, [uploads]);

  const filteredUploads = useMemo(() => {
    const q = uploadFilter.trim().toLowerCase();
    return uploads.filter((u) => {
      if (uploadTableFilter !== 'ALL' && u.table !== uploadTableFilter) return false;
      if (!q) return true;
      return (
        (u.recordLabel || '').toLowerCase().includes(q) ||
        (u.label || '').toLowerCase().includes(q) ||
        (u.uploadedBy || '').toLowerCase().includes(q) ||
        (u.url || '').toLowerCase().includes(q)
      );
    });
  }, [uploads, uploadFilter, uploadTableFilter]);

  const fmtDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString();
  };

  const uploadKey = (u) => `${u.table}|${u.recordId}|${u.field}`;

  const toggleRowSelection = (id) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllRows = () => {
    if (selectedRows.size === rows.length && rows.length > 0) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(rows.map((r) => r.id)));
    }
  };

  const toggleUploadSelection = (u) => {
    const k = uploadKey(u);
    setSelectedUploads((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleAllUploads = () => {
    if (selectedUploads.size === filteredUploads.length && filteredUploads.length > 0) {
      setSelectedUploads(new Set());
    } else {
      setSelectedUploads(new Set(filteredUploads.map(uploadKey)));
    }
  };

  async function bulkDeleteRows() {
    if (selectedRows.size === 0) return;
    if (!window.confirm(`Delete ${selectedRows.size} row(s) from ${active}? This is permanent.`)) return;
    setBulkDeleting(true);
    setError('');
    const ids = [...selectedRows];
    const failures = [];
    for (const id of ids) {
      try {
        await api.delete(`/superadmin/table/${active}/row/${id}`);
      } catch (e) {
        failures.push({ id, error: e.response?.data?.error || e.message });
      }
    }
    setBulkDeleting(false);
    setSelectedRows(new Set());
    if (failures.length > 0) {
      setError(`${failures.length}/${ids.length} delete(s) failed. First error: ${failures[0].error}`);
    }
    fetchRows(active, page);
  }

  async function bulkDeleteUploads() {
    if (selectedUploads.size === 0) return;
    if (!window.confirm(`Delete ${selectedUploads.size} upload(s)? The DB references are cleared AND the files are permanently deleted from the server. This cannot be undone.`)) return;
    setBulkDeleting(true);
    setError('');
    const targets = uploads.filter((u) => selectedUploads.has(uploadKey(u)));
    const failures = [];
    for (const u of targets) {
      try {
        await api.delete('/superadmin/uploads', { data: { table: u.table, recordId: u.recordId, field: u.field } });
      } catch (e) {
        failures.push({ key: uploadKey(u), error: e.response?.data?.error || e.message });
      }
    }
    setBulkDeleting(false);
    setSelectedUploads(new Set());
    if (failures.length > 0) {
      setError(`${failures.length}/${targets.length} delete(s) failed. First error: ${failures[0].error}`);
    }
    fetchUploads();
  }

  const allRowsSelected = rows.length > 0 && selectedRows.size === rows.length;

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHero
        title="Real-time Corrections"
        subtitle="Direct database editor — actions are not audit-logged."
        eyebrow="SuperAdmin"
        icon={Database}
      />

      <div className="border-b border-gray-200 flex gap-1">
        <button
          onClick={() => setView('tables')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${view === 'tables' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          <Database size={14} /> Tables
        </button>
        <button
          onClick={() => setView('uploads')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-2 ${view === 'uploads' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
        >
          <FileText size={14} /> Uploads {uploads.length > 0 && <span className="text-xs bg-gray-200 rounded-full px-2">{uploads.length}</span>}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {view === 'uploads' ? (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <FileText className="text-purple-700" size={18} />
              <span className="font-semibold text-gray-900">All Uploads</span>
              <span className="text-xs text-gray-500">({filteredUploads.length} of {uploads.length})</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedUploads.size > 0 && (
                <button
                  onClick={bulkDeleteUploads}
                  disabled={bulkDeleting}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1 disabled:opacity-50"
                >
                  <Trash2 size={14} /> Delete selected ({selectedUploads.size})
                </button>
              )}
              <select
                value={uploadTableFilter}
                onChange={(e) => setUploadTableFilter(e.target.value)}
                className="px-2 py-1 text-sm border rounded"
              >
                {uploadTableOptions.map((t) => (
                  <option key={t} value={t}>{t === 'ALL' ? 'All tables' : t}</option>
                ))}
              </select>
              <input
                type="text"
                value={uploadFilter}
                onChange={(e) => setUploadFilter(e.target.value)}
                placeholder="Search…"
                className="px-2 py-1 text-sm border rounded w-48"
              />
              <button onClick={fetchUploads} className="text-gray-500 hover:text-gray-900" title="Reload">
                <RefreshCw size={16} />
              </button>
            </div>
          </div>

          {loadingUploads ? (
            <div className="p-8 text-center text-gray-400">Loading uploads…</div>
          ) : filteredUploads.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No uploads found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={filteredUploads.length > 0 && selectedUploads.size === filteredUploads.length}
                        ref={(el) => { if (el) el.indeterminate = selectedUploads.size > 0 && selectedUploads.size < filteredUploads.length; }}
                        onChange={toggleAllUploads}
                        title="Select all"
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600 w-24">Actions</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Where (Table / Record)</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">What</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">Uploaded By</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">When</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-600">File</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUploads.map((u, i) => (
                    <tr key={`${u.table}-${u.recordId}-${u.field}-${i}`} className={`border-t hover:bg-gray-50 ${selectedUploads.has(uploadKey(u)) ? 'bg-purple-50' : ''}`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedUploads.has(uploadKey(u))}
                          onChange={() => toggleUploadSelection(u)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <a
                            href={u.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800"
                            title="Open file"
                          >
                            <ExternalLink size={14} />
                          </a>
                          <button
                            onClick={() => deleteUpload(u)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete (clears DB reference)"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-purple-100 text-purple-800 rounded mr-2">{u.table}</span>
                        <span className="font-mono text-gray-800">{u.recordLabel || u.recordId}</span>
                      </td>
                      <td className="px-3 py-2">{u.label}</td>
                      <td className="px-3 py-2 text-gray-700">{u.uploadedBy || <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{fmtDate(u.uploadedAt)}</td>
                      <td className="px-3 py-2">
                        <a
                          href={u.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 font-mono text-[11px] break-all"
                        >
                          {u.url}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
      <div className="space-y-3">
        {/* Mobile table picker — a simple dropdown instead of the sidebar */}
        <div className="md:hidden">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Choose a table</label>
          <div className="flex gap-2">
            <select
              value={active || ''}
              onChange={(e) => selectTable(e.target.value)}
              className="flex-1 px-3 py-2.5 text-sm border border-gray-300 rounded-lg bg-white"
            >
              <option value="">{loadingTables ? 'Loading…' : 'Select a table…'}</option>
              {tables.map((t) => (
                <option key={t.name} value={t.name}>{t.name} ({t.rows ?? '?'})</option>
              ))}
            </select>
            <button onClick={fetchTables} className="px-3 border border-gray-300 rounded-lg text-gray-500" title="Refresh">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
          {/* Tables sidebar — desktop only */}
          <div className="hidden md:block bg-white rounded-lg border border-gray-200 overflow-hidden self-start">
            <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Tables</span>
              <button onClick={fetchTables} className="text-gray-400 hover:text-gray-700" title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {loadingTables && <div className="p-3 text-sm text-gray-400">Loading…</div>}
              {tables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => selectTable(t.name)}
                  className={`w-full px-3 py-2 text-left text-sm flex justify-between items-center border-b border-gray-100 hover:bg-purple-50 ${active === t.name ? 'bg-purple-100 font-semibold' : ''}`}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{t.rows ?? '?'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Rows panel */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden min-w-0">
            {!active ? (
              <div className="p-8 text-center text-gray-400">Choose a table to begin.</div>
            ) : (
              <>
                <div className="px-3 sm:px-4 py-3 border-b bg-gray-50 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="font-semibold text-gray-900 truncate">{active}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {rowQuery ? `${total} match${total === 1 ? '' : 'es'}` : `${total} row${total === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => { setModalError(''); setCreating(true); }}
                        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1"
                      >
                        <Plus size={15} /> <span className="hidden sm:inline">Insert row</span><span className="sm:hidden">Add</span>
                      </button>
                      <button onClick={() => fetchRows(active, page, rowQuery)} className="text-gray-500 hover:text-gray-900" title="Reload">
                        <RefreshCw size={16} />
                      </button>
                    </div>
                  </div>

                  <form onSubmit={runRowSearch} className="flex items-center gap-1">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={rowSearchInput}
                        onChange={(e) => setRowSearchInput(e.target.value)}
                        placeholder="Search this table…"
                        className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-lg"
                      />
                    </div>
                    <button type="submit" className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Search</button>
                    {rowQuery && (
                      <button type="button" onClick={clearRowSearch} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Clear</button>
                    )}
                  </form>

                  {selectedRows.size > 0 && (
                    <button
                      onClick={bulkDeleteRows}
                      disabled={bulkDeleting}
                      className="w-full sm:w-auto px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-1 disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Delete selected ({selectedRows.size})
                    </button>
                  )}
                </div>

                {loadingRows ? (
                  <div className="p-8 text-center text-gray-400">Loading rows…</div>
                ) : rows.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">{rowQuery ? `No rows match “${rowQuery}”.` : 'No rows.'}</div>
                ) : (
                  <>
                    {/* Mobile: stacked cards */}
                    <div className="md:hidden">
                      <label className="flex items-center gap-2 px-3 py-2 border-b bg-gray-50 text-xs text-gray-600">
                        <input type="checkbox" checked={allRowsSelected} onChange={toggleAllRows} />
                        Select all ({rows.length})
                      </label>
                      <div className="divide-y">
                        {rows.map((row) => (
                          <div key={row.id} className={`p-3 ${selectedRows.has(row.id) ? 'bg-purple-50' : ''}`}>
                            <div className="flex items-center justify-between gap-2">
                              <label className="flex items-center gap-2 min-w-0">
                                <input type="checkbox" checked={selectedRows.has(row.id)} onChange={() => toggleRowSelection(row.id)} />
                                <span className="font-mono text-xs text-gray-500 truncate">#{String(row.id)}</span>
                              </label>
                              <div className="flex gap-4">
                                <button onClick={() => { setModalError(''); setEditRow(row); }} className="text-blue-600" title="Edit"><Edit2 size={18} /></button>
                                <button onClick={() => deleteRow(row.id)} className="text-red-600" title="Delete"><Trash2 size={18} /></button>
                              </div>
                            </div>
                            <dl className="mt-2 space-y-1">
                              {columns.filter((c) => c !== 'id').map((c) => (
                                <div key={c} className="flex gap-2 text-xs">
                                  <dt className="text-gray-500 w-28 shrink-0 truncate">{c}</dt>
                                  <dd className="text-gray-800 min-w-0 break-words">{renderCell(row[c])}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Desktop: full table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-2 py-2 w-8">
                              <input
                                type="checkbox"
                                checked={allRowsSelected}
                                ref={(el) => { if (el) el.indeterminate = selectedRows.size > 0 && selectedRows.size < rows.length; }}
                                onChange={toggleAllRows}
                                title="Select all"
                              />
                            </th>
                            <th className="px-2 py-2 text-left font-semibold text-gray-600 w-20">Actions</th>
                            {columns.map((c) => (
                              <th key={c} className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.id} className={`border-t hover:bg-gray-50 ${selectedRows.has(row.id) ? 'bg-purple-50' : ''}`}>
                              <td className="px-2 py-1">
                                <input type="checkbox" checked={selectedRows.has(row.id)} onChange={() => toggleRowSelection(row.id)} />
                              </td>
                              <td className="px-2 py-1">
                                <div className="flex gap-1">
                                  <button onClick={() => { setModalError(''); setEditRow(row); }} className="text-blue-600 hover:text-blue-800" title="Edit">
                                    <Edit2 size={14} />
                                  </button>
                                  <button onClick={() => deleteRow(row.id)} className="text-red-600 hover:text-red-800" title="Delete">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </td>
                              {columns.map((c) => (
                                <td key={c} className="px-2 py-1 whitespace-nowrap max-w-xs truncate">{renderCell(row[c])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {totalPages > 1 && (
                  <div className="px-4 py-2 border-t bg-gray-50 flex items-center justify-between text-sm">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-3 py-1 border rounded disabled:opacity-50"
                    >Prev</button>
                    <span className="text-gray-600">Page {page} of {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="px-3 py-1 border rounded disabled:opacity-50"
                    >Next</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {editRow && (
        <RowEditor
          title={`Edit row #${String(editRow.id)}`}
          subtitle={active}
          fields={editFieldsFor(editRow)}
          omitEmpty={false}
          submitLabel="Save changes"
          busy={saving}
          error={modalError}
          onSave={saveEdit}
          onCancel={() => setEditRow(null)}
        />
      )}

      {creating && (
        <RowEditor
          title="Insert new row"
          subtitle={active}
          fields={createFields}
          omitEmpty
          submitLabel="Insert row"
          busy={saving}
          error={modalError}
          onSave={saveCreate}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
