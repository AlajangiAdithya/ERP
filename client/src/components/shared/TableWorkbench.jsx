// Table workbench — pick a table, find the row, change its values.
//
// Shared by the DATA_EDITOR "Edit Data" page and the ADMIN "FIM Data" page.
// Both talk to the same shaped API (`GET :base/tables`, `GET :base/table/:name`,
// `PUT|POST|DELETE :base/table/:name/row[/:id]`); what differs is which
// catalogue the server hands back and which write actions are permitted, so
// that all rides on props rather than a forked copy of this screen.
//
// Mobile-first: the table list is a dropdown on phones, rows render as readable
// cards, and editing uses a plain labelled form (no JSON).

import { useEffect, useState, useMemo } from 'react';
import { Pencil, RefreshCw, Search, Plus, Trash2, X } from 'lucide-react';
import api from '../../api/axios';
import PageHero from './PageHero';
import {
  AUTO_FIELDS, inferType, editFieldsFor, renderCell, RowEditor, prettyHeader, cellValue,
} from './TableRowEditor';

export default function TableWorkbench({
  base,                    // API prefix, e.g. '/data-editor' or '/fim-editor'
  title,
  subtitle,
  eyebrow,
  icon,
  note,                    // optional line under the hero
  allowInsert = false,
  allowDelete = false,
  emptyHint = 'Choose a table to begin.',
}) {
  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [active, setActive] = useState(null);
  const [rows, setRows] = useState([]);
  // Column allowlist the server sends for curated views (FIM …) so the listing
  // isn't a wall of blank cells. Null for ordinary tables.
  const [serverColumns, setServerColumns] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(false);
  const [rowQuery, setRowQuery] = useState('');
  const [rowSearchInput, setRowSearchInput] = useState('');
  const [editRow, setEditRow] = useState(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { fetchTables(); }, [base]);
  useEffect(() => { if (active) fetchRows(active, page, rowQuery); }, [active, page, rowQuery]);

  async function fetchTables() {
    setLoadingTables(true);
    try {
      const { data } = await api.get(`${base}/tables`);
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
      const { data } = await api.get(`${base}/table/${name}?${qs}`);
      setRows(data.rows || []);
      setServerColumns(data.columns || null);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setRows([]);
      setServerColumns(null);
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

  // The server sends every table already filed under a business area and in
  // display order, so grouping here just preserves that order (a Map keeps
  // insertion order).
  const tableGroups = useMemo(() => {
    const groups = new Map();
    tables.forEach((t) => {
      const g = t.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(t);
    });
    return [...groups.entries()];
  }, [tables]);

  const activeTable = useMemo(() => tables.find((t) => t.name === active), [tables, active]);

  // Every column present on the loaded rows — drives the insert form, so a
  // curated view's shorter listing never stops you setting a hidden field.
  const allColumns = useMemo(() => {
    if (rows.length === 0) return [];
    const keys = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (!k.startsWith('_')) keys.add(k); }));
    return ['id', ...Array.from(keys).filter((k) => k !== 'id')];
  }, [rows]);

  // What the rows table renders. The raw id stays out — the friendly row label
  // stands in for it.
  const columns = useMemo(() => {
    const source = serverColumns?.length ? serverColumns : allColumns;
    return source.filter((c) => c !== 'id');
  }, [serverColumns, allColumns]);

  const createFields = useMemo(() => (
    allColumns
      .filter((c) => !AUTO_FIELDS.includes(c))
      .map((c) => {
        const sample = rows.find((r) => r[c] != null)?.[c];
        return { key: c, type: sample !== undefined ? inferType(sample) : 'text', value: null, wasNull: true };
      })
  ), [allColumns, rows]);

  async function saveEdit(payload) {
    setSaving(true);
    setModalError('');
    try {
      await api.put(`${base}/table/${active}/row/${editRow.id}`, payload);
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
      await api.post(`${base}/table/${active}/row`, payload);
      setCreating(false);
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

  async function deleteRow(row) {
    const label = row._rowLabel || row.id;
    if (!window.confirm(`Delete “${label}”?\n\nThis is permanent, and any records that hang off this row go with it.`)) return;
    try {
      await api.delete(`${base}/table/${active}/row/${row.id}`);
      fetchRows(active, page, rowQuery);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  const rowActions = (row, big) => (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={() => { setModalError(''); setEditRow(row); }}
        className={big
          ? 'flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg'
          : 'text-purple-600 hover:text-purple-800'}
        title="Edit"
      >
        <Pencil size={15} />{big && ' Edit'}
      </button>
      {allowDelete && (
        <button onClick={() => deleteRow(row)} className="text-red-600 hover:text-red-800" title="Delete">
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <PageHero title={title} subtitle={subtitle} eyebrow={eyebrow} icon={icon} />

      {note && (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{note}</div>
      )}

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between gap-3">
          <span className="min-w-0 break-words">{error}</span>
          <button onClick={() => setError('')} className="shrink-0"><X size={14} /></button>
        </div>
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
            {tableGroups.map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((t) => (
                  <option key={t.name} value={t.name}>{t.label || t.name} ({t.rows ?? '?'})</option>
                ))}
              </optgroup>
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
            {tableGroups.map(([group, list]) => (
              <div key={group}>
                <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold uppercase tracking-wider text-gray-500 sticky top-0">
                  {group}
                </div>
                {list.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => selectTable(t.name)}
                    title={t.hint || t.name}
                    className={`w-full px-3 py-2 text-left text-sm flex justify-between items-center border-b border-gray-100 hover:bg-purple-50 ${active === t.name ? 'bg-purple-100 font-semibold' : ''}`}
                  >
                    <span className="truncate">{t.label || t.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{t.rows ?? '?'}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Rows panel */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden min-w-0">
          {!active ? (
            <div className="p-8 text-center text-gray-400">{emptyHint}</div>
          ) : (
            <>
              <div className="px-3 sm:px-4 py-3 border-b bg-gray-50 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-semibold text-gray-900 truncate">{activeTable?.label || active}</span>
                    <span className="text-xs text-gray-500 shrink-0">
                      {rowQuery ? `${total} match${total === 1 ? '' : 'es'}` : `${total} row${total === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {allowInsert && (
                      <button
                        onClick={() => { setModalError(''); setCreating(true); }}
                        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1"
                      >
                        <Plus size={15} /> <span className="hidden sm:inline">Add row</span><span className="sm:hidden">Add</span>
                      </button>
                    )}
                    <button onClick={() => fetchRows(active, page, rowQuery)} className="text-gray-500 hover:text-gray-900" title="Reload">
                      <RefreshCw size={16} />
                    </button>
                  </div>
                </div>

                {activeTable?.hint && (
                  <div className="text-[11px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-1">
                    {activeTable.hint}
                    {activeTable.virtual && '. Only these rows are shown, and your changes stay inside this view.'}
                  </div>
                )}

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
                          {rowActions(row, true)}
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
                          <th className="px-2 py-2 text-left font-semibold text-gray-600 w-20">Actions</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">Record</th>
                          {columns.map((c) => (
                            <th key={c} className="px-2 py-2 text-left font-semibold text-gray-600 whitespace-nowrap">{prettyHeader(c)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} className="border-t hover:bg-gray-50">
                            <td className="px-2 py-1">{rowActions(row, false)}</td>
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
          title={editRow._rowLabel ? `Edit ${editRow._rowLabel}` : `Edit row #${String(editRow.id)}`}
          subtitle={activeTable?.label || active}
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

      {creating && (
        <RowEditor
          title="Add row"
          subtitle={activeTable?.label || active}
          fields={createFields}
          omitEmpty
          allowAdvanced={false}
          submitLabel="Add row"
          busy={saving}
          error={modalError}
          onSave={saveCreate}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
