import { Sparkles, LayoutDashboard } from 'lucide-react';

export default function DashboardHero({ title, subtitle, actions, eyebrow = 'Workspace Overview' }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-navy-900 via-navy-800 to-indigo-900 px-7 py-7 text-white shadow-2xl ring-1 ring-white/10">
      {/* Fine blueprint grid */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse 90% 100% at 50% 0%, black 30%, transparent 95%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 100% at 50% 0%, black 30%, transparent 95%)',
        }}
        aria-hidden="true"
      />
      {/* Soft decorative orbs */}
      <div className="absolute -top-20 -right-20 w-80 h-80 bg-blue-500/25 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
      {/* Top edge highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/50 to-transparent pointer-events-none" aria-hidden="true" />

      {/* Faint rocket photo to the right */}
      <div
        className="absolute inset-y-0 right-0 w-2/3 bg-cover bg-right opacity-[0.07] pointer-events-none hidden sm:block"
        style={{
          backgroundImage: "url('/rocket.jpg')",
          maskImage: 'linear-gradient(to left, black 10%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to left, black 10%, transparent 85%)',
        }}
        aria-hidden="true"
      />

      {/* Decorative icon */}
      <div className="absolute top-4 right-6 opacity-10">
        <LayoutDashboard size={140} strokeWidth={1} />
      </div>

      <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-blue-200/80 font-semibold">
            <Sparkles size={14} className="text-blue-300" />
            <span>{eyebrow}</span>
          </div>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-blue-100/90 mt-2 max-w-2xl leading-relaxed">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 relative z-10">{actions}</div>
        )}
      </div>
    </div>
  );
}
