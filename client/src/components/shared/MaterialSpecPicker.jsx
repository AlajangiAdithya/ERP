import { useState, useEffect, useRef } from 'react';
import { Search, Upload, Paperclip, X, Check, Package } from 'lucide-react';
import api from '../../api/axios';
import Modal from '../ui/Modal';
import Button from '../ui/Button';

// Allowed spec formats — any common document/drawing type. Validated by extension
// (DWG/office/zip mime types vary across browsers). Mirrors the PR form's rules.
const ATT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.dwg,.doc,.docx,.xls,.xlsx,.zip';
const ATT_EXT_RE = /\.(pdf|png|jpe?g|dwg|docx?|xlsx?|zip)$/i;
const ATT_MAX_MB = 15;

// ─── Material picker for the Purchase Requisition form ───
// Two modes, toggled at the top:
//   • Existing — search the product catalogue, pick a material, then tick one or
//     more of its previously-stored spec files (or upload new ones). New uploads
//     are added to that product's library on PR submit so they're reusable next time.
//   • New     — type a brand-new material description and (optionally) upload its
//     first spec file(s).
// onApply returns { productId, productName, productUnit, attachments: [{url,name}] }.
// This is purely an input aid — the PR table/PDF never show "existing/new".
export default function MaterialSpecPicker({ isOpen, mode = 'existing', initial = {}, onClose, onApply }) {
  const [tab, setTab] = useState(mode);

  // Existing-mode state
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [product, setProduct] = useState(null); // { id, name, unit }
  const [specs, setSpecs] = useState([]);
  const [loadingSpecs, setLoadingSpecs] = useState(false);

  // New-mode state
  const [newName, setNewName] = useState('');

  // Shared multi-select + upload state. `selected` is the list of chosen files
  // ({url,name}); existing specs are ticked by URL, new uploads are appended.
  const [selected, setSelected] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const debounceRef = useRef(null);

  const isSelected = (url) => selected.some((s) => s.url === url);
  const toggle = (file) =>
    setSelected((prev) => (prev.some((s) => s.url === file.url)
      ? prev.filter((s) => s.url !== file.url)
      : [...prev, { url: file.url, name: file.name }]));

  // Reset to the requested mode + carry over any existing row values each open.
  useEffect(() => {
    if (!isOpen) return;
    setTab(mode);
    setSearch('');
    setResults([]);
    setProduct(initial.productId ? { id: initial.productId, name: initial.productName || '', unit: initial.productUnit || '' } : null);
    setSpecs([]);
    setNewName(initial.productName || '');
    setSelected(Array.isArray(initial.attachments) ? initial.attachments.map((a) => ({ url: a.url, name: a.name })) : []);
    setUploadError('');
    setUploading(false);
    // If reopening on an already-linked product, preload its spec library.
    if (mode === 'existing' && initial.productId) loadSpecs(initial.productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  // Debounced product search.
  useEffect(() => {
    if (tab !== 'existing') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (q.length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get('/products', { params: { search: q, limit: 20 } });
        setResults(data.products || []);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [search, tab]);

  const loadSpecs = async (productId) => {
    setLoadingSpecs(true);
    try {
      const { data } = await api.get(`/products/${productId}/specs`);
      setSpecs(Array.isArray(data) ? data : []);
    } catch {
      setSpecs([]);
    }
    setLoadingSpecs(false);
  };

  const pickProduct = (p) => {
    setProduct({ id: p.id, name: p.name, unit: p.unit });
    setResults([]);
    setSearch('');
    // Clear any spec selection carried from a different product.
    setSelected([]);
    loadSpecs(p.id);
  };

  const uploadSpecs = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    for (const f of files) {
      if (!ATT_EXT_RE.test(f.name)) { setUploadError('Allowed: PDF, JPG, PNG, DWG, DOC, XLS, ZIP'); return; }
      if (f.size > ATT_MAX_MB * 1024 * 1024) { setUploadError(`Max ${ATT_MAX_MB} MB per file`); return; }
    }
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const { data } = await api.post('/purchase-requests/upload-spec', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const uploaded = data.files || (data.url ? [{ url: data.url, name: data.name }] : []);
      // Show each in the visible list (existing mode) and auto-select it.
      setSpecs((prev) => [...uploaded.map((u, i) => ({ id: `new-${Date.now()}-${i}`, url: u.url, name: u.name, _justUploaded: true })), ...prev]);
      setSelected((prev) => [...prev, ...uploaded.map((u) => ({ url: u.url, name: u.name }))]);
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
  };

  const canApply = tab === 'existing' ? !!product : !!newName.trim();

  const apply = () => {
    if (!canApply) return;
    if (tab === 'existing') {
      onApply({
        productId: product.id,
        productName: product.name,
        productUnit: product.unit || undefined,
        attachments: selected,
      });
    } else {
      onApply({
        productId: null,
        productName: newName.trim(),
        productUnit: undefined,
        attachments: selected,
      });
    }
    onClose();
  };

  const tabBtn = (key) =>
    `px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
      tab === key ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`;

  const SpecUploadBtn = () => (
    <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-navy-700 hover:underline">
      <Upload size={13} /> {uploading ? 'Uploading…' : 'Upload new spec files (any format)'}
      <input
        type="file"
        multiple
        accept={ATT_ACCEPT}
        className="hidden"
        disabled={uploading}
        onChange={(e) => { uploadSpecs(e.target.files); e.target.value = ''; }}
      />
    </label>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select material & specs" size="lg">
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-2">
          <button type="button" className={tabBtn('existing')} onClick={() => setTab('existing')}>Existing</button>
          <button type="button" className={tabBtn('new')} onClick={() => setTab('new')}>New</button>
        </div>

        {tab === 'existing' ? (
          <div className="space-y-3">
            {/* Product search */}
            {!product && (
              <div className="relative">
                <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search material by name, ID or SKU…"
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
                />
                {(searching || results.length > 0) && (
                  <div className="mt-1 border border-gray-200 rounded-md max-h-56 overflow-y-auto divide-y divide-gray-50">
                    {searching && <div className="px-3 py-2 text-xs text-gray-400">Searching…</div>}
                    {!searching && results.length === 0 && search.trim().length >= 2 && (
                      <div className="px-3 py-2 text-xs text-gray-400">No matches — try the “New” tab.</div>
                    )}
                    {results.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-navy-50"
                      >
                        <div className="text-sm font-medium text-gray-800">{p.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono">
                          {p.materialCode || p.sku || '—'}{p.category ? ` · ${p.category}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {search.trim().length > 0 && search.trim().length < 2 && (
                  <div className="mt-1 text-[11px] text-gray-400">Type at least 2 characters.</div>
                )}
              </div>
            )}

            {/* Selected product + its spec library */}
            {product && (
              <div className="border border-gray-200 rounded-md p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package size={15} className="text-navy-700 flex-shrink-0" />
                    <span className="text-sm font-semibold text-gray-800 truncate">{product.name}</span>
                  </div>
                  <button type="button" onClick={() => { setProduct(null); setSpecs([]); setSelected([]); }} className="text-xs text-gray-500 hover:text-navy-700">
                    Change
                  </button>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1.5">Previous material specs — tick any to attach</div>
                  {loadingSpecs ? (
                    <div className="text-xs text-gray-400">Loading…</div>
                  ) : specs.length === 0 ? (
                    <div className="text-xs text-gray-400 italic">No specs stored yet for this material — upload one below.</div>
                  ) : (
                    <div className="space-y-1">
                      {specs.map((s) => {
                        const sel = isSelected(s.url);
                        return (
                          <label
                            key={s.id}
                            className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-sm ${
                              sel ? 'border-navy-500 bg-navy-50' : 'border-gray-200 hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={sel}
                              onChange={() => toggle(s)}
                            />
                            <Paperclip size={12} className="text-gray-400 flex-shrink-0" />
                            <span className="truncate flex-1">{s.name}</span>
                            {s._justUploaded && <span className="text-[10px] text-green-600 font-medium">new</span>}
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-[11px] text-navy-700 hover:underline flex-shrink-0"
                            >
                              view
                            </a>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                  <SpecUploadBtn />
                  {selected.length > 0 && (
                    <button type="button" onClick={() => setSelected([])} className="text-[11px] text-gray-400 hover:text-red-600 inline-flex items-center gap-1">
                      <X size={11} /> clear {selected.length} selected
                    </button>
                  )}
                </div>
                {uploadError && <div className="text-[11px] text-red-600">{uploadError}</div>}
              </div>
            )}
          </div>
        ) : (
          /* New material */
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Material description</label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Stainless Steel Plate 304, 6mm"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700"
              />
            </div>
            <div className="border border-gray-200 rounded-md p-3 space-y-2">
              <div className="text-xs font-semibold text-gray-600">Spec files (optional, any format)</div>
              {selected.length > 0 && (
                <div className="space-y-1">
                  {selected.map((f, i) => (
                    <div key={f.url || i} className="flex items-center gap-2 text-sm">
                      <Paperclip size={12} className="text-gray-400" />
                      <span className="truncate flex-1">{f.name || 'spec'}</span>
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-[11px] text-navy-700 hover:underline">view</a>
                      <button type="button" onClick={() => setSelected((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <SpecUploadBtn />
              {uploadError && <div className="text-[11px] text-red-600">{uploadError}</div>}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={apply} disabled={!canApply}>
            <Check size={15} className="mr-1" /> Use this material{selected.length > 0 ? ` (${selected.length} spec${selected.length === 1 ? '' : 's'})` : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
