import { Link } from 'react-router-dom';
import {
  Gauge, Wind, Scale, FlaskConical, Ruler, Thermometer, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

// Anyone in the procurement / quality chain can view the registers. Editing
// is restricted to METROLOGY + ADMIN (enforced server-side too).
const VIEW_ROLES = [
  'METROLOGY', 'ADMIN', 'MANAGER', 'STORE_MANAGER',
  'PURCHASE_OFFICER', 'QC', 'ACCOUNTING', 'SAFETY',
  'LAB', 'NDT', 'RND', 'DESIGNS', 'SUPERADMIN',
];

const MODULES = [
  {
    to: '/metrology/pressure-gauges',
    icon: Gauge,
    title: 'Pressure Gauges',
    description: 'Calibration register for pressure gauges across all units.',
    accent: 'from-blue-500 to-blue-600',
    iconBg: 'bg-blue-50 text-blue-600',
  },
  {
    to: '/metrology/vacuum-gauges',
    icon: Wind,
    title: 'Vacuum Gauges',
    description: 'Calibration register for SS / standard vacuum gauges.',
    accent: 'from-sky-500 to-sky-600',
    iconBg: 'bg-sky-50 text-sky-600',
  },
  {
    to: '/metrology/weighing-balances',
    icon: Scale,
    title: 'Weighing Balances',
    description: 'Weighing balances calibration list — analytical & platform scales.',
    accent: 'from-emerald-500 to-emerald-600',
    iconBg: 'bg-emerald-50 text-emerald-600',
  },
  {
    to: '/metrology/testing-equipment',
    icon: FlaskConical,
    title: 'Testing Equipment',
    description: 'UTM, viscometer, hardness testers and other lab equipment.',
    accent: 'from-amber-500 to-amber-600',
    iconBg: 'bg-amber-50 text-amber-600',
  },
  {
    to: '/metrology/metrology-instruments',
    icon: Ruler,
    title: 'Metrology Instruments',
    description: 'Vernier calipers, micrometers, height gauges and related instruments.',
    accent: 'from-indigo-500 to-indigo-600',
    iconBg: 'bg-indigo-50 text-indigo-600',
  },
  {
    to: '/metrology/mmr',
    icon: Thermometer,
    title: 'Monitoring & Measuring Resources',
    description: 'Thermocouples, PID controllers and temperature scanners.',
    accent: 'from-rose-500 to-rose-600',
    iconBg: 'bg-rose-50 text-rose-600',
  },
];

export default function Metrology() {
  const { user } = useAuth();
  const role = user?.role;
  const canView = VIEW_ROLES.includes(role);
  const canEdit = role === 'METROLOGY' || role === 'ADMIN' || role === 'SUPERADMIN';

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-navy-800 to-navy-700 rounded-2xl px-6 py-6 text-white shadow-card">
        <h1 className="text-2xl font-bold tracking-tight">Metrology &amp; Calibration</h1>
        <p className="text-sm text-blue-100/90 mt-1">
          Master registers for every calibrated instrument across the plant.
          {canEdit
            ? ' Metrology team manages all entries here; everyone else has read-only access.'
            : ' Read-only view. Metrology handles all changes and recalibration scheduling.'}
        </p>
      </div>

      {!canView ? (
        <Card>
          <p className="text-center text-gray-500 py-6">
            You don't have access to the metrology registers.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {MODULES.map((m) => {
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
                  <h3 className="mt-4 text-base font-semibold text-navy-800">{m.title}</h3>
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
