import { useState, useEffect } from 'react';
import { Plus, PackageCheck, X, Scissors } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import { formatDateTime } from '../utils/formatters';

export default function MyRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [notes, setNotes] = useState('');
  const [remarks, setRemarks] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [saving, setSaving] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectModal, setCollectModal] = useState(null); // { request, rows: [{id, productName, unit, approved, alreadyTaken, remaining, take}] }

  const fetchRequests = () => {
    setLoading(true);
    api.get('/requests', { params: { limit: 50 } })
      .then(({ data }) => setRequests(data.requests))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRequests(); }, []);

  const openCreate = () => {
    api.get('/products', { params: { limit: 'all' } }).then(({ data }) => setProducts(data.products));
    setCartItems([]);
    setNotes('');
    setRemarks('');
    setReferenceNo('');
    setShowCreate(true);
  };

  const addToCart = (product) => {
    if (cartItems.find(i => i.productId === product.id)) return;
    setCartItems([...cartItems, { productId: product.id, product, quantity: 1, purpose: '' }]);
  };

  const removeFromCart = (productId) => {
    setCartItems(cartItems.filter(i => i.productId !== productId));
  };

  const updateQty = (productId, qty) => {
    setCartItems(cartItems.map(i => i.productId === productId ? { ...i, quantity: Math.max(1, parseInt(qty) || 1) } : i));
  };

  const updatePurpose = (productId, purpose) => {
    setCartItems(cartItems.map(i => i.productId === productId ? { ...i, purpose } : i));
  };

  const submitRequest = async () => {
    if (cartItems.length === 0) return alert('Add at least one product');
    setSaving(true);
    try {
      await api.post('/requests', {
        notes: notes || undefined,
        remarks: remarks || undefined,
        referenceNo: referenceNo || undefined,
        items: cartItems.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          purpose: i.purpose || undefined,
        })),
      });
      setShowCreate(false);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create request');
    }
    setSaving(false);
  };

  const openCollectModal = (request) => {
    const rows = (request.items || [])
      .map((it) => {
        const approved = it.approvedQty ?? it.quantity ?? 0;
        const alreadyTaken = it.collectedQty || 0;
        const remaining = Math.max(0, approved - alreadyTaken);
        return {
          id: it.id,
          productName: it.product?.name || '',
          unit: it.product?.unit || '',
          approved,
          alreadyTaken,
          remaining,
          take: remaining, // default: take everything remaining
        };
      })
      .filter((r) => r.remaining > 0);
    if (rows.length === 0) return alert('Nothing remaining to collect.');
    setCollectModal({ request, rows });
  };

  const updateCollectTake = (itemId, value) => {
    setCollectModal((m) => ({
      ...m,
      rows: m.rows.map((r) => {
        if (r.id !== itemId) return r;
        const n = Math.max(0, Math.min(r.remaining, parseFloat(value) || 0));
        return { ...r, take: n };
      }),
    }));
  };

  const submitCollect = async () => {
    if (!collectModal) return;
    const items = collectModal.rows
      .filter((r) => r.take > 0)
      .map((r) => ({ id: r.id, collectedQty: r.take }));
    if (items.length === 0) return alert('Enter qty > 0 for at least one item.');
    setCollecting(true);
    try {
      await api.put(`/requests/${collectModal.request.id}/collect`, { items });
      setCollectModal(null);
      setShowDetail(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to collect');
    }
    setCollecting(false);
  };

  const killRemaining = async (requestId) => {
    if (!confirm('Close this request without collecting the remaining qty? The remaining reserved stock will be released.')) return;
    try {
      await api.put(`/requests/${requestId}/kill-remaining`);
      setShowDetail(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to close');
    }
  };

  const cancelRequest = async (requestId) => {
    if (!confirm('Cancel this request?')) return;
    try {
      await api.put(`/requests/${requestId}/cancel`);
      setShowDetail(null);
      fetchRequests();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to cancel');
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  const statusColor = (s) => ({
    PENDING: 'yellow', APPROVED: 'green', PARTIAL: 'orange', COLLECTED: 'blue', REJECTED: 'red', CANCELLED: 'gray'
  }[s] || 'gray');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">My Requests</h1>
        <Button onClick={openCreate}><Plus size={16} /> New Request</Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : requests.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>No requests yet. Create your first product request!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Request #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Items</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Notes</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-navy-700 cursor-pointer" onClick={() => setShowDetail(r)}>{r.requestNumber}</td>
                    <td className="px-3 py-2 text-gray-600">{r.items?.length} item(s)</td>
                    <td className="px-3 py-2"><Badge color={statusColor(r.status)}>{r.status}</Badge></td>
                    <td className="px-3 py-2 text-gray-600 max-w-48 truncate">{r.notes || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setShowDetail(r)}>View</Button>
                        {(r.status === 'APPROVED' || r.status === 'PARTIAL') && (
                          <Button size="sm" onClick={() => openCollectModal(r)}>
                            {r.status === 'PARTIAL' ? 'Collect More' : 'Collect'}
                          </Button>
                        )}
                        {r.status === 'PARTIAL' && (
                          <Button size="sm" variant="secondary" onClick={() => killRemaining(r.id)}>
                            <Scissors size={14} className="mr-1" /> Close
                          </Button>
                        )}
                        {r.status === 'PENDING' && (
                          <Button size="sm" variant="danger" onClick={() => cancelRequest(r.id)}>Cancel</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Request Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Product Request" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Search Products</label>
            <SearchBar value={productSearch} onChange={setProductSearch} placeholder="Search by name or SKU..." />
          </div>

          {/* Product list */}
          <div className="max-h-48 overflow-y-auto border rounded-md">
            {filteredProducts.map(p => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <div>
                  <span className="text-sm font-medium text-gray-700">{p.name}</span>
                  <span className="text-xs text-gray-400 ml-2">({p.currentStock} {p.unit} available)</span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => addToCart(p)} disabled={cartItems.find(i => i.productId === p.id)}>
                  {cartItems.find(i => i.productId === p.id) ? 'Added' : 'Add'}
                </Button>
              </div>
            ))}
            {filteredProducts.length === 0 && <p className="px-3 py-4 text-center text-gray-400 text-sm">No products found</p>}
          </div>

          {/* Cart */}
          {cartItems.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Selected Items ({cartItems.length})</h4>
              <div className="space-y-2">
                {cartItems.map(item => (
                  <div key={item.productId} className="bg-gray-50 rounded-md p-2 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-1">
                        <span className="text-sm font-medium">{item.product.name}</span>
                        <span className="text-xs text-gray-400 ml-1">({item.product.currentStock} {item.product.unit} available)</span>
                      </div>
                      <Input
                        type="number" min={1} value={item.quantity}
                        onChange={(e) => updateQty(item.productId, e.target.value)}
                        className="w-20 text-center"
                      />
                      <span className="text-xs text-gray-500">{item.product.unit}</span>
                      <button onClick={() => removeFromCart(item.productId)} className="text-gray-400 hover:text-red-500">
                        <X size={16} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={item.purpose || ''}
                      onChange={(e) => updatePurpose(item.productId, e.target.value)}
                      placeholder="Purpose (optional)"
                      className="w-full px-2 py-1 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-navy-500 focus:border-navy-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Reference No. & Date"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder="e.g. REF/2025/001"
            />
            <Input
              label="Remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Any remarks..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
              rows={2} placeholder="Reason for request..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={submitRequest} disabled={saving || cartItems.length === 0}>
              {saving ? 'Submitting...' : `Submit Request (${cartItems.length} items)`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Request Detail Modal */}
      <Modal isOpen={!!showDetail} onClose={() => setShowDetail(null)} title={`Request ${showDetail?.requestNumber}`} size="lg">
        {showDetail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Status:</span> <Badge color={statusColor(showDetail.status)}>{showDetail.status}</Badge></div>
              <div><span className="text-gray-500">Unit:</span> <span className="font-medium">{showDetail.unit?.name}</span></div>
              <div><span className="text-gray-500">Created:</span> <span>{formatDateTime(showDetail.createdAt)}</span></div>
              {showDetail.referenceNo && <div><span className="text-gray-500">Reference No:</span> <span className="font-medium">{showDetail.referenceNo}</span></div>}
              {showDetail.mirNo && <div><span className="text-gray-500">MIR No:</span> <span className="font-medium">{showDetail.mirNo}</span></div>}
              {showDetail.issueNo && <div><span className="text-gray-500">Issue No:</span> <span className="font-medium">{showDetail.issueNo}</span></div>}
              {showDetail.issueDate && <div><span className="text-gray-500">Issue Date:</span> <span>{formatDateTime(showDetail.issueDate)}</span></div>}
              {showDetail.clearedAt && <div><span className="text-gray-500">Cleared:</span> <span>{formatDateTime(showDetail.clearedAt)}</span></div>}
              {showDetail.collectedAt && <div><span className="text-gray-500">Collected:</span> <span>{formatDateTime(showDetail.collectedAt)}</span></div>}
            </div>

            {showDetail.notes && (
              <div className="bg-gray-50 rounded-md p-3 text-sm">
                <span className="text-gray-500">Your Notes:</span> <span>{showDetail.notes}</span>
              </div>
            )}
            {showDetail.remarks && (
              <div className="bg-gray-50 rounded-md p-3 text-sm">
                <span className="text-gray-500">Remarks:</span> <span>{showDetail.remarks}</span>
              </div>
            )}
            {showDetail.clearanceNotes && (
              <div className="bg-blue-50 rounded-md p-3 text-sm">
                <span className="text-blue-600">Clearance Notes:</span> <span>{showDetail.clearanceNotes}</span>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Items</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Purpose</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Requested</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Collected</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Remaining</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Batch No.</th>
                  </tr>
                </thead>
                <tbody>
                  {showDetail.items?.map(item => {
                    const approved = item.approvedQty ?? item.quantity ?? 0;
                    const collected = item.collectedQty || 0;
                    const remaining = Math.max(0, approved - collected);
                    return (
                      <tr key={item.id} className="border-b border-gray-50">
                        <td className="px-3 py-2 text-gray-700">{item.product?.name}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{item.purpose || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{item.quantity} {item.product?.unit}</td>
                        <td className="px-3 py-2 text-gray-600">
                          {item.approvedQty != null ? `${item.approvedQty} ${item.product?.unit}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{collected} {item.product?.unit}</td>
                        <td className={`px-3 py-2 ${remaining > 0 && showDetail.status === 'PARTIAL' ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>
                          {remaining} {item.product?.unit}
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{item.materialBatchNo || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              {(showDetail.status === 'APPROVED' || showDetail.status === 'PARTIAL') && (
                <Button onClick={() => openCollectModal(showDetail)} disabled={collecting}>
                  <PackageCheck size={16} className="mr-1" />
                  {showDetail.status === 'PARTIAL' ? 'Collect More' : 'Collect'}
                </Button>
              )}
              {showDetail.status === 'PARTIAL' && (
                <Button variant="secondary" onClick={() => killRemaining(showDetail.id)}>
                  <Scissors size={16} className="mr-1" /> Close without remaining
                </Button>
              )}
              {showDetail.status === 'PENDING' && (
                <Button variant="danger" onClick={() => cancelRequest(showDetail.id)}>Cancel Request</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Partial / Full Collect Modal */}
      <Modal
        isOpen={!!collectModal}
        onClose={() => setCollectModal(null)}
        title={`Collect items — ${collectModal?.request.requestNumber || ''}`}
        size="lg"
      >
        {collectModal && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter the quantity you are taking now. Leave at the remaining value to collect fully, or reduce for partial.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Approved</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Already taken</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Remaining</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Take now</th>
                  </tr>
                </thead>
                <tbody>
                  {collectModal.rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-700">{r.productName}</td>
                      <td className="px-3 py-2 text-gray-600">{r.approved} {r.unit}</td>
                      <td className="px-3 py-2 text-gray-600">{r.alreadyTaken} {r.unit}</td>
                      <td className="px-3 py-2 text-gray-600">{r.remaining} {r.unit}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={r.remaining}
                          step="any"
                          value={r.take}
                          onChange={(e) => updateCollectTake(r.id, e.target.value)}
                          className="w-24"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setCollectModal(null)}>Cancel</Button>
              <Button onClick={submitCollect} disabled={collecting}>
                <PackageCheck size={16} className="mr-1" /> {collecting ? 'Recording...' : 'Record collection'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
