// SUPERADMIN-only direct table editor. Renders the row count + paginated rows
// for any whitelisted Prisma model and lets the operator update/insert/delete
// individual rows. No audit log is written — by design, SUPERADMIN actions are
// invisible to other admins.

import { useEffect, useState, useMemo } from 'react';
import { Database, Edit2, Trash2, Plus, Save, X, RefreshCw } from 'lucide-react';
import api from '../../api/axios';

export default function RealtimeCorrections() {
  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [active, setActive] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingRows, setLoadingRows] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState('{\n  \n}');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchTables();
  }, []);

  useEffect(() => {
    if (active) fetchRows(active, page);
  }, [active, page]);

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

  async function fetchRows(name, p) {
    setLoadingRows(true);
    setError('');
    try {
      const { data } = await api.get(`/superadmin/table/${name}?page=${p}&limit=50`);
      setRows(data.rows || []);
      setTotalPages(data.totalPages || 1);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
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
      fetchRows(active, page);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function deleteRow(id) {
    if (!window.confirm(`Delete ${active}/${id}? This is permanent.`)) return;
    try {
      await api.delete(`/superadmin/table/${active}/row/${id}`);
      fetchRows(active, page);
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
      fetchRows(active, 1);
      setPage(1);
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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <Database className="text-purple-700" size={28} />
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Real-time Corrections</h1>
          <p className="text-sm text-gray-500">Direct database editor — actions are not audit-logged.</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

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
                onClick={() => { setActive(t.name); setPage(1); setEditingId(null); setCreating(false); }}
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
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                <span className="font-semibold text-gray-900">{active}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCreating(true)}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                  >
                    <Plus size={14} /> Insert row
                  </button>
                  <button onClick={() => fetchRows(active, page)} className="text-gray-500 hover:text-gray-900" title="Reload">
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
                <div className="p-8 text-center text-gray-400">No rows.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
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
                            <td colSpan={columns.length + 1} className="p-3">
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
                          <tr key={row.id} className="border-t hover:bg-gray-50">
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
    </div>
  );
}
