import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, Layers, History, Send, ShoppingBag, FileQuestion } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { formatDate, formatDateTime, formatNotes } from '../utils/formatters';

const formatCurrency = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

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
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === 'suppliers' ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <History size={14} className="inline mr-1.5" /> Supplier History
          </button>
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
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map(b => {
                        const age = daysOld(b.receivedDate);
                        const depleted = b.remaining === 0;
                        const partial = b.remaining > 0 && b.remaining < b.quantity;
                        return (
                          <tr key={b.id} className={`border-b border-gray-50 ${depleted ? 'bg-gray-50 text-gray-400' : ''}`}>
                            <td className="px-3 py-2 text-xs">{formatDate(b.receivedDate)}</td>
                            <td className="px-3 py-2 text-xs">{age}d</td>
                            <td className="px-3 py-2 font-mono text-xs">{b.batchNo || <span className="text-gray-400">—</span>}</td>
                            <td className="px-3 py-2 text-right">{b.quantity} {product.unit}</td>
                            <td className="px-3 py-2 text-right font-semibold">{b.remaining} {product.unit}</td>
                            <td className="px-3 py-2">
                              {depleted ? <Badge color="gray">Depleted</Badge>
                                : partial ? <Badge color="yellow">Partial</Badge>
                                : <Badge color="green">Full</Badge>}
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
                          <td />
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

        {activeTab === 'suppliers' && (
          <SupplierHistoryTab product={product} onRequote={openRequote} />
        )}
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
