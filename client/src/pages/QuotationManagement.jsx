import { useState, useEffect, useMemo } from 'react';
import { Plus, Send, CheckCircle, Trash2, Eye, FileText, X, Layers, Paperclip, RefreshCw, AlertCircle, PauseCircle, GitMerge, FileSearch } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SupplierAutocomplete, { supplierContactString, matchSuppliers } from '../components/shared/SupplierAutocomplete';
import { formatDateTime } from '../utils/formatters';

const formatCurrency = (amt) => `₹${Number(amt).toLocaleString('en-IN')}`;

// ─── Add Quotation Modal ───
// Per-row supplier picker: "Existing supplier" (dropdown of past suppliers for
// THIS product, with last unit price shown) or "New supplier" (free-text fields).
// Match priority: productId → product name (case-insensitive).
function AddQuotationModal({ isOpen, onClose, purchaseRequest, onCreated }) {
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [complianceFY, setComplianceFY] = useState('');
  // Supplier compliance flags indexed by supplierId, loaded once when the modal
  // opens. Used to surface a soft "assessment expired" banner without blocking
  // submission — the PO can still send the quote even if the FY assessment is
  // overdue.
  const [supplierIndex, setSupplierIndex] = useState({});
  const [currentFY, setCurrentFY] = useState('');
  // Approved Supplier List (minus rejected/terminated) — merged into each row's
  // "Existing" dropdown by matching scope of supply against the product name.
  const [aslSuppliers, setAslSuppliers] = useState([]);
  // history[productKey] = [{ supplierId, supplierName, supplierContact, supplierAddress, lastUnitPrice, lastDate, timesUsed, wasSelected }]
  const [history, setHistory] = useState({});
  // Common supplier fields applied across all rows on demand
  const [common, setCommon] = useState({ supplierId: null, supplierName: '', supplierContact: '', supplierAddress: '' });

  // Normalised key for a row's product: prefer productId, fall back to name-lower.
  const rowKey = (row) => row.productId ? `id:${row.productId}` : `name:${(row.productName || '').toLowerCase().trim()}`;

  useEffect(() => {
    if (isOpen && purchaseRequest) {
      setNotes('');
      setCommon({ supplierId: null, supplierName: '', supplierContact: '', supplierAddress: '' });
      // Show items still open for quoting (AWAITING / SUBMITTED / HELD). Items
      // already covered by a competing quote can still receive another one —
      // only APPROVED (already on a PO) and CANCELLED items are hidden.
      // Items already pooled belong to the pool's union quote, not the per-PR form.
      const prItems = purchaseRequest.items
        ?.filter(i => !i.materialPoolMembership)
        .filter(i => !i.itemQuotationStatus || ['AWAITING_QUOTATION', 'QUOTATION_SUBMITTED', 'QUOTATION_HELD'].includes(i.itemQuotationStatus))
        .map(i => ({
          productId: i.productId || null,
          productName: i.productName,
          productUnit: i.productUnit || 'pcs',
          quantity: i.adminApprovedQty || i.requestedQty,
          unitPrice: 0,
          supplierMode: 'existing', // 'existing' | 'new'
          supplierId: null,
          supplierName: '',
          supplierContact: '',
          supplierAddress: '',
          // PR specs flow through to PO — read-only for quotation/PO creators.
          materialType: i.materialType || '',
          materialSpecification: i.materialSpecification || '',
          drawingNo: i.drawingNo || '',
          qapNo: i.qapNo || '',
          itemRemarks: i.itemRemarks || '',
          quotationPdf: null, // per-product supplier-quote PDF (File)
        })) || [{ productId: null, productName: '', productUnit: 'pcs', quantity: 1, unitPrice: 0, supplierMode: 'new', supplierId: null, supplierName: '', supplierContact: '', supplierAddress: '', quotationPdf: null }];
      setItems(prItems);

      // For each PR item with a productId, fetch supplier history (purchased + quoted).
      // Build a per-product list of suppliers + last unit price.
      const productIds = [...new Set(prItems.map(i => i.productId).filter(Boolean))];
      const productNames = [...new Set(prItems.map(i => (i.productName || '').toLowerCase().trim()).filter(Boolean))];

      const acc = {};
      const addEntry = (key, entry) => {
        if (!acc[key]) acc[key] = new Map();
        const map = acc[key];
        const sk = (entry.supplierId || entry.supplierName || '').toString().toLowerCase();
        if (!sk) return;
        const existing = map.get(sk) || { supplierId: entry.supplierId || null, supplierName: entry.supplierName, supplierContact: entry.supplierContact || '', supplierAddress: entry.supplierAddress || '', lastUnitPrice: entry.unitPrice, lastDate: entry.date, timesUsed: 0, wasPurchased: false };
        existing.timesUsed += 1;
        if (entry.wasPurchased) existing.wasPurchased = true;
        if (new Date(entry.date) > new Date(existing.lastDate)) {
          existing.lastDate = entry.date;
          existing.lastUnitPrice = entry.unitPrice;
          if (entry.supplierContact) existing.supplierContact = entry.supplierContact;
          if (entry.supplierAddress) existing.supplierAddress = entry.supplierAddress;
        }
        if (entry.supplierId && !existing.supplierId) existing.supplierId = entry.supplierId;
        map.set(sk, existing);
      };

      // Fetch per-product supplier history in parallel.
      const fetches = productIds.map(pid =>
        api.get(`/products/${pid}/supplier-history`)
          .then(({ data }) => {
            const productKey = `id:${pid}`;
            const nameKey = `name:${(data.product?.name || '').toLowerCase().trim()}`;
            for (const r of data.purchased || []) {
              const entry = { ...r, wasPurchased: true };
              addEntry(productKey, entry);
              addEntry(nameKey, entry);
            }
            for (const r of data.quoted || []) {
              const entry = { ...r, wasPurchased: false };
              addEntry(productKey, entry);
              addEntry(nameKey, entry);
            }
          })
          .catch(() => {})
      );

      // Load suppliers in parallel: the assessment-expired soft-warning index,
      // plus the Approved Supplier List used to fill the "Existing" dropdowns.
      const suppliersPromise = api.get('/suppliers?limit=all').then(({ data }) => {
        const idx = {};
        for (const s of data.suppliers || []) {
          idx[s.id] = {
            name: s.name,
            assessmentValid: !!s.assessmentValidForCurrentFY,
            assessmentFiscalYear: s.assessmentFiscalYear || null,
          };
        }
        setSupplierIndex(idx);
        setCurrentFY(data.currentFinancialYear || '');
        const asl = (data.suppliers || []).filter(
          s => s.approvalStatus !== 'REJECTED' && s.approvalStatus !== 'TERMINATED'
        );
        setAslSuppliers(asl);
        return asl;
      }).catch(() => []);

      Promise.all([Promise.all(fetches), suppliersPromise]).then(([, asl]) => {
        const finalised = {};
        for (const [k, m] of Object.entries(acc)) {
          finalised[k] = [...m.values()].sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
        }
        setHistory(finalised);

        // Default to 'existing' when the row has past suppliers OR ASL suppliers
        // whose scope of supply covers the product; otherwise 'new'.
        setItems(prev => prev.map(row => {
          const key = rowKey(row);
          const list = finalised[key] || [];
          const aslHits = matchSuppliers(asl, row.productName, 20, false);
          return { ...row, supplierMode: (list.length > 0 || aslHits.length > 0) ? 'existing' : 'new' };
        }));
      });
    }
  }, [isOpen, purchaseRequest]);

  // Suppliers selected on any row whose assessment is missing/expired.
  const expiredAssessmentSuppliers = useMemo(() => {
    const seen = new Map();
    for (const row of items) {
      const sid = row.supplierId;
      const info = sid ? supplierIndex[sid] : null;
      if (info && !info.assessmentValid && !seen.has(sid)) {
        seen.set(sid, info);
      }
    }
    return [...seen.entries()].map(([id, info]) => ({ id, ...info }));
  }, [items, supplierIndex]);

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  // Patch several fields on one row atomically (used by the ASL autocomplete).
  const patchItem = (idx, patch) => {
    setItems(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  // Stable option key for a history entry — id when linked, name otherwise.
  const historyKey = (s) =>
    s.supplierId ? s.supplierId.toString().toLowerCase() : `name:${(s.supplierName || '').toLowerCase()}`;

  // Select an existing supplier on a row — pre-fills name/contact/address + lastUnitPrice.
  // Keys: "<supplierId>" / "name:<name>" come from purchase history; "asl:<id>"
  // comes from the Approved Supplier List (scope-of-supply match, no history).
  const applyExistingSupplier = (idx, supplierKey) => {
    if (!supplierKey) {
      patchItem(idx, { supplierId: null, supplierName: '' });
      return;
    }
    if (supplierKey.startsWith('asl:')) {
      const s = aslSuppliers.find(x => `asl:${x.id}` === supplierKey);
      if (!s) return;
      patchItem(idx, {
        supplierId: s.id,
        supplierName: s.name,
        supplierContact: supplierContactString(s),
        supplierAddress: s.address || '',
      });
      return;
    }
    const row = items[idx];
    const list = history[rowKey(row)] || [];
    const s = list.find(x => historyKey(x) === supplierKey);
    if (!s) return;
    const updated = [...items];
    updated[idx] = {
      ...row,
      supplierId: s.supplierId || null,
      supplierName: s.supplierName,
      supplierContact: s.supplierContact || '',
      supplierAddress: s.supplierAddress || '',
      unitPrice: row.unitPrice && row.unitPrice > 0 ? row.unitPrice : (s.lastUnitPrice || 0),
    };
    setItems(updated);
  };

  const switchMode = (idx, mode) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], supplierMode: mode };
    if (mode === 'new') {
      // Switching to new — keep typed name if any, but drop the supplierId link.
      updated[idx].supplierId = null;
    } else {
      // Switching to existing — clear name so the dropdown forces a re-select.
      updated[idx].supplierName = '';
      updated[idx].supplierContact = '';
      updated[idx].supplierAddress = '';
    }
    setItems(updated);
  };

  const addItem = () => setItems([...items, { productId: null, productName: '', productUnit: 'pcs', quantity: 1, unitPrice: 0, supplierMode: 'new', supplierId: null, supplierName: '', supplierContact: '', supplierAddress: '', quotationPdf: null }]);
  const removeItem = (idx) => items.length > 1 && setItems(items.filter((_, i) => i !== idx));

  const totalAmount = items.reduce((sum, i) => sum + (i.quantity * i.unitPrice), 0);
  const uniqueSuppliers = [...new Set(items.map(i => (i.supplierName || '').trim()).filter(Boolean))];

  const submit = async () => {
    const validItems = items.filter(i => i.productName.trim() && i.unitPrice > 0);
    if (validItems.length === 0) return alert('At least one item with pricing is required');
    const missingSupplier = validItems.find(i => !i.supplierName.trim());
    if (missingSupplier) return alert(`Supplier is required for every item (missing for "${missingSupplier.productName}")`);
    const badPdf = validItems.find(i => i.quotationPdf && i.quotationPdf.type !== 'application/pdf');
    if (badPdf) {
      return alert(`Quotation attachment for "${badPdf.productName}" must be a PDF file`);
    }

    setSaving(true);
    setComplianceIssues([]);
    try {
      const payload = {
        purchaseRequestId: purchaseRequest.id,
        notes: notes || undefined,
        items: validItems.map(i => ({
          productId: i.productId || undefined,
          productName: i.productName.trim(),
          productUnit: i.productUnit,
          quantity: parseFloat(i.quantity) || 1,
          unitPrice: parseFloat(i.unitPrice) || 0,
          supplierId: i.supplierId || undefined,
          supplierName: i.supplierName.trim(),
          supplierContact: i.supplierContact?.trim() || undefined,
          supplierAddress: i.supplierAddress?.trim() || undefined,
        })),
      };

      // Per-product PDFs are keyed by their index in payload.items so the server
      // can attach each quote document to the right line.
      const hasItemPdf = validItems.some(i => i.quotationPdf);
      if (hasItemPdf) {
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        validItems.forEach((i, idx) => {
          if (i.quotationPdf) form.append(`quotationPdf_${idx}`, i.quotationPdf);
        });
        await api.post('/quotations', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/quotations', payload);
      }
      onClose();
      onCreated();
    } catch (err) {
      const issues = err.response?.data?.complianceIssues;
      if (Array.isArray(issues) && issues.length > 0) {
        setComplianceIssues(issues);
        setComplianceFY(err.response?.data?.currentFinancialYear || '');
      } else {
        alert(err.response?.data?.error || 'Failed to create quotation');
      }
    }
    setSaving(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Quotation" size="xl">
      <div className="space-y-4">
        <div className="bg-gray-50 p-3 rounded-md text-sm flex flex-wrap gap-x-6 gap-y-1">
          <div><span className="text-gray-500">For PR:</span>{' '}<span className="font-medium">{purchaseRequest?.requestNumber}</span></div>
          <div className="text-xs text-gray-500">Enter a supplier name beside each product. Products sharing one supplier become a single Purchase Order on approval.</div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
          For each product below, choose <strong>Existing supplier</strong> — the dropdown lists past suppliers for that product (with last price) plus <strong>Approved Supplier List</strong> suppliers whose scope of supply covers the material — or <strong>New supplier</strong>. In the supplier name box you can also type a material (e.g. TCE) or a name to search the ASL; picking one fills their details. Last unit price is pre-filled — edit before submitting.
        </div>

        {complianceIssues.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-900">
            <p className="font-semibold mb-1">Supplier compliance documents required{complianceFY ? ` for FY ${complianceFY}` : ''}</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              {complianceIssues.map((iss) => (
                <li key={iss.supplierId}>
                  <strong>{iss.supplierName}</strong>
                  {' '}— missing{' '}
                  {iss.missing.map((m, idx) => (
                    <span key={m}>
                      {idx > 0 ? ', ' : ''}
                      {m === 'vendor-evaluation' ? 'Vendor Evaluation PDF' : `Supplier Assessment PDF (FY ${complianceFY})`}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <a
              href="/suppliers"
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 text-xs font-semibold text-red-900 underline hover:text-red-700"
            >
              Open Suppliers page to upload PDFs →
            </a>
            <p className="text-[11px] text-red-700 mt-1">After uploading, click "Submit Quotation" again.</p>
          </div>
        )}

        {expiredAssessmentSuppliers.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5 text-amber-700" />
              <div className="flex-1">
                <p className="font-semibold mb-1">
                  Supplier assessment expired{currentFY ? ` for FY ${currentFY}` : ''}
                </p>
                <ul className="text-xs space-y-0.5 list-disc list-inside">
                  {expiredAssessmentSuppliers.map((s) => (
                    <li key={s.id}>
                      <strong>{s.name}</strong>
                      {s.assessmentFiscalYear ? ` — last assessed in FY ${s.assessmentFiscalYear}` : ' — no assessment on file'}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] mt-1.5">
                  You can still submit this quotation — the assessment can be uploaded later from the Suppliers page.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Same-supplier quick fill — one click sets the supplier on every row */}
        <div className="border border-blue-200 bg-blue-50/40 rounded-md p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-blue-800">Single supplier for the whole quote?</span>
            <span className="text-[11px] text-blue-700">Fill these once, then "Apply to all items".</span>
          </div>
          <div className="grid grid-cols-12 gap-2">
            <SupplierAutocomplete
              className="col-span-4"
              inputClassName="w-full px-2 py-1.5 border rounded text-sm"
              placeholder="Supplier name (type material or name)"
              value={common.supplierName}
              onChange={(v) => setCommon({ ...common, supplierName: v, supplierId: null })}
              onSelect={(s) => setCommon({
                supplierId: s.id,
                supplierName: s.name,
                supplierContact: supplierContactString(s),
                supplierAddress: s.address || '',
              })}
            />
            <input value={common.supplierContact} onChange={(e) => setCommon({ ...common, supplierContact: e.target.value })}
              className="col-span-3 px-2 py-1.5 border rounded text-sm" placeholder="Phone/Email" />
            <input value={common.supplierAddress} onChange={(e) => setCommon({ ...common, supplierAddress: e.target.value })}
              className="col-span-3 px-2 py-1.5 border rounded text-sm" placeholder="Address" />
            <Button
              size="sm"
              variant="secondary"
              className="col-span-2"
              disabled={!common.supplierName.trim()}
              onClick={() => {
                setItems(items.map(row => ({
                  ...row,
                  supplierMode: 'new',
                  supplierId: common.supplierId || null,
                  supplierName: common.supplierName.trim(),
                  supplierContact: common.supplierContact.trim(),
                  supplierAddress: common.supplierAddress.trim(),
                })));
              }}
            >
              Apply to all items
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Items, Suppliers & Pricing</h4>
            <button onClick={addItem} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
              <Plus size={12} /> Add Item
            </button>
          </div>
          <div className="space-y-3">
            {items.map((item, idx) => {
              const suggestions = history[rowKey(item)] || [];
              // ASL suppliers whose scope of supply (or name) covers this row's
              // product, word-by-word — minus ones already in the history list.
              const aslMatches = matchSuppliers(aslSuppliers, item.productName, 20, false).filter(
                s => !suggestions.some(h =>
                  (h.supplierId && h.supplierId === s.id) ||
                  (h.supplierName || '').trim().toLowerCase() === s.name.trim().toLowerCase()
                )
              );
              const hasExisting = suggestions.length > 0 || aslMatches.length > 0;
              const selectValue = item.supplierId
                ? (aslMatches.some(s => s.id === item.supplierId) ? `asl:${item.supplierId}` : item.supplierId.toString().toLowerCase())
                : (item.supplierName ? `name:${item.supplierName.toLowerCase()}` : '');
              return (
                <div key={idx} className="border rounded-md p-3 bg-white space-y-2">
                  {/* Product row */}
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Product</label>
                      <input value={item.productName} onChange={(e) => updateItem(idx, 'productName', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Product name" />
                      {(item.materialType || item.materialSpecification || item.drawingNo || item.qapNo || item.itemRemarks) && (
                        <div className="mt-1 text-[11px] text-gray-600 space-y-0.5 bg-gray-50 border-l-2 border-blue-300 pl-2 py-1">
                          {item.materialType && (<div><span className="font-medium text-gray-700">Type:</span> {item.materialType}</div>)}
                          {item.materialSpecification && (<div><span className="font-medium text-gray-700">Spec:</span> {item.materialSpecification}</div>)}
                          {item.drawingNo && (<div><span className="font-medium text-gray-700">Drawing #:</span> {item.drawingNo}</div>)}
                          {item.qapNo && (<div><span className="font-medium text-gray-700">QAP #:</span> {item.qapNo}</div>)}
                          {item.itemRemarks && (<div><span className="font-medium text-gray-700">Remarks:</span> {item.itemRemarks}</div>)}
                        </div>
                      )}
                    </div>
                    <div className="col-span-1">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Unit</label>
                      <input value={item.productUnit} onChange={(e) => updateItem(idx, 'productUnit', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Qty</label>
                      <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm" min="0.01" step="0.01" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Unit Price (₹)</label>
                      <input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded text-sm" min="0" step="0.01" />
                    </div>
                    <div className="col-span-2 flex items-center justify-between">
                      <div>
                        <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Total</label>
                        <div className="text-sm font-semibold text-navy-700">
                          {formatCurrency((item.quantity || 0) * (item.unitPrice || 0))}
                        </div>
                      </div>
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600 self-end pb-1" title="Remove row"><X size={16} /></button>
                      )}
                    </div>
                  </div>

                  {/* Supplier picker */}
                  <div className="bg-gray-50 border rounded p-2">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-medium text-gray-700">Supplier:</span>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="radio" checked={item.supplierMode === 'existing'} onChange={() => switchMode(idx, 'existing')} disabled={!hasExisting} />
                        <span className={!hasExisting ? 'text-gray-400' : ''}>
                          Existing {hasExisting && (
                            <span className="text-gray-500">
                              ({[
                                suggestions.length > 0 ? `${suggestions.length} past` : null,
                                aslMatches.length > 0 ? `${aslMatches.length} approved` : null,
                              ].filter(Boolean).join(' · ')})
                            </span>
                          )}
                        </span>
                      </label>
                      <label className="flex items-center gap-1 text-xs cursor-pointer">
                        <input type="radio" checked={item.supplierMode === 'new'} onChange={() => switchMode(idx, 'new')} />
                        <span>New supplier</span>
                      </label>
                    </div>

                    {item.supplierMode === 'existing' && hasExisting ? (
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-12">
                          <select
                            value={selectValue}
                            onChange={(e) => applyExistingSupplier(idx, e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm bg-white"
                          >
                            <option value="">— Select supplier —</option>
                            {suggestions.length > 0 && (
                              <optgroup label="Past suppliers for this product">
                                {suggestions.map(s => {
                                  const key = historyKey(s);
                                  return (
                                    <option key={key} value={key}>
                                      {s.supplierName} · last @ ₹{Number(s.lastUnitPrice).toLocaleString('en-IN')}/{item.productUnit} on {new Date(s.lastDate).toLocaleDateString('en-IN')} {s.wasPurchased ? '· purchased' : '· quoted'} ({s.timesUsed}×)
                                    </option>
                                  );
                                })}
                              </optgroup>
                            )}
                            {aslMatches.length > 0 && (
                              <optgroup label={`Approved Supplier List — scope covers "${item.productName || 'this product'}"`}>
                                {aslMatches.map(s => (
                                  <option key={`asl:${s.id}`} value={`asl:${s.id}`}>
                                    {s.name}{s.vendorIdNo ? ` · ${s.vendorIdNo}` : ''}{s.approvalStatus === 'CONDITIONAL' ? ' · Conditional' : ''} · scope: {s.scopeOfSupply || '—'}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                        {item.supplierName && (
                          <div className="col-span-12 text-xs text-gray-600">
                            <span className="font-medium">{item.supplierName}</span>
                            {item.supplierContact && <> · {item.supplierContact}</>}
                            {item.supplierAddress && <> · {item.supplierAddress}</>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-4">
                          <SupplierAutocomplete
                            value={item.supplierName}
                            contextQuery={item.productName}
                            placeholder="Supplier name *"
                            onChange={(v) => patchItem(idx, { supplierName: v, supplierId: null })}
                            onSelect={(s) => patchItem(idx, {
                              supplierId: s.id,
                              supplierName: s.name,
                              supplierContact: supplierContactString(s),
                              supplierAddress: s.address || '',
                            })}
                          />
                        </div>
                        <div className="col-span-3">
                          <input value={item.supplierContact} onChange={(e) => updateItem(idx, 'supplierContact', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Phone/Email" />
                        </div>
                        <div className="col-span-5">
                          <input value={item.supplierAddress} onChange={(e) => updateItem(idx, 'supplierAddress', e.target.value)}
                            className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Address" />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Per-product supplier-quote PDF */}
                  <div className="bg-blue-50/40 border rounded p-2">
                    <label className="text-xs font-medium text-gray-700 flex items-center gap-1 mb-1">
                      <Paperclip size={12} /> Quote PDF for this product
                      <span className="text-[11px] text-gray-500 font-normal">(optional, PDF only ≤10 MB)</span>
                    </label>
                    {item.quotationPdf ? (
                      <div className="text-xs text-gray-600 flex items-center gap-2">
                        <span className="font-medium">{item.quotationPdf.name}</span>
                        <span className="text-gray-400">({(item.quotationPdf.size / 1024).toFixed(1)} KB)</span>
                        <button type="button" onClick={() => updateItem(idx, 'quotationPdf', null)} className="text-red-500 hover:text-red-700"><X size={12} /></button>
                      </div>
                    ) : (
                      <input
                        type="file"
                        accept="application/pdf"
                        onChange={(e) => updateItem(idx, 'quotationPdf', e.target.files?.[0] || null)}
                        className="text-xs"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between items-center mt-2 text-sm">
            <div className="text-xs text-gray-500">
              {uniqueSuppliers.length > 0 && (
                <>Suppliers in this quotation: <span className="font-medium text-gray-700">{uniqueSuppliers.length}</span> ({uniqueSuppliers.join(', ')})</>
              )}
            </div>
            <div className="font-semibold">
              Grand Total: <span className="text-navy-700">{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </div>

        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Add Quotation'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Create Union Quotation Modal (PO selects items across multiple PRs) ───
function CreateUnionQuotationModal({ isOpen, onClose, purchaseRequests, onCreated }) {
  // unionLines: { key: stableKey, productName, productUnit, unitPrice, supplierName, supplierContact, supplierAddress, sources: [{ purchaseRequestItemId, purchaseRequestId, requestNumber, unitCode, allocatedQty, checked }] }
  const [unionLines, setUnionLines] = useState([]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [quotationPdf, setQuotationPdf] = useState(null);
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [complianceFY, setComplianceFY] = useState('');

  useEffect(() => {
    if (!isOpen || !purchaseRequests?.length) return;
    setNotes('');
    setQuotationPdf(null);

    // Group PR items by product. Prefer productId when present so items that
    // happen to share a typed name don't get merged with a real catalog product
    // (e.g. free-typed "Steel rod" vs. product#abc "Steel Rod 12mm"). Fall back
    // to name-lowercased when there's no productId on either side.
    // We also collect per-source material specs so PO/quotation creators can see what each PR asked for.
    const groups = new Map();
    for (const pr of purchaseRequests) {
      for (const item of (pr.items || [])) {
        const productKey = item.productId
          ? `pid:${item.productId}`
          : `name:${(item.productName || '').toLowerCase().trim()}`;
        const key = `${productKey}::${(item.productUnit || 'pcs').toLowerCase().trim()}`;
        const allocatedQty = item.adminApprovedQty ?? item.requestedQty ?? 0;
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            productName: item.productName,
            productUnit: item.productUnit || 'pcs',
            unitPrice: 0,
            supplierId: null,
            supplierName: '',
            supplierContact: '',
            supplierAddress: '',
            sources: [],
          });
        }
        groups.get(key).sources.push({
          purchaseRequestItemId: item.id,
          purchaseRequestId: pr.id,
          requestNumber: pr.requestNumber,
          unitCode: pr.unit?.code || pr.unit?.name || '—',
          allocatedQty,
          checked: true,
          // PR specs flow through to PO — read-only for quotation/PO creators.
          materialType: item.materialType || '',
          materialSpecification: item.materialSpecification || '',
          drawingNo: item.drawingNo || '',
          qapNo: item.qapNo || '',
          itemRemarks: item.itemRemarks || '',
        });
      }
    }
    setUnionLines([...groups.values()]);
  }, [isOpen, purchaseRequests]);

  const updateLine = (key, field, value) => {
    setUnionLines((lines) => lines.map(l => l.key === key ? { ...l, [field]: value } : l));
  };

  // Patch several fields on one line atomically (used by the ASL autocomplete).
  const patchLine = (key, patch) => {
    setUnionLines((lines) => lines.map(l => l.key === key ? { ...l, ...patch } : l));
  };

  const toggleSource = (key, idx) => {
    setUnionLines((lines) => lines.map(l => {
      if (l.key !== key) return l;
      const sources = l.sources.map((s, i) => i === idx ? { ...s, checked: !s.checked } : s);
      return { ...l, sources };
    }));
  };

  const updateSourceQty = (key, idx, value) => {
    setUnionLines((lines) => lines.map(l => {
      if (l.key !== key) return l;
      const sources = l.sources.map((s, i) => i === idx ? { ...s, allocatedQty: parseFloat(value) || 0 } : s);
      return { ...l, sources };
    }));
  };

  const lineTotalQty = (line) => line.sources.filter(s => s.checked).reduce((sum, s) => sum + (s.allocatedQty || 0), 0);
  const lineTotalPrice = (line) => lineTotalQty(line) * (line.unitPrice || 0);
  const grandTotal = unionLines.reduce((sum, l) => sum + lineTotalPrice(l), 0);

  const submit = async () => {
    // Only include lines that have ≥2 sources checked AND unit price + supplier set.
    const eligible = unionLines.filter(l =>
      l.sources.filter(s => s.checked).length >= 2 &&
      (l.unitPrice > 0) &&
      l.supplierName.trim()
    );

    if (eligible.length === 0) {
      return alert('Union requires at least one line aggregating ≥2 PR items with unit price and supplier filled.');
    }

    // PR set actually used by the eligible lines
    const usedPRIds = new Set();
    for (const l of eligible) {
      for (const s of l.sources) if (s.checked) usedPRIds.add(s.purchaseRequestId);
    }
    if (usedPRIds.size < 2) {
      return alert('Union must aggregate items from at least 2 distinct PRs.');
    }
    if (quotationPdf && quotationPdf.type !== 'application/pdf') {
      return alert('Quotation attachment must be a PDF file');
    }

    setSaving(true);
    setComplianceIssues([]);
    try {
      const payload = {
        purchaseRequestIds: [...usedPRIds],
        notes: notes || undefined,
        items: eligible.map(l => {
          const checkedSources = l.sources.filter(s => s.checked);
          return {
            productName: l.productName.trim(),
            productUnit: l.productUnit,
            quantity: lineTotalQty(l),
            unitPrice: parseFloat(l.unitPrice) || 0,
            supplierId: l.supplierId || undefined,
            supplierName: l.supplierName.trim(),
            supplierContact: l.supplierContact?.trim() || undefined,
            supplierAddress: l.supplierAddress?.trim() || undefined,
            sources: checkedSources.map(s => ({
              purchaseRequestItemId: s.purchaseRequestItemId,
              allocatedQty: parseFloat(s.allocatedQty) || 0,
            })),
          };
        }),
      };
      if (quotationPdf) {
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        form.append('quotationPdf', quotationPdf);
        await api.post('/quotations/union', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/quotations/union', payload);
      }
      onClose();
      onCreated();
    } catch (err) {
      const issues = err.response?.data?.complianceIssues;
      if (Array.isArray(issues) && issues.length > 0) {
        setComplianceIssues(issues);
        setComplianceFY(err.response?.data?.currentFinancialYear || '');
      } else {
        alert(err.response?.data?.error || 'Failed to create union quotation');
      }
    }
    setSaving(false);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Union Quotation" size="xl">
      <div className="space-y-4">
        <div className="bg-navy-50 border border-navy-200 rounded-md p-3 text-sm">
          <div className="font-semibold text-navy-700 mb-1 flex items-center gap-2">
            <Layers size={16} /> Bundling {purchaseRequests?.length} approved PRs into one Union Quotation
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {purchaseRequests?.map(pr => (
              <Badge key={pr.id} color="navy">
                {pr.requestNumber} · {pr.unit?.code || pr.unit?.name}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-navy-700/70 mt-2">
            For each product group below, uncheck PR-items you don't want in the union. Lines with fewer than 2 PRs checked are skipped.
          </p>
        </div>

        {complianceIssues.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-900">
            <p className="font-semibold mb-1">Supplier compliance documents required{complianceFY ? ` for FY ${complianceFY}` : ''}</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              {complianceIssues.map((iss) => (
                <li key={iss.supplierId}>
                  <strong>{iss.supplierName}</strong>
                  {' '}— missing{' '}
                  {iss.missing.map((m, idx) => (
                    <span key={m}>
                      {idx > 0 ? ', ' : ''}
                      {m === 'vendor-evaluation' ? 'Vendor Evaluation PDF' : `Supplier Assessment PDF (FY ${complianceFY})`}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <a
              href="/suppliers"
              target="_blank"
              rel="noreferrer"
              className="inline-block mt-2 text-xs font-semibold text-red-900 underline hover:text-red-700"
            >
              Open Suppliers page to upload PDFs →
            </a>
          </div>
        )}

        {unionLines.length === 0 ? (
          <p className="text-center text-gray-400 py-6">No items found in the selected PRs.</p>
        ) : (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto">
            {unionLines.map(line => {
              const checkedCount = line.sources.filter(s => s.checked).length;
              const eligible = checkedCount >= 2;
              return (
                <div key={line.key} className={`border rounded-lg p-3 ${eligible ? 'border-navy-200 bg-white' : 'border-gray-200 bg-gray-50/50'}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="font-semibold text-gray-800">{line.productName}</span>
                    <span className="text-xs text-gray-500">({line.productUnit})</span>
                    {eligible
                      ? <Badge color="green">Union — {checkedCount} PRs</Badge>
                      : <Badge color="gray">Skipped (needs ≥2 PRs)</Badge>}
                    <span className="ml-auto text-sm">
                      Total: <span className="font-semibold text-navy-700">{lineTotalQty(line)} {line.productUnit}</span>
                      {' · '}
                      Line total: <span className="font-semibold text-navy-700">{formatCurrency(lineTotalPrice(line))}</span>
                    </span>
                  </div>

                  <div className="overflow-x-auto border rounded-md mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr className="border-b">
                          <th className="px-2 py-1.5 w-8"></th>
                          <th className="px-2 py-1.5 text-left text-gray-600">PR</th>
                          <th className="px-2 py-1.5 text-left text-gray-600">Unit</th>
                          <th className="px-2 py-1.5 text-left text-gray-600">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {line.sources.map((s, idx) => {
                          const hasSpecs = s.materialType || s.materialSpecification || s.drawingNo || s.qapNo || s.itemRemarks;
                          return (
                            <>
                              <tr key={`${line.key}-${idx}`} className="border-b border-gray-50">
                                <td className="px-2 py-1.5">
                                  <input
                                    type="checkbox"
                                    checked={s.checked}
                                    onChange={() => toggleSource(line.key, idx)}
                                    className="rounded"
                                  />
                                </td>
                                <td className="px-2 py-1.5 font-medium text-navy-700">{s.requestNumber}</td>
                                <td className="px-2 py-1.5"><Badge color="blue">{s.unitCode}</Badge></td>
                                <td className="px-2 py-1.5">
                                  <input
                                    type="number"
                                    value={s.allocatedQty}
                                    onChange={(e) => updateSourceQty(line.key, idx, e.target.value)}
                                    className="w-24 px-2 py-1 border rounded"
                                    min="0"
                                    step="0.01"
                                    disabled={!s.checked}
                                  />
                                </td>
                              </tr>
                              {hasSpecs && (
                                <tr key={`${line.key}-${idx}-specs`} className="border-b border-gray-50">
                                  <td></td>
                                  <td colSpan={3} className="px-2 pb-2">
                                    <div className="text-[11px] text-gray-600 space-y-0.5 bg-gray-50 border-l-2 border-blue-300 pl-2 py-1">
                                      {s.materialType && (<div><span className="font-medium text-gray-700">Type:</span> {s.materialType}</div>)}
                                      {s.materialSpecification && (<div><span className="font-medium text-gray-700">Spec:</span> {s.materialSpecification}</div>)}
                                      {s.drawingNo && (<div><span className="font-medium text-gray-700">Drawing #:</span> {s.drawingNo}</div>)}
                                      {s.qapNo && (<div><span className="font-medium text-gray-700">QAP #:</span> {s.qapNo}</div>)}
                                      {s.itemRemarks && (<div><span className="font-medium text-gray-700">Remarks:</span> {s.itemRemarks}</div>)}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="text-[11px] uppercase text-gray-500">Unit Price (₹)</label>
                      <input
                        type="number"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(line.key, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase text-gray-500">Supplier *</label>
                      <SupplierAutocomplete
                        value={line.supplierName}
                        contextQuery={line.productName}
                        inputClassName="w-full px-2 py-1 border rounded text-sm"
                        onChange={(v) => patchLine(line.key, { supplierName: v, supplierId: null })}
                        onSelect={(s) => patchLine(line.key, {
                          supplierId: s.id,
                          supplierName: s.name,
                          supplierContact: supplierContactString(s),
                          supplierAddress: s.address || '',
                        })}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase text-gray-500">Contact</label>
                      <input
                        value={line.supplierContact}
                        onChange={(e) => updateLine(line.key, 'supplierContact', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="Phone/Email"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] uppercase text-gray-500">Address</label>
                      <input
                        value={line.supplierAddress}
                        onChange={(e) => updateLine(line.key, 'supplierAddress', e.target.value)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="Address"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />

        <div className="border rounded-md p-3 bg-blue-50/40">
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <Paperclip size={14} /> Quotation PDF <span className="text-xs text-gray-500 font-normal">(optional, one per supplier quote, PDF only ≤10 MB)</span>
          </label>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setQuotationPdf(e.target.files?.[0] || null)}
            className="text-sm"
          />
          {quotationPdf && (
            <div className="mt-1 text-xs text-gray-600 flex items-center gap-2">
              <span className="font-medium">{quotationPdf.name}</span>
              <span className="text-gray-400">({(quotationPdf.size / 1024).toFixed(1)} KB)</span>
              <button type="button" onClick={() => setQuotationPdf(null)} className="text-red-500 hover:text-red-700"><X size={12} /></button>
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-2 border-t">
          <div className="text-sm">
            Grand total: <span className="font-bold text-navy-700">{formatCurrency(grandTotal)}</span>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Submit Union Quotation'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Aggregate unique suppliers across a quotation's items and return their
// compliance status (Vendor Evaluation + current-FY Supplier Assessment).
// Admins must be able to view both PDFs before approving.
function buildSupplierCompliance(quotation, currentFY) {
  const map = new Map();
  for (const it of quotation.items || []) {
    const s = it.supplier;
    if (!s?.id) {
      // Item with no resolved supplier — flag separately so admin notices.
      const key = `name:${(it.supplierName || '').toLowerCase().trim() || 'unknown'}`;
      if (!map.has(key)) {
        map.set(key, {
          supplierId: null,
          supplierName: it.supplierName || 'Unknown supplier',
          vendorEvaluationPdfUrl: null,
          supplierAssessmentPdfUrl: null,
          assessmentFiscalYear: null,
        });
      }
      continue;
    }
    if (!map.has(s.id)) map.set(s.id, { ...s });
  }
  return [...map.values()].map(s => {
    const hasEval = !!s.vendorEvaluationPdfUrl;
    const hasAssessment = !!s.supplierAssessmentPdfUrl && s.assessmentFiscalYear === currentFY;
    return { ...s, hasEval, hasAssessment, compliant: hasEval && hasAssessment };
  });
}

function SupplierComplianceStrip({ quotation, currentFY }) {
  const suppliers = buildSupplierCompliance(quotation, currentFY);
  if (suppliers.length === 0) return null;
  const allCompliant = suppliers.every(s => s.compliant);
  return (
    <div className={`mt-3 border rounded p-2 text-xs ${allCompliant ? 'border-green-200 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-center gap-1 font-semibold mb-1">
        {allCompliant ? <CheckCircle size={12} className="text-green-700" /> : <AlertCircle size={12} className="text-amber-700" />}
        <span className={allCompliant ? 'text-green-800' : 'text-amber-900'}>
          Supplier compliance {allCompliant ? '— all documents on file' : `— action required (FY ${currentFY})`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {suppliers.map((s, idx) => (
          <li key={s.supplierId || idx} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-gray-800">{s.supplierName}</span>
            {s.vendorEvaluationPdfUrl ? (
              <a
                href={s.vendorEvaluationPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-blue-700 hover:underline"
              >
                <Eye size={11} /> View Vendor Evaluation
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-700">
                <AlertCircle size={11} /> Vendor Evaluation missing
              </span>
            )}
            {s.hasAssessment ? (
              <a
                href={s.supplierAssessmentPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-blue-700 hover:underline"
              >
                <Eye size={11} /> View Assessment (FY {s.assessmentFiscalYear})
              </a>
            ) : s.supplierAssessmentPdfUrl ? (
              <span className="inline-flex items-center gap-1 text-red-700">
                <AlertCircle size={11} /> Assessment expired (FY {s.assessmentFiscalYear})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-red-700">
                <AlertCircle size={11} /> Assessment missing
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Dialog: PO reviews the held quotation in full (items + supplier compliance +
// the previously uploaded PDF), can replace/remove the PDF, optionally adds a
// note explaining what was fixed, and resubmits. The server clears
// holdNote/heldAt and notifies approvers.
function ResubmitQuotationModal({ quotation, onClose, onResubmitted }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [newPdf, setNewPdf] = useState(null);
  const [removeExistingPdf, setRemoveExistingPdf] = useState(false);
  if (!quotation) return null;
  const existingPdfStillAttached = !!quotation.quotationPdfUrl && !removeExistingPdf && !newPdf;

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {};
      if (note.trim()) payload.notes = note.trim();
      if (removeExistingPdf && !newPdf) payload.clearPdf = true;

      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      if (newPdf) form.append('quotationPdf', newPdf);

      await api.put(`/quotations/${quotation.id}/resubmit`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onResubmitted();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to resubmit quotation');
    }
    setSaving(false);
  };
  return (
    <Modal isOpen={!!quotation} onClose={onClose} title={`Resubmit ${quotation.quotationNumber}`} size="lg">
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
          <div className="font-semibold mb-0.5 inline-flex items-center gap-1">
            <PauseCircle size={12} /> Admin's hold reason
          </div>
          <div>{quotation.holdNote || '—'}</div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">
            Quotation items ({quotation.items?.length || 0})
          </div>
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr className="border-b">
                  <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Product</th>
                  <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Qty</th>
                  <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Unit Price</th>
                  <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Supplier</th>
                  <th className="px-2 py-1.5 text-right text-gray-600 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {(quotation.items || []).map(it => (
                  <tr key={it.id} className="border-b last:border-b-0">
                    <td className="px-2 py-1.5">
                      {it.productName}
                      {it.quotationPdfUrl && (
                        <a
                          href={it.quotationPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-blue-600 hover:text-blue-800 underline align-middle"
                        >
                          <Eye size={11} /> Quote PDF
                        </a>
                      )}
                    </td>
                    <td className="px-2 py-1.5">{it.quantity} {it.productUnit}</td>
                    <td className="px-2 py-1.5">{formatCurrency(it.unitPrice)}</td>
                    <td className="px-2 py-1.5">{it.supplierName}</td>
                    <td className="px-2 py-1.5 text-right">{formatCurrency(it.totalPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td colSpan={4} className="px-2 py-1.5 text-right font-semibold">Total</td>
                  <td className="px-2 py-1.5 text-right font-semibold">{formatCurrency(quotation.totalAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">Supplier quotation PDF</div>
          {existingPdfStillAttached && (
            <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-gray-50">
              <a
                href={quotation.quotationPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
              >
                <Paperclip size={12} /> View current quotation PDF
              </a>
              <button
                type="button"
                onClick={() => setRemoveExistingPdf(true)}
                className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900"
              >
                <Trash2 size={12} /> Remove
              </button>
            </div>
          )}
          {removeExistingPdf && !newPdf && (
            <div className="flex items-center justify-between border border-red-200 rounded-md px-3 py-2 bg-red-50">
              <span className="text-xs text-red-800">Existing PDF will be removed on resubmit.</span>
              <button
                type="button"
                onClick={() => setRemoveExistingPdf(false)}
                className="text-xs text-navy-700 hover:underline"
              >
                Undo
              </button>
            </div>
          )}
          {newPdf && (
            <div className="flex items-center justify-between border border-green-200 rounded-md px-3 py-2 bg-green-50 mb-1">
              <span className="inline-flex items-center gap-1 text-xs text-green-800">
                <Paperclip size={12} /> New: {newPdf.name}
              </span>
              <button
                type="button"
                onClick={() => setNewPdf(null)}
                className="text-xs text-red-700 hover:text-red-900"
              >
                Clear
              </button>
            </div>
          )}
          <label className="mt-2 inline-flex items-center gap-2 cursor-pointer text-xs text-navy-700 border border-dashed border-navy-300 rounded-md px-3 py-2 hover:bg-navy-50">
            <Paperclip size={12} />
            {quotation.quotationPdfUrl ? 'Upload replacement PDF' : 'Upload quotation PDF'}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setNewPdf(f);
                if (f) setRemoveExistingPdf(false);
              }}
            />
          </label>
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-700 mb-1">Note for admin (optional)</div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Uploaded Vendor Evaluation PDF for ABC Suppliers / re-attached supplier quotation."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
          />
        </div>

        <p className="text-xs text-gray-500">
          Resubmitting clears the hold and notifies approvers to re-review.
        </p>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Resubmitting…' : 'Resubmit & notify admin'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Dialog: admin writes a hold note that gets sent to the Purchase Officer.
function HoldQuotationModal({ quotation, onClose, onHeld }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  if (!quotation) return null;
  const submit = async () => {
    const trimmed = note.trim();
    if (!trimmed) return alert('Please write the reason this quotation is on hold (e.g. which document the PO needs to attach).');
    setSaving(true);
    try {
      await api.post(`/quotations/${quotation.id}/hold`, { holdNote: trimmed });
      onHeld();
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to put quotation on hold');
    }
    setSaving(false);
  };
  return (
    <Modal isOpen={!!quotation} onClose={onClose} title={`Hold ${quotation.quotationNumber}`} size="md">
      <div className="space-y-3">
        <p className="text-sm text-gray-700">
          Send this quotation back to the Purchase Officer with a reason. The PO will be notified and can attach the required documents (Vendor Evaluation / Supplier Assessment) and resubmit for approval.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Vendor Evaluation PDF missing for supplier ABC. Please upload it on the Suppliers page and notify admin."
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !note.trim()}>
            <PauseCircle size={16} className="mr-1" /> {saving ? 'Holding…' : 'Put on hold & notify PO'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Review Quotations Modal (ADMIN approver only) ───
function ReviewQuotationsModal({ purchaseRequest, onClose, onUpdated, isApprover, isPO }) {
  const [quotations, setQuotations] = useState([]);
  const [currentFY, setCurrentFY] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [selectionNote, setSelectionNote] = useState('');
  const [resubmitTarget, setResubmitTarget] = useState(null);
  const [holdTarget, setHoldTarget] = useState(null);

  const reload = () => {
    setLoading(true);
    api.get('/quotations', { params: { purchaseRequestId: purchaseRequest.id, limit: 50 } })
      .then(({ data }) => {
        setQuotations((data.quotations || []).filter(q => !q.isUnion));
        setCurrentFY(data.currentFinancialYear || '');
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (purchaseRequest) {
      reload();
      setSelectedId(null);
      setSelectionNote('');
    }
  }, [purchaseRequest]);

  const selectQuotation = async () => {
    if (!selectedId) return alert('Select a quotation first');
    const note = selectionNote.trim();
    if (!note) return alert('Please write a selection note explaining why you chose this quotation. It is visible to admin, manager and purchase officer.');

    setProcessing(true);
    try {
      await api.put(`/quotations/${selectedId}/select`, { selectionNote: note });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve quotation');
    }
    setProcessing(false);
  };

  // PO sends a single quotation (one product's quote) to admin, independently
  // of the other drafts on this PR.
  const sendQuotation = async (q) => {
    if (!confirm(`Send quotation ${q.quotationNumber} to admin for approval?`)) return;
    setProcessing(true);
    try {
      await api.post(`/quotations/${q.id}/submit`);
      reload();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send quotation');
    }
    setProcessing(false);
  };

  // Count unique suppliers for selected quotation
  const selectedQuotation = quotations.find(q => q.id === selectedId);
  const selectedSuppliers = selectedQuotation
    ? [...new Set(selectedQuotation.items.map(i => (i.supplierName || '').trim().toLowerCase()).filter(Boolean))]
    : [];
  const selectedCompliance = selectedQuotation ? buildSupplierCompliance(selectedQuotation, currentFY) : [];
  const selectedCompliant = selectedCompliance.length === 0 || selectedCompliance.every(s => s.compliant);

  if (!purchaseRequest) return null;

  return (
    <>
    <Modal isOpen={!!purchaseRequest} onClose={onClose} title={`Review Quotations — ${purchaseRequest.requestNumber}`} size="xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 rounded-md p-4">
          <div><span className="text-gray-500">Request #:</span> <span className="font-medium">{purchaseRequest.requestNumber}</span></div>
          <div><span className="text-gray-500">Manager:</span> <span className="font-medium">{purchaseRequest.manager?.name}</span></div>
          <div><span className="text-gray-500">Unit:</span> <Badge color="blue">{purchaseRequest.unit?.name}</Badge></div>
          <div><span className="text-gray-500">Submitted:</span> <span>{formatDateTime(purchaseRequest.updatedAt)}</span></div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : quotations.length === 0 ? (
          <p className="text-center text-gray-400 py-4">No quotations submitted yet.</p>
        ) : (
          <div className="space-y-4">
            {quotations.map(q => {
              const suppliers = [...new Set(q.items.map(i => (i.supplierName || '').trim()).filter(Boolean))];
              const sourcePRs = q.sourceRequests?.map(s => s.purchaseRequest) || [];
              return (
                <div
                  key={q.id}
                  onClick={() => setSelectedId(q.id)}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    selectedId === q.id ? 'border-navy-700 bg-navy-50 ring-2 ring-navy-200' : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900">{q.quotationNumber}</h4>
                        {q.isUnion && <Badge color="purple"><Layers size={10} className="inline mr-0.5" /> UNION</Badge>}
                        {q.isSelected ? (
                          <Badge color="blue">Approved</Badge>
                        ) : q.heldAt ? (
                          <Badge color="red"><PauseCircle size={10} className="inline mr-0.5" /> On hold</Badge>
                        ) : q.submittedToAdminAt ? (
                          <Badge color="green">Sent to admin</Badge>
                        ) : (
                          <Badge color="amber">Draft</Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}: {suppliers.join(', ')}
                      </p>
                      {q.isUnion && sourcePRs.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {sourcePRs.map(pr => (
                            <Badge key={pr.id} color="navy">{pr.requestNumber} · {pr.unit?.code || pr.unit?.name}</Badge>
                          ))}
                        </div>
                      )}
                      {q.notes && <p className="text-xs text-gray-400 mt-1">Notes: {q.notes}</p>}
                      {q.quotationPdfUrl && (
                        <a
                          href={q.quotationPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          <Eye size={12} /> View supplier quotation PDF
                        </a>
                      )}
                      {q.selectionNote && (
                        <div className="mt-2 bg-green-50 border border-green-200 rounded p-2 text-xs text-green-900">
                          <span className="font-semibold">Admin note: </span>{q.selectionNote}
                        </div>
                      )}
                      {q.holdNote && !q.isSelected && (
                        <div className="mt-2 bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-900">
                          <div>
                            <span className="font-semibold inline-flex items-center gap-1"><PauseCircle size={11} /> On hold: </span>
                            {q.holdNote}
                          </div>
                          {isPO && q.heldAt && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setResubmitTarget(q); }}
                              className="mt-1.5 inline-flex items-center gap-1 text-xs text-navy-700 hover:text-navy-900 border border-navy-300 hover:bg-navy-50 rounded px-2 py-1 bg-white"
                            >
                              Edit & Resubmit
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-navy-700">{formatCurrency(q.totalAmount)}</p>
                      <p className="text-xs text-gray-400">by {q.createdBy?.name}</p>
                      {isApprover && !q.isSelected && !q.heldAt && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setHoldTarget(q); }}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-amber-800 hover:text-amber-900 border border-amber-300 hover:bg-amber-50 rounded px-2 py-1"
                        >
                          <PauseCircle size={12} /> Put on hold
                        </button>
                      )}
                      {isPO && !q.isSelected && !q.heldAt && !q.submittedToAdminAt && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); sendQuotation(q); }}
                          disabled={processing}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-white bg-navy-700 hover:bg-navy-800 rounded px-2 py-1 disabled:opacity-50"
                        >
                          <Send size={12} /> Send to Admin
                        </button>
                      )}
                    </div>
                  </div>
                  <SupplierComplianceStrip quotation={q} currentFY={currentFY} />
                  <div className="overflow-x-auto border rounded-md mt-2">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr className="border-b">
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Product</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Qty</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Unit Price</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Supplier</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Contact</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.items.map(item => {
                          const allocs = Array.isArray(item.sourceAllocations) ? item.sourceAllocations : [];
                          return (
                            <>
                              <tr key={item.id} className="border-b border-gray-50 hover:bg-amber-50/30">
                                <td className="px-2 py-1.5">
                                  {item.productName}
                                  {item.quotationPdfUrl && (
                                    <a
                                      href={item.quotationPdfUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="ml-2 inline-flex items-center gap-0.5 text-[11px] text-blue-600 hover:text-blue-800 underline align-middle"
                                    >
                                      <Eye size={11} /> Quote PDF
                                    </a>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap">{item.quantity} {item.productUnit}</td>
                                <td className="px-2 py-1.5">{formatCurrency(item.unitPrice)}</td>
                                <td className="px-2 py-1.5 font-medium text-gray-800">{item.supplierName || '—'}</td>
                                <td className="px-2 py-1.5 text-gray-500">{item.supplierContact || '—'}</td>
                                <td className="px-2 py-1.5 font-medium">{formatCurrency(item.totalPrice)}</td>
                              </tr>
                              {q.isUnion && allocs.length > 0 && (
                                <tr key={`${item.id}-alloc`} className="bg-purple-50/40">
                                  <td colSpan={6} className="px-3 py-1.5 text-[11px] text-purple-900">
                                    Allocation: {allocs.map((a, idx) => {
                                      const pr = sourcePRs.find(p => (q.sourceRequests?.find(s => s.purchaseRequestId === p.id)));
                                      // Find PR via sourceRequests by matching the PR item's PR
                                      const matchedSource = q.sourceRequests?.find(s => s.purchaseRequest.items?.some?.(it => it.id === a.purchaseRequestItemId));
                                      const ref = matchedSource?.purchaseRequest;
                                      return (
                                        <span key={idx} className="inline-block mr-3">
                                          {ref ? `${ref.requestNumber} · ${ref.unit?.code || ref.unit?.name}` : 'PR'}: <strong>{a.allocatedQty} {item.productUnit}</strong>
                                        </span>
                                      );
                                    })}
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {selectedId === q.id && (
                    <div className="mt-3 flex items-center gap-1">
                      <CheckCircle size={16} className="text-green-600" />
                      <span className="text-sm text-green-600 font-medium">Selected</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {quotations.length > 0 && isApprover && (
          <div className="border-t pt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selection Note <span className="text-red-500">*</span>
                <span className="text-xs text-gray-500 font-normal ml-2">(why this supplier — visible to admin, manager and purchase officer)</span>
              </label>
              <textarea
                value={selectionNote}
                onChange={(e) => setSelectionNote(e.target.value)}
                placeholder="e.g. Cheapest of the three quotations, supplier has a long track record on this product, delivery time matches the required-by date…"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500"
                disabled={!selectedId}
              />
            </div>
            <div className="text-xs text-gray-500">
              {selectedSuppliers.length > 1 ? (
                <>Approving will create <span className="font-semibold text-navy-700">{selectedSuppliers.length} Purchase Orders</span> (one per supplier) linked to PR <span className="font-semibold text-navy-700">{purchaseRequest.requestNumber}</span>.</>
              ) : (
                <>The selected quotation will create a Purchase Order linked to PR <span className="font-semibold text-navy-700">{purchaseRequest.requestNumber}</span>.</>
              )}{' '}
              Purchase will then place the order(s) with accounting.
            </div>
            {selectedId && !selectedCompliant && (
              <div className="bg-amber-50 border border-amber-300 rounded-md p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-0.5">Cannot approve — supplier compliance documents missing.</p>
                  <p>Review the red items above. Put this quotation on hold so the Purchase Officer can upload the Vendor Evaluation / Supplier Assessment PDFs on the Suppliers page and resubmit.</p>
                  <button
                    type="button"
                    onClick={() => setHoldTarget(selectedQuotation)}
                    className="mt-1 inline-flex items-center gap-1 text-amber-900 font-semibold underline hover:text-amber-950"
                  >
                    <PauseCircle size={12} /> Put this quotation on hold
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={selectQuotation} disabled={processing || !selectedId || !selectionNote.trim() || !selectedCompliant}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : `Approve & Create ${selectedSuppliers.length > 1 ? selectedSuppliers.length + ' Orders' : 'Order'}`}
              </Button>
            </div>
          </div>
        )}

        {quotations.length > 0 && isPO && (
          <div className="border-t pt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">
              Click <strong>Send to Admin</strong> on each draft to send that product's quote on its own — ready products go now, the rest stay drafts until you send them.
            </p>
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        )}
      </div>
    </Modal>
    <HoldQuotationModal
      quotation={holdTarget}
      onClose={() => setHoldTarget(null)}
      onHeld={() => { reload(); onUpdated(); }}
    />
    <ResubmitQuotationModal
      quotation={resubmitTarget}
      onClose={() => setResubmitTarget(null)}
      onResubmitted={() => { reload(); onUpdated(); }}
    />
    </>
  );
}

// ─── Union Review Modal (ADMIN picks one from a competing-union batch) ───
function UnionReviewModal({ unionGroup, onClose, onUpdated, isApprover, isPO }) {
  const [unions, setUnions] = useState([]);
  const [currentFY, setCurrentFY] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [selectionNote, setSelectionNote] = useState('');
  const [holdTarget, setHoldTarget] = useState(null);
  const [resubmitTarget, setResubmitTarget] = useState(null);

  const reload = () => {
    if (!unionGroup) return;
    setLoading(true);
    const fyProbePr = unionGroup.prSet[0]?.id;
    const tasks = [
      Promise.all(unionGroup.unions.map(u => api.get(`/quotations/${u.id}`).then(r => r.data))),
      fyProbePr
        ? api.get('/quotations', { params: { purchaseRequestId: fyProbePr, limit: 1 } }).then(r => r.data.currentFinancialYear || '').catch(() => '')
        : Promise.resolve(''),
    ];
    Promise.all(tasks)
      .then(([fetchedUnions, fy]) => {
        setUnions(fetchedUnions);
        setCurrentFY(fy);
      })
      .catch((err) => { console.error(err); setUnions([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!unionGroup) return;
    reload();
    setSelectedId(null);
    setSelectionNote('');
  }, [unionGroup]);

  const selectQuotation = async () => {
    if (!selectedId) return alert('Select a union quotation first');
    const note = selectionNote.trim();
    if (!note) return alert('Please write a selection note explaining why you chose this union quotation. It is visible to admin, manager and purchase officer.');
    setProcessing(true);
    try {
      await api.put(`/quotations/${selectedId}/select`, { selectionNote: note });
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve union quotation');
    }
    setProcessing(false);
  };

  const selectedUnion = unions.find(q => q.id === selectedId);
  const selectedCompliance = selectedUnion ? buildSupplierCompliance(selectedUnion, currentFY) : [];
  const selectedCompliant = selectedCompliance.length === 0 || selectedCompliance.every(s => s.compliant);

  if (!unionGroup) return null;

  return (
    <>
    <Modal isOpen={!!unionGroup} onClose={onClose} title={`Review Union Quotations (${unionGroup.unions.length} competing)`} size="xl">
      <div className="space-y-4">
        <div className="bg-purple-50 border border-purple-200 rounded-md p-3">
          <div className="text-xs uppercase tracking-wide text-purple-700 font-medium mb-2 flex items-center gap-1">
            <Layers size={14} /> Union covering {unionGroup.prSet.length} purchase requests
          </div>
          <div className="flex flex-wrap gap-1">
            {unionGroup.prSet.map(pr => (
              <Badge key={pr.id} color="navy">
                {pr.requestNumber} · {pr.unit?.code || pr.unit?.name}
              </Badge>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : unions.length === 0 ? (
          <p className="text-center text-gray-400 py-4">No union quotations found.</p>
        ) : (
          <div className="space-y-4">
            {unions.map(q => {
              const suppliers = [...new Set(q.items.map(i => (i.supplierName || '').trim()).filter(Boolean))];
              const sourcePRs = q.sourceRequests?.map(s => s.purchaseRequest) || [];
              return (
                <div
                  key={q.id}
                  onClick={() => setSelectedId(q.id)}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    selectedId === q.id ? 'border-purple-600 bg-purple-50 ring-2 ring-purple-200' : 'border-gray-200 hover:border-gray-400'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-900">{q.quotationNumber}</h4>
                        <Badge color="purple"><Layers size={10} className="inline mr-0.5" /> UNION</Badge>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}: {suppliers.join(', ')}
                      </p>
                      {q.notes && <p className="text-xs text-gray-400 mt-1">Notes: {q.notes}</p>}
                      {q.quotationPdfUrl && (
                        <a
                          href={q.quotationPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          <Eye size={12} /> View supplier quotation PDF
                        </a>
                      )}
                      {q.selectionNote && (
                        <div className="mt-2 bg-green-50 border border-green-200 rounded p-2 text-xs text-green-900">
                          <span className="font-semibold">Admin note: </span>{q.selectionNote}
                        </div>
                      )}
                      {q.holdNote && !q.isSelected && (
                        <div className="mt-2 bg-amber-50 border border-amber-300 rounded p-2 text-xs text-amber-900">
                          <div>
                            <span className="font-semibold inline-flex items-center gap-1"><PauseCircle size={11} /> On hold: </span>
                            {q.holdNote}
                          </div>
                          {isPO && q.heldAt && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setResubmitTarget(q); }}
                              className="mt-1.5 inline-flex items-center gap-1 text-xs text-navy-700 hover:text-navy-900 border border-navy-300 hover:bg-navy-50 rounded px-2 py-1 bg-white"
                            >
                              Edit & Resubmit
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-purple-700">{formatCurrency(q.totalAmount)}</p>
                      <p className="text-xs text-gray-400">by {q.createdBy?.name}</p>
                      {isApprover && !q.isSelected && !q.heldAt && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setHoldTarget(q); }}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-amber-800 hover:text-amber-900 border border-amber-300 hover:bg-amber-50 rounded px-2 py-1"
                        >
                          <PauseCircle size={12} /> Put on hold
                        </button>
                      )}
                    </div>
                  </div>
                  <SupplierComplianceStrip quotation={q} currentFY={currentFY} />
                  <div className="overflow-x-auto border rounded-md mt-2">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr className="border-b">
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Product</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Total Qty</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Unit Price</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Supplier</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Contact</th>
                          <th className="px-2 py-1.5 text-left text-gray-600 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {q.items.map((item, i) => {
                          const allocs = Array.isArray(item.sourceAllocations) ? item.sourceAllocations : [];
                          // Resolve material specs from any source PR item that has them.
                          const specSources = allocs
                            .map(a => {
                              for (const pr of sourcePRs) {
                                const prItem = pr.items?.find?.(it => it.id === a.purchaseRequestItemId);
                                if (prItem && (prItem.materialType || prItem.materialSpecification || prItem.drawingNo || prItem.qapNo || prItem.itemRemarks)) {
                                  return { pr, prItem };
                                }
                              }
                              return null;
                            })
                            .filter(Boolean);
                          return (
                            <>
                              <tr key={item.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                                <td className="px-2 py-1.5">{item.productName}</td>
                                <td className="px-2 py-1.5 whitespace-nowrap">{item.quantity} {item.productUnit}</td>
                                <td className="px-2 py-1.5">{formatCurrency(item.unitPrice)}</td>
                                <td className="px-2 py-1.5 font-medium text-gray-800">{item.supplierName || '—'}</td>
                                <td className="px-2 py-1.5 text-gray-500">{item.supplierContact || '—'}</td>
                                <td className="px-2 py-1.5 font-medium">{formatCurrency(item.totalPrice)}</td>
                              </tr>
                              {specSources.length > 0 && (
                                <tr key={`${item.id}-specs`} className="bg-blue-50/40">
                                  <td colSpan={6} className="px-3 py-1.5 text-[11px] text-gray-700">
                                    <div className="space-y-1">
                                      {specSources.map(({ pr, prItem }, idx) => (
                                        <div key={idx} className="flex flex-wrap gap-x-3 gap-y-0.5">
                                          <span className="font-medium text-navy-700">{pr.requestNumber}:</span>
                                          {prItem.materialType && (<span><span className="font-medium">Type:</span> {prItem.materialType}</span>)}
                                          {prItem.materialSpecification && (<span><span className="font-medium">Spec:</span> {prItem.materialSpecification}</span>)}
                                          {prItem.drawingNo && (<span><span className="font-medium">Drawing #:</span> {prItem.drawingNo}</span>)}
                                          {prItem.qapNo && (<span><span className="font-medium">QAP #:</span> {prItem.qapNo}</span>)}
                                          {prItem.itemRemarks && (<span><span className="font-medium">Remarks:</span> {prItem.itemRemarks}</span>)}
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                              {allocs.length > 0 && (
                                <tr key={`${item.id}-alloc`} className="bg-purple-50/40">
                                  <td colSpan={6} className="px-3 py-1.5 text-[11px] text-purple-900">
                                    Per-PR split: {allocs.map((a, idx) => {
                                      const pr = sourcePRs.find(p => p.items?.some?.(it => it.id === a.purchaseRequestItemId));
                                      return (
                                        <span key={idx} className="inline-block mr-3">
                                          {pr ? `${pr.requestNumber} · ${pr.unit?.code || pr.unit?.name}` : 'PR'}: <strong>{a.allocatedQty} {item.productUnit}</strong>
                                        </span>
                                      );
                                    })}
                                  </td>
                                </tr>
                              )}
                            </>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {selectedId === q.id && (
                    <div className="mt-3 flex items-center gap-1">
                      <CheckCircle size={16} className="text-green-600" />
                      <span className="text-sm text-green-600 font-medium">Selected</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {unions.length > 0 && isApprover && (
          <div className="border-t pt-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Selection Note <span className="text-red-500">*</span>
                <span className="text-xs text-gray-500 font-normal ml-2">(why this union — visible to admin, manager and purchase officer)</span>
              </label>
              <textarea
                value={selectionNote}
                onChange={(e) => setSelectionNote(e.target.value)}
                placeholder="e.g. Lowest aggregate cost across the bundled PRs; supplier already serves both units…"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={!selectedId}
              />
            </div>
            <div className="text-xs text-gray-500">
              Approving will create one union Purchase Order per supplier across the {unionGroup.prSet.length} source PRs. The unselected competing unions will be skipped.
            </div>
            {selectedId && !selectedCompliant && (
              <div className="bg-amber-50 border border-amber-300 rounded-md p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertCircle size={14} className="text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold mb-0.5">Cannot approve — supplier compliance documents missing.</p>
                  <p>Review the red items above. Put this union quotation on hold so the Purchase Officer can upload the Vendor Evaluation / Supplier Assessment PDFs on the Suppliers page and resubmit.</p>
                  <button
                    type="button"
                    onClick={() => setHoldTarget(selectedUnion)}
                    className="mt-1 inline-flex items-center gap-1 text-amber-900 font-semibold underline hover:text-amber-950"
                  >
                    <PauseCircle size={12} /> Put this union quotation on hold
                  </button>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={selectQuotation} disabled={processing || !selectedId || !selectionNote.trim() || !selectedCompliant}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : 'Approve Union & Create POs'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
    <HoldQuotationModal
      quotation={holdTarget}
      onClose={() => setHoldTarget(null)}
      onHeld={() => { reload(); onUpdated(); }}
    />
    <ResubmitQuotationModal
      quotation={resubmitTarget}
      onClose={() => setResubmitTarget(null)}
      onResubmitted={() => { reload(); onUpdated(); }}
    />
    </>
  );
}

// ─── Open Pools section (lists MaterialPool records the PO can quote against) ───
// Each pool was created from the PR detail page by bundling same-material lines
// across PRs. Multiple competing quotes can be added to one pool — each one
// becomes a separate draft union quotation. The pool dissolves automatically
// once admin approves one of the quotes (PR-items follow the union PO from
// there via the existing FIFO allocation chain).
function OpenPoolsSection({ onUpdated, reloadKey }) {
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [poolState, setPoolState] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/material-pools', { params: { status: 'OPEN' } });
      // Also pull QUOTED pools so the PO can attach more competing quotes.
      const { data: quoted } = await api.get('/material-pools', { params: { status: 'QUOTED' } });
      setPools([...(data.pools || []), ...(quoted.pools || [])]);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [reloadKey]);

  const getState = (id) => poolState[id] || {
    unitPrice: '',
    supplierName: '',
    supplierContact: '',
    supplierAddress: '',
    notes: '',
    quotationPdf: null,
    saving: false,
    complianceIssues: [],
    complianceFY: '',
  };
  const updateState = (id, patch) => setPoolState((p) => ({ ...p, [id]: { ...getState(id), ...patch } }));

  const dissolvePool = async (poolId) => {
    if (!confirm('Dissolve this pool? Member PR-items return to the normal single-quote flow.')) return;
    try {
      await api.delete(`/material-pools/${poolId}`);
      await load();
      onUpdated?.();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to dissolve pool');
    }
  };

  const submitQuote = async (pool) => {
    const s = getState(pool.id);
    const price = parseFloat(s.unitPrice);
    if (!(price >= 0)) return alert('Enter a valid unit price.');
    if (!s.supplierName.trim()) return alert('Supplier name is required.');
    if (s.quotationPdf && s.quotationPdf.type !== 'application/pdf') {
      return alert('Quotation attachment must be a PDF file');
    }
    updateState(pool.id, { saving: true, complianceIssues: [], complianceFY: '' });
    try {
      const payload = {
        unitPrice: price,
        supplierName: s.supplierName.trim(),
        supplierContact: s.supplierContact.trim() || undefined,
        supplierAddress: s.supplierAddress.trim() || undefined,
        notes: s.notes.trim() || undefined,
      };
      if (s.quotationPdf) {
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        form.append('quotationPdf', s.quotationPdf);
        await api.post(`/material-pools/${pool.id}/quotations`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post(`/material-pools/${pool.id}/quotations`, payload);
      }
      updateState(pool.id, {
        unitPrice: '', supplierName: '', supplierContact: '', supplierAddress: '',
        notes: '', quotationPdf: null, saving: false, complianceIssues: [], complianceFY: '',
      });
      await load();
      onUpdated?.();
    } catch (err) {
      const issues = err.response?.data?.complianceIssues;
      if (Array.isArray(issues) && issues.length > 0) {
        updateState(pool.id, {
          complianceIssues: issues,
          complianceFY: err.response?.data?.currentFinancialYear || '',
          saving: false,
        });
      } else {
        alert(err.response?.data?.error || 'Failed to add quote');
        updateState(pool.id, { saving: false });
      }
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      </Card>
    );
  }

  if (pools.length === 0) {
    return (
      <Card>
        <p className="text-center text-gray-400 py-6">
          No active material pools. Pool same-material lines from two PRs by opening a PR and clicking <strong>Pool</strong> on a material row.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {pools.map(pool => {
        const s = getState(pool.id);
        const totalQty = pool.items.reduce((sum, pi) => {
          const it = pi.purchaseRequestItem;
          return sum + (it.adminApprovedQty != null ? it.adminApprovedQty : it.requestedQty || 0);
        }, 0);
        const lineTotal = totalQty * (parseFloat(s.unitPrice) || 0);
        return (
          <Card key={pool.id}>
            <div className="space-y-4">
              {/* Header bar — mirrors the "For PR: …" bar in the single-PR modal */}
              <div className="bg-gray-50 p-3 rounded-md text-sm flex flex-wrap gap-x-6 gap-y-1 items-center">
                <div className="flex items-center gap-2">
                  <GitMerge size={16} className="text-purple-600" />
                  <span className="text-gray-500">Pool for:</span>
                  <span className="font-medium">{pool.productName}</span>
                  <Badge color={pool.status === 'OPEN' ? 'gray' : 'purple'}>{pool.status}</Badge>
                </div>
                <div className="text-xs text-gray-500">
                  {pool.items.length} PR-items · total {totalQty} {pool.productUnit} · created by {pool.createdBy?.name || '—'}
                </div>
                {pool.status === 'OPEN' && (
                  <div className="ml-auto">
                    <Button size="sm" variant="ghost" onClick={() => dissolvePool(pool.id)}>
                      Dissolve
                    </Button>
                  </div>
                )}
              </div>

              {/* Members table */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Sourced from</h4>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium text-gray-500">PR</th>
                        <th className="px-3 py-1.5 text-left font-medium text-gray-500">Unit</th>
                        <th className="px-3 py-1.5 text-left font-medium text-gray-500">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pool.items.map((pi, i) => {
                        const it = pi.purchaseRequestItem;
                        const qty = it.adminApprovedQty != null ? it.adminApprovedQty : it.requestedQty;
                        return (
                          <tr key={pi.id} className={`border-t border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                            <td className="px-3 py-1.5 font-mono">{it.request?.requestNumber}</td>
                            <td className="px-3 py-1.5">{it.request?.unit?.code || it.request?.unit?.name || '—'}</td>
                            <td className="px-3 py-1.5">{qty} {pool.productUnit}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Compliance issue banner — same style as single-PR modal */}
              {s.complianceIssues.length > 0 && (
                <div className="bg-red-50 border border-red-300 rounded p-3 text-sm text-red-900">
                  <p className="font-semibold mb-1">Supplier compliance documents required{s.complianceFY ? ` for FY ${s.complianceFY}` : ''}</p>
                  <ul className="list-disc pl-5 space-y-0.5 text-xs">
                    {s.complianceIssues.map((iss) => (
                      <li key={iss.supplierId}>
                        <strong>{iss.supplierName}</strong> — missing{' '}
                        {iss.missing.map((m, idx) => (
                          <span key={m}>
                            {idx > 0 ? ', ' : ''}
                            {m === 'vendor-evaluation' ? 'Vendor Evaluation PDF' : `Supplier Assessment PDF (FY ${s.complianceFY})`}
                          </span>
                        ))}
                      </li>
                    ))}
                  </ul>
                  <a href="/suppliers" target="_blank" rel="noreferrer" className="inline-block mt-2 text-xs font-semibold text-red-900 underline hover:text-red-700">
                    Open Suppliers page to upload PDFs →
                  </a>
                </div>
              )}

              {/* Supplier + pricing form */}
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Supplier & Pricing</h4>
                <div className="border rounded-md p-3 bg-white space-y-3">
                  <div className="grid grid-cols-12 gap-2">
                    <div className="col-span-4">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Supplier name *</label>
                      <SupplierAutocomplete
                        value={s.supplierName}
                        contextQuery={pool.productName}
                        onChange={(v) => updateState(pool.id, { supplierName: v })}
                        onSelect={(sup) => updateState(pool.id, {
                          supplierName: sup.name,
                          supplierContact: supplierContactString(sup),
                          supplierAddress: sup.address || '',
                        })}
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Phone/Email</label>
                      <input value={s.supplierContact} onChange={(e) => updateState(pool.id, { supplierContact: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Optional" />
                    </div>
                    <div className="col-span-5">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Address</label>
                      <input value={s.supplierAddress} onChange={(e) => updateState(pool.id, { supplierAddress: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded text-sm" placeholder="Optional" />
                    </div>
                  </div>
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Total Qty</label>
                      <div className="px-2 py-1.5 border rounded text-sm bg-gray-50 text-gray-700">
                        {totalQty} {pool.productUnit}
                      </div>
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Unit Price (₹)</label>
                      <input type="number" min={0} step="0.01" value={s.unitPrice}
                        onChange={(e) => updateState(pool.id, { unitPrice: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-[10px] uppercase text-gray-500 mb-0.5">Line Total</label>
                      <div className="text-sm font-semibold text-navy-700">{formatCurrency(lineTotal)}</div>
                    </div>
                  </div>
                </div>
              </div>

              <Input label="Notes" value={s.notes} onChange={(e) => updateState(pool.id, { notes: e.target.value })} placeholder="Optional notes" />

              {/* Quotation PDF block — identical styling to the single-PR modal */}
              <div className="border rounded-md p-3 bg-blue-50/40">
                <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                  <Paperclip size={14} /> Quotation PDF <span className="text-xs text-gray-500 font-normal">(optional, one per supplier quote, PDF only ≤10 MB)</span>
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => updateState(pool.id, { quotationPdf: e.target.files?.[0] || null })}
                  className="text-sm"
                />
                {s.quotationPdf && (
                  <div className="mt-1 text-xs text-gray-600 flex items-center gap-2">
                    <span className="font-medium">{s.quotationPdf.name}</span>
                    <span className="text-gray-400">({(s.quotationPdf.size / 1024).toFixed(1)} KB)</span>
                    <button type="button" onClick={() => updateState(pool.id, { quotationPdf: null })} className="text-red-500 hover:text-red-700"><X size={12} /></button>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <Button onClick={() => submitQuote(pool)} disabled={s.saving}>
                  <Plus size={14} className="mr-1" /> {s.saving ? 'Saving…' : 'Add Quotation'}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Pool by Material (per-product card with manual line picking) ───
// One card per product (grouped by name+unit). Inside each card the PO ticks
// the lines from different PRs they want to pool, enters supplier + price,
// and submits — each card produces its own union quotation covering only the
// ticked lines. Lines from products they don't touch stay in the normal
// single-PR quotation flow.
function PoolByMaterialSection({ onUpdated }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // Per-product UI state, keyed by `${productName}::${productUnit}` (lower-cased).
  // { checked: Set<itemId>, unitPrice, supplierName, supplierContact, supplierAddress, quotationPdf, saving, complianceIssues }
  const [groupState, setGroupState] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/quotations/pool-candidates');
      setItems(data.items || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Group line items by product. Use productId when present so a real catalog
  // product and a free-typed line that happens to share a name aren't merged.
  const groups = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const productKey = it.productId
        ? `pid:${it.productId}`
        : `name:${(it.productName || '').toLowerCase().trim()}`;
      const key = `${productKey}::${(it.productUnit || 'pcs').toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          productName: it.productName,
          productUnit: it.productUnit || 'pcs',
          rows: [],
          prIds: new Set(),
        });
      }
      const g = map.get(key);
      g.rows.push(it);
      g.prIds.add(it.request.id);
    }
    return [...map.values()].sort((a, b) => a.productName.localeCompare(b.productName));
  }, [items]);

  const getState = (key) => groupState[key] || {
    checked: new Set(),
    unitPrice: '',
    supplierName: '',
    supplierContact: '',
    supplierAddress: '',
    quotationPdf: null,
    saving: false,
    complianceIssues: [],
  };

  const updateState = (key, patch) => {
    setGroupState((prev) => ({ ...prev, [key]: { ...getState(key), ...patch } }));
  };

  const toggleRow = (key, itemId) => {
    const s = getState(key);
    const next = new Set(s.checked);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    updateState(key, { checked: next });
  };

  const submitGroup = async (group) => {
    const s = getState(group.key);
    const checkedRows = group.rows.filter(r => s.checked.has(r.id));
    const distinctPRs = new Set(checkedRows.map(r => r.request.id));

    if (checkedRows.length < 2) return alert('Pool at least 2 lines.');
    if (distinctPRs.size < 2) return alert('Pool must span at least 2 different PRs.');
    const price = parseFloat(s.unitPrice);
    if (!(price >= 0)) return alert('Enter a valid unit price.');
    if (!s.supplierName.trim()) return alert('Supplier name is required.');
    if (s.quotationPdf && s.quotationPdf.type !== 'application/pdf') return alert('Attachment must be PDF.');

    const totalQty = checkedRows.reduce((sum, r) => sum + (r.adminApprovedQty ?? r.requestedQty ?? 0), 0);

    updateState(group.key, { saving: true, complianceIssues: [] });
    try {
      const payload = {
        purchaseRequestIds: [...distinctPRs],
        items: [{
          productName: group.productName.trim(),
          productUnit: group.productUnit,
          quantity: totalQty,
          unitPrice: price,
          supplierName: s.supplierName.trim(),
          supplierContact: s.supplierContact.trim() || undefined,
          supplierAddress: s.supplierAddress.trim() || undefined,
          sources: checkedRows.map(r => ({
            purchaseRequestItemId: r.id,
            allocatedQty: r.adminApprovedQty ?? r.requestedQty ?? 0,
          })),
        }],
      };
      if (s.quotationPdf) {
        const form = new FormData();
        form.append('payload', JSON.stringify(payload));
        form.append('quotationPdf', s.quotationPdf);
        await api.post('/quotations/union', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      } else {
        await api.post('/quotations/union', payload);
      }
      alert(`Pooled ${checkedRows.length} lines across ${distinctPRs.size} PRs into one union quotation for "${group.productName}".`);
      updateState(group.key, {
        checked: new Set(), unitPrice: '', supplierName: '', supplierContact: '', supplierAddress: '',
        quotationPdf: null, saving: false, complianceIssues: [],
      });
      await load();
      onUpdated?.();
    } catch (err) {
      const issues = err.response?.data?.complianceIssues;
      if (Array.isArray(issues) && issues.length > 0) {
        updateState(group.key, { complianceIssues: issues, saving: false });
      } else {
        alert(err.response?.data?.error || 'Failed to pool & quote');
        updateState(group.key, { saving: false });
      }
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
        </div>
      </Card>
    );
  }

  // Only show product groups that span ≥2 distinct PRs — pooling needs at
  // least 2 different PRs to make sense; single-PR lines belong in the normal
  // "Add Quote" flow.
  const poolable = groups.filter(g => g.prIds.size >= 2);

  if (poolable.length === 0) {
    return (
      <Card>
        <p className="text-center text-gray-400 py-6">
          No materials are currently requested by 2 or more PRs. Use the normal "Add Quote" flow above for single-PR items.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {poolable.map(group => {
        const s = getState(group.key);
        const checkedRows = group.rows.filter(r => s.checked.has(r.id));
        const distinctPRs = new Set(checkedRows.map(r => r.request.id));
        const canSubmit = checkedRows.length >= 2 && distinctPRs.size >= 2 && parseFloat(s.unitPrice) >= 0 && s.supplierName.trim();
        const totalQty = checkedRows.reduce((sum, r) => sum + (r.adminApprovedQty ?? r.requestedQty ?? 0), 0);
        const lineTotal = totalQty * (parseFloat(s.unitPrice) || 0);
        return (
          <Card key={group.key}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <GitMerge size={16} className="text-purple-600" />
              <span className="font-semibold text-gray-800">{group.productName}</span>
              <span className="text-xs text-gray-500">({group.productUnit})</span>
              <Badge color="purple">{group.rows.length} lines · {group.prIds.size} PRs</Badge>
              {checkedRows.length >= 2 && distinctPRs.size >= 2 && (
                <Badge color="green">
                  Selected: {checkedRows.length} lines · {distinctPRs.size} PRs · Total {totalQty} {group.productUnit}
                </Badge>
              )}
              <span className="ml-auto text-sm">
                Line total: <span className="font-semibold text-navy-700">{formatCurrency(lineTotal)}</span>
              </span>
            </div>

            {s.complianceIssues.length > 0 && (
              <div className="bg-red-50 border border-red-300 rounded p-3 text-xs text-red-900 mb-3">
                <p className="font-semibold mb-1">Supplier compliance documents required</p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {s.complianceIssues.map((iss) => (
                    <li key={iss.supplierId}><strong>{iss.supplierName}</strong> — missing Vendor Evaluation PDF</li>
                  ))}
                </ul>
                <a href="/suppliers" target="_blank" rel="noreferrer" className="inline-block mt-2 font-semibold underline">
                  Open Suppliers page →
                </a>
              </div>
            )}

            <div className="overflow-x-auto border rounded-md mb-3">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr className="border-b">
                    <th className="px-2 py-1.5 w-8"></th>
                    <th className="px-2 py-1.5 text-left text-gray-600">PR</th>
                    <th className="px-2 py-1.5 text-left text-gray-600">Unit</th>
                    <th className="px-2 py-1.5 text-left text-gray-600">Manager</th>
                    <th className="px-2 py-1.5 text-left text-gray-600">Required Qty</th>
                    <th className="px-2 py-1.5 text-left text-gray-600">Required By</th>
                    <th className="px-2 py-1.5 text-left text-gray-600">Existing Quotes</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r, i) => {
                    const qty = r.adminApprovedQty ?? r.requestedQty ?? 0;
                    const existing = r.existingQuoteCount || 0;
                    return (
                      <tr key={r.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={s.checked.has(r.id)}
                            onChange={() => toggleRow(group.key, r.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-2 py-1.5 font-medium text-navy-700">{r.request.requestNumber}</td>
                        <td className="px-2 py-1.5"><Badge color="blue">{r.request.unit?.code || r.request.unit?.name || '—'}</Badge></td>
                        <td className="px-2 py-1.5 text-gray-600">{r.request.manager?.name || '—'}</td>
                        <td className="px-2 py-1.5">{qty} {r.productUnit}</td>
                        <td className="px-2 py-1.5 text-gray-500">
                          {r.requiredByDate ? new Date(r.requiredByDate).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td className="px-2 py-1.5">
                          {existing > 0
                            ? <Badge color="purple">{existing} quote{existing > 1 ? 's' : ''}</Badge>
                            : <span className="text-gray-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
              <div>
                <label className="text-[11px] uppercase text-gray-500">Unit Price (₹) *</label>
                <input
                  type="number"
                  value={s.unitPrice}
                  onChange={(e) => updateState(group.key, { unitPrice: e.target.value })}
                  className="w-full px-2 py-1 border rounded text-sm"
                  min="0"
                  step="0.01"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase text-gray-500">Supplier *</label>
                <SupplierAutocomplete
                  value={s.supplierName}
                  contextQuery={group.productName}
                  inputClassName="w-full px-2 py-1 border rounded text-sm"
                  onChange={(v) => updateState(group.key, { supplierName: v })}
                  onSelect={(sup) => updateState(group.key, {
                    supplierName: sup.name,
                    supplierContact: supplierContactString(sup),
                    supplierAddress: sup.address || '',
                  })}
                />
              </div>
              <div>
                <label className="text-[11px] uppercase text-gray-500">Contact</label>
                <input
                  value={s.supplierContact}
                  onChange={(e) => updateState(group.key, { supplierContact: e.target.value })}
                  className="w-full px-2 py-1 border rounded text-sm"
                  placeholder="Phone / email"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase text-gray-500">Address</label>
                <input
                  value={s.supplierAddress}
                  onChange={(e) => updateState(group.key, { supplierAddress: e.target.value })}
                  className="w-full px-2 py-1 border rounded text-sm"
                  placeholder="Address"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-gray-600 flex items-center gap-2 cursor-pointer">
                <Paperclip size={12} />
                <span>{s.quotationPdf ? s.quotationPdf.name : 'Attach quotation PDF (optional)'}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => updateState(group.key, { quotationPdf: e.target.files?.[0] || null })}
                />
              </label>
              <Button
                size="sm"
                disabled={!canSubmit || s.saving}
                onClick={() => submitGroup(group)}
                title={!canSubmit ? 'Tick ≥2 lines from ≥2 PRs and enter supplier + price' : ''}
              >
                <GitMerge size={14} className="mr-1" /> {s.saving ? 'Pooling…' : `Pool & Quote (${checkedRows.length})`}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ───
export default function QuotationManagement() {
  const { user } = useAuth();
  const [approvedPRs, setApprovedPRs] = useState([]);
  const [submittedPRs, setSubmittedPRs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddQuotation, setShowAddQuotation] = useState(null);
  const [reviewPR, setReviewPR] = useState(null);
  const [quotationCounts, setQuotationCounts] = useState({});
  const [unionCounts, setUnionCounts] = useState({});
  const [selectedPRIds, setSelectedPRIds] = useState(new Set());
  const [showUnionModal, setShowUnionModal] = useState(false);
  const [submittingUnions, setSubmittingUnions] = useState(false);
  // Quotation loaded on demand when the PO clicks "Fix & Resubmit" from the
  // top banner — ResubmitQuotationModal needs the full quotation (items),
  // and the PR list endpoint only returns header fields.
  const [resubmitTarget, setResubmitTarget] = useState(null);
  // Which draft union is currently being sent to admin (per-union spinner).
  const [sendingUnionId, setSendingUnionId] = useState(null);
  // Incremented every time fetchData runs so child sections (OpenPoolsSection,
  // PoolByMaterialSection) reload their own data without us having to lift
  // their state up.
  const [reloadKey, setReloadKey] = useState(0);

  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isApprover = user?.role === 'ADMIN';

  const openResubmit = async (quotationId) => {
    try {
      const { data } = await api.get(`/quotations/${quotationId}`);
      setResubmitTarget(data);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to load quotation');
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get PRs in relevant statuses
      const { data } = await api.get('/purchase-requests', { params: { limit: 100 } });
      // A PR belongs in the PO's "Add Quotations" list as long as it has any
      // item still open for quoting — AWAITING, SUBMITTED, or HELD. Items that
      // are already approved (on a PO) or cancelled are dead. This keeps the
      // PR visible for competing quotes even after the first batch has gone
      // to admin: admin can still ask for another supplier, or the PO can add
      // one before admin picks the winner.
      const isOpenForQuote = (s) =>
        s === 'AWAITING_QUOTATION' || s === 'QUOTATION_SUBMITTED' || s === 'QUOTATION_HELD';
      const hasOpenItems = (pr) => (pr.items || []).some(i => isOpenForQuote(i.itemQuotationStatus));
      const approved = data.requests.filter(r =>
        ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED'].includes(r.status) &&
        hasOpenItems(r)
      );
      const submitted = data.requests.filter(r => r.status === 'QUOTATION_SUBMITTED');
      setApprovedPRs(approved);
      setSubmittedPRs(submitted);

      // Get quotation counts for each PR — single quotes + union quotes that touch this PR
      const counts = {};
      const unionCounts = {};
      const allPRs = [...approved, ...submitted];
      for (const pr of allPRs) {
        const single = pr.quotations?.length || 0;
        const union = pr.quotationSources?.length || 0;
        counts[pr.id] = single + union;
        unionCounts[pr.id] = union;
      }
      setQuotationCounts(counts);
      setUnionCounts(unionCounts);
      setReloadKey(k => k + 1);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const togglePR = (id) => {
    setSelectedPRIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedPRs = useMemo(
    () => approvedPRs.filter(pr => selectedPRIds.has(pr.id)),
    [approvedPRs, selectedPRIds],
  );

  // Group competing union quotations by their source-PR signature so admin sees
  // one row per "union batch" instead of one row per source PR. We scan both
  // approvedPRs and submittedPRs because a held union can sit on a PR whose
  // status got demoted to IN_PROGRESS (sibling items still awaiting), and we
  // still want admin to see it.
  const unionGroups = useMemo(() => {
    const groups = new Map();
    const seen = new Set();
    const pool = new Map();
    for (const pr of [...approvedPRs, ...submittedPRs]) {
      if (!pool.has(pr.id)) pool.set(pr.id, pr);
    }
    for (const pr of pool.values()) {
      for (const src of (pr.quotationSources || [])) {
        const q = src.quotation;
        if (!q || q.isSelected || seen.has(q.id)) continue;
        // Only show sent-to-admin (or held) unions; drafts have their own PO section.
        if (!q.submittedToAdminAt) continue;
        seen.add(q.id);
        const prSet = (q.sourceRequests || []).map(s => s.purchaseRequest).filter(Boolean);
        const sig = prSet.map(p => p.id).sort().join('|');
        if (!groups.has(sig)) groups.set(sig, { sig, prSet, unions: [] });
        groups.get(sig).unions.push(q);
      }
    }
    return [...groups.values()];
  }, [approvedPRs, submittedPRs]);

  // PRs with single-PR quotations admin can act on (sent, not selected). Scans
  // both lists so held-on-IN_PROGRESS PRs still surface.
  const submittedPRsWithSingles = useMemo(() => {
    const pool = new Map();
    for (const pr of [...approvedPRs, ...submittedPRs]) {
      if (pool.has(pr.id)) continue;
      const live = (pr.quotations || []).some(q => q.submittedToAdminAt && !q.isSelected);
      if (live) pool.set(pr.id, pr);
    }
    return [...pool.values()];
  }, [approvedPRs, submittedPRs]);

  // Every quotation (single + union) currently on HOLD, deduped by id and
  // annotated with the PRs it touches. Drives the top-of-page "Action Required"
  // banner so the PO sees admin's hold notes without digging into modals.
  const heldQuotations = useMemo(() => {
    const seen = new Map();
    for (const pr of [...approvedPRs, ...submittedPRs]) {
      for (const q of (pr.quotations || [])) {
        if (q.heldAt && !q.isSelected && !seen.has(q.id)) {
          const prSet = q.isUnion
            ? (q.sourceRequests || []).map(s => s.purchaseRequest).filter(Boolean)
            : [{ id: pr.id, requestNumber: pr.requestNumber, unit: pr.unit }];
          seen.set(q.id, { ...q, prSet });
        }
      }
      for (const src of (pr.quotationSources || [])) {
        const q = src.quotation;
        if (!q || q.isSelected || !q.heldAt || seen.has(q.id)) continue;
        const prSet = (q.sourceRequests || []).map(s => s.purchaseRequest).filter(Boolean);
        seen.set(q.id, { ...q, prSet });
      }
    }
    return [...seen.values()];
  }, [approvedPRs, submittedPRs]);

  // Draft union quotations grouped by the PR-set they cover. The "Send to
  // Admin" endpoint always batches every unsent union covering a PR set
  // together (competing quotes go to admin side-by-side), so the UI matches
  // that semantics — one row per PR-set, with all the competing draft unions
  // listed inside.
  const draftUnionGroups = useMemo(() => {
    const groups = new Map();
    const seenQ = new Set();
    const pool = new Map();
    for (const pr of [...approvedPRs, ...submittedPRs]) {
      if (!pool.has(pr.id)) pool.set(pr.id, pr);
    }
    for (const pr of pool.values()) {
      for (const src of (pr.quotationSources || [])) {
        const q = src.quotation;
        if (!q || q.isSelected || q.heldAt || q.submittedToAdminAt) continue;
        if (seenQ.has(q.id)) continue;
        seenQ.add(q.id);
        const prSet = (q.sourceRequests || []).map(s => s.purchaseRequest).filter(Boolean);
        const sig = prSet.map(p => p.id).sort().join('|');
        if (!groups.has(sig)) groups.set(sig, { sig, prSet, unions: [] });
        groups.get(sig).unions.push(q);
      }
    }
    return [...groups.values()];
  }, [approvedPRs, submittedPRs]);

  // Quick lookup: how many quotes covering this PR are on hold right now.
  const heldCountForPR = (pr) => {
    const singles = (pr.quotations || []).filter(q => q.heldAt && !q.isSelected).length;
    const unions = (pr.quotationSources || []).filter(s => s.quotation?.heldAt && !s.quotation.isSelected).length;
    return singles + unions;
  };

  // Submits every draft union covering the given PR set. The backend's
  // /quotations/union/submit endpoint batches by PR set, not by quotation id,
  // so passing the PR ids is enough — all competing drafts get sent together.
  const sendUnionGroup = async (group) => {
    const prIds = (group.prSet || []).map(p => p.id);
    if (prIds.length < 2) {
      alert('This union does not have at least 2 source PRs — please re-create it.');
      return;
    }
    setSendingUnionId(group.sig);
    try {
      await api.post('/quotations/union/submit', { purchaseRequestIds: prIds });
      await fetchData();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to send union quotation to admin');
    }
    setSendingUnionId(null);
  };

  const [reviewUnionGroup, setReviewUnionGroup] = useState(null);

  return (
    <div className="space-y-6">
      <PageHero
        title="Quotation Management"
        subtitle="Collect supplier quotations, review submissions, and select winning bids."
        eyebrow="Bid Management"
        icon={FileSearch}
        actions={
          <Button variant="secondary" onClick={fetchData} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      {/* PO: Action Required — held quotations (single + union) admin sent back. */}
      {isPO && heldQuotations.length > 0 && (
        <div className="border-2 border-amber-400 bg-amber-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <PauseCircle size={20} className="text-amber-700" />
            <h2 className="text-lg font-semibold text-amber-900">
              Action Required — {heldQuotations.length} quotation{heldQuotations.length > 1 ? 's' : ''} on hold
            </h2>
          </div>
          <p className="text-xs text-amber-800 mb-3">
            Admin sent these back to you. Read the reason, fix the issue (usually a supplier document), and resubmit.
          </p>
          <div className="space-y-2">
            {heldQuotations.map(q => (
              <div key={q.id} className="bg-white border border-amber-300 rounded-md p-3">
                <div className="flex justify-between items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{q.quotationNumber}</span>
                      {q.isUnion && <Badge color="purple"><Layers size={10} className="inline mr-0.5" /> UNION</Badge>}
                      <span className="text-sm text-gray-600">{q.supplierName || '—'}</span>
                      <span className="text-sm font-semibold text-navy-700">{formatCurrency(q.totalAmount)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(q.prSet || []).map(pr => (
                        <Badge key={pr.id} color="navy">
                          {pr.requestNumber}{pr.unit ? ` · ${pr.unit.code || pr.unit.name}` : ''}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900">
                      <span className="font-semibold">Admin's reason: </span>
                      {q.holdNote || '(no reason given)'}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openResubmit(q.id)}>
                    <RefreshCw size={14} className="mr-1" /> Fix & Resubmit
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PO: Approved PRs needing quotations */}
      {isPO && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Approved PRs — Add Quotations</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Add as many supplier quotes per PR as you need. Use <strong>Send per product</strong> to send each quote on its own (so ready products go to admin now and the rest wait), or <strong>Send all</strong> to send every draft at once. Admin only sees a PR's quotes after you send them.
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={selectedPRIds.size < 2}
              onClick={() => setShowUnionModal(true)}
              title={selectedPRIds.size < 2 ? 'Tick ≥2 PRs to bundle them into one Union Quotation' : ''}
            >
              <Layers size={14} className="mr-1" /> Bundle {selectedPRIds.size > 1 ? selectedPRIds.size : ''} PRs (Union)
            </Button>
          </div>
          <Card>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : approvedPRs.length === 0 ? (
              <p className="text-center text-gray-400 py-6">No approved PRs awaiting quotations.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 w-10"></th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quotations</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvedPRs.map(pr => (
                      <tr key={pr.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedPRIds.has(pr.id)}
                            onChange={() => togglePR(pr.id)}
                            className="rounded"
                            title="Select for Union Quotation"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-navy-700">{pr.requestNumber}</td>
                        <td className="px-3 py-2 text-gray-600">{pr.manager?.name}</td>
                        <td className="px-3 py-2"><Badge color="blue">{pr.unit?.code}</Badge></td>
                        <td className="px-3 py-2 text-gray-600">{pr.items?.length}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              const singles = pr.quotations || [];
                              const heldSingles = singles.filter(q => q.heldAt && !q.isSelected).length;
                              // Drafts = not held, not selected, not yet sent.
                              const draftCount = singles.filter(q => !q.submittedToAdminAt && !q.heldAt && !q.isSelected).length;
                              // Sent + still awaiting admin = submitted, not held, not selected.
                              const sentCount = singles.filter(q => q.submittedToAdminAt && !q.heldAt && !q.isSelected).length;
                              const heldUnions = (pr.quotationSources || []).filter(s => s.quotation?.heldAt && !s.quotation.isSelected).length;
                              const totalHeld = heldSingles + heldUnions;
                              return (
                                <>
                                  {draftCount > 0 && (
                                    <Badge color="amber" title="Not yet sent to admin">
                                      {draftCount} draft
                                    </Badge>
                                  )}
                                  {sentCount > 0 && (
                                    <Badge color="green" title="Sent to admin — awaiting review">
                                      {sentCount} sent
                                    </Badge>
                                  )}
                                  {totalHeld > 0 && (
                                    <Badge color="red" title="Admin sent these back — action required">
                                      <PauseCircle size={10} className="inline mr-0.5" /> {totalHeld} on hold
                                    </Badge>
                                  )}
                                  {singles.length === 0 && (unionCounts[pr.id] || 0) === 0 && (
                                    <Badge color="gray">No quotes yet</Badge>
                                  )}
                                </>
                              );
                            })()}
                            {(unionCounts[pr.id] || 0) > 0 && (
                              <Badge color="purple">
                                <Layers size={10} className="inline mr-0.5" /> {unionCounts[pr.id]} union
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(pr.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => setShowAddQuotation(pr)}>
                              <Plus size={14} className="mr-1" /> Add Quote
                            </Button>
                            {(pr.quotations || []).filter(q => !q.isUnion).length > 0 && (
                              <Button size="sm" variant="secondary" onClick={() => setReviewPR(pr)}>
                                <Eye size={14} className="mr-1" /> Send per product
                              </Button>
                            )}
                            {(() => {
                              const draftSingles = (pr.quotations || []).filter(q => !q.submittedToAdminAt);
                              if (draftSingles.length === 0) return null;
                              return (
                                <Button size="sm" variant="primary" onClick={async () => {
                                  if (!confirm(`Send all ${draftSingles.length} draft quotation(s) to admin for approval?`)) return;
                                  try {
                                    await api.post(`/quotations/submit/${pr.id}`);
                                    alert('Quotations sent to admin for approval.');
                                    fetchData();
                                  } catch (err) {
                                    alert(err.response?.data?.error || 'Failed to submit');
                                  }
                                }}>
                                  <Send size={14} className="mr-1" /> Send all {draftSingles.length}
                                </Button>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* PO: Material Pools — PR-items the PO has bundled together from the PR
          detail page. Each pool can collect multiple competing supplier
          quotations; once admin approves one, the pool's PR-items move into a
          single union PO with FIFO inward allocation. */}
      {isPO && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <GitMerge size={18} className="text-purple-600" /> Material Pools
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Pools are built from the <strong>PR detail page</strong> — open a PR, click <em>Pool</em> on any material to bundle it with the same material from another PR. Add competing quotes here; each becomes a separate draft union quotation you can send to admin.
          </p>
          <OpenPoolsSection onUpdated={fetchData} reloadKey={reloadKey} />
        </div>
      )}

      {/* PO: Legacy Pool-by-Material — keep around for ad-hoc pooling without
          touching PR detail. Lines that aren't already in a pool show up here. */}
      {isPO && (
        <details className="rounded border border-gray-200 bg-gray-50">
          <summary className="cursor-pointer text-sm text-gray-700 px-3 py-2 select-none">
            Quick pool-by-material (legacy) — pool + quote in one step
          </summary>
          <div className="p-3">
            <PoolByMaterialSection onUpdated={fetchData} />
          </div>
        </details>
      )}

      {/* PO: Draft Union Quotations — built but not yet sent to admin.
          Grouped by PR-set because the submit endpoint always batches every
          unsent union covering the same PR set together. */}
      {isPO && draftUnionGroups.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-1 flex items-center gap-2">
            <Layers size={18} className="text-purple-600" /> Draft Union Quotations ({draftUnionGroups.length})
          </h2>
          <p className="text-xs text-gray-500 mb-3">
            Union quotations you've built but haven't sent yet. Each row groups every draft union covering the same PR set — clicking <strong>Send to Admin</strong> sends them all together so admin can pick between competing suppliers.
          </p>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Covered PRs</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Competing Drafts</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Total</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {draftUnionGroups.map(g => {
                    const sending = sendingUnionId === g.sig;
                    return (
                      <tr key={g.sig} className="border-b border-gray-50 hover:bg-purple-50/30 align-top">
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {g.prSet.map(pr => (
                              <Badge key={pr.id} color="navy">
                                {pr.requestNumber}{pr.unit ? ` · ${pr.unit.code || pr.unit.name}` : ''}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            {g.unions.map(q => (
                              <div key={q.id} className="text-xs">
                                <span className="font-medium text-purple-700">{q.quotationNumber}</span>
                                <span className="text-gray-500"> · {q.supplierName || 'no supplier'}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            {g.unions.map(q => (
                              <div key={q.id} className="text-xs font-semibold text-navy-700">
                                {formatCurrency(q.totalAmount)}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={sending}
                            onClick={() => sendUnionGroup(g)}
                          >
                            <Send size={14} className="mr-1" /> {sending ? 'Sending…' : `Send ${g.unions.length} to Admin`}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Approver only: Union quotations awaiting approval — grouped by PR-set */}
      {isApprover && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Layers size={18} className="text-purple-600" /> Union Quotations Awaiting Approval
          </h2>
          <Card>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : unionGroups.length === 0 ? (
              <p className="text-center text-gray-400 py-6">No union quotations awaiting approval.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Covered PRs</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Competing Unions</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Suppliers</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount Range</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unionGroups.map(g => {
                      const amounts = g.unions.map(q => q.totalAmount);
                      const minAmt = Math.min(...amounts);
                      const maxAmt = Math.max(...amounts);
                      const suppliers = [...new Set(g.unions.map(q => q.supplierName).filter(Boolean))];
                      return (
                        <tr key={g.sig} className="border-b border-gray-50 hover:bg-purple-50/30">
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {g.prSet.map(pr => (
                                <Badge key={pr.id} color="navy">
                                  {pr.requestNumber} · {pr.unit?.code || pr.unit?.name}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <Badge color="purple">{g.unions.length}</Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600">
                            {suppliers.length > 0 ? suppliers.join(', ') : '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-600 text-xs">
                            {formatCurrency(minAmt)} — {formatCurrency(maxAmt)}
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" onClick={() => setReviewUnionGroup(g)}>
                              <Eye size={14} className="mr-1" /> Review & Approve
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Approver only: Single-PR quotations for review */}
      {isApprover && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            Single-PR Quotations Awaiting Your Approval
          </h2>
          <Card>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : submittedPRsWithSingles.length === 0 ? (
              <p className="text-center text-gray-400 py-6">No single-PR quotations awaiting approval.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Manager</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quotations</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Amount Range</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submittedPRsWithSingles.map(pr => {
                      const amounts = pr.quotations?.map(q => q.totalAmount) || [];
                      const minAmt = amounts.length > 0 ? Math.min(...amounts) : 0;
                      const maxAmt = amounts.length > 0 ? Math.max(...amounts) : 0;
                      return (
                        <tr key={pr.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-navy-700">{pr.requestNumber}</td>
                          <td className="px-3 py-2 text-gray-600">{pr.manager?.name}</td>
                          <td className="px-3 py-2"><Badge color="blue">{pr.unit?.code}</Badge></td>
                          <td className="px-3 py-2"><Badge color="navy">{pr.quotations?.length || 0}</Badge></td>
                          <td className="px-3 py-2 text-gray-600 text-xs">
                            {formatCurrency(minAmt)} — {formatCurrency(maxAmt)}
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" onClick={() => setReviewPR(pr)}>
                              <Eye size={14} className="mr-1" /> Review & Approve
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Modals */}
      <AddQuotationModal
        isOpen={!!showAddQuotation}
        onClose={() => setShowAddQuotation(null)}
        purchaseRequest={showAddQuotation}
        onCreated={fetchData}
      />
      <ReviewQuotationsModal
        purchaseRequest={reviewPR}
        onClose={() => setReviewPR(null)}
        onUpdated={fetchData}
        isApprover={isApprover}
        isPO={isPO}
      />
      <UnionReviewModal
        unionGroup={reviewUnionGroup}
        onClose={() => setReviewUnionGroup(null)}
        onUpdated={fetchData}
        isApprover={isApprover}
        isPO={isPO}
      />
      <CreateUnionQuotationModal
        isOpen={showUnionModal}
        onClose={() => setShowUnionModal(false)}
        purchaseRequests={selectedPRs}
        onCreated={() => {
          fetchData();
        }}
      />
      <ResubmitQuotationModal
        quotation={resubmitTarget}
        onClose={() => setResubmitTarget(null)}
        onResubmitted={fetchData}
      />
    </div>
  );
}
