// Standard dashboard section header — icon chip + title (+ count) + subtitle,
// with an optional action slot on the right. Keeps every card heading on the
// same visual rhythm across role dashboards.
const TONE = {
  navy:   'bg-navy-50 text-navy-700 ring-navy-100',
  blue:   'bg-blue-50 text-blue-700 ring-blue-100',
  green:  'bg-green-50 text-green-700 ring-green-100',
  red:    'bg-red-50 text-red-700 ring-red-100',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-100',
  amber:  'bg-amber-50 text-amber-700 ring-amber-100',
  purple: 'bg-purple-50 text-purple-700 ring-purple-100',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  cyan:   'bg-cyan-50 text-cyan-700 ring-cyan-100',
  rose:   'bg-rose-50 text-rose-700 ring-rose-100',
  gray:   'bg-gray-50 text-gray-600 ring-gray-100',
};

export default function SectionHeader({ icon: Icon, tone = 'navy', title, count, subtitle, actions, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-3 mb-4 pb-3 border-b border-gray-100 ${className}`}>
      <div className="flex items-center gap-2.5 min-w-0">
        {Icon && (
          <div className={`p-1.5 rounded-lg ring-1 flex-shrink-0 ${TONE[tone] || TONE.navy}`}>
            <Icon size={15} strokeWidth={2.2} />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">
            {title}
            {count != null && (
              <span className="ml-2 text-xs font-normal text-gray-500 tnum">({count})</span>
            )}
          </h3>
          {subtitle && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
