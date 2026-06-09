import { Link } from 'react-router-dom';
import {
  DoorOpen, Truck, Route as RouteIcon, ArrowRight, Sparkles, Navigation,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'STORE_MANAGER', 'PURCHASE_OFFICER', 'ACCOUNTING', 'QC', 'LAB',
  'METROLOGY', 'NDT', 'RND', 'SAFETY', 'SUPPLY_CHAIN',
  'DESIGNS', 'FINANCE', 'PLANNING', 'LOGISTICS', 'HR', 'SITE_OFFICE', 'SUPERADMIN',
];

const MODULES = [
  {
    to: '/gate-pass',
    icon: DoorOpen,
    title: 'Gate Pass',
    description: 'Raise, approve, and track inward/outward gate passes for material and visitors.',
    roles: ['ADMIN', 'MANAGER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'LOGISTICS', 'SAFETY', 'SITE_OFFICE'],
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    glow: 'group-hover:shadow-amber-500/40',
    iconBg: 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-700',
    ringColor: 'ring-amber-200/60',
  },
  {
    to: '/logistics',
    icon: RouteIcon,
    title: 'Logistics Dispatch',
    description: 'Pending dispatch queue — assign vehicles and confirm outbound movement.',
    roles: ['ADMIN', 'LOGISTICS'],
    gradient: 'from-emerald-500 via-teal-500 to-cyan-600',
    glow: 'group-hover:shadow-emerald-500/40',
    iconBg: 'bg-gradient-to-br from-emerald-100 to-teal-200 text-emerald-700',
    ringColor: 'ring-emerald-200/60',
  },
  {
    to: '/vehicles',
    icon: Truck,
    title: 'Vehicle Movement',
    description: 'Vehicle register, driver list, and trip history across all units.',
    roles: ALL_ROLES,
    gradient: 'from-blue-500 via-indigo-500 to-violet-600',
    glow: 'group-hover:shadow-blue-500/40',
    iconBg: 'bg-gradient-to-br from-blue-100 to-indigo-200 text-blue-700',
    ringColor: 'ring-blue-200/60',
  },
];

export default function Transport() {
  const { user } = useAuth();
  const role = user?.role;

  const visible = MODULES.filter((m) => m.roles.includes(role));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-indigo-900 px-7 py-7 text-white shadow-2xl">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-6 opacity-10">
          <Navigation size={140} strokeWidth={1} />
        </div>

        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-200/80 font-semibold">
            <Sparkles size={14} className="text-blue-300" />
            <span>Dispatch Workspace</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Gate Pass, Logistics &amp; Vehicle Movement</h1>
          <p className="text-sm text-blue-100/90 mt-2 max-w-2xl leading-relaxed">
            One workspace for everything that moves in or out of the plant —
            gate passes, dispatch assignments, and the vehicle register with trip history.
          </p>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <p className="text-center text-gray-500 py-6">
            You don't have access to any dispatch modules.
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
                className={`group relative block rounded-2xl bg-white border border-navy-100/60 shadow-card
                  hover:-translate-y-1 hover:shadow-2xl ${m.glow}
                  transition-all duration-300 overflow-hidden`}
              >
                <div className={`h-1.5 bg-gradient-to-r ${m.gradient}`} />
                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${m.gradient} opacity-0 group-hover:opacity-20 blur-2xl transition-opacity duration-500 pointer-events-none`} />

                <div className="p-5 relative">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`p-3 rounded-xl ${m.iconBg} ring-1 ${m.ringColor} shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                      <Icon size={22} strokeWidth={2.2} />
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-navy-800 group-hover:text-navy-900 leading-snug">
                    {m.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed line-clamp-2">{m.description}</p>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 group-hover:text-navy-800 group-hover:gap-2 transition-all">
                      Open module
                      <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
