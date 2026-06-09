import { useState, useEffect } from 'react';
import { Plus, UserCog, Building2 } from 'lucide-react';
import PageHero from '../components/shared/PageHero';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select } from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';

const FIXED_ADMINS = ['madhubabu', 'sureshbabu', 'rameshbabu'];
const isFixedAdmin = (user) => FIXED_ADMINS.includes(user.username);

const GLOBAL_ONLY_ROLES = [
  'STORE_MANAGER', 'PURCHASE_OFFICER', 'SUPPLY_CHAIN', 'SAFETY',
  'FINANCE', 'LOGISTICS', 'DESIGNS', 'PLANNING', 'SITE_OFFICE', 'HR',
];

const roleLabel = (role) => ({
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STORE_MANAGER: 'Store Manager',
  PURCHASE_OFFICER: 'Purchase Officer',
  ACCOUNTING: 'Accounting',
  QC: 'Quality Control',
  LAB: 'Lab',
  METROLOGY: 'Metrology',
  NDT: 'NDT',
  RND: 'R&D',
  SAFETY: 'Safety',
  SUPPLY_CHAIN: 'Supply Chain',
  DESIGNS: 'Designs',
  FINANCE: 'Finance',
  PLANNING: 'Planning',
  LOGISTICS: 'Logistics',
  SITE_OFFICE: 'Site Office',
  HR: 'HR',
}[role] || role);

const roleBadgeColor = (role) => ({
  ADMIN: 'navy',
  MANAGER: 'green',
  STORE_MANAGER: 'blue',
  PURCHASE_OFFICER: 'yellow',
  ACCOUNTING: 'green',
  QC: 'purple',
  LAB: 'purple',
  METROLOGY: 'blue',
  NDT: 'blue',
  RND: 'blue',
  SAFETY: 'red',
  SUPPLY_CHAIN: 'yellow',
  DESIGNS: 'purple',
  FINANCE: 'green',
  PLANNING: 'navy',
  LOGISTICS: 'blue',
  SITE_OFFICE: 'green',
  HR: 'blue',
}[role] || 'gray');

export default function Management() {
  const [tab, setTab] = useState('users');

  return (
    <div className="space-y-6">
      <PageHero
        title="Management"
        subtitle="Users, roles, and unit definitions."
        eyebrow="Administration"
        icon={UserCog}
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        <button
          onClick={() => setTab('users')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'users' ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <UserCog size={16} className="inline mr-2" />Users
        </button>
        <button
          onClick={() => setTab('units')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            tab === 'units' ? 'bg-white text-navy-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Building2 size={16} className="inline mr-2" />Units
        </button>
      </div>

      {tab === 'users' ? <UsersSection /> : <UnitsSection />}
    </div>
  );
}

// ════════════════════════════════════════
// USERS SECTION
// ════════════════════════════════════════
function UsersSection() {
  const [users, setUsers] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ username: '', password: '', role: 'MANAGER', unitId: '' });

  const fetchUsers = () => {
    setLoading(true);
    api.get('/users').then(({ data }) => setUsers(data)).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchUsers();
    api.get('/units').then(({ data }) => setUnits(data));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      if (editUser) {
        const data = { role: form.role, unitId: form.unitId || null };
        await api.put(`/users/${editUser.id}`, data);
      } else {
        await api.post('/users', { ...form, unitId: form.unitId || null });
      }
      setShowModal(false);
      setEditUser(null);
      setForm({ username: '', password: '', role: 'MANAGER', unitId: '' });
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({ username: user.username, password: '', role: user.role, unitId: user.unitId || '' });
    setShowModal(true);
  };

  const toggleActive = async (user) => {
    try {
      await api.put(`/users/${user.id}`, { isActive: !user.isActive });
      fetchUsers();
    } catch {}
  };

  const deleteUser = async () => {
    if (!editUser) return;
    if (!confirm(`Are you sure you want to permanently delete "${editUser.username}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${editUser.id}`);
      setShowModal(false);
      setEditUser(null);
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const showUnitSelector = !GLOBAL_ONLY_ROLES.includes(form.role);

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => { setEditUser(null); setForm({ username: '', password: '', role: 'MANAGER', unitId: '' }); setShowModal(true); }}>
          <Plus size={16} /> Add User
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-navy-700 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Username</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Password</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Role</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.id} className={`border-b border-gray-100 transition-colors ${i % 2 === 1 ? 'bg-brand-gray' : 'bg-white'} hover:bg-navy-50`}>
                    <td className="px-3 py-2 font-medium text-gray-700">{u.username}</td>
                    <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                      {u.plainPassword ? u.plainPassword : <span className="text-gray-400">••••</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge color={roleBadgeColor(u.role)}>
                        {roleLabel(u.role)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{u.unit?.name || '— (Global)'}</td>
                    <td className="px-3 py-2">
                      <Badge color={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {isFixedAdmin(u) ? (
                        <span className="text-xs text-amber-600 font-semibold">🔒 Fixed Admin</span>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => openEdit(u)}>Edit</Button>
                          <Button size="sm" variant={u.isActive ? 'danger' : 'secondary'} onClick={() => toggleActive(u)}>
                            {u.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal isOpen={showModal} onClose={() => { setShowModal(false); setEditUser(null); }} title={editUser ? 'Edit User' : 'Add User'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <p className="text-sm text-brand-red">{formError}</p>}
          {!editUser && (
            <>
              <Input label="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              <Input label="Password *" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </>
          )}
          <Select label="Role *" value={form.role} onChange={(e) => {
            const newRole = e.target.value;
            setForm({ ...form, role: newRole, unitId: GLOBAL_ONLY_ROLES.includes(newRole) ? '' : form.unitId });
          }}>
            <option value="MANAGER">Manager</option>
            <option value="STORE_MANAGER">Store Manager</option>
            <option value="PURCHASE_OFFICER">Purchase Officer</option>
            <option value="ACCOUNTING">Accounting</option>
            <option value="FINANCE">Finance</option>
            <option value="QC">Quality Control</option>
            <option value="LAB">Lab</option>
            <option value="METROLOGY">Metrology</option>
            <option value="NDT">NDT</option>
            <option value="RND">R&amp;D</option>
            <option value="DESIGNS">Designs</option>
            <option value="PLANNING">Planning</option>
            <option value="LOGISTICS">Logistics</option>
            <option value="SAFETY">Safety</option>
            <option value="SUPPLY_CHAIN">Supply Chain</option>
            <option value="HR">HR</option>
            <option value="ADMIN">Admin</option>
          </Select>

          {GLOBAL_ONLY_ROLES.includes(form.role) ? (
            <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
              {roleLabel(form.role)} is a global role — not assigned to any unit.
            </p>
          ) : (
            <Select label="Assign Unit" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
              <option value="">No Unit (Global)</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
            </Select>
          )}

          <div className="flex justify-between pt-2">
            {editUser ? (
              <Button variant="danger" type="button" onClick={deleteUser}>Delete User</Button>
            ) : <div />}
            <div className="flex gap-3">
              <Button variant="secondary" type="button" onClick={() => { setShowModal(false); setEditUser(null); }}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : (editUser ? 'Update' : 'Create User')}</Button>
            </div>
          </div>
        </form>
      </Modal>
    </>
  );
}

// ════════════════════════════════════════
// UNITS SECTION
// ════════════════════════════════════════
function UnitsSection() {
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
    <>
      <div className="flex justify-end">
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
                      <span className="text-gray-600">{u.username}</span>
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
    </>
  );
}
