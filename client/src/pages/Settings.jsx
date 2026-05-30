import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import { Settings as SettingsIcon } from 'lucide-react';
import PageHero from '../components/shared/PageHero';

export default function Settings() {
  const { user } = useAuth();
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');

    if (pwForm.newPassword !== pwForm.confirmPassword) {
      return setError('Passwords do not match');
    }
    if (pwForm.newPassword.length < 6) {
      return setError('Password must be at least 6 characters');
    }

    setSaving(true);
    try {
      await api.put(`/users/${user.id}/password`, {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setMessage('Password updated successfully');
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update password');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <PageHero
        title="Settings"
        subtitle="Your profile information and account settings."
        eyebrow="Account"
        icon={SettingsIcon}
      />

      <Card>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Profile Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500">Name:</span> <span className="font-medium">{user?.name}</span></div>
          <div><span className="text-gray-500">Username:</span> <span className="font-medium">{user?.username}</span></div>
          <div>
            <span className="text-gray-500">Role:</span>{' '}
            <Badge color={user?.role === 'ADMIN' ? 'navy' : user?.role === 'STORE_MANAGER' ? 'blue' : user?.role === 'PURCHASE_OFFICER' ? 'yellow' : 'green'}>
              {user?.role === 'PURCHASE_OFFICER' ? 'Purchase Officer' : user?.role?.replace('_', ' ')}
            </Badge>
          </div>
          <div><span className="text-gray-500">Unit:</span> <span className="font-medium">{user?.unit?.name || 'Global'}</span></div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Change Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
          {message && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded">{message}</p>}
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
          <Input label="Current Password" type="password" value={pwForm.currentPassword}
            onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} required />
          <Input label="New Password" type="password" value={pwForm.newPassword}
            onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} required />
          <Input label="Confirm New Password" type="password" value={pwForm.confirmPassword}
            onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} required />
          <Button type="submit" disabled={saving}>{saving ? 'Updating...' : 'Update Password'}</Button>
        </form>
      </Card>
    </div>
  );
}
