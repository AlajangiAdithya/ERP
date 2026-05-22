const colorMap = {
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  amber: 'bg-amber-100 text-amber-800 border border-amber-300',
  blue: 'bg-blue-100 text-blue-700',
  gray: 'bg-gray-100 text-gray-600',
  navy: 'bg-navy-100 text-navy-700',
  purple: 'bg-purple-100 text-purple-700',
  orange: 'bg-orange-100 text-orange-800 border border-orange-300',
};

export default function Badge({ children, color = 'gray', className = '' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorMap[color]} ${className}`}>
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
