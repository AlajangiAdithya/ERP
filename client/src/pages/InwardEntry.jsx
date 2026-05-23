import { useState, useEffect } from 'react';
import { Check, Package, ClipboardList, Truck, Plus, FileInput } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import SearchBar from '../components/shared/SearchBar';
import { formatDate, formatDateTime } from '../utils/formatters';
import InwardPdf from '../components/pdf/InwardPdf';
import DownloadPdfButton from '../components/pdf/DownloadPdfButton';

export default function InwardEntry() {
  const [mode, setMode] = useState('po');
  const [success, setSuccess] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onSuccess = (msg) => {
    setSuccess(msg);
    setRefreshKey(k => k + 1);
    setTimeout(() => setSuccess(null), 8000);
  };

  const tabBtn = (key, label, Icon) => (
    <button onClick={() => setMode(key)}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
        mode === key ? 'border-navy-700 text-navy-700' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}>
      <Icon size={16} className="inline mr-2" />{label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inward Entry</h1>
        <p className="text-sm text-gray-500">Record materials received into stores.</p>
      </div>

      {success && (
        <Card className="border-green-200 bg-green-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
              <Check size={20} className="text-green-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-green-800">{success.title}</p>
              <p className="text-sm text-green-600">{success.message}</p>
            </div>
            {success.pdfData && (
              <DownloadPdfButton
                document={<InwardPdf data={success.pdfData} />}
                fileName={`MIV-${success.pdfData.mivNumber || new Date().toISOString().slice(0, 10)}.pdf`}
                label="Download MIV PDF"
              />
            )}
          </div>
        </Card>
      )}

      <div className="flex gap-2 border-b border-gray-200">
        {tabBtn('po', 'From Purchase Order', Truck)}
        {tabBtn('direct', 'Direct Entry', ClipboardList)}
        {tabBtn('gatepass', 'From Gate Pass (FIM)', FileInput)}
      </div>

      {mode === 'po' && <FromPOMode onSuccess={onSuccess} refreshKey={refreshKey} />}
      {mode === 'direct' && <DirectEntryMode onSuccess={onSuccess} />}
      {mode === 'gatepass' && <FromGatePassMode onSuccess={onSuccess} refreshKey={refreshKey} />}
    </div>
  );
}

