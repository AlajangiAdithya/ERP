import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Package } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select } from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';

export default function Products() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [categories, setCategories] = useState([]);
  const [catFilter, setCatFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const canEdit = user?.role === 'ADMIN' || user?.role === 'STORE_MANAGER';

  const [form, setForm] = useState({
    name: '', description: '', category: 'Raw Material', unit: 'pcs',
    minStockLevel: 0,
  });
  const [materialTypes, setMaterialTypes] = useState([]);

  const fetchProducts = () => {
    setLoading(true);
    const params = { page, limit: 100, search: search || undefined, category: catFilter || undefined, includeUnitStock: 'true', includeMir: 'true' };
    api.get('/products', { params })
      .then(({ data }) => {
        setProducts(data.products);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchProducts(); }, [page, search, catFilter]);
  useEffect(() => {
    api.get('/products/categories').then(({ data }) => setCategories(data));
    api.get('/products/material-types').then(({ data }) => setMaterialTypes(data)).catch(() => {});
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const data = {
        ...form,
        minStockLevel: parseFloat(form.minStockLevel) || 0,
      };
      await api.post('/products', data);
      setShowModal(false);
      setForm({ name: '', description: '', category: 'Raw Material', unit: 'pcs', minStockLevel: 0 });
      fetchProducts();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to create product');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', render: (v) => v || '—' },
    {
      key: 'currentStock', label: 'Total Stock',
      render: (v, row) => (
        <span className="flex items-center gap-2">
          {v} {row.unit}
          {v === 0 ? (
            <Badge color="red">Out</Badge>
          ) : row.minStockLevel > 0 && v <= row.minStockLevel ? (
            <Badge color="yellow">Low</Badge>
          ) : null}
        </span>
      )
    },
    {
      key: 'unitStocks', label: 'Owned by',
      render: (v, row) => {
        const list = Array.isArray(v) ? v.filter(u => u.quantity > 0) : [];
        if (list.length === 0) {
          return <span className="text-xs text-gray-400">Unassigned</span>;
        }
        return (
          <div className="flex flex-col gap-0.5">
            {list.map(us => (
              <span key={us.id} className="text-xs text-gray-700">
                <strong>{us.quantity}</strong> {row.unit} owned by{' '}
                <span className="font-medium text-navy-700">{us.unit?.name || us.unit?.code || 'Unit'}</span>
              </span>
            ))}
          </div>
        );
      }
    },
    {
      // MIR numbers (Material Inward Register) — auto-generated at stores inward on the PO.
      // We surface the most recent few so users can trace which inward batch brought this stock.
      key: 'batches', label: 'MIR No.',
      render: (v) => {
        const list = Array.isArray(v) ? v : [];
        const mirs = [];
        const seen = new Set();
        for (const b of list) {
          const mir = b.sourceQcInspection?.purchaseOrder?.mirNo;
          if (mir && !seen.has(mir)) {
            seen.add(mir);
            mirs.push({ mir, date: b.receivedDate });
          }
        }
        if (mirs.length === 0) return <span className="text-xs text-gray-400">—</span>;
        return (
          <div className="flex flex-col gap-0.5">
            {mirs.slice(0, 3).map(m => (
              <span key={m.mir} className="text-xs font-mono text-navy-700" title={new Date(m.date).toLocaleDateString()}>
                {m.mir}
              </span>
            ))}
            {mirs.length > 3 && <span className="text-[10px] text-gray-500">+{mirs.length - 3} more</span>}
          </div>
        );
      },
    },
    { key: 'minStockLevel', label: 'Min Level', render: (v, row) => v > 0 ? `${v} ${row.unit}` : '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        {canEdit && (
          <Button onClick={() => setShowModal(true)}>
            <Plus size={16} /> Add Product
          </Button>
        )}
      </div>

      <Card>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex-1">
            <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search products..." />
          </div>
          <Select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }} className="w-full sm:w-48">
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Table columns={columns} data={products} onRowClick={(row) => navigate(`/products/${row.id}`)} />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      {/* Add Product Modal */}
      {canEdit && (
        <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Product" size="lg">
          <form onSubmit={handleCreate} className="space-y-4">
            {formError && <p className="text-sm text-brand-red">{formError}</p>}
            <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <p className="text-xs text-gray-500 -mt-2">SKU is auto-generated from material type (e.g. RAW-0001, CONS-0001).</p>
            <Input label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="grid grid-cols-3 gap-4">
              <Select label="Material Type *" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required>
                {(materialTypes.length ? materialTypes : ['Raw Material', 'Consumable', 'Tooling', 'Others']).map(mt => <option key={mt} value={mt}>{mt}</option>)}
              </Select>
              <Select label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {['pcs', 'kg', 'litre', 'meter', 'Sq. mtr', 'box', 'set'].map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
              <Input label="Min Stock Level" type="number" value={form.minStockLevel} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Product'}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
