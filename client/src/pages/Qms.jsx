import { Link } from 'react-router-dom';
import { BadgeCheck, BookOpen, ListChecks, Gauge, ArrowRight, Sparkles } from 'lucide-react';

// QMS hub — SOPs, Work Instructions and KPIs. Everyone views; document
// uploads inside the sub-pages are gated to Unit-5 server-side.
const MODULES = [
  {
    to: '/qms/sops',
    icon: BookOpen,
    title: 'SOP',
    description: 'Standard Operating Procedures — controlled copies uploaded by Unit-5.',
    gradient: 'from-sky-500 via-blue-600 to-indigo-600',
    iconBg: 'bg-gradient-to-br from-sky-100 to-blue-200 text-sky-700',
  },
  {
    to: '/qms/work-instructions',
    icon: ListChecks,
    title: 'Work Instructions',
    description: 'Station / process-level work instructions for shop-floor reference.',
    gradient: 'from-emerald-500 via-teal-600 to-cyan-600',
    iconBg: 'bg-gradient-to-br from-emerald-100 to-teal-200 text-emerald-700',
  },
  {
    to: '/qms/kpis',
    icon: Gauge,
    title: 'KPIs',
    description: 'Auto-generated QMS indicators — on-time deliveries, tender vs order, supplier performance, QC rejections, certifications.',
    gradient: 'from-amber-500 via-orange-500 to-rose-500',
    iconBg: 'bg-gradient-to-br from-amber-100 to-orange-200 text-amber-700',
  },
];

export default function Qms() {
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-indigo-900 px-7 py-7 text-white shadow-2xl">
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-4 right-6 opacity-10"><BadgeCheck size={140} strokeWidth={1} /></div>
        <div className="relative">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-200/80 font-semibold">
            <Sparkles size={14} className="text-blue-300" />
            <span>Quality Management System</span>
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">QMS</h1>
          <p className="text-sm text-blue-100/90 mt-2 max-w-2xl leading-relaxed">
            Standard Operating Procedures, Work Instructions and auto-generated KPIs.
            Documents are maintained by Unit-5; everyone views.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {MODULES.map((m) => (
          <Link
            key={m.to}
            to={m.to}
            className="group relative overflow-hidden rounded-2xl bg-white border border-gray-200 shadow-sm hover:shadow-xl transition-all duration-200"
          >
            <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${m.gradient}`} />
            <div className="p-5 flex items-start gap-4">
              <div className={`shrink-0 p-3 rounded-xl ring-1 ring-gray-200 ${m.iconBg}`}>
                <m.icon size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-navy-800 group-hover:text-navy-900">{m.title}</h3>
                  <ArrowRight size={16} className="text-gray-400 group-hover:text-navy-700 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-xs text-gray-600 mt-1 leading-relaxed">{m.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