// ─── From PO Mode ───
function FromPOMode({ onSuccess, refreshKey }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);

  useEffect(() => {
    setLoading(true);
    api.get('/purchase-orders', { params: { status: 'QC_PASSED', limit: 100 } })
      .then(({ data }) => setOrders(data.orders || []))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (selectedOrder) {
    return (
      <POInwardForm
        order={selectedOrder}
        onCancel={() => setSelectedOrder(null)}
        onComplete={(msg) => { setSelectedOrder(null); onSuccess(msg); }}
      />
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-800 mb-3">QC-Passed Orders Pending Inward</h3>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : orders.length === 0 ? (
        <Card className="text-center text-gray-500 py-8">
          No QC-passed orders waiting for inward entry.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {orders.map(o => (
            <Card key={o.id} className="cursor-pointer hover:border-navy-400 hover:shadow-md transition-all border border-gray-200"
              onClick={() => setSelectedOrder(o)}>
              <div className="flex items-start justify-between mb-2">
                <h4 className="font-semibold text-navy-700">{o.customName}</h4>
                <Badge color="green">QC Passed</Badge>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                <div><span className="text-gray-500">Order:</span> {o.orderNumber}</div>
                <div><span className="text-gray-500">Supplier:</span> {o.supplierName}</div>
                <div><span className="text-gray-500">PR:</span> {o.purchaseRequest?.requestNumber}</div>
                <div>
                  <span className="text-gray-500">Total Qty:</span>{' '}
                  {o.items?.reduce((s, i) => s + (i.quantity || 0), 0) || 0}
                  {' '}across {o.items?.length || 0} item(s)
                </div>
                {o.goodsArrivedAt && (
                  <div><span className="text-gray-500">Arrived:</span> {formatDateTime(o.goodsArrivedAt)}</div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function POInwardForm({ order, onCancel, onComplete }) {
  // Pull latest QC inspection (qcInspections come sorted desc from API)
  const latestInspection = (order.qcInspections || []).find(
    i => i.result === 'PASSED' || i.result === 'PARTIAL'
  );
  const qcAccepted = latestInspection?.qtyAccepted;
  const qcOrdered = latestInspection?.qtyOrdered;
  const totalOrderedQty = (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
  // Ratio of accepted to ordered — used to distribute accepted qty across items proportionally
  const acceptRatio = (qcAccepted != null && qcOrdered > 0)
    ? (qcAccepted / qcOrdered)
    : (qcAccepted != null && totalOrderedQty > 0)
      ? (qcAccepted / totalOrderedQty)
      : null;

  const [items, setItems] = useState(
    (order.items || []).map(i => {
      const prefill = acceptRatio != null
        ? Math.round(i.quantity * acceptRatio * 100) / 100
        : i.quantity;
      return {
        id: i.id,
        productName: i.productName,
        quantity: i.quantity,
        productUnit: i.productUnit,
        receivedQty: prefill,
        batchNumber: '',
      };
    })
  );
  const [saving, setSaving] = useState(false);
  const totalAllowed = qcAccepted != null ? qcAccepted : totalOrderedQty;

  const updateItem = (idx, field, value) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [field]: value };
    setItems(copy);
  };

  const submit = async () => {
    if (items.some(i => !i.receivedQty || parseFloat(i.receivedQty) <= 0)) {
      return alert('Enter received quantity for all items');
    }
    if (items.some(i => parseFloat(i.receivedQty) > i.quantity)) {
      return alert('Received qty cannot exceed ordered qty for any item');
    }
    if (qcAccepted != null) {
      const totalReceiving = items.reduce((s, i) => s + parseFloat(i.receivedQty || 0), 0);
      if (totalReceiving > qcAccepted + 0.001) {
        return alert(`Total inward qty (${totalReceiving}) cannot exceed QC-accepted qty (${qcAccepted}). Only QC-accepted material can be entered into stores.`);
      }
    }
    setSaving(true);
    try {
      await api.put(`/purchase-orders/${order.id}/inward`, {
        items: items.map(i => ({
          id: i.id,
          receivedQty: parseFloat(i.receivedQty),
          batchNumber: i.batchNumber || undefined,
        })),
      });
      onComplete({
        title: 'Inward entry recorded',
        message: `${order.customName} (${order.orderNumber}) marked as INWARD_DONE.`,
        pdfData: {
          mivNumber: `MIV-${order.orderNumber}`,
          date: new Date().toISOString(),
          supplierName: order.supplierName,
          orderNumber: order.orderNumber,
          prNumber: order.purchaseRequest?.requestNumber,
          customName: order.customName,
          items: items.map(i => ({
            productName: i.productName,
            orderedQty: i.quantity,
            receivedQty: parseFloat(i.receivedQty),
            productUnit: i.productUnit,
            batchNumber: i.batchNumber,
          })),
        },
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record inward');
    }
    setSaving(false);
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-navy-700">{order.customName}</h3>
          <p className="text-xs text-gray-500">
            Order: {order.orderNumber} • Supplier: {order.supplierName} • PR: {order.purchaseRequest?.requestNumber}
          </p>
        </div>
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
      </div>

      {latestInspection && qcAccepted != null && (
        <div className={`mb-3 rounded-md border p-3 text-xs ${
          qcAccepted < qcOrdered
            ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
            : 'bg-green-50 border-green-300 text-green-800'
        }`}>
          <strong>QC Report ({latestInspection.inspectionNumber}):</strong>{' '}
          Received <strong>{latestInspection.qtyReceived ?? '—'}</strong>,{' '}
          Accepted <strong>{qcAccepted}</strong>,{' '}
          Rejected <strong>{latestInspection.qtyRejected ?? 0}</strong>.
          {qcAccepted < qcOrdered
            ? ' Only the QC-accepted quantity has been pre-filled below for inward entry.'
            : ' Full ordered quantity accepted by QC.'}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-300">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Product</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Ordered</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Received *</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">Batch No.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id} className="border-b border-gray-100">
                <td className="px-3 py-2 font-medium text-gray-700">{it.productName}</td>
                <td className="px-3 py-2 text-gray-600">{it.quantity} {it.productUnit}</td>
                <td className="px-3 py-2">
                  <input type="number" value={it.receivedQty} min="0" step="any"
                    onChange={(e) => updateItem(idx, 'receivedQty', e.target.value)}
                    className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" />
                  <span className="ml-1 text-xs text-gray-500">{it.productUnit}</span>
                </td>
                <td className="px-3 py-2">
                  <input type="text" value={it.batchNumber}
                    onChange={(e) => updateItem(idx, 'batchNumber', e.target.value)}
                    placeholder="Batch"
                    className="w-32 px-2 py-1 border border-gray-300 rounded text-sm" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Record Inward Entry'}
        </Button>
      </div>
    </Card>
  );
}

// ─── Direct Entry Mode ───
function DirectEntryMode({ onSuccess }) {
  const [subMode, setSubMode] = useState('existing');

  const subBtn = (key, label, Icon) => (
    <button onClick={() => setSubMode(key)}
      className={`px-3 py-1.5 text-sm rounded-md border transition-colors inline-flex items-center ${
        subMode === key ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      }`}>
      <Icon size={14} className="mr-1" />{label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {subBtn('existing', 'Existing Product', Package)}
        {subBtn('new', 'New Product', Plus)}
      </div>

      {subMode === 'existing' && <ExistingProductForm onSuccess={onSuccess} />}
      {subMode === 'new' && <NewProductForm onSuccess={onSuccess} />}
    </div>
  );
}

function ExistingProductForm({ onSuccess }) {
  const [products, setProducts] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState({ productId: '', quantity: '', batchNumber: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const loadProducts = () =>
    api.get('/products', { params: { limit: 'all' } }).then(({ data }) => setProducts(data.products));

  useEffect(() => { loadProducts(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.productId || !form.quantity) return;
    setSaving(true);
    try {
      const { data } = await api.post('/inventory/inward', {
        productId: form.productId,
        quantity: parseFloat(form.quantity),
        batchNumber: form.batchNumber || undefined,
        notes: form.notes || undefined,
      });
      onSuccess({
        title: 'Inward entry recorded',
        message: `${data.product?.name} — ${data.movement?.quantity} ${data.product?.unit} added. New stock: ${data.product?.currentStock}.`,
        pdfData: {
          mivNumber: `MIV-DIRECT-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString(),
          supplierName: 'Direct Entry',
          batchNumber: form.batchNumber,
          notes: form.notes,
          items: [{
            productName: data.product?.name,
            receivedQty: data.movement?.quantity,
            productUnit: data.product?.unit,
            batchNumber: form.batchNumber,
          }],
        },
      });
      setForm({ productId: '', quantity: '', batchNumber: '', notes: '' });
      loadProducts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record inward entry');
    }
    setSaving(false);
  };

  const selectedProduct = products.find(p => p.id === form.productId);
  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.sku.toLowerCase().includes(productSearch.toLowerCase())
  );

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Select Product *</label>
          <SearchBar value={productSearch} onChange={setProductSearch} placeholder="Search by name or SKU..." />
          <div className="mt-2 max-h-40 overflow-y-auto border rounded-md">
            {filteredProducts.map(p => (
              <div
                key={p.id}
                onClick={() => { setForm({ ...form, productId: p.id }); setProductSearch(''); }}
                className={`flex items-center justify-between px-3 py-2 cursor-pointer border-b border-gray-100 last:border-0 transition-colors ${
                  form.productId === p.id ? 'bg-navy-50 border-navy-200' : 'hover:bg-gray-50'
                }`}
              >
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-gray-400 ml-2">{p.sku}</span>
                </div>
                <span className="text-xs text-gray-500">Stock: {p.currentStock} {p.unit}</span>
              </div>
            ))}
          </div>
          {selectedProduct && (
            <p className="mt-2 text-sm text-navy-700">
              Selected: <strong>{selectedProduct.name}</strong> (Current: {selectedProduct.currentStock} {selectedProduct.unit})
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Quantity *" type="number" min="0.01" step="any" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          <Input label="Batch Number" value={form.batchNumber}
            onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} />
        </div>

        <Input label="Notes" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.productId || !form.quantity}>
            {saving ? 'Recording…' : 'Record Inward Entry'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function NewProductForm({ onSuccess }) {
  const [form, setForm] = useState({
    name: '', sku: '', category: '', unit: 'pcs',
    quantity: '', batchNumber: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.sku || !form.quantity) return;
    setSaving(true);
    try {
      const { data } = await api.post('/inventory/inward-new', {
        name: form.name,
        sku: form.sku,
        category: form.category || undefined,
        unit: form.unit || 'pcs',
        quantity: parseFloat(form.quantity),
        batchNumber: form.batchNumber || undefined,
        notes: form.notes || undefined,
      });
      onSuccess({
        title: 'New product created & stocked',
        message: `${data.product.name} (${data.product.sku}) — ${data.movement.quantity} ${data.product.unit} added.`,
        pdfData: {
          mivNumber: `MIV-NEW-${Date.now().toString().slice(-6)}`,
          date: new Date().toISOString(),
          supplierName: 'Direct Entry (New Product)',
          batchNumber: form.batchNumber,
          notes: form.notes,
          items: [{
            productName: data.product.name,
            receivedQty: data.movement.quantity,
            productUnit: data.product.unit,
            batchNumber: form.batchNumber,
          }],
        },
      });
      setForm({ name: '', sku: '', category: '', unit: 'pcs', quantity: '', batchNumber: '', notes: '' });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create product');
    }
    setSaving(false);
  };

  const unitOptions = ['kg', 'litre', 'pcs', 'meter', 'ton', 'box', 'drum', 'bag', 'roll', 'set'];

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Product Name *" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="SKU *" value={form.sku}
            onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
          <Input label="Category" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <Select label="Unit" value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
          </Select>
          <Input label="Quantity *" type="number" min="0.01" step="any" value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          <Input label="Batch Number" value={form.batchNumber}
            onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} />
        </div>

        <Input label="Notes" value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })} />

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !form.name || !form.sku || !form.quantity}>
            {saving ? 'Creating…' : 'Create Product & Record Inward'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── From Gate Pass (FIM) Mode ──────────────────────────────────────────
// Lists pending INWARD gate passes (customer FIM) and accepts items into
// Products. Created ProductBatches are linked back to the inward gate pass.
function FromGatePassMode({ onSuccess, refreshKey }) {
  const [gatePasses, setGatePasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/gatepasses', { params: { direction: 'INWARD', status: 'PENDING_ACCEPTANCE', limit: 100 } })
      .then(({ data }) => setGatePasses(data.gatePasses || []))
      .finally(() => setLoading(false));
  };

  useEffect(load, [refreshKey]);

  if (selected) {
    return (
      <AcceptInwardForm
        gatePass={selected}
        onCancel={() => setSelected(null)}
        onComplete={(msg) => { setSelected(null); load(); onSuccess(msg); }}
      />
    );
  }

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-800 mb-3">Inward Gate Passes Awaiting Acceptance (FIM)</h3>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : gatePasses.length === 0 ? (
        <Card className="text-center text-gray-500 py-8">
          No inward gate passes waiting for acceptance.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {gatePasses.map(g => {
            const pending = (g.items || []).filter(i => (i.inwardedQty || 0) < (i.quantity || 0));
            return (
              <Card key={g.id} className="cursor-pointer hover:border-navy-400 hover:shadow-md transition-all border border-gray-200"
                onClick={() => setSelected(g)}>
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-navy-700">{g.passNumber}</h4>
                  <Badge color="yellow">Pending Acceptance</Badge>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <div><span className="text-gray-500">Customer:</span> {g.customerName || '—'}</div>
                  <div><span className="text-gray-500">Customer GP:</span> {g.customerGatePassNo || '—'}{g.customerGatePassDate ? ` (${formatDate(g.customerGatePassDate)})` : ''}</div>
                  <div><span className="text-gray-500">Type:</span> {g.passType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}</div>
                  <div><span className="text-gray-500">Items pending:</span> {pending.length} of {g.items?.length || 0}</div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AcceptInwardForm({ gatePass, onCancel, onComplete }) {
  const items = (gatePass.items || []).filter(i => (i.inwardedQty || 0) < (i.quantity || 0));
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState(
    items.map(i => ({
      itemId: i.id,
      description: i.description,
      quantity: i.quantity,
      inwardedQty: i.inwardedQty || 0,
      unit: i.unit || 'pcs',
      probableReturnDate: i.probableReturnDate,
      itemPassType: i.itemPassType,
      // Form state
      mode: 'new', // 'new' | 'existing'
      productId: '',
      newName: i.description,
      newMaterialType: 'Others',
      acceptQty: (i.quantity || 0) - (i.inwardedQty || 0),
      batchNumber: '',
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products', { params: { limit: 'all' } })
      .then(({ data }) => setProducts(data.products || []))
      .catch(() => setProducts([]));
  }, []);

  const update = (idx, field, value) => {
    const copy = [...rows];
    copy[idx] = { ...copy[idx], [field]: value };
    setRows(copy);
  };

  const submit = async () => {
    setError('');
    for (const r of rows) {
      const qty = parseFloat(r.acceptQty);
      const remaining = r.quantity - r.inwardedQty;
      if (!qty || qty <= 0) return setError(`Enter accept qty for ${r.description}`);
      if (qty > remaining + 1e-9) return setError(`${r.description}: cannot accept ${qty} (only ${remaining} pending)`);
      if (r.mode === 'existing' && !r.productId) return setError(`${r.description}: select a product or switch to "New product"`);
      if (r.mode === 'new' && !r.newName.trim()) return setError(`${r.description}: new product name is required`);
    }

    setSaving(true);
    try {
      await api.put(`/gatepasses/${gatePass.id}/accept-inward`, {
        items: rows.map(r => ({
          itemId: r.itemId,
          quantity: parseFloat(r.acceptQty),
          batchNumber: r.batchNumber || undefined,
          productId: r.mode === 'existing' ? r.productId : undefined,
          newProduct: r.mode === 'new' ? {
            name: r.newName.trim(),
            materialType: r.newMaterialType,
            unit: r.unit || 'pcs',
          } : undefined,
        })),
      });
      onComplete({
        title: 'Inward gate pass accepted',
        message: `${rows.length} FIM item${rows.length === 1 ? '' : 's'} from ${gatePass.customerName || 'customer'} added to inventory.`,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept inward gate pass');
    }
    setSaving(false);
  };

  const cellInput = "w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-navy-700 focus:border-navy-700";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-navy-700">{gatePass.passNumber}</h3>
          <p className="text-xs text-gray-500">
            Customer: <strong>{gatePass.customerName}</strong> · Customer GP <strong>{gatePass.customerGatePassNo}</strong>
            {gatePass.customerGatePassDate ? ` (${formatDate(gatePass.customerGatePassDate)})` : ''}
            {' · '}
            Type: <strong>{gatePass.passType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}</strong>
          </p>
        </div>
        <Button variant="secondary" onClick={onCancel}>Back to list</Button>
      </div>

      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900">
        <strong>FIM (Free Issue Material):</strong> these items belong to the customer. Each accepted item creates (or adds to) a Product
        and marks the resulting batch as <em>FIM</em>, linked to this gate pass so the product can be traced back to the customer.
      </div>

      {error && <div className="p-3 mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">{error}</div>}

      <div className="space-y-4">
        {rows.map((r, idx) => (
          <div key={r.itemId} className="border border-gray-200 rounded p-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="font-medium text-gray-800">{r.description}</span>
                <span className="ml-2 text-xs text-gray-500">
                  on gatepass: {r.quantity} {r.unit} · pending: {(r.quantity - r.inwardedQty).toFixed(2)} {r.unit}
                </span>
              </div>
              <Badge color={r.itemPassType === 'NON_RETURNABLE' ? 'orange' : 'blue'}>
                {r.itemPassType === 'NON_RETURNABLE' ? 'Non-Returnable' : 'Returnable'}
              </Badge>
            </div>

            <div className="flex gap-3 text-xs mb-2">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={r.mode === 'new'} onChange={() => update(idx, 'mode', 'new')} />
                Create new product
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" checked={r.mode === 'existing'} onChange={() => update(idx, 'mode', 'existing')} />
                Add to existing product
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
              {r.mode === 'new' ? (
                <>
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Product name *</label>
                    <input className={cellInput}
                      value={r.newName} onChange={(e) => update(idx, 'newName', e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Material type</label>
                    <select className={cellInput}
                      value={r.newMaterialType} onChange={(e) => update(idx, 'newMaterialType', e.target.value)}>
                      <option>Others</option>
                      <option>Raw Material</option>
                      <option>Consumable</option>
                      <option>Tooling</option>
                    </select>
                  </div>
                </>
              ) : (
                <div className="md:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Pick product *</label>
                  <select className={cellInput}
                    value={r.productId} onChange={(e) => update(idx, 'productId', e.target.value)}>
                    <option value="">— Select existing product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Accept qty * ({r.unit})</label>
                <input type="number" min="0" step="any" className={cellInput}
                  value={r.acceptQty} onChange={(e) => update(idx, 'acceptQty', e.target.value)} />
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs text-gray-500 mb-1">Batch number (optional)</label>
                <input className={cellInput}
                  value={r.batchNumber} onChange={(e) => update(idx, 'batchNumber', e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={submit} disabled={saving || rows.length === 0}>
          {saving ? 'Saving…' : 'Accept & Inward FIM'}
        </Button>
      </div>
    </Card>
  );
}
