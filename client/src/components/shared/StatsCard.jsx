export default function StatsCard({ title, value, icon: Icon, trend, color = 'navy', onClick }) {
  const colorClasses = {
    navy: 'bg-navy-50 text-navy-700',
    red: 'bg-red-50 text-brand-red',
    green: 'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
  };

  const accentClasses = {
    navy: 'before:bg-navy-600',
    red: 'before:bg-brand-red',
    green: 'before:bg-green-500',
    yellow: 'before:bg-yellow-500',
    blue: 'before:bg-blue-500',
    purple: 'before:bg-purple-500',
  };

  return (
    <div
      className={`relative overflow-hidden bg-white rounded-xl shadow-card border border-navy-100/60 p-6 pl-7 transition-all duration-200 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1.5 ${
        accentClasses[color] || accentClasses.navy
      } ${
        onClick
          ? 'group cursor-pointer hover:shadow-cardHover hover:-translate-y-0.5 hover:border-navy-200 active:scale-[0.99]'
          : ''
      }`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 mb-1">{title}</p>
          <p className="text-2xl font-semibold text-navy-800">{value}</p>
          {trend && (
            <p className={`text-xs mt-1 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {trend > 0 ? '+' : ''}{trend}% from last month
            </p>
          )}
          {onClick && (
            <p className="text-xs text-navy-600 mt-1.5 font-medium opacity-0 group-hover:opacity-100">Click to view →</p>
          )}
        </div>
        {Icon && (
          <div className={`p-3 rounded-lg ${colorClasses[color] || colorClasses.navy}`}>
            <Icon size={22} />
          </div>
        )}
      </div>
    </div>
  );
}
