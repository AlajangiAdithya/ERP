export default function StatsCard({ title, value, subtitle, icon: Icon, trend, color = 'navy', onClick }) {
  const iconWrap = {
    navy: 'bg-gradient-to-br from-navy-100 to-navy-50 text-navy-700 ring-1 ring-navy-200/60',
    red: 'bg-gradient-to-br from-red-100 to-red-50 text-brand-red ring-1 ring-red-200/60',
    green: 'bg-gradient-to-br from-green-100 to-green-50 text-green-700 ring-1 ring-green-200/60',
    yellow: 'bg-gradient-to-br from-yellow-100 to-yellow-50 text-yellow-700 ring-1 ring-yellow-200/60',
    blue: 'bg-gradient-to-br from-blue-100 to-blue-50 text-blue-700 ring-1 ring-blue-200/60',
    purple: 'bg-gradient-to-br from-purple-100 to-purple-50 text-purple-700 ring-1 ring-purple-200/60',
  };

  const accentBar = {
    navy: 'before:bg-navy-600',
    red: 'before:bg-brand-red',
    green: 'before:bg-green-500',
    yellow: 'before:bg-yellow-500',
    blue: 'before:bg-blue-500',
    purple: 'before:bg-purple-500',
  };

  const glow = {
    navy: 'after:bg-navy-500/5',
    red: 'after:bg-brand-red/5',
    green: 'after:bg-green-500/5',
    yellow: 'after:bg-yellow-500/5',
    blue: 'after:bg-blue-500/5',
    purple: 'after:bg-purple-500/5',
  };

  return (
    <div
      className={`relative overflow-hidden bg-white rounded-2xl shadow-card border border-navy-100/70 p-5 pl-6 transition-all duration-200
        before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${accentBar[color] || accentBar.navy}
        after:absolute after:-right-10 after:-top-10 after:w-32 after:h-32 after:rounded-full after:blur-2xl ${glow[color] || glow.navy}
        ${onClick ? 'group cursor-pointer hover:shadow-cardHover hover:-translate-y-0.5 hover:border-navy-200 active:scale-[0.99]' : 'hover:shadow-cardHover'}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.1em] font-semibold text-gray-500 mb-1.5">{title}</p>
          <p className="text-[28px] leading-none font-bold text-navy-800 font-display tnum tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-[11px] text-gray-500 mt-1.5 font-medium">{subtitle}</p>
          )}
          {trend && (
            <p className={`text-xs mt-2 font-medium ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% from last month
            </p>
          )}
          {onClick && (
            <p className="text-[11px] text-navy-600 mt-2 font-medium opacity-0 group-hover:opacity-100 transition-opacity">View details →</p>
          )}
        </div>
        {Icon && (
          <div className={`p-2.5 rounded-xl flex-shrink-0 ${iconWrap[color] || iconWrap.navy}`}>
            <Icon size={20} strokeWidth={2.2} />
          </div>
        )}
      </div>
    </div>
  );
}
