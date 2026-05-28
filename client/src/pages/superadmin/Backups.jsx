// SUPERADMIN-only S3 backup browser. Mirrors the bucket layout produced by
// deploy/backup.sh: FY folder → tier folder → file. Click a file to view its
// metadata.json (or master snapshot) and grab a 5-minute presigned download URL.

import { useEffect, useState } from 'react';
import { HardDrive, Download, Eye, ChevronRight, ChevronDown, RefreshCw, X } from 'lucide-react';
import api from '../../api/axios';

const TIER_LABELS = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  'half-yearly': 'Half-yearly',
  yearly: 'Yearly',
  master: 'Master snapshots',
};
const TIER_ORDER = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly', 'master'];

const fmtBytes = (n) => {
  if (!n) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

export default function Backups() {
  const [tree, setTree] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openFY, setOpenFY] = useState({});
  const [openTier, setOpenTier] = useState({});
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => { fetchTree(); }, []);

  async function fetchTree() {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/superadmin/backups');
      setTree(data.tree || {});
      // open the most recent FY by default
      const fys = Object.keys(data.tree || {}).sort().reverse();
      if (fys[0]) setOpenFY({ [fys[0]]: true });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }

  async function openPreview(file) {
    setPreviewLoading(true);
    setPreview({ file, data: null });
    try {
      const { data } = await api.get(`/superadmin/backups/preview?key=${encodeURIComponent(file.key)}`);
      setPreview({ file, data });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function downloadFile(file) {
    try {
      const { data } = await api.get(`/superadmin/backups/signed-url?key=${encodeURIComponent(file.key)}`);
      // Open in a new tab — browser will download directly from S3.
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  const fys = Object.keys(tree).sort().reverse();

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="text-purple-700" size={28} />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Backups</h1>
            <p className="text-sm text-gray-500">Browse the S3 tier ladder. Download links expire in 5 minutes.</p>
          </div>
        </div>
        <button onClick={fetchTree} className="px-3 py-2 text-sm border rounded hover:bg-gray-50 flex items-center gap-1.5">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded bg-red-50 border border-red-200 text-sm text-red-800 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={14} /></button>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-gray-400">Loading…</div>
      ) : fys.length === 0 ? (
        <div className="p-8 text-center text-gray-400">No backups found in the bucket.</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {fys.map((fy) => (
            <div key={fy} className="border-b last:border-b-0">
              <button
                onClick={() => setOpenFY((o) => ({ ...o, [fy]: !o[fy] }))}
                className="w-full px-4 py-3 flex items-center gap-2 bg-gray-50 hover:bg-gray-100"
              >
                {openFY[fy] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="font-semibold text-gray-900">{fy}</span>
              </button>
              {openFY[fy] && (
                <div>
                  {TIER_ORDER.filter((t) => tree[fy][t]).map((tier) => {
                    const tierKey = `${fy}/${tier}`;
                    const files = tree[fy][tier];
                    return (
                      <div key={tierKey} className="border-t">
                        <button
                          onClick={() => setOpenTier((o) => ({ ...o, [tierKey]: !o[tierKey] }))}
                          className="w-full px-8 py-2 flex items-center gap-2 text-sm hover:bg-gray-50"
                        >
                          {openTier[tierKey] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <span className="font-medium text-gray-700">{TIER_LABELS[tier]}</span>
                          <span className="text-xs text-gray-400">({files.length})</span>
                        </button>
                        {openTier[tierKey] && (
                          <div className="bg-gray-50 px-12 py-1">
                            {files.map((f) => (
                              <div key={f.key} className="py-1.5 flex items-center justify-between border-b border-gray-200 last:border-b-0 text-sm">
                                <div>
                                  <div className="font-mono text-gray-800">{f.name}</div>
                                  <div className="text-xs text-gray-500">
                                    {fmtBytes(f.size)} · {f.lastModified.slice(0, 10)}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => openPreview(f)}
                                    className="px-2 py-1 text-xs border rounded hover:bg-white flex items-center gap-1"
                                  >
                                    <Eye size={12} /> Preview
                                  </button>
                                  <button
                                    onClick={() => downloadFile(f)}
                                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1"
                                  >
                                    <Download size={12} /> Download
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-900">{preview.file.name}</div>
                <div className="text-xs text-gray-500 font-mono">{preview.file.key}</div>
              </div>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto">
              {previewLoading ? (
                <div className="text-center text-gray-400 py-8">Loading…</div>
              ) : (
                <pre className="text-xs font-mono whitespace-pre-wrap break-all bg-gray-900 text-green-300 p-4 rounded">
                  {JSON.stringify(preview.data?.metadata ?? preview.data, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
