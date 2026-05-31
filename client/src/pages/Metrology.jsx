import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Gauge, Wind, Scale, FlaskConical, Ruler, Thermometer, ArrowRight,
  Activity, AlertTriangle, CheckCircle2, Clock, Sparkles,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';

// Full edit: METROLOGY, QC, MANAGER@Unit-V. SUPERADMIN keeps its owner-only bypass.
// View + remarks + cert download: ADMIN, MANAGER (all units), LAB, NDT, RND.
// Unit 5 may appear as code '5', name 'Unit 5', or username 'unit 5'
// depending on how the account was provisioned.
const EDIT_UNIT_CODES = ['5', 'UNIT-V', 'UNIT-5'];
const EDIT_UNIT_NAMES = ['unit 5', 'unit-5', 'unit5', 'unit v'];
const BASE_EDIT_ROLES = ['METROLOGY', 'QC'];
const BASE_VIEW_ROLES = ['ADMIN', 'METROLOGY', 'QC', 'LAB', 'NDT', 'RND'];

const isUnit5Manager = (user) => {
  if (user?.role !== 'MANAGER') return false;
  const code = (user?.unit?.code || '').toString().toUpperCase();
  const name = (user?.unit?.name || '').toString().trim().toLowerCase();
  const uname = (user?.username || '').toString().trim().toLowerCase();
  return EDIT_UNIT_CODES.includes(code)
    || EDIT_UNIT_NAMES.includes(name)
    || EDIT_UNIT_NAMES.includes(uname);
};

const MODULES = [
  {
    key: 'PRESSURE_GAUGE',
    to: '/metrology/pressure-gauges',
    icon: Gauge,
    title: 'Pressure Gauges',
    description: 'Calibration register for pressure gauges across all units.',
    gradient: 'from-blue-500 via-blue-600 to-indigo-600',
    glow: 'group-hover:shadow-blue-500/40',
    iconBg: 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700',
    ringColor: 'ring-blue-200/60',
  },
  {
    key: 'VACUUM_GAUGE',
    to: '/metrology/vacuum-gauges',
    icon: Wind,
    title: 'Vacuum Gauges',
    description: 'Calibration register for SS / standard vacuum gauges.',
    gradient: 'from-sky-500 via-cyan-500 to-teal-500',
    glow: 'group-hover:shadow-cyan-500/40',
    iconBg: 'bg-gradient-to-br from-sky-100 to-cyan-200 text-sky-700',
    ringColor: 'ring-sky-200/60',
  },
  {
    key: 'WEIGHING_BALANCE',
    to: '/metrology/weighing-balances',
    icon: Scale,
    title: 'Weighing Balances',
    description: 'Analytical balances, platform scales, and standard weights.',
    gradient: 'from-emerald-500 via-emerald-600 to-green-600',
    glow: 'group-hover:shadow-emerald-500/40',
    iconBg: 'bg-gradient-to-br from-emerald-100 to-green-200 text-emerald-700',
    ringColor: 'ring-emerald-200/60',
  },
  {
    key: 'TESTING_EQUIPMENT',
    to: '/metrology/testing-equipment',
    icon: FlaskConical,
    title: 'Testing Equipment',
    description: 'UTM, viscometer, hardness testers and other lab equipment.',
    gradient: 'from-amber-500 via-orange-500 to-red-500',
    glow: 'group-hover:shadow-amber-500/40',
    iconBg: 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-700',
    ringColor: 'ring-amber-200/60',
  },
  {
    key: 'METROLOGY_INSTRUMENT',
    to: '/metrology/metrology-instruments',
    icon: Ruler,
    title: 'Metrology Instruments',
    description: 'Vernier calipers, micrometers, height gauges, and more.',
    gradient: 'from-indigo-500 via-violet-500 to-purple-600',
    glow: 'group-hover:shadow-indigo-500/40',
    iconBg: 'bg-gradient-to-br from-indigo-100 to-violet-200 text-indigo-700',
    ringColor: 'ring-indigo-200/60',
  },
  {
    key: 'MMR',
    to: '/metrology/mmr',
    icon: Thermometer,
    title: 'Monitoring & Measuring Resources',
    description: 'Thermocouples, PID controllers and temperature scanners.',
    gradient: 'from-rose-500 via-pink-500 to-fuchsia-600',
    glow: 'group-hover:shadow-rose-500/40',
    iconBg: 'bg-gradient-to-br from-rose-100 to-pink-200 text-rose-700',
    ringColor: 'ring-rose-200/60',
  },
];

const daysUntil = (d) => Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

