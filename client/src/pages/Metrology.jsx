import { Link } from 'react-router-dom';
import {
  Gauge, Wind, Scale, FlaskConical, Ruler, Flame, Truck, Search, Box,
  Sparkles, ArrowRight, ListChecks,
} from 'lucide-react';
import CalibrationList from './metrology/CalibrationList';

// Single unified register for every calibrated instrument. Each group below
// rolls up both the legacy top-level `category` rows (PRESSURE_GAUGE, …) and
// the matching MMR `mmrSubCategory` rows into one bucket the user sees.
// New rows created from this page are stored as MMR + sub-category.
export const UNIFIED_CATEGORIES = [
  {
    value: 'PRESSURE_GAUGES',
    label: 'Pressure gauges',
    matchCategories: ['PRESSURE_GAUGE'],
    matchMmrSubs:    ['PRESSURE_GAUGES'],
  },
  {
    value: 'VACUUM_GAUGES',
    label: 'Vacuum gauges',
    matchCategories: ['VACUUM_GAUGE'],
    matchMmrSubs:    ['VACUUM_GAUGES'],
  },
  {
    value: 'METROLOGY_INSTRUMENTS',
    label: 'Metrology instruments',
    matchCategories: ['METROLOGY_INSTRUMENT'],
    matchMmrSubs:    ['METROLOGY_INSTRUMENTS'],
  },
  {
    value: 'LAB_TESTING_EQUIPMENT',
    label: 'Mechanical & chemical lab testing equipment',
    matchCategories: ['TESTING_EQUIPMENT'],
    matchMmrSubs:    ['LAB_TESTING_EQUIPMENT'],
  },
  {
    value: 'AUTOCLAVE_OVEN_THERMOCOUPLES',
    label: 'Autoclave, Oven, Thermocouples',
    matchCategories: [],
    matchMmrSubs:    ['AUTOCLAVE_OVEN_THERMOCOUPLES'],
  },
  {
    value: 'EOT_CRANES_CHAIN_BLOCKS',
    label: 'EOT cranes, Chain block pulleys',
    matchCategories: [],
    matchMmrSubs:    ['EOT_CRANES_CHAIN_BLOCKS'],
  },
  {
    value: 'WEIGHING_BALANCES',
    label: 'Weighing balances',
    matchCategories: ['WEIGHING_BALANCE'],
    matchMmrSubs:    ['WEIGHING_BALANCES'],
  },
  {
    value: 'NDT',
    label: 'NDT',
    matchCategories: [],
    matchMmrSubs:    ['NDT'],
  },
  {
    value: 'OTHER',
    label: 'Other equipment',
    matchCategories: [],
    matchMmrSubs:    ['OTHER'],
  },
];

