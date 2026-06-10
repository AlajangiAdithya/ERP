const colorMap = {
  green: 'bg-green-50 text-green-700 ring-green-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  yellow: 'bg-yellow-50 text-yellow-700 ring-yellow-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-300',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  gray: 'bg-gray-50 text-gray-600 ring-gray-200',
  navy: 'bg-navy-50 text-navy-700 ring-navy-200',
  purple: 'bg-purple-50 text-purple-700 ring-purple-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-300',
};

const dotMap = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  gray: 'bg-gray-400',
  navy: 'bg-navy-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
};

export default function Badge({ children, color = 'gray', className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset
        ${colorMap[color] || colorMap.gray} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotMap[color] || dotMap.gray}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export const statusColors = {
  DRAFT: 'gray',
  SENT: 'blue',
  PARTIALLY_RECEIVED: 'yellow',
  RECEIVED: 'green',
  CANCELLED: 'red',
  CONFIRMED: 'blue',
  DISPATCHED: 'yellow',
  DELIVERED: 'green',
  UNPAID: 'red',
  PARTIALLY_PAID: 'yellow',
  PAID: 'green',
  OVERDUE: 'red',
  IN: 'green',
  OUT: 'red',
  ADJUSTMENT: 'blue',
};
