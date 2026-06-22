// DATA_EDITOR "Edit Data" page — a deliberately simple, edit-only table editor
// for non-technical staff. They pick a table, find the row, tap Edit, and change
// values in a plain labelled form (no JSON, no insert, no delete). Mobile-first:
// the table list is a dropdown on phones and rows render as readable cards.
//
// Backed by /api/data-editor (read tables / read rows / update row only). All the
// destructive power (insert/delete/uploads/backups) lives on the SUPERADMIN page.

import { useEffect, useState, useMemo } from 'react';
import { Pencil, RefreshCw, Search, Table2 } from 'lucide-react';
import api from '../api/axios';
import PageHero from '../components/shared/PageHero';
import { editFieldsFor, renderCell, RowEditor, prettyHeader, cellValue } from '../components/shared/TableRowEditor';

export default function DataEditor() {
  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [active, setActive] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowQuery, setRowQuery] = useState('');
  const [rowSearchInput, setRowSearchInput] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchTables(); }, []);
  useEffect(() => { if (active) fetchRows(active, page, rowQuery); }, [active, page, rowQuery]);

  async function fetchTables() {
    setLoadingTables(true);
    try {
      const { data } = await api.get('/data-editor/tables');
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
      const { data } = await api.get(`/data-editor/table/${name}?${qs}`);
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

  // Columns to show: skip the raw id and the server's "_labels"/"_rowLabel"
  // helper keys. The friendly row label stands in for the id.
  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    const keys = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'id' && !k.startsWith('_')) keys.add(k); }));
    return Array.from(keys);
  }, [rows]);

  async function saveEdit(payload) {
    setSaving(true);
    setModalError('');
    try {
      await api.put(`/data-editor/table/${active}/row/${editRow.id}`, payload);
      setEditRow(null);
      fetchRows(active, page, rowQuery);
    } catch (e) {
      setModalError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHero
        title="Edit Data"
        subtitle="Pick a table, find the row, and update its values."
        eyebrow="Data Editor"
        icon={Table2}
      />

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {/* Mobile table picker */}
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
                  <button onClick={() => fetchRows(active, page, rowQuery)} className="text-gray-500 hover:text-gray-900 shrink-0" title="Reload">
                    <RefreshCw size={16} />
                  </button>
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
              </div>

              {loadingRows ? (
                <div className="p-8 text-center text-gray-400">Loading rows…</div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-gray-400">{rowQuery ? `No rows match “${rowQuery}”.` : 'No rows.'}</div>
              ) : (
                <>
                  {/* Mobile: stacked cards */}
                  <div className="md:hidden divide-y">
                    {rows.map((row) => (
                      <div key={row.id} className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-gray-900 min-w-0 truncate">{row._rowLabel || '—'}</span>
                          <button
                            onClick={() => { setModalError(''); setEditRow(row); }}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg shrink-0"
                          >
                            <Pencil size={15} /> Edit
                          </button>
                        </div>
                        <dl className="mt-2 space-y-1">
                          {columns.map((c) => (
                            <div key={c} className="flex gap-2 text-xs">
                              <dt className="text-gray-500 w-28 shrink-0 truncate">{prettyHeader(c)}</dt>
                              <dd className="text-gray-800 min-w-0 break-words">{renderCell(cellValue(row, c))}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    ))}
                  </div>

                  {/* Desktop: full table */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-600 w-16">Edit</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Record</th>
                          {columns.map((c) => (
                            <th key={c} className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{prettyHeader(c)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} className="border-t hover:bg-gray-50">
                            <td className="px-2 py-1">
                              <button onClick={() => { setModalError(''); setEditRow(row); }} className="text-purple-600 hover:text-purple-800" title="Edit">
                                <Pencil size={15} />
                              </button>
                            </td>
                            <td className="px-2 py-1 font-medium text-gray-900 whitespace-nowrap max-w-xs truncate">{row._rowLabel || '—'}</td>
                            {columns.map((c) => (
                              <td key={c} className="px-2 py-1 whitespace-nowrap max-w-xs truncate">{renderCell(cellValue(row, c))}</td>
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

      {editRow && (
        <RowEditor
          title={`Edit row #${String(editRow.id)}`}
          subtitle={active}
          fields={editFieldsFor(editRow)}
          omitEmpty={false}
          allowAdvanced={false}
          submitLabel="Save changes"
          busy={saving}
          error={modalError}
          onSave={saveEdit}
          onCancel={() => setEditRow(null)}
        />
      )}
    </div>
  );
}
