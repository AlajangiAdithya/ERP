import { Calendar, X } from 'lucide-react';

export default function DateRangeFilter({ fromDate, toDate, onFromChange, onToChange }) {
  const hasDates = fromDate || toDate;

  const clear = () => {
    onFromChange('');
    onToChange('');
  };

  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
        <div className="relative">
          <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => onFromChange(e.target.value)}
            className="pl-8 pr-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
        <div className="relative">
          <Calendar size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => onToChange(e.target.value)}
            className="pl-8 pr-2 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500"
          />
        </div>
      </div>
      {hasDates && (
        <button
          onClick={clear}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          title="Clear date filter"
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}
