import { useState, useEffect } from 'react';
import { ArrowRightLeft, ArrowRight, Plus } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input, { Select, Textarea } from '../components/ui/Input';
import Table from '../components/ui/Table';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';
import { formatDateTime } from '../utils/formatters';

export default function StockTransfers() {
  const [transfers, setTransfers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [sourceStock, setSourceStock] = useState(null);

  const emptyForm = { fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: '', transferDate: new Date().toISOString().split('T')[0], notes: '' };
  const [form, setForm] = useState(emptyForm);

  const fetchTransfers = () => {
    setLoading(true);
    api.get('/warehouses/transfers/history', { params: { page, limit: 20, search: search || undefined } })
      .then(({ data }) => {
        setTransfers(data.transfers);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTransfers(); }, [page, search]);

  useEffect(() => {
    Promise.all([
      api.get('/warehouses/all'),
      api.get('/products', { params: { limit: 100 } }),
    ]).then(([whRes, prodRes]) => {
      setWarehouses(whRes.data);
      setProducts(prodRes.data.products || []);
    });
  }, []);

  // Fetch source warehouse stock when from warehouse + product selected
  useEffect(() => {
    if (form.fromWarehouseId && form.productId) {
      api.get(`/warehouses/${form.fromWarehouseId}/stock-for-product/${form.productId}`)
        .then(({ data }) => setSourceStock(data.quantity));
    } else {
      setSourceStock(null);
    }
  }, [form.fromWarehouseId, form.productId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSuccess('');
    setSaving(true);
    try {
      const data = {
        ...form,
        quantity: parseFloat(form.quantity),
      };
      const { data: result } = await api.post('/warehouses/transfers', data);
      setShowModal(false);
      setForm(emptyForm);
      setSuccess(`Transfer ${result.transferNumber} completed — ${result.quantity} units moved`);
      fetchTransfers();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create transfer');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'transferNumber', label: 'Transfer #', render: (v) => <span className="font-mono text-xs">{v}</span> },
    {
      key: 'product', label: 'Product',
      render: (_, row) => (
        <div>
          <p className="font-medium text-gray-700">{row.product?.name}</p>
          <p className="text-xs text-gray-400">{row.product?.sku}</p>
        </div>
      ),
    },
    {
      key: 'fromWarehouse', label: 'From → To',
      render: (_, row) => (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-700">{row.fromWarehouse?.name}</span>
          <ArrowRight size={14} className="text-gray-400" />
          <span className="text-gray-700">{row.toWarehouse?.name}</span>
        </div>
      ),
    },
    {
      key: 'quantity', label: 'Qty',
      render: (v, row) => <span className="font-semibold">{v} {row.product?.unit}</span>,
    },
    { key: 'transferDate', label: 'Date', render: (v) => formatDateTime(v) },
    { key: 'notes', label: 'Notes', render: (v) => <span className="text-gray-500 text-xs">{v || '—'}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Stock Transfers</h1>
        <Button onClick={() => { setFormError(''); setForm(emptyForm); setShowModal(true); }}>
          <Plus size={16} /> New Transfer
        </Button>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}

      <Card>
        <div className="mb-4">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search transfers..." />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : transfers.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <ArrowRightLeft size={48} className="mx-auto mb-3 opacity-50" />
            <p>No transfers found</p>
          </div>
        ) : (
          <>
            <Table columns={columns} data={transfers} />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      {/* Transfer Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New Stock Transfer" size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="text-sm text-brand-red">{formError}</p>}

          <div className="grid grid-cols-2 gap-4">
            <Select label="From Warehouse *" value={form.fromWarehouseId} onChange={(e) => setForm({ ...form, fromWarehouseId: e.target.value })} required>
              <option value="">Select source...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label="To Warehouse *" value={form.toWarehouseId} onChange={(e) => setForm({ ...form, toWarehouseId: e.target.value })} required>
              <option value="">Select destination...</option>
              {warehouses.filter(w => w.id !== form.fromWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>

          <Select label="Product *" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} required>
            <option value="">Select product...</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
          </Select>

          {sourceStock !== null && (
            <p className="text-sm text-gray-500">
              Available in source warehouse: <span className="font-semibold text-gray-700">{sourceStock}</span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Quantity *"
              type="number"
              min="0.01"
              step="0.01"
              max={sourceStock || undefined}
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              required
            />
            <Input
              label="Transfer Date"
              type="date"
              value={form.transferDate}
              onChange={(e) => setForm({ ...form, transferDate: e.target.value })}
            />
          </div>

          <Textarea label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Transferring...' : 'Transfer Stock'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
