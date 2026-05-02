import { useState, useEffect } from 'react';
import { Plus, Building2 } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input from '../components/ui/Input';

export default function Units() {
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUnit, setEditUnit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', code: '' });

  const fetchUnits = () => {
    setLoading(true);
    api.get('/units/all').then(({ data }) => setUnits(data)).finally(() => setLoading(false));
  };

  useEffect(() => { fetchUnits(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editUnit) {
        await api.put(`/units/${editUnit.id}`, form);
      } else {
        await api.post('/units', form);
      }
      setShowModal(false);
      setEditUnit(null);
      setForm({ name: '', code: '' });
      fetchUnits();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save unit');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (unit) => {
    setEditUnit(unit);
    setForm({ name: unit.name, code: unit.code });
    setShowModal(true);
  };

  const deactivate = async (unit) => {
    if (!confirm(`Deactivate ${unit.name}?`)) return;
    try {
      await api.delete(`/units/${unit.id}`);
      fetchUnits();
    } catch {}
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Units</h1>
        <Button onClick={() => { setEditUnit(null); setForm({ name: '', code: '' }); setShowModal(true); }}>
          <Plus size={16} /> Add Unit
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : units.length === 0 ? (
          <div className="col-span-3 text-center py-8 text-gray-400">No units created yet</div>
        ) : (
          units.map(unit => (
            <Card key={unit.id}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-navy-100 rounded-lg flex items-center justify-center">
                    <Building2 size={20} className="text-navy-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{unit.name}</h3>
                    <p className="text-xs text-gray-500">{unit.code}</p>
                  </div>
                </div>
                <Badge color={unit.isActive ? 'green' : 'red'}>{unit.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
              <div className="text-sm text-gray-600 mb-3">
                <p>{unit._count?.users || 0} user(s) assigned</p>
              </div>
              {unit.users && unit.users.length > 0 && (
                <div className="mb-3 space-y-1">
                  {unit.users.map(u => (
                    <div key={u.id} className="flex items-center gap-2 text-xs">
                      <span className={`w-2 h-2 rounded-full ${u.isActive ? 'bg-green-400' : 'bg-gray-300'}`} />
                      <span className="text-gray-600">{u.name}</span>
                      <Badge color="blue">{u.role.replace('_', ' ')}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openEdit(unit)}>Edit</Button>
                {unit.isActive && (
                  <Button size="sm" variant="danger" onClick={() => deactivate(unit)}>Deactivate</Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditUnit(null); }} title={editUnit ? 'Edit Unit' : 'Add Unit'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="text-sm text-brand-red">{formError}</p>}
          <Input label="Unit Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Manufacturing Unit-A" />
          <Input label="Unit Code *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} required placeholder="e.g. UNIT-A" />
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" type="button" onClick={() => { setShowModal(false); setEditUnit(null); }}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : (editUnit ? 'Update' : 'Create Unit')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
