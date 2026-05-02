import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Warehouse, MapPin, User, Pencil, Trash2 } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';

export default function Warehouses() {
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const emptyForm = { name: '', address: '', contactPerson: '', phone: '', email: '' };
  const [form, setForm] = useState(emptyForm);

  const fetchWarehouses = () => {
    setLoading(true);
    api.get('/warehouses', { params: { page, limit: 20, search: search || undefined } })
      .then(({ data }) => {
        setWarehouses(data.warehouses);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchWarehouses(); }, [page, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (wh, e) => {
    e.stopPropagation();
    setEditing(wh);
    setForm({ name: wh.name, address: wh.address || '', contactPerson: wh.contactPerson || '', phone: wh.phone || '', email: wh.email || '' });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/warehouses/${editing.id}`, form);
      } else {
        await api.post('/warehouses', form);
      }
      setShowModal(false);
      fetchWarehouses();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save warehouse');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/warehouses/${id}`);
      setDeleteConfirm(null);
      fetchWarehouses();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete warehouse');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Warehouses</h1>
        <Button onClick={openCreate}>
          <Plus size={16} /> Add Warehouse
        </Button>
      </div>

      <Card>
        <div className="mb-4">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search warehouses..." />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : warehouses.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Warehouse size={48} className="mx-auto mb-3 opacity-50" />
            <p>No warehouses found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {warehouses.map((wh) => (
              <div
                key={wh.id}
                onClick={() => navigate(`/warehouses/${wh.id}`)}
                className="border border-gray-200 rounded-lg p-5 hover:border-navy-300 hover:shadow-sm transition-all cursor-pointer group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-navy-50 rounded-lg text-navy-700">
                      <Warehouse size={20} />
                    </div>
                    <h3 className="font-semibold text-gray-900">{wh.name}</h3>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => openEdit(wh, e)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-navy-700">
                      <Pencil size={14} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(wh.id); }} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-brand-red">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {wh.address && (
                  <p className="text-sm text-gray-500 flex items-center gap-1.5 mb-1">
                    <MapPin size={13} /> {wh.address}
                  </p>
                )}
                {wh.contactPerson && (
                  <p className="text-sm text-gray-500 flex items-center gap-1.5 mb-3">
                    <User size={13} /> {wh.contactPerson}
                  </p>
                )}

                <div className="flex gap-4 pt-3 border-t border-gray-100">
                  <div>
                    <p className="text-xs text-gray-400">Products</p>
                    <p className="text-sm font-semibold text-gray-700">{wh.totalItems}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Total Qty</p>
                    <p className="text-sm font-semibold text-gray-700">{wh.totalQuantity}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </Card>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Warehouse' : 'Add Warehouse'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="text-sm text-brand-red">{formError}</p>}
          <Input label="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Contact Person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : (editing ? 'Update' : 'Create')}</Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Warehouse" size="sm">
        <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete this warehouse? This action cannot be undone.</p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => handleDelete(deleteConfirm)}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
