import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, Layers, History, Send, ShoppingBag, FileQuestion, FileInput, Link2, ArrowUpFromLine, FileText, GitBranch, Box } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { formatDate, formatDateTime, formatNotes } from '../utils/formatters';

const formatCurrency = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// Expiry status helper — QC fills `dateOfExpiry` on the inspection report. Each batch
// derived from that inspection inherits the same shelf life. We surface this on the
// product page so stores notice expired/expiring stock before issuing it.
function expiryStatusOf(dateOfExpiry) {
  if (!dateOfExpiry) return null;
  const exp = new Date(dateOfExpiry);
  if (Number.isNaN(exp.getTime())) return null;
  const now = new Date();
  const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { kind: 'expired', days: -diffDays, date: exp };
  if (diffDays <= 30) return { kind: 'soon', days: diffDays, date: exp };
  return { kind: 'ok', days: diffDays, date: exp };
}

function ExpiryBadge({ dateOfExpiry, className = '' }) {
  const s = expiryStatusOf(dateOfExpiry);
  if (!s) return null;
  if (s.kind === 'expired') {
    // animate-pulse approximates a "blinking" alarm without harsh strobing.
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-bold text-white bg-red-600 border border-red-700 rounded px-2 py-0.5 animate-pulse shadow-sm ${className}`}
        title={`Expired on ${formatDate(s.date)} (${s.days} day${s.days === 1 ? '' : 's'} ago)`}
      >
        ⚠ EXPIRED · {s.days}d ago
      </span>
    );
  }
  if (s.kind === 'soon') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-0.5 ${className}`}
        title={`Expires on ${formatDate(s.date)}`}
      >
        Expires in {s.days}d
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] text-gray-600 ${className}`}
      title={`Expires on ${formatDate(s.date)}`}
    >
      Expires {formatDate(s.date)}
    </span>
  );
}

// ─── Quick Re-quote Modal ─────────────────────────────────────────────────
// Pre-fills supplier + product from history row. Asks which open Purchase Request
// (status APPROVED for this product) to attach the quotation to. Submits as a
// regular Quotation; admin gets the same notification as today.
function QuickRequoteModal({ isOpen, onClose, product, source, onCreated }) {
  const [openPRs, setOpenPRs] = useState([]);
  const [selectedPrId, setSelectedPrId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [supplierAddress, setSupplierAddress] = useState('');
  const [supplierId, setSupplierId] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingPRs, setLoadingPRs] = useState(false);

  useEffect(() => {
    if (!isOpen || !source || !product) return;
    setSupplierName(source.supplierName || '');
    setSupplierContact(source.supplierContact || '');
    setSupplierAddress(source.supplierAddress || '');
    setSupplierId(source.supplierId || null);
    setQuantity(source.quantity || 1);
    setUnitPrice(source.unitPrice || 0);
    setNotes('');
    setSelectedPrId('');

    setLoadingPRs(true);
    // Fetch open PRs (APPROVED state) that include this product (by id or name).
    api.get('/purchase-requests', { params: { status: 'APPROVED', limit: 200 } })
      .then(({ data }) => {
        const all = data.purchaseRequests || data.requests || data;
        const list = Array.isArray(all) ? all : [];
        const matching = list.filter(pr => (pr.items || []).some(it =>
          it.productId === product.id ||
          (it.productName || '').toLowerCase().trim() === product.name.toLowerCase().trim()
        ));
        setOpenPRs(matching);
        if (matching.length === 1) setSelectedPrId(matching[0].id);
      })
      .catch(() => setOpenPRs([]))
      .finally(() => setLoadingPRs(false));
  }, [isOpen, source, product]);

  const submit = async () => {
    if (!selectedPrId) return alert('Select a Purchase Request to attach this quotation to');
    if (!supplierName.trim()) return alert('Supplier name is required');
    if (!(quantity > 0) || !(unitPrice >= 0)) return alert('Quantity and price must be valid');

    setSaving(true);
    try {
      await api.post('/quotations', {
        purchaseRequestId: selectedPrId,
        notes: notes || undefined,
        items: [{
          productId: product.id,
          productName: product.name,
          productUnit: product.unit,
          quantity: parseFloat(quantity),
          unitPrice: parseFloat(unitPrice),
          supplierId: supplierId || undefined,
          supplierName: supplierName.trim(),
          supplierContact: supplierContact.trim() || undefined,
          supplierAddress: supplierAddress.trim() || undefined,
        }],
      });
      onClose();
      onCreated && onCreated();
      alert('Quotation submitted. Admin will be notified once the Purchase Officer submits all quotes for this PR.');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create quotation');
    }
    setSaving(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Quick Re-quote: ${product?.name || ''}`} size="lg">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
          <strong>Re-using past supplier:</strong> Update the quantity + unit price, pick which open Purchase Request to attach this to, and submit. The quotation will appear in the PR's quotation list — same as today's flow. Admin gets notified when the PR's Purchase Officer hits "Submit all quotations".
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Attach to Purchase Request *</label>
          {loadingPRs ? (
            <div className="text-sm text-gray-500">Loading open PRs…</div>
          ) : openPRs.length === 0 ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              No open Purchase Request found for <strong>{product?.name}</strong> in status <em>APPROVED</em>.
              Ask a Unit Manager to raise a Purchase Request for this product (and Admin to approve it) before re-quoting.
            </div>
          ) : (
            <select
              value={selectedPrId}
              onChange={(e) => setSelectedPrId(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm"
            >
              <option value="">— Select PR —</option>
              {openPRs.map(pr => (
                <option key={pr.id} value={pr.id}>
                  {pr.requestNumber} · {pr.requestId || '—'} · {pr.unit?.name || pr.unit?.code || ''} · {pr.manager?.name || ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Supplier *</label>
            <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="w-full px-3 py-2 border rounded text-sm bg-gray-50" readOnly title="Pre-filled from history. To use a different supplier, use the standard Quotation flow." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Supplier Contact</label>
            <input value={supplierContact} onChange={(e) => setSupplierContact(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Supplier Address</label>
          <input value={supplierAddress} onChange={(e) => setSupplierAddress(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
            <input type="number" value={quantity} min="0.01" step="0.01" onChange={(e) => setQuantity(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price (₹)</label>
            <input type="number" value={unitPrice} min="0" step="0.01" onChange={(e) => setUnitPrice(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Total</label>
            <div className="px-3 py-2 border rounded bg-gray-50 text-sm font-semibold text-navy-700">
              {formatCurrency((parseFloat(quantity) || 0) * (parseFloat(unitPrice) || 0))}
            </div>
          </div>
        </div>

        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra remarks for admin" />

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !selectedPrId || openPRs.length === 0}>
            {saving ? 'Saving…' : <><Send size={14} className="inline mr-1" /> Submit Quotation</>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Supplier History Tab ────────────────────────────────────────────────
function SupplierHistoryTab({ product, onRequote }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState('purchased');

  useEffect(() => {
    if (!product?.id) return;
    setLoading(true);
    api.get(`/products/${product.id}/supplier-history`)
      .then(({ data }) => setHistory(data))
      .catch(() => setHistory(null))
      .finally(() => setLoading(false));
  }, [product?.id]);

  if (loading) return <div className="text-sm text-gray-500 py-4">Loading supplier history…</div>;
  if (!history) return <div className="text-sm text-red-600 py-4">Failed to load supplier history.</div>;

  const { purchased, quoted, summary } = history;

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-navy-50 to-white border border-navy-200 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-navy-700/70 font-medium">Last bought from</div>
          {summary.lastBoughtFrom ? (
            <>
              <div className="font-semibold text-navy-700 mt-1">{summary.lastBoughtFrom.supplierName}</div>
              <div className="text-xs text-gray-600 mt-0.5">
                {formatDate(summary.lastBoughtFrom.date)} · @ {formatCurrency(summary.lastBoughtFrom.unitPrice)}/{product.unit}
              </div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{summary.lastBoughtFrom.poNumber}</div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-1">Never purchased</div>
          )}
        </div>

        <div className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-green-700/70 font-medium">Cheapest historical</div>
          {summary.cheapestEver ? (
            <>
              <div className="font-semibold text-green-700 mt-1">{summary.cheapestEver.supplierName}</div>
              <div className="text-xs text-gray-600 mt-0.5">
                @ {formatCurrency(summary.cheapestEver.unitPrice)}/{product.unit} on {formatDate(summary.cheapestEver.date)}
              </div>
              <div className="text-[10px] text-gray-400 font-mono mt-0.5">{summary.cheapestEver.poNumber}</div>
            </>
          ) : (
            <div className="text-sm text-gray-400 mt-1">—</div>
          )}
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-white border border-amber-200 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-amber-700/70 font-medium">Supplier coverage</div>
          <div className="font-semibold text-amber-700 mt-1 text-2xl">{summary.totalSuppliers}</div>
          <div className="text-xs text-gray-600 mt-0.5">
            unique supplier{summary.totalSuppliers === 1 ? '' : 's'} · {summary.purchasedCount} PO line{summary.purchasedCount === 1 ? '' : 's'} · {summary.quotedCount} unselected quote{summary.quotedCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Sub-tab switcher */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setSubTab('purchased')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            subTab === 'purchased' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <ShoppingBag size={14} className="inline mr-1.5" />
          Purchased ({purchased.length})
        </button>
        <button
          onClick={() => setSubTab('quoted')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            subTab === 'quoted' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <FileQuestion size={14} className="inline mr-1.5" />
          Quoted but not bought ({quoted.length})
        </button>
      </div>

      {/* Purchased table */}
      {subTab === 'purchased' && (
        <div className="overflow-x-auto">
          {purchased.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No purchases of this product yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PO #</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Unit Price</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {purchased.map(row => (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-amber-50/30">
                    <td className="px-3 py-2 text-xs text-gray-600">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{row.supplierName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.poNumber}</td>
                    <td className="px-3 py-2 text-right">{row.quantity} {row.productUnit}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-navy-700">{formatCurrency(row.totalPrice)}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge color={row.itemStatus === 'RECEIVED' ? 'green' : row.itemStatus === 'CANCELLED' ? 'red' : 'yellow'}>
                        {row.itemStatus}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => onRequote(row)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        title="Re-quote this product from this supplier"
                      >
                        Quick Re-quote
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Quoted (not bought) table */}
      {subTab === 'quoted' && (
        <div className="overflow-x-auto">
          {quoted.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No unselected quotations on record. Either every quote was approved, or this product was never quoted.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Supplier</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quotation #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">PR #</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Unit Price</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {quoted.map(row => (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-amber-50/30">
                    <td className="px-3 py-2 text-xs text-gray-600">{formatDate(row.date)}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{row.supplierName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-600">{row.quotationNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{row.purchaseRequestNumber || '—'}</td>
                    <td className="px-3 py-2 text-right">{row.quantity} {row.productUnit}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(row.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-700">{formatCurrency(row.totalPrice)}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => onRequote(row)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        title="Re-quote this product from this supplier"
                      >
                        Quick Re-quote
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FIM / Gate Pass Tab ─────────────────────────────────────────────────
// Surfaces, for each FIM batch of this product:
//   - the inward gate pass (customer GP number, customer name, etc.)
//   - any outward delivery challans that returned/delivered this FIM back
// This is the visible end of the inward↔outward mapping for customer-property
// material.
function FimTab({ product }) {
  const batches = product.fimBatches || [];
  if (batches.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No FIM batches on record for this product.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
        These batches are <strong>customer property (FIM)</strong>. They were inwarded against the
        customer's own gate pass, so the original GP number is preserved here. Delivery Challans
        that sent the material (or finished goods derived from it) back are shown beside each batch.
      </div>

      {batches.map(b => {
        const gp = b.sourceInwardGatePass;
        const item = b.sourceInwardGatePassItem;
        const outwards = item?.outwardLinkedItems || [];
        return (
          <div key={b.id} className="border border-gray-200 rounded p-4 bg-white">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-semibold text-navy-700">
                  Batch <span className="font-mono">{b.batchNo || b.id.slice(0, 8)}</span>
                </p>
                <p className="text-xs text-gray-500">
                  Received {formatDate(b.receivedDate)} · {b.quantity} {product.unit} ({b.remaining} remaining)
                </p>
              </div>
              <Badge color={gp?.passType === 'NON_RETURNABLE' ? 'orange' : 'blue'}>
                {gp?.passType === 'NON_RETURNABLE' ? 'Non-Returnable FIM' : 'Returnable FIM'}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1">Inward Gate Pass</p>
                <p className="font-mono text-navy-700 font-medium">{gp?.passNumber || '—'}</p>
                <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                  <div><span className="text-gray-500">Customer:</span> {gp?.customerName || '—'}</div>
                  <div><span className="text-gray-500">Customer GP No.:</span> <span className="font-mono">{gp?.customerGatePassNo || '—'}</span></div>
                  {gp?.customerGatePassDate && (
                    <div><span className="text-gray-500">Customer GP date:</span> {formatDate(gp.customerGatePassDate)}</div>
                  )}
                  {gp?.customerContact && (
                    <div><span className="text-gray-500">Contact:</span> {gp.customerContact}</div>
                  )}
                  {item?.probableReturnDate && (
                    <div><span className="text-gray-500">Probable return:</span> {formatDate(item.probableReturnDate)}</div>
                  )}
                </div>
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1 inline-flex items-center gap-1">
                  <ArrowUpFromLine size={11} /> Returned via Delivery Challan
                </p>
                {outwards.length === 0 ? (
                  <p className="text-xs text-gray-400 italic mt-1">Not yet sent back — no Delivery Challan linked.</p>
                ) : (
                  <ul className="space-y-1 mt-1">
                    {outwards.map(lo => (
                      <li key={lo.id} className="text-xs text-gray-700">
                        <Link2 size={10} className="inline mr-0.5 text-blue-600" />
                        <span className="font-mono text-blue-700">{lo.gatePass?.passNumber}</span>
                        <span className="text-gray-500"> · {formatDate(lo.gatePass?.date)}</span>
                        <span className="text-gray-700"> · sent {lo.quantity} {lo.unit}</span>
                        {lo.gatePass?.partyName && (
                          <span className="text-gray-500"> → {lo.gatePass.partyName}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Procurement Chain / Stores Trace Tab ────────────────────────────────
// For every PO-flow batch of this product, render the full origin chain:
//   PR (raised by Unit Manager) → PO → Lot N (invoice/MRD) → Batch (inwarded qty)
// Stores team (STORE_MANAGER) additionally see the full IIR + QC report data
// for each batch so they can answer "where did this stock come from and is it OK
// to issue?" without leaving the page.
function ProcurementChainTab({ product, isStores }) {
  const batches = product.poBatches || [];
  if (batches.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No purchased batches yet — this product has not been inwarded against any Purchase Order.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
        Each card traces one inwarded batch back to its origin:
        <strong> PR → PO → Lot N (invoice) → Batch</strong>.
        Multiple lots can come from the same PO when material arrives in instalments.
        {isStores && <span className="ml-1">Stores view: inspection request and report data are included below each batch.</span>}
      </div>

      {batches.map(b => {
        const insp = b.sourceQcInspection;
        const po = insp?.purchaseOrder;
        const pr = po?.purchaseRequest;
        const docTypes = insp?.documentTypes || {};
        const ticked = Object.entries(docTypes).filter(([, v]) => v).map(([k]) => k);
        return (
          <div key={b.id} className="border border-gray-200 rounded p-4 bg-white">
            <div className="flex items-start justify-between mb-3 gap-3">
              <div>
                <p className="text-sm font-semibold text-navy-700">
                  Batch <span className="font-mono">{b.batchNo || b.id.slice(0, 8)}</span>
                  {insp?.lotNumber != null && (
                    <span className="ml-2 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      Lot {insp.lotNumber}
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-500">
                  Inwarded {formatDate(b.receivedDate)} · {b.quantity} {product.unit} ({b.remaining} remaining)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {insp?.dateOfExpiry && <ExpiryBadge dateOfExpiry={insp.dateOfExpiry} />}
                {!insp && <Badge color="gray">Legacy (no QC link)</Badge>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              {/* PR */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1 flex items-center gap-1">
                  <GitBranch size={11} /> Purchase Request
                </p>
                {pr ? (
                  <>
                    <p className="font-mono text-navy-700 font-medium">{pr.requestNumber}</p>
                    <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                      {pr.requestId && <div><span className="text-gray-500">ID:</span> <span className="font-mono">{pr.requestId}</span></div>}
                      {pr.manager?.name && <div><span className="text-gray-500">Raised by:</span> {pr.manager.name}</div>}
                      {pr.unit && <div><span className="text-gray-500">Unit:</span> {pr.unit.name || pr.unit.code}</div>}
                    </div>
                  </>
                ) : <p className="text-xs text-gray-400 italic">—</p>}
              </div>

              {/* PO */}
              <div className="p-3 bg-gray-50 border border-gray-200 rounded">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1">Purchase Order</p>
                {po ? (
                  <>
                    <p className="font-mono text-navy-700 font-medium">{po.orderNumber}</p>
                    <div className="text-xs text-gray-600 mt-1 space-y-0.5">
                      {po.customName && <div><span className="text-gray-500">Name:</span> {po.customName}</div>}
                      {po.supplierName && <div><span className="text-gray-500">Supplier:</span> {po.supplierName}</div>}
                      {po.mirNo && <div><span className="text-gray-500">MIR:</span> <span className="font-mono">{po.mirNo}</span></div>}
                    </div>
                  </>
                ) : <p className="text-xs text-gray-400 italic">—</p>}
              </div>

              {/* Lot + Invoice */}
              <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                <p className="text-xs uppercase tracking-wide text-amber-700 font-medium mb-1">
                  Lot {insp?.lotNumber ?? '—'} · QC {insp?.inspectionNumber || ''}
                </p>
                {insp ? (
                  <div className="text-xs text-gray-700 mt-1 space-y-0.5">
                    {insp.arrivedQty != null && (
                      <div><span className="text-gray-500">Arrived:</span> <strong>{insp.arrivedQty} {product.unit}</strong></div>
                    )}
                    {insp.materialReceiptDate && (
                      <div><span className="text-gray-500">MRD:</span> {formatDate(insp.materialReceiptDate)}</div>
                    )}
                    {insp.invoiceNo && (
                      <div>
                        <span className="text-gray-500">Invoice #:</span> <span className="font-mono">{insp.invoiceNo}</span>
                        {insp.invoiceDate && <span className="text-gray-500"> ({formatDate(insp.invoiceDate)})</span>}
                      </div>
                    )}
                    {insp.result && (
                      <div>
                        <span className="text-gray-500">QC:</span>{' '}
                        <Badge color={insp.result === 'PASSED' ? 'green' : insp.result === 'PARTIAL' ? 'yellow' : 'red'}>
                          {insp.result}
                        </Badge>
                      </div>
                    )}
                    {insp.invoiceFileUrl && (
                      <div className="mt-1">
                        <a href={insp.invoiceFileUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-navy-700 hover:underline font-medium">
                          <FileText size={12} /> Download invoice PDF
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No QC link (pre-lot-tracking)</p>
                )}
              </div>
            </div>

            {/* Stores-only deep trace: full Inspection Request + Inspection Report data
                for this batch. PO/QC/Admin users see the summary above; stores get the
                line-level info they need to make issuing decisions. */}
            {isStores && insp && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 border border-blue-200 bg-blue-50 rounded">
                  <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-2">
                    Inspection Request (IIR)
                  </div>
                  <div className="text-xs text-gray-700 space-y-1">
                    <div><span className="text-gray-500">IIR no.:</span> <span className="font-mono">{insp.inspectionNumber}</span></div>
                    {insp.requestCreatedBy?.name && (
                      <div><span className="text-gray-500">Raised by:</span> {insp.requestCreatedBy.name}</div>
                    )}
                    {insp.createdAt && (
                      <div><span className="text-gray-500">Raised on:</span> {formatDateTime(insp.createdAt)}</div>
                    )}
                    {insp.materialReceiptDate && (
                      <div><span className="text-gray-500">Material receipt date:</span> {formatDate(insp.materialReceiptDate)}</div>
                    )}
                    {insp.materialCategory && (
                      <div><span className="text-gray-500">Material category:</span> {insp.materialCategory}</div>
                    )}
                    {insp.dcNo && (
                      <div><span className="text-gray-500">DC no.:</span> <span className="font-mono">{insp.dcNo}</span></div>
                    )}
                    {insp.gatePassNo && (
                      <div>
                        <span className="text-gray-500">Gate pass:</span>{' '}
                        <span className="font-mono">{insp.gatePassNo}</span>
                        {insp.gatePassType && <span className="text-gray-500"> ({insp.gatePassType})</span>}
                      </div>
                    )}
                    {ticked.length > 0 && (
                      <div>
                        <span className="text-gray-500">Docs requested:</span>{' '}
                        {ticked.map(k => (
                          <span key={k} className="inline-block mr-1 text-[10px] bg-white border border-blue-200 rounded px-1.5 py-0.5">
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Itemized lot breakdown for stores */}
                  {Array.isArray(insp.items) && insp.items.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-blue-200">
                      <div className="text-[10px] font-bold text-blue-800 uppercase mb-1 flex items-center gap-1">
                        <Box size={10} /> Lot Items
                      </div>
                      <div className="space-y-1">
                        {insp.items.map(li => (
                          <div key={li.id} className="flex justify-between items-center text-[11px] text-gray-700 bg-white/40 rounded px-1.5 py-0.5">
                            <span className="truncate mr-2">{li.purchaseOrderItem?.productName || 'Material'}</span>
                            <span className="font-semibold shrink-0">{li.arrivedQty} {li.purchaseOrderItem?.productUnit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-3 border border-green-200 bg-green-50 rounded">
                  <div className="text-xs uppercase tracking-wide text-green-700 font-semibold mb-2">
                    Inspection Report (QC)
                  </div>
                  {insp.inspectedAt || insp.reportNo || insp.qtyAccepted != null ? (
                    <div className="text-xs text-gray-700 space-y-1">
                      {insp.reportNo && (
                        <div><span className="text-gray-500">Report no.:</span> <span className="font-mono">{insp.reportNo}</span></div>
                      )}
                      {insp.inspectedBy?.name && (
                        <div><span className="text-gray-500">QC by:</span> {insp.inspectedBy.name}</div>
                      )}
                      {(insp.inspectedAt || insp.reportDate) && (
                        <div><span className="text-gray-500">Reported on:</span> {formatDateTime(insp.inspectedAt || insp.reportDate)}</div>
                      )}
                      {(insp.qtyAccepted != null || insp.qtyRejected != null) && (
                        <div>
                          <span className="text-gray-500">Accept/Reject:</span>{' '}
                          <strong className="text-green-700">{insp.qtyAccepted ?? '—'}</strong>
                          {' / '}
                          <strong className="text-red-700">{insp.qtyRejected ?? 0}</strong>
                          {insp.qtyReceived != null && <span className="text-gray-500"> of {insp.qtyReceived} received</span>}
                        </div>
                      )}
                      {insp.rejectionReason && (
                        <div><span className="text-gray-500">Rejection reason:</span> {insp.rejectionReason}</div>
                      )}
                      {insp.packingCondition && (
                        <div>
                          <span className="text-gray-500">Packing:</span> {insp.packingCondition}
                          {insp.packingDamageNotes && <span className="text-red-700"> — {insp.packingDamageNotes}</span>}
                        </div>
                      )}
                      {insp.dateOfManufacturing && (
                        <div><span className="text-gray-500">Manufactured:</span> {formatDate(insp.dateOfManufacturing)}</div>
                      )}
                      {insp.dateOfExpiry && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500">Expiry:</span>
                          <span>{formatDate(insp.dateOfExpiry)}</span>
                          <ExpiryBadge dateOfExpiry={insp.dateOfExpiry} />
                        </div>
                      )}
                      {insp.remarks && (
                        <div><span className="text-gray-500">Remarks:</span> {insp.remarks}</div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic">QC report not filled yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ProductDetail page ─────────────────────────────────────────────
export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [requoteSource, setRequoteSource] = useState(null);
  const [requoteOpen, setRequoteOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/products/${id}`),
      api.get(`/inventory/batches?productId=${id}`),
    ])
      .then(([productRes, batchesRes]) => {
        setProduct(productRes.data);
        setBatches(batchesRes.data?.batches || []);
      })
      .catch(() => navigate('/products'))
      .finally(() => setLoading(false));
  }, [id]);

  const activeBatches = batches.filter(b => b.remaining > 0);
  const daysOld = (d) => Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24));

  const openRequote = (row) => {
    setRequoteSource(row);
    setRequoteOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) return null;

  const stockPercentage = product.minStockLevel > 0
    ? Math.min(100, (product.currentStock / product.minStockLevel) * 100)
    : 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => navigate('/products')}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
      </div>

      {/* Product Info */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">SKU:</span> <span className="font-medium">{product.sku}</span></div>
            <div><span className="text-gray-500">Category:</span> <span className="font-medium">{product.category || '—'}</span></div>
            <div><span className="text-gray-500">Unit:</span> <span className="font-medium">{product.unit}</span></div>
            {product.description && (
              <div className="col-span-2"><span className="text-gray-500">Description:</span> <span>{product.description}</span></div>
            )}
            {(product.fimBatches || []).length > 0 && (
              <div className="col-span-2">
                <Badge color="blue"><FileInput size={10} className="inline mr-1" /> FIM (Customer Property)</Badge>
                <span className="text-xs text-gray-500 ml-2">
                  Some or all stock of this product is customer-supplied. See "FIM / Gate Pass" tab below.
                </span>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Stock Status</h3>
          <div className="text-center">
            <p className="text-3xl font-bold text-gray-900">{product.currentStock}</p>
            <p className="text-sm text-gray-500">{product.unit}</p>
            {product.minStockLevel > 0 && (
              <>
                <div className="mt-3 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      stockPercentage < 50 ? 'bg-red-500' : stockPercentage < 100 ? 'bg-yellow-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(100, stockPercentage)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Min level: {product.minStockLevel} {product.unit}</p>
              </>
            )}
            {product.maxStockLevel && (
              <p className="text-xs text-gray-400">Max level: {product.maxStockLevel} {product.unit}</p>
            )}
          </div>

          {Array.isArray(product.unitStocks) && product.unitStocks.filter(u => u.quantity > 0).length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Owned by</p>
              <ul className="space-y-1">
                {product.unitStocks.filter(u => u.quantity > 0).map(us => (
                  <li key={us.id} className="text-sm text-gray-700 flex justify-between">
                    <span className="font-medium text-navy-700">{us.unit?.name || us.unit?.code || 'Unit'}</span>
                    <span><strong>{us.quantity}</strong> {product.unit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Tabs */}
      <Card>
        <div className="flex gap-1 border-b -mt-2 mb-4">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'overview' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Layers size={14} className="inline mr-1.5" /> Batches & Movements
          </button>
          {(product.poBatches || []).length > 0 && (
            <button
              onClick={() => setActiveTab('procurement')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === 'procurement' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <GitBranch size={14} className="inline mr-1.5" /> Procurement Chain ({product.poBatches.length})
            </button>
          )}
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'suppliers' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History size={14} className="inline mr-1.5" /> Supplier History
          </button>
          {(product.fimBatches || []).length > 0 && (
            <button
              onClick={() => setActiveTab('fim')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                activeTab === 'fim' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FileInput size={14} className="inline mr-1.5" /> FIM / Gate Pass ({product.fimBatches.length})
            </button>
          )}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* FIFO Batches */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Layers size={16} className="text-navy-700" />
                <h3 className="text-sm font-semibold text-gray-700">FIFO Batches <span className="text-xs font-normal text-gray-400">(oldest first — consumed first on issue)</span></h3>
              </div>
              {batches.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No batch records yet. Newly inwarded stock will appear here.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Received</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Age</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Batch No</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Received Qty</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Remaining</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Expiry</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Origin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map(b => {
                        const age = daysOld(b.receivedDate);
                        const depleted = b.remaining === 0;
                        const partial = b.remaining > 0 && b.remaining < b.quantity;
                        const poBatch = (product.poBatches || []).find(pb => pb.id === b.id);
                        const insp = poBatch?.sourceQcInspection;
                        return (
                          <tr key={b.id} className={`border-b border-gray-50 ${depleted ? 'bg-gray-50 text-gray-400' : ''}`}>
                            <td className="px-3 py-2 text-xs">{formatDate(b.receivedDate)}</td>
                            <td className="px-3 py-2 text-xs">{age}d</td>
                            <td className="px-3 py-2 font-mono text-xs font-semibold text-amber-800">
                              {b.batchNo || <span className="text-gray-400 font-normal">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right">{b.quantity} {product.unit}</td>
                            <td className="px-3 py-2 text-right font-semibold">{b.remaining} {product.unit}</td>
                            <td className="px-3 py-2">
                              {depleted ? <Badge color="gray">Depleted</Badge>
                                : partial ? <Badge color="yellow">Partial</Badge>
                                : <Badge color="green">Full</Badge>}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {insp?.dateOfExpiry
                                ? <ExpiryBadge dateOfExpiry={insp.dateOfExpiry} />
                                : <span className="text-gray-300 italic">—</span>}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {insp?.purchaseOrder ? (
                                <button onClick={() => setActiveTab('procurement')}
                                  className="text-navy-700 hover:underline text-left">
                                  <span className="font-mono">{insp.purchaseOrder.orderNumber}</span>
                                  {insp.lotNumber != null && (
                                    <span className="ml-1 text-amber-700">· Lot {insp.lotNumber}</span>
                                  )}
                                </button>
                              ) : poBatch ? (
                                <span className="text-gray-400 italic">PO (no QC link)</span>
                              ) : (
                                <span className="text-gray-400">{b.isFim ? 'FIM' : 'Direct'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {activeBatches.length > 0 && (
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2 font-semibold text-sm">
                          <td colSpan={4} className="px-3 py-2 text-right">Active total:</td>
                          <td className="px-3 py-2 text-right">{activeBatches.reduce((s, b) => s + b.remaining, 0)} {product.unit}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* Stock Movements */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-4">Stock Movements</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Quantity</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Reference</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.stockMovements?.length === 0 ? (
                      <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">No stock movements</td></tr>
                    ) : (
                      product.stockMovements?.map(m => (
                        <tr key={m.id} className="border-b border-gray-50">
                          <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(m.createdAt)}</td>
                          <td className="px-3 py-2">
                            <Badge color={m.type === 'IN' ? 'green' : m.type === 'OUT' ? 'red' : 'yellow'}>
                              {m.type === 'IN' && <ArrowDown size={10} className="inline mr-1" />}
                              {m.type === 'OUT' && <ArrowUp size={10} className="inline mr-1" />}
                              {m.type}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-gray-700 font-medium">{m.quantity} {product.unit}</td>
                          <td className="px-3 py-2 text-gray-600">{m.referenceType || '—'}</td>
                          <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate" title={formatNotes(m.notes)}>{formatNotes(m.notes)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'procurement' && (
          <ProcurementChainTab
            product={product}
            isStores={user?.role === 'STORE_MANAGER' || user?.role === 'ADMIN'}
          />
        )}

        {activeTab === 'suppliers' && (
          <SupplierHistoryTab product={product} onRequote={openRequote} />
        )}

        {activeTab === 'fim' && <FimTab product={product} />}
      </Card>

      <QuickRequoteModal
        isOpen={requoteOpen}
        onClose={() => setRequoteOpen(false)}
        product={product}
        source={requoteSource}
        onCreated={() => { /* could reload supplier-history; cheap to do nothing */ }}
      />
    </div>
  );
}
