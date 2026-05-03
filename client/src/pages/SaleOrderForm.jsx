import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input, { Select, Textarea } from '../components/ui/Input';
import Badge, { statusColors } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../utils/formatters';

export default function SaleOrderForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState(null);

  const [form, setForm] = useState({
    customerId: '',
    notes: '',
    items: [{ productId: '', quantity: '', unitPrice: '', taxPercent: '18' }],
  });

  useEffect(() => {
    api.get('/customers/all').then(({ data }) => setCustomers(data));
    api.get('/products', { params: { limit: 'all' } }).then(({ data }) => setProducts(data.products || []));

    if (!isNew) {
      api.get(`/sales/${id}`)
        .then(({ data }) => {
          setOrder(data);
          setForm({
            customerId: data.customerId,
            notes: data.notes || '',
            items: data.items.map(i => ({
              productId: i.productId, quantity: i.quantity.toString(),
              unitPrice: i.unitPrice.toString(), taxPercent: i.taxPercent.toString(),
            })),
          });
        })
        .catch(() => navigate('/sale-orders'))
        .finally(() => setLoading(false));
    }
  }, [id]);

  const addItem = () => {
    setForm({ ...form, items: [...form.items, { productId: '', quantity: '', unitPrice: '', taxPercent: '18' }] });
  };

  const removeItem = (idx) => {
    if (form.items.length <= 1) return;
    setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    if (field === 'productId') {
      const product = products.find(p => p.id === value);
      if (product) items[idx].unitPrice = product.sellingPrice.toString();
    }
    setForm({ ...form, items });
  };

  const calculateTotals = () => {
    let subtotal = 0, taxAmount = 0;
    form.items.forEach(item => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      const tax = parseFloat(item.taxPercent) || 0;
      subtotal += qty * price;
      taxAmount += qty * price * (tax / 100);
    });
    return { subtotal, taxAmount, total: subtotal + taxAmount };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = {
        customerId: form.customerId,
        notes: form.notes || undefined,
        items: form.items.map(i => ({
          productId: i.productId,
          quantity: parseFloat(i.quantity),
          unitPrice: parseFloat(i.unitPrice),
          taxPercent: parseFloat(i.taxPercent) || 0,
        })),
      };
      const { data } = await api.post('/sales', payload);
      navigate(`/sale-orders/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create sale order');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status) => {
    try {
      await api.put(`/sales/${id}/status`, { status });
      const { data } = await api.get(`/sales/${id}`);
      setOrder(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update status');
    }
  };

  const createInvoice = async () => {
    try {
      await api.post(`/invoices/from-sale/${id}`);
      const { data } = await api.get(`/sales/${id}`);
      setOrder(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create invoice');
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" /></div>;
  }

  const totals = calculateTotals();

  // View mode
  if (!isNew && order) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate('/sale-orders')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-700">
          <ArrowLeft size={16} /> Back to Sale Orders
        </button>

        <Card>
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{order.orderNumber}</h1>
              <p className="text-sm text-gray-500">Customer: {order.customer?.name}</p>
              <p className="text-sm text-gray-500">Date: {formatDate(order.orderDate)}</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge color={statusColors[order.status]}>{order.status}</Badge>
              {order.status === 'DRAFT' && (
                <Button size="sm" onClick={() => updateStatus('CONFIRMED')}>Confirm Order</Button>
              )}
              {order.status === 'CONFIRMED' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => updateStatus('DISPATCHED')}>Mark Dispatched</Button>
                  {!order.invoice && <Button size="sm" onClick={createInvoice}>Generate Invoice</Button>}
                </>
              )}
              {order.status === 'DISPATCHED' && (
                <Button size="sm" onClick={() => updateStatus('DELIVERED')}>Mark Delivered</Button>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-brand-red mb-4">{error}</p>}

          {order.invoice && (
            <div className="mb-4 p-3 bg-blue-50 rounded-lg flex items-center justify-between">
              <span className="text-sm text-blue-700">Invoice: {order.invoice.invoiceNumber}</span>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/invoices/${order.invoice.id}`)}>View Invoice</Button>
            </div>
          )}

          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Product</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Stock</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Unit Price</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Tax %</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-gray-50">
                  <td className="px-3 py-2">{item.product?.name} <span className="text-gray-400">({item.product?.sku})</span></td>
                  <td className="px-3 py-2 text-right">{item.quantity}</td>
                  <td className="px-3 py-2 text-right">{item.product?.currentStock}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-right">{item.taxPercent}%</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.totalPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="text-right space-y-1">
            <p className="text-sm text-gray-500">Subtotal: {formatCurrency(order.subtotal)}</p>
            <p className="text-sm text-gray-500">Tax: {formatCurrency(order.taxAmount)}</p>
            <p className="text-lg font-bold text-gray-900">Total: {formatCurrency(order.totalAmount)}</p>
          </div>
        </Card>
      </div>
    );
  }

  // Create form
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <button onClick={() => navigate('/sale-orders')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-navy-700">
        <ArrowLeft size={16} /> Back to Sale Orders
      </button>

      <h1 className="text-2xl font-bold text-gray-900">New Sale Order</h1>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <p className="text-sm text-brand-red">{error}</p>}

          <Select label="Customer *" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} required>
            <option value="">Select customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <Button type="button" variant="ghost" size="sm" onClick={addItem}><Plus size={14} /> Add Item</Button>
            </div>

            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="flex gap-2 items-end p-3 bg-gray-50 rounded-lg">
                  <Select className="flex-1" label={idx === 0 ? 'Product' : undefined} value={item.productId} onChange={(e) => updateItem(idx, 'productId', e.target.value)} required>
                    <option value="">Select product</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.currentStock})</option>)}
                  </Select>
                  <Input className="w-24" label={idx === 0 ? 'Qty' : undefined} type="number" step="0.01" min="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)} required />
                  <Input className="w-28" label={idx === 0 ? 'Price' : undefined} type="number" step="0.01" min="0" value={item.unitPrice} onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)} required />
                  <Input className="w-20" label={idx === 0 ? 'Tax%' : undefined} type="number" step="0.01" min="0" max="100" value={item.taxPercent} onChange={(e) => updateItem(idx, 'taxPercent', e.target.value)} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(idx)} disabled={form.items.length <= 1}>
                    <Trash2 size={14} className="text-gray-400" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="text-right space-y-1 border-t pt-4">
            <p className="text-sm text-gray-500">Subtotal: {formatCurrency(totals.subtotal)}</p>
            <p className="text-sm text-gray-500">Tax: {formatCurrency(totals.taxAmount)}</p>
            <p className="text-lg font-bold text-gray-900">Total: {formatCurrency(totals.total)}</p>
          </div>

          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

          <div className="flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => navigate('/sale-orders')}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Sale Order'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
