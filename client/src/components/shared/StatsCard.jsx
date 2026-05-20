export default function StatsCard({ title, value, icon: Icon, trend, color = 'navy', onClick }) {
  const colorClasses = {
    navy: 'bg-gradient-to-br from-navy-50 to-navy-100 text-navy-700 ring-1 ring-navy-200/50',
    red: 'bg-gradient-to-br from-red-50 to-red-100 text-brand-red ring-1 ring-red-200/50',
    green: 'bg-gradient-to-br from-green-50 to-green-100 text-green-700 ring-1 ring-green-200/50',
    yellow: 'bg-gradient-to-br from-yellow-50 to-yellow-100 text-yellow-700 ring-1 ring-yellow-200/50',
    blue: 'bg-gradient-to-br from-blue-50 to-blue-100 text-brand-blueLight ring-1 ring-blue-200/50',
    purple: 'bg-gradient-to-br from-purple-50 to-purple-100 text-purple-700 ring-1 ring-purple-200/50',
  };

  const glowClasses = {
    navy: 'group-hover:shadow-[0_8px_24px_-4px_rgba(16,42,67,0.2)]',
    red: 'group-hover:shadow-[0_8px_24px_-4px_rgba(225,29,72,0.2)]',
    green: 'group-hover:shadow-[0_8px_24px_-4px_rgba(34,197,94,0.2)]',
    yellow: 'group-hover:shadow-[0_8px_24px_-4px_rgba(234,179,8,0.2)]',
    blue: 'group-hover:shadow-[0_8px_24px_-4px_rgba(58,107,224,0.2)]',
    purple: 'group-hover:shadow-[0_8px_24px_-4px_rgba(168,85,247,0.2)]',
  };

  return (
    <div
      className={`relative overflow-hidden bg-white rounded-2xl shadow-card border border-slate-200/60 p-6 transition-all duration-300 ${
        onClick
          ? `group cursor-pointer hover:-translate-y-1 active:scale-[0.98] ${glowClasses[color] || glowClasses.navy}`
          : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] font-medium text-slate-500 uppercase tracking-wide mb-2">{title}</p>
          <p className="text-3xl font-bold text-navy-900">{value}</p>
          {trend && (
            <p className={`text-xs mt-2 font-medium ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}% from last month
            </p>
          )}
          {onClick && (
            <p className="text-xs text-brand-blueLight mt-2 font-semibold opacity-0 -translate-x-2 group-hover:translate-x-0 group-hover:opacity-100 transition-all duration-300 flex items-center gap-1">
              View details <span>→</span>
            </p>
          )}
        </div>
        {Icon && (
          <div className={`p-3.5 rounded-xl shadow-sm ${colorClasses[color] || colorClasses.navy} transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
            <Icon size={24} strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  );
}
