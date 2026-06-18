// SUPERADMIN-only direct table editor. Renders the row count + paginated rows
// for any whitelisted Prisma model and lets the operator update/insert/delete
// individual rows. No audit log is written — by design, SUPERADMIN actions are
// invisible to other admins.

import { useEffect, useState, useMemo } from 'react';
import { Database, Edit2, Trash2, Plus, Save, X, RefreshCw, FileText, ExternalLink, Search } from 'lucide-react';
import api from '../../api/axios';
import PageHero from '../../components/shared/PageHero';

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
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('{\n  \n}');
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

  function startEdit(row) {
    setEditingId(row.id);
    const { id, createdAt, updatedAt, ...editable } = row;
    setEditDraft(JSON.stringify(editable, null, 2));
  }

  async function saveEdit() {
    try {
      const parsed = JSON.parse(editDraft);
      await api.put(`/superadmin/table/${active}/row/${editingId}`, parsed);
      setEditingId(null);
      fetchRows(active, page, rowQuery);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
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

  async function saveCreate() {
    try {
      const parsed = JSON.parse(createDraft);
      await api.post(`/superadmin/table/${active}/row`, parsed);
      setCreating(false);
      setCreateDraft('{\n  \n}');
      // Clear any active search so the newly-inserted row is visible.
      setRowSearchInput('');
      setRowQuery('');
      setPage(1);
      fetchRows(active, 1, '');
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

  return (
    <div className="p-6 space-y-6">
      <PageHero
        title="Real-time Corrections"
        subtitle="Direct database editor — actions are not audit-logged."
        eyebrow="SuperAdmin"
        icon={Database}
      />

      <div className="mb-4 border-b border-gray-200 flex gap-1">
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
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between">
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
      <div className="grid grid-cols-[260px_1fr] gap-4">
        {/* Tables sidebar */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
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
                onClick={() => { setActive(t.name); setPage(1); setEditingId(null); setCreating(false); setRowSearchInput(''); setRowQuery(''); }}
                className={`w-full px-3 py-2 text-left text-sm flex justify-between items-center border-b border-gray-100 hover:bg-purple-50 ${active === t.name ? 'bg-purple-100 font-semibold' : ''}`}
              >
                <span className="truncate">{t.name}</span>
                <span className="text-xs text-gray-500 ml-2">{t.rows ?? '?'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Rows panel */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {!active ? (
            <div className="p-8 text-center text-gray-400">Select a table on the left.</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{active}</span>
                  <span className="text-xs text-gray-500">
                    {rowQuery ? `${total} match${total === 1 ? '' : 'es'} for “${rowQuery}”` : `${total} row${total === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <form onSubmit={runRowSearch} className="flex items-center gap-1">
                    <div className="relative">
                      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input
                        type="text"
                        value={rowSearchInput}
                        onChange={(e) => setRowSearchInput(e.target.value)}
                        placeholder="Search this table…"
                        className="pl-7 pr-2 py-1 text-sm border rounded w-56"
                      />
                    </div>
                    <button type="submit" className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Search</button>
                    {rowQuery && (
                      <button type="button" onClick={clearRowSearch} className="px-2 py-1 text-sm border rounded hover:bg-gray-50">Clear</button>
                    )}
                  </form>
                  {selectedRows.size > 0 && (
                    <button
                      onClick={bulkDeleteRows}
                      disabled={bulkDeleting}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-1 disabled:opacity-50"
                    >
                      <Trash2 size={14} /> Delete selected ({selectedRows.size})
                    </button>
                  )}
                  <button
                    onClick={() => setCreating(true)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                  >
                    <Plus size={14} /> Insert row
                  </button>
                  <button onClick={() => fetchRows(active, page, rowQuery)} className="text-gray-500 hover:text-gray-900" title="Reload">
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              {creating && (
                <div className="p-4 bg-green-50 border-b">
                  <div className="text-xs text-gray-600 mb-1">JSON for new row (omit id/createdAt — Prisma fills these):</div>
                  <textarea
                    value={createDraft}
                    onChange={(e) => setCreateDraft(e.target.value)}
                    className="w-full h-40 px-3 py-2 font-mono text-xs border rounded"
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={saveCreate} className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1">
                      <Save size={14} /> Insert
                    </button>
                    <button onClick={() => setCreating(false)} className="px-3 py-1 text-sm border rounded hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              )}

              {loadingRows ? (
                <div className="p-8 text-center text-gray-400">Loading rows…</div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-gray-400">{rowQuery ? `No rows match “${rowQuery}”.` : 'No rows.'}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 w-8">
                          <input
                            type="checkbox"
                            checked={rows.length > 0 && selectedRows.size === rows.length}
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
                        editingId === row.id ? (
                          <tr key={row.id} className="bg-yellow-50">
                            <td colSpan={columns.length + 2} className="p-3">
                              <div className="text-xs text-gray-600 mb-1">Editing row <span className="font-mono">{row.id}</span> — provide partial JSON:</div>
                              <textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                className="w-full h-40 px-3 py-2 font-mono text-xs border rounded"
                              />
                              <div className="mt-2 flex gap-2">
                                <button onClick={saveEdit} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
                                  <Save size={14} /> Save
                                </button>
                                <button onClick={() => setEditingId(null)} className="px-3 py-1 text-sm border rounded hover:bg-gray-50">Cancel</button>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          <tr key={row.id} className={`border-t hover:bg-gray-50 ${selectedRows.has(row.id) ? 'bg-purple-50' : ''}`}>
                            <td className="px-2 py-1">
                              <input
                                type="checkbox"
                                checked={selectedRows.has(row.id)}
                                onChange={() => toggleRowSelection(row.id)}
                              />
                            </td>
                            <td className="px-2 py-1">
                              <div className="flex gap-1">
                                <button onClick={() => startEdit(row)} className="text-blue-600 hover:text-blue-800" title="Edit">
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
                        )
                      ))}
                    </tbody>
                  </table>
                </div>
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
      )}
    </div>
  );
}