export default function Metrology() {
  const { user } = useAuth();
  const role = user?.role;

  const canEdit = role === 'SUPERADMIN'
    || BASE_EDIT_ROLES.includes(role)
    || isUnit5Manager(user);
  const canView = canEdit
    || BASE_VIEW_ROLES.includes(role)
    || role === 'MANAGER';

  const [allItems, setAllItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    api.get('/calibration')
      .then(({ data }) => setAllItems(data.items || []))
      .catch(() => setAllItems([]))
      .finally(() => setLoading(false));
  }, [canView]);

  const stats = (() => {
    const total = allItems.length;
    let overdue = 0, dueSoon = 0, healthy = 0;
    allItems.forEach((it) => {
      if (!it.calibrationDueDate) { healthy++; return; }
      const d = daysUntil(it.calibrationDueDate);
      if (d < 0) overdue++;
      else if (d <= 30) dueSoon++;
      else healthy++;
    });
    return { total, overdue, dueSoon, healthy };
  })();

  const perCategory = (() => {
    const map = Object.fromEntries(MODULES.map((m) => [m.key, { total: 0, overdue: 0, dueSoon: 0 }]));
    allItems.forEach((it) => {
      const m = map[it.category];
      if (!m) return;
      m.total++;
      if (it.calibrationDueDate) {
        const d = daysUntil(it.calibrationDueDate);
        if (d < 0) m.overdue++;
        else if (d <= 30) m.dueSoon++;
      }
    });
    return map;
  })();

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-indigo-900 px-7 py-7 text-white shadow-2xl">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-6 opacity-10">
          <Ruler size={140} strokeWidth={1} />
        </div>

        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-200/80 font-semibold">
            <Sparkles size={14} className="text-blue-300" />
            <span>Calibration Control Centre</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Metrology &amp; Calibration</h1>
          <p className="text-sm text-blue-100/90 mt-2 max-w-2xl leading-relaxed">
            Master registers for every calibrated instrument across the plant.
            {canEdit
              ? ' Metrology team manages all entries; every other role gets a live read-only view.'
              : ' Read-only view — Metrology handles all changes and recalibration scheduling.'}
          </p>

          {/* Stat tiles */}
          {canView && !loading && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
              <StatTile
                icon={<Activity size={16} />}
                label="Total instruments"
                value={stats.total}
                tint="bg-white/10 ring-white/20 text-white"
              />
              <StatTile
                icon={<CheckCircle2 size={16} />}
                label="Healthy"
                value={stats.healthy}
                tint="bg-emerald-400/15 ring-emerald-300/30 text-emerald-100"
              />
              <StatTile
                icon={<Clock size={16} />}
                label="Due in 30 days"
                value={stats.dueSoon}
                tint="bg-amber-400/15 ring-amber-300/30 text-amber-100"
              />
              <StatTile
                icon={<AlertTriangle size={16} />}
                label="Overdue"
                value={stats.overdue}
                tint="bg-rose-400/15 ring-rose-300/30 text-rose-100"
              />
            </div>
          )}
        </div>
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
            const c = perCategory[m.key] || { total: 0, overdue: 0, dueSoon: 0 };
            return (
              <Link
                key={m.to}
                to={m.to}
                className={`group relative block rounded-2xl bg-white border border-navy-100/60 shadow-card
                  hover:-translate-y-1 hover:shadow-2xl ${m.glow}
                  transition-all duration-300 overflow-hidden`}
              >
                {/* Top gradient strip */}
                <div className={`h-1.5 bg-gradient-to-r ${m.gradient}`} />

                {/* Decorative gradient glow */}
                <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${m.gradient} opacity-0 group-hover:opacity-20 blur-2xl transition-opacity duration-500 pointer-events-none`} />

                <div className="p-5 relative">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`p-3 rounded-xl ${m.iconBg} ring-1 ${m.ringColor} shadow-sm group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300`}>
                      <Icon size={22} strokeWidth={2.2} />
                    </div>

                    <div className="flex items-center gap-1.5">
                      {c.overdue > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                          <AlertTriangle size={10} /> {c.overdue}
                        </span>
                      )}
                      {c.dueSoon > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                          <Clock size={10} /> {c.dueSoon}
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-navy-800 group-hover:text-navy-900 leading-snug">
                    {m.title}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed line-clamp-2">{m.description}</p>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-navy-800 tabular-nums">{c.total}</span>
                      <span className="text-xs text-gray-500 uppercase tracking-wide">entries</span>
                    </div>
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
      )}
    </div>
  );
}

function StatTile({ icon, label, value, tint }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ring-1 backdrop-blur-sm ${tint}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold opacity-90">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
