import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../api/axios';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import { Settings as SettingsIcon, Sun, Moon, Monitor, Check } from 'lucide-react';
import PageHero from '../components/shared/PageHero';

// Appearance options. Each tile carries a mini preview of the theme it selects
// so the choice reads at a glance without switching first.
const THEME_OPTIONS = [
  { key: 'light', label: 'Light', icon: Sun, hint: 'Bright surfaces — best in daylight', swatch: ['#EDF0F7', '#FFFFFF', '#16306E'] },
  { key: 'dark', label: 'Dark', icon: Moon, hint: 'Low-glare navy — easier at night', swatch: ['#0B111D', '#131A2A', '#AECBF8'] },
  { key: 'system', label: 'System', icon: Monitor, hint: 'Follows your device setting', swatch: ['#EDF0F7', '#131A2A', '#5C8AF2'] },
];

function AppearanceCard() {
  const { preference, theme, setTheme } = useTheme();

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Appearance</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Applies to this device only — it stays put when you sign out.
          </p>
        </div>
        <Badge color={theme === 'dark' ? 'navy' : 'yellow'}>
          {theme === 'dark' ? 'Dark' : 'Light'} active
        </Badge>
      </div>

      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {THEME_OPTIONS.map(({ key, label, icon: Icon, hint, swatch }) => {
          const active = preference === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(key)}
              className={`group relative text-left rounded-xl border p-3 transition-all
                ${active
                  ? 'border-navy-500 ring-2 ring-navy-500/25 bg-navy-50'
                  : 'border-gray-200 hover:border-navy-300 hover:bg-navy-50/50'}`}
            >
              <div className="flex items-center gap-2">
                <Icon size={16} className={active ? 'text-navy-700' : 'text-gray-400'} />
                <span className={`text-sm font-semibold ${active ? 'text-navy-800' : 'text-gray-700'}`}>{label}</span>
                {active && <Check size={14} className="ml-auto text-navy-700" />}
              </div>
              {/* Theme preview strip — real hexes, so it looks the same in both themes */}
              <div className="mt-2.5 flex h-8 overflow-hidden rounded-lg ring-1 ring-black/5">
                {swatch.map((c) => (
                  <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-gray-500">{hint}</p>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

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

      <AppearanceCard />

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
