import { Link } from 'react-router-dom';
import { Boxes, Database, Building2, ArrowRight, Sparkles, Package } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

// Master Data hub. One tile holding both Product Master Data (specs + shelf life,
// owned by Unit 1–5 managers + QC) and the Approved Supplier List. Stores/Purchase
// just consume product names elsewhere — they don't manage master data here.
const TILES = [
  {
    to: '/master-data/products',
    icon: Package,
    title: 'Product Master Data',
    description: 'Define products with their specifications and shelf life. Stores can only inward a material once its master data has been added here.',
    roles: ['ADMIN', 'MANAGER', 'QC', 'SUPERADMIN'],
    gradient: 'from-sky-500 via-sky-600 to-cyan-600',
    glow: 'group-hover:shadow-sky-500/40',
    iconBg: 'bg-gradient-to-br from-sky-100 to-cyan-200 text-sky-700',
    ringColor: 'ring-sky-200/60',
  },
  {
    to: '/suppliers',
    icon: Building2,
    title: 'Approved Supplier List',
    description: 'Approved Supplier List, re-evaluation log, assessment forms and performance ratings.',
    roles: ['ADMIN', 'MANAGER', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'DESIGNS', 'SUPERADMIN'],
    gradient: 'from-slate-500 via-slate-600 to-gray-700',
    glow: 'group-hover:shadow-slate-500/40',
    iconBg: 'bg-gradient-to-br from-slate-100 to-gray-200 text-slate-700',
    ringColor: 'ring-slate-200/60',
  },
];

export default function MasterData() {
  const { user } = useAuth();
  const role = user?.role;
  const visible = TILES.filter((t) => t.roles.includes(role));

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-indigo-900 px-7 py-7 text-white shadow-2xl">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-6 opacity-10">
          <Database size={140} strokeWidth={1} />
        </div>
        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-200/80 font-semibold">
            <Sparkles size={14} className="text-blue-300" />
            <span>Master Data</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Master Data</h1>
          <p className="text-sm text-blue-100/90 mt-2 max-w-2xl leading-relaxed">
            The single source of truth for product specifications and approved suppliers.
            Keep these complete so the rest of procurement and inventory stays clean.
          </p>
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <p className="text-center text-gray-500 py-6">You don't have access to any master-data modules.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
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
                  <div className={`inline-flex p-3 rounded-xl ${m.iconBg} ring-1 ${m.ringColor} shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                    <Icon size={22} strokeWidth={2.2} />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-navy-800 group-hover:text-navy-900 leading-snug">{m.title}</h3>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">{m.description}</p>
                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 group-hover:text-navy-800 group-hover:gap-2 transition-all">
                      Open <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
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
