import { useState, useEffect } from 'react';
import { Plus, UserCog } from 'lucide-react';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Modal from '../components/ui/Modal';
import Input, { Select } from '../components/ui/Input';
import { formatDateTime } from '../utils/formatters';

const roleLabel = (role) => ({
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STORE_MANAGER: 'Store Manager',
  PURCHASE_OFFICER: 'Purchase Officer',
}[role] || role);

const roleBadgeColor = (role) => ({
  ADMIN: 'navy',
  MANAGER: 'green',
  STORE_MANAGER: 'blue',
  PURCHASE_OFFICER: 'yellow',
}[role] || 'gray');

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'MANAGER', unitId: '' });

  // These 3 admins are fixed and cannot be modified
  const FIXED_ADMINS = ['madhubabu', 'suresh', 'rameshbabu'];
  const isFixedAdmin = (user) => FIXED_ADMINS.includes(user.username);

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
        const data = { name: form.name, role: form.role, unitId: form.unitId || null };
        await api.put(`/users/${editUser.id}`, data);
      } else {
        await api.post('/users', { ...form, unitId: form.unitId || null });
      }
      setShowModal(false);
      setEditUser(null);
      setForm({ name: '', username: '', password: '', role: 'MANAGER', unitId: '' });
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({ name: user.name, username: user.username, password: '', role: user.role, unitId: user.unitId || '' });
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
    if (!confirm(`Are you sure you want to permanently delete "${editUser.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${editUser.id}`);
      setShowModal(false);
      setEditUser(null);
      fetchUsers();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to delete user');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <Button onClick={() => { setEditUser(null); setForm({ name: '', username: '', password: '', role: 'MANAGER', unitId: '' }); setShowModal(true); }}>
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Username</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Password</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Role</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Created</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{u.name}</td>
                    <td className="px-3 py-2 text-gray-600">{u.username}</td>
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
                    <td className="px-3 py-2 text-gray-500 text-xs">{formatDateTime(u.createdAt)}</td>
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
          <Input label="Full Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          {!editUser && (
            <>
              <Input label="Username *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              <Input label="Password *" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
            </>
          )}
          <Select label="Role *" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="MANAGER">Manager</option>
            <option value="STORE_MANAGER">Store Manager</option>
            <option value="PURCHASE_OFFICER">Purchase Officer</option>
            <option value="ADMIN">Admin</option>
          </Select>
          {form.role === 'MANAGER' && (
            <Select label="Assign Unit *" value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} required>
              <option value="">Select a Unit</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
            </Select>
          )}
          {form.role === 'PURCHASE_OFFICER' && (
            <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">Purchase Officers are global and not assigned to any unit.</p>
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
    </div>
  );
}