// Per-category card metadata used by the dashboard grid. `slug` maps to the
// URL the card opens; the focused page reuses CalibrationList with the same
// UNIFIED_CATEGORIES list but the bucket pre-selected via initialBucket.
export const CATEGORY_CARDS = [
  {
    value: 'PRESSURE_GAUGES',
    slug: 'pressure-gauges',
    label: 'Pressure gauges',
    icon: Gauge,
    description: 'Pressure gauge calibration register across all units.',
    gradient: 'from-blue-500 via-blue-600 to-indigo-600',
    glow: 'group-hover:shadow-blue-500/40',
    iconBg: 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700',
    ringColor: 'ring-blue-200/60',
  },
  {
    value: 'VACUUM_GAUGES',
    slug: 'vacuum-gauges',
    label: 'Vacuum gauges',
    icon: Wind,
    description: 'Vacuum gauge calibration history and due dates.',
    gradient: 'from-sky-500 via-cyan-500 to-teal-500',
    glow: 'group-hover:shadow-cyan-500/40',
    iconBg: 'bg-gradient-to-br from-sky-100 to-cyan-200 text-cyan-700',
    ringColor: 'ring-cyan-200/60',
  },
  {
    value: 'METROLOGY_INSTRUMENTS',
    slug: 'metrology-instruments',
    label: 'Metrology instruments',
    icon: Ruler,
    description: 'Verniers, micrometers, and other metrology tooling.',
    gradient: 'from-indigo-500 via-violet-500 to-purple-600',
    glow: 'group-hover:shadow-violet-500/40',
    iconBg: 'bg-gradient-to-br from-indigo-100 to-violet-200 text-indigo-700',
    ringColor: 'ring-indigo-200/60',
  },
  {
    value: 'LAB_TESTING_EQUIPMENT',
    slug: 'lab-testing',
    label: 'Lab testing equipment',
    icon: FlaskConical,
    description: 'Mechanical & chemical lab testing instruments.',
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    glow: 'group-hover:shadow-orange-500/40',
    iconBg: 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-700',
    ringColor: 'ring-amber-200/60',
  },
  {
    value: 'AUTOCLAVE_OVEN_THERMOCOUPLES',
    slug: 'autoclave-oven',
    label: 'Autoclave, oven & thermocouples',
    icon: Flame,
    description: 'Cure ovens, autoclaves, and thermocouple sensors.',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-500',
    glow: 'group-hover:shadow-pink-500/40',
    iconBg: 'bg-gradient-to-br from-rose-100 to-pink-200 text-rose-700',
    ringColor: 'ring-rose-200/60',
  },
  {
    value: 'EOT_CRANES_CHAIN_BLOCKS',
    slug: 'eot-cranes',
    label: 'EOT cranes & chain blocks',
    icon: Truck,
    description: 'EOT cranes, chain block pulleys, lifting gear.',
    gradient: 'from-stone-500 via-stone-600 to-zinc-700',
    glow: 'group-hover:shadow-stone-500/40',
    iconBg: 'bg-gradient-to-br from-stone-100 to-zinc-200 text-stone-700',
    ringColor: 'ring-stone-200/60',
  },
  {
    value: 'WEIGHING_BALANCES',
    slug: 'weighing-balances',
    label: 'Weighing balances',
    icon: Scale,
    description: 'Weighing balance calibration register.',
    gradient: 'from-emerald-500 via-green-600 to-emerald-700',
    glow: 'group-hover:shadow-emerald-500/40',
    iconBg: 'bg-gradient-to-br from-emerald-100 to-green-200 text-emerald-700',
    ringColor: 'ring-emerald-200/60',
  },
  {
    value: 'NDT',
    slug: 'ndt',
    label: 'NDT equipment',
    icon: Search,
    description: 'Non-destructive testing equipment.',
    gradient: 'from-teal-500 via-cyan-600 to-sky-600',
    glow: 'group-hover:shadow-teal-500/40',
    iconBg: 'bg-gradient-to-br from-teal-100 to-cyan-200 text-teal-700',
    ringColor: 'ring-teal-200/60',
  },
  {
    value: 'OTHER',
    slug: 'other',
    label: 'Other equipment',
    icon: Box,
    description: 'Calibrated equipment not covered by the other buckets.',
    gradient: 'from-slate-500 via-slate-600 to-gray-700',
    glow: 'group-hover:shadow-slate-500/40',
    iconBg: 'bg-gradient-to-br from-slate-100 to-gray-200 text-slate-700',
    ringColor: 'ring-slate-200/60',
  },
];

export default function Metrology() {
  return (
    <div className="space-y-7">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-700 via-pink-700 to-fuchsia-800 px-7 py-7 text-white shadow-2xl">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-pink-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-fuchsia-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-6 opacity-10">
          <Gauge size={140} strokeWidth={1} />
        </div>

        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-pink-100/80 font-semibold">
            <Sparkles size={14} className="text-pink-200" />
            <span>Metrology Workspace</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Measuring &amp; Monitoring Resources</h1>
          <p className="text-sm text-pink-100/90 mt-2 max-w-2xl leading-relaxed">
            Choose a category below to open its calibration register, or scroll
            down for the full list of every monitoring instrument on file.
          </p>
        </div>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {CATEGORY_CARDS.map((m) => {
          const Icon = m.icon;
          return (
            <Link
              key={m.slug}
              to={`/metrology/category/${m.slug}`}
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
                  {m.label}
                </h3>
                <p className="mt-1 text-sm text-gray-500 leading-relaxed line-clamp-2">{m.description}</p>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end">
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-navy-600 group-hover:text-navy-800 group-hover:gap-2 transition-all">
                    Open register
                    <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Total list — full unified register, also visible on the dashboard. */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pt-2">
          <div className="p-1.5 rounded-md bg-navy-50 text-navy-700">
            <ListChecks size={16} />
          </div>
          <h2 className="text-lg font-semibold text-navy-800">
            Total list — every monitoring instrument
          </h2>
        </div>
        <CalibrationList
          title="All monitoring instruments"
          defaultName=""
          unifiedCategories={UNIFIED_CATEGORIES}
          hideBack
        />
      </div>
    </div>
  );
}
