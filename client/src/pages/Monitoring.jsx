import { Link } from 'react-router-dom';
import {
  BarChart3, FileText, History, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

const MODULES = [
  {
    to: '/stock-movements',
    icon: BarChart3,
    title: 'Stock Movements',
    description: 'Track inward, outward, and transfer movements across all stores.',
    roles: ['ADMIN', 'STORE_MANAGER', 'LOGISTICS', 'PLANNING', 'SAFETY'],
    accent: 'from-blue-500 to-blue-600',
    iconBg: 'bg-blue-50 text-blue-600',
  },
  {
    to: '/audit-logs',
    icon: FileText,
    title: 'Audit Logs',
    description: 'Review every privileged action recorded across the system.',
    roles: ['ADMIN', 'SAFETY'],
    accent: 'from-amber-500 to-amber-600',
    iconBg: 'bg-amber-50 text-amber-600',
  },
  {
    to: '/unit-usage',
    icon: History,
    title: 'Unit Usage Logs',
    description: 'Per-unit activity history for compliance and review.',
    roles: ['ADMIN', 'SAFETY'],
    accent: 'from-purple-500 to-purple-600',
    iconBg: 'bg-purple-50 text-purple-600',
  },
];

export default function Monitoring() {
  const { user } = useAuth();
  const role = user?.role;

  const visible = MODULES.filter((m) => m.roles.includes(role));

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-navy-800 to-navy-700 rounded-2xl px-6 py-6 text-white shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">Monitoring</h1>
        <p className="text-sm text-blue-100/90 mt-1">
          Stock movement, audit, and unit-usage views in one place.
        </p>
      </div>

      {visible.length === 0 ? (
        <Card>
          <p className="text-center text-gray-500 py-6">
            You don't have access to any monitoring modules.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {visible.map((m) => {
            const Icon = m.icon;
            return (
              <Link
                key={m.to}
                to={m.to}
                className="group block rounded-xl bg-white border border-navy-100/60 shadow-card hover:shadow-lg hover:-translate-y-0.5 transition-all duration-150 overflow-hidden"
              >
                <div className={`h-1 bg-gradient-to-r ${m.accent}`} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`p-2.5 rounded-lg ${m.iconBg}`}>
                      <Icon size={22} strokeWidth={2} />
                    </div>
                    <ArrowRight
                      size={18}
                      className="text-gray-300 group-hover:text-navy-700 group-hover:translate-x-1 transition-all duration-150"
                    />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-navy-800">
                    {m.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">{m.description}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
