import { useState, useEffect } from 'react';
import { Check, Package, ClipboardList, Truck, Plus } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select } from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import SearchBar from '../components/shared/SearchBar';
import { formatDateTime } from '../utils/formatters';
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
      </div>

      {mode === 'po' && <FromPOMode onSuccess={onSuccess} refreshKey={refreshKey} />}
      {mode === 'direct' && <DirectEntryMode onSuccess={onSuccess} />}
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
  const [items, setItems] = useState(
    (order.items || []).map(i => ({
      id: i.id,
      productName: i.productName,
      quantity: i.quantity,
      productUnit: i.productUnit,
      receivedQty: i.quantity,
      batchNumber: '',
    }))
  );
  const [saving, setSaving] = useState(false);

  const updateItem = (idx, field, value) => {
    const copy = [...items];
    copy[idx] = { ...copy[idx], [field]: value };
    setItems(copy);
  };

  const submit = async () => {
    if (items.some(i => !i.receivedQty || parseFloat(i.receivedQty) <= 0)) {
      return alert('Enter received quantity for all items');
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
    api.get('/products', { params: { limit: 200 } }).then(({ data }) => setProducts(data.products));

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
