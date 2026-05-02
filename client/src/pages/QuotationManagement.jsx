import { useState, useEffect } from 'react';
import { Plus, Send, CheckCircle, Trash2, Eye, FileText, X } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';

const formatCurrency = (amt) => `₹${Number(amt).toLocaleString('en-IN')}`;

// ─── Add Quotation Modal ───
function AddQuotationModal({ isOpen, onClose, purchaseRequest, onCreated }) {
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [supplierSuggestions, setSupplierSuggestions] = useState([]);

  useEffect(() => {
    if (isOpen && purchaseRequest) {
      setNotes('');
      // Pre-fill items from PR items
      const prItems = purchaseRequest.items?.map(i => ({
        productName: i.productName,
        productUnit: i.productUnit || 'pcs',
        quantity: i.adminApprovedQty || i.requestedQty,
        unitPrice: 0,
        supplierName: '',
        supplierContact: '',
        supplierAddress: '',
      })) || [{ productName: '', productUnit: 'pcs', quantity: 1, unitPrice: 0, supplierName: '', supplierContact: '', supplierAddress: '' }];
      setItems(prItems);

      // Fetch supplier history — map supplier → usage count/contact, matched by product name
      api.get('/quotations', { params: { limit: 200 } })
        .then(({ data }) => {
          const productNames = new Set(prItems.map(i => i.productName.toLowerCase().trim()).filter(Boolean));
          const byName = new Map();
          for (const q of data.quotations || []) {
            for (const it of q.items || []) {
              const supplier = (it.supplierName || q.supplierName || '').trim();
              if (!supplier) continue;
              if (productNames.size && !productNames.has((it.productName || '').toLowerCase().trim())) continue;
              const key = supplier.toLowerCase();
              const existing = byName.get(key) || { supplierName: supplier, contact: '', address: '', products: new Set(), lastUsedAt: q.createdAt, count: 0, selected: false };
              existing.contact = existing.contact || it.supplierContact || q.supplierContact || '';
              existing.address = existing.address || it.supplierAddress || q.supplierAddress || '';
              existing.products.add(it.productName);
              existing.count += 1;
              if (q.isSelected) existing.selected = true;
              if (new Date(q.createdAt) > new Date(existing.lastUsedAt)) existing.lastUsedAt = q.createdAt;
              byName.set(key, existing);
            }
          }
          const list = [...byName.values()]
            .map(s => ({ ...s, products: [...s.products] }))
            .sort((a, b) => new Date(b.lastUsedAt) - new Date(a.lastUsedAt));
          setSupplierSuggestions(list);
        })
        .catch(() => setSupplierSuggestions([]));
    }
  }, [isOpen, purchaseRequest]);

  const applySupplierToRow = (idx, s) => {
    const updated = [...items];
    updated[idx] = {
      ...updated[idx],
      supplierName: s.supplierName,
      supplierContact: updated[idx].supplierContact || s.contact || '',
      supplierAddress: updated[idx].supplierAddress || s.address || '',
    };
    setItems(updated);
  };

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  const addItem = () => setItems([...items, { productName: '', productUnit: 'pcs', quantity: 1, unitPrice: 0, supplierName: '', supplierContact: '', supplierAddress: '' }]);
  const removeItem = (idx) => items.length > 1 && setItems(items.filter((_, i) => i !== idx));

  const totalAmount = items.reduce((sum, i) => sum + (i.quantity * i.unitPrice), 0);
  const uniqueSuppliers = [...new Set(items.map(i => (i.supplierName || '').trim()).filter(Boolean))];

  const submit = async () => {
    const validItems = items.filter(i => i.productName.trim() && i.unitPrice > 0);
    if (validItems.length === 0) return alert('At least one item with pricing is required');
    const missingSupplier = validItems.find(i => !i.supplierName.trim());
    if (missingSupplier) return alert(`Supplier is required for every item (missing for "${missingSupplier.productName}")`);

    setSaving(true);
    try {
      await api.post('/quotations', {
        purchaseRequestId: purchaseRequest.id,
        notes: notes || undefined,
        items: validItems.map(i => ({
          productName: i.productName.trim(),
          productUnit: i.productUnit,
          quantity: parseFloat(i.quantity) || 1,
          unitPrice: parseFloat(i.unitPrice) || 0,
          supplierName: i.supplierName.trim(),
          supplierContact: i.supplierContact?.trim() || undefined,
          supplierAddress: i.supplierAddress?.trim() || undefined,
        })),
      });
      onClose();
      onCreated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create quotation');
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

        {supplierSuggestions.length > 0 && (
          <details className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <summary className="text-xs font-semibold text-amber-900 cursor-pointer">
              Previously used suppliers ({supplierSuggestions.length}) — click a pill, then click a product row to apply
            </summary>
            <p className="text-[11px] text-amber-800 mt-2 mb-2">Tip: paste a supplier into any row directly, or click to copy to the focused row.</p>
            <div className="flex flex-wrap gap-2">
              {supplierSuggestions.slice(0, 12).map(s => (
                <span
                  key={s.supplierName}
                  className="text-xs px-3 py-1.5 rounded-md border border-amber-300 bg-white text-amber-900"
                  title={`Products: ${s.products.join(', ')}${s.contact ? '\nContact: ' + s.contact : ''}`}
                >
                  <span className="font-medium">{s.supplierName}</span>
                  {s.selected && <span className="ml-1 text-green-600">✓</span>}
                  <span className="ml-1 text-gray-500">({s.count})</span>
                </span>
              ))}
            </div>
          </details>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Items, Suppliers & Pricing</h4>
            <button onClick={addItem} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
              <Plus size={12} /> Add Item
            </button>
          </div>
          <div className="overflow-x-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b">
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Product</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Unit</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Qty</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Unit Price (₹)</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Supplier *</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Contact</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Address</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-600">Total</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100 hover:bg-amber-50/30">
                    <td className="px-2 py-1">
                      <input value={item.productName} onChange={(e) => updateItem(idx, 'productName', e.target.value)}
                        className="w-40 px-2 py-1 border rounded text-sm" placeholder="Product name" />
                    </td>
                    <td className="px-2 py-1">
                      <input value={item.productUnit} onChange={(e) => updateItem(idx, 'productUnit', e.target.value)}
                        className="w-16 px-2 py-1 border rounded text-sm" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                        className="w-20 px-2 py-1 border rounded text-sm" min="0.01" step="0.01" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                        className="w-24 px-2 py-1 border rounded text-sm" min="0" step="0.01" />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        list={`supplier-options-${idx}`}
                        value={item.supplierName}
                        onChange={(e) => {
                          updateItem(idx, 'supplierName', e.target.value);
                          const match = supplierSuggestions.find(s => s.supplierName.toLowerCase() === e.target.value.toLowerCase());
                          if (match) applySupplierToRow(idx, match);
                        }}
                        className="w-40 px-2 py-1 border rounded text-sm"
                        placeholder="Supplier name"
                      />
                      <datalist id={`supplier-options-${idx}`}>
                        {supplierSuggestions.map(s => (
                          <option key={s.supplierName} value={s.supplierName} />
                        ))}
                      </datalist>
                    </td>
                    <td className="px-2 py-1">
                      <input value={item.supplierContact} onChange={(e) => updateItem(idx, 'supplierContact', e.target.value)}
                        className="w-32 px-2 py-1 border rounded text-sm" placeholder="Phone/Email" />
                    </td>
                    <td className="px-2 py-1">
                      <input value={item.supplierAddress} onChange={(e) => updateItem(idx, 'supplierAddress', e.target.value)}
                        className="w-40 px-2 py-1 border rounded text-sm" placeholder="Address" />
                    </td>
                    <td className="px-2 py-1 text-gray-700 font-medium whitespace-nowrap">
                      {formatCurrency((item.quantity || 0) * (item.unitPrice || 0))}
                    </td>
                    <td className="px-2 py-1">
                      {items.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

// ─── Review Quotations Modal (ADMIN approver only) ───
function ReviewQuotationsModal({ purchaseRequest, onClose, onUpdated, isApprover }) {
  const [quotations, setQuotations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (purchaseRequest) {
      setLoading(true);
      api.get('/quotations', { params: { purchaseRequestId: purchaseRequest.id, limit: 50 } })
        .then(({ data }) => setQuotations(data.quotations))
        .catch(console.error)
        .finally(() => setLoading(false));
      setSelectedId(null);
    }
  }, [purchaseRequest]);

  const selectQuotation = async () => {
    if (!selectedId) return alert('Select a quotation first');

    setProcessing(true);
    try {
      await api.put(`/quotations/${selectedId}/select`);
      onClose();
      onUpdated();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to approve quotation');
    }
    setProcessing(false);
  };

  // Count unique suppliers for selected quotation
  const selectedQuotation = quotations.find(q => q.id === selectedId);
  const selectedSuppliers = selectedQuotation
    ? [...new Set(selectedQuotation.items.map(i => (i.supplierName || '').trim().toLowerCase()).filter(Boolean))]
    : [];

  if (!purchaseRequest) return null;

  return (
    <Modal isOpen={!!purchaseRequest} onClose={onClose} title={`Review Quotations — ${purchaseRequest.requestNumber}`} size="xl">
      <div className="space-y-4">
        {purchaseRequest.requestId && (
          <div className="bg-navy-50 border border-navy-200 rounded-md p-3">
            <div className="text-xs uppercase tracking-wide text-navy-600 font-medium">Order Name (set by manager)</div>
            <div className="text-xl font-bold text-navy-700">{purchaseRequest.requestId}</div>
          </div>
        )}
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
                      <h4 className="font-semibold text-gray-900">{q.quotationNumber}</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {suppliers.length} supplier{suppliers.length !== 1 ? 's' : ''}: {suppliers.join(', ')}
                      </p>
                      {q.notes && <p className="text-xs text-gray-400 mt-1">Notes: {q.notes}</p>}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-navy-700">{formatCurrency(q.totalAmount)}</p>
                      <p className="text-xs text-gray-400">by {q.createdBy?.name}</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto border rounded-md">
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
                        {q.items.map(item => (
                          <tr key={item.id} className="border-b border-gray-50 hover:bg-amber-50/30">
                            <td className="px-2 py-1.5">{item.productName}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap">{item.quantity} {item.productUnit}</td>
                            <td className="px-2 py-1.5">{formatCurrency(item.unitPrice)}</td>
                            <td className="px-2 py-1.5 font-medium text-gray-800">{item.supplierName || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-500">{item.supplierContact || '—'}</td>
                            <td className="px-2 py-1.5 font-medium">{formatCurrency(item.totalPrice)}</td>
                          </tr>
                        ))}
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
            <div className="text-xs text-gray-500">
              {selectedSuppliers.length > 1 ? (
                <>Approving will create <span className="font-semibold text-navy-700">{selectedSuppliers.length} Purchase Orders</span> (one per supplier) all named <span className="font-semibold text-navy-700">"{purchaseRequest.requestId}"</span>.</>
              ) : (
                <>The selected quotation will create a Purchase Order named <span className="font-semibold text-navy-700">"{purchaseRequest.requestId}"</span> (the manager's order name).</>
              )}{' '}
              Purchase will then place the order(s) with accounting.
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={selectQuotation} disabled={processing || !selectedId}>
                <CheckCircle size={16} className="mr-1" /> {processing ? 'Processing...' : `Approve & Create ${selectedSuppliers.length > 1 ? selectedSuppliers.length + ' Orders' : 'Order'}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
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

  const isPO = user?.role === 'PURCHASE_OFFICER';
  const isApprover = user?.role === 'ADMIN';

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get PRs in relevant statuses
      const { data } = await api.get('/purchase-requests', { params: { limit: 100 } });
      const approved = data.requests.filter(r => r.status === 'APPROVED');
      const submitted = data.requests.filter(r => r.status === 'QUOTATION_SUBMITTED');
      setApprovedPRs(approved);
      setSubmittedPRs(submitted);

      // Get quotation counts for each PR
      const counts = {};
      const allPRs = [...approved, ...submitted];
      for (const pr of allPRs) {
        if (pr.quotations) {
          counts[pr.id] = pr.quotations.length;
        }
      }
      setQuotationCounts(counts);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Quotation Management</h1>

      {/* PO: Approved PRs needing quotations */}
      {isPO && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Approved PRs — Add Quotations</h2>
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
                        <td className="px-3 py-2 font-medium text-navy-700">{pr.requestNumber}</td>
                        <td className="px-3 py-2 text-gray-600">{pr.manager?.name}</td>
                        <td className="px-3 py-2"><Badge color="blue">{pr.unit?.code}</Badge></td>
                        <td className="px-3 py-2 text-gray-600">{pr.items?.length}</td>
                        <td className="px-3 py-2">
                          <Badge color={quotationCounts[pr.id] > 0 ? 'green' : 'gray'}>
                            {quotationCounts[pr.id] || 0} added
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(pr.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => setShowAddQuotation(pr)}>
                              <Plus size={14} className="mr-1" /> Add Quote
                            </Button>
                            {(quotationCounts[pr.id] || 0) > 0 && (
                              <Button size="sm" variant="primary" onClick={async () => {
                                if (!confirm(`Submit ${quotationCounts[pr.id]} quotation(s) to admin for approval?`)) return;
                                try {
                                  await api.post(`/quotations/submit/${pr.id}`);
                                  alert('Quotations submitted to admin for approval.');
                                  fetchData();
                                } catch (err) {
                                  alert(err.response?.data?.error || 'Failed to submit');
                                }
                              }}>
                                <Send size={14} className="mr-1" /> Submit to Admin
                              </Button>
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
        </div>
      )}

      {/* Approver: Submitted quotations for review */}
      {(isApprover || isPO) && (
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-3">
            {isApprover ? 'Quotations Awaiting Your Approval' : 'Submitted — Awaiting Approval'}
          </h2>
          <Card>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : submittedPRs.length === 0 ? (
              <p className="text-center text-gray-400 py-6">No quotations awaiting approval.</p>
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
                    {submittedPRs.map(pr => {
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
                              <Eye size={14} className="mr-1" /> {isApprover ? 'Review & Approve' : 'View'}
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
      />
    </div>
  );
}
