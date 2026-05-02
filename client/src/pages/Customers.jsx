import { useState, useEffect } from 'react';
import { Plus, Edit2 } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';
import SearchBar from '../components/shared/SearchBar';
import Pagination from '../components/shared/Pagination';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [form, setForm] = useState({
    name: '', contactPerson: '', email: '', phone: '', address: '', gstNumber: '',
  });

  const fetchCustomers = () => {
    setLoading(true);
    api.get('/customers', { params: { page, limit: 20, search: search || undefined } })
      .then(({ data }) => {
        setCustomers(data.customers);
        setTotalPages(data.totalPages);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCustomers(); }, [page, search]);

  const openEdit = (customer) => {
    setEditing(customer);
    setForm({
      name: customer.name, contactPerson: customer.contactPerson || '',
      email: customer.email || '', phone: customer.phone || '',
      address: customer.address || '', gstNumber: customer.gstNumber || '',
    });
    setShowModal(true);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', contactPerson: '', email: '', phone: '', address: '', gstNumber: '' });
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/customers/${editing.id}`, form);
      } else {
        await api.post('/customers', form);
      }
      setShowModal(false);
      fetchCustomers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'contactPerson', label: 'Contact', render: (v) => v || '—' },
    { key: 'email', label: 'Email', render: (v) => v || '—' },
    { key: 'phone', label: 'Phone', render: (v) => v || '—' },
    { key: 'gstNumber', label: 'GST', render: (v) => v || '—' },
    { key: '_count', label: 'Orders', render: (v) => v?.saleOrders || 0 },
    {
      key: 'actions', label: '',
      render: (_, row) => (
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(row); }}>
          <Edit2 size={14} />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <Button onClick={openCreate}><Plus size={16} /> Add Customer</Button>
      </div>

      <Card>
        <div className="mb-4">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search customers..." />
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <Table columns={columns} data={customers} />
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit Customer' : 'Add Customer'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="text-sm text-brand-red">{formError}</p>}
          <Input label="Company Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label="Contact Person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <Input label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input label="GST Number" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
