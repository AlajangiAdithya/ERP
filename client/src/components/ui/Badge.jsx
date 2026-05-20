const colorMap = {
  green: 'bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20 shadow-sm',
  red: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/10 shadow-sm',
  yellow: 'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20 shadow-sm',
  blue: 'bg-blue-50 text-brand-blueLight ring-1 ring-inset ring-blue-600/20 shadow-sm',
  gray: 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-500/10 shadow-sm',
  navy: 'bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-600/20 shadow-sm',
};

export default function Badge({ children, color = 'gray', className = '' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wide uppercase transition-all duration-200 ${colorMap[color]} ${className}`}>
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
