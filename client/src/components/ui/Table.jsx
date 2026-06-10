import { Inbox } from 'lucide-react';

export default function Table({ columns, data, onRowClick, emptyMessage = 'No data found' }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-100/70">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gradient-to-b from-navy-50 to-navy-50/40 border-b border-navy-100">
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 text-left font-semibold text-navy-600 uppercase tracking-[0.08em] text-[11px] whitespace-nowrap"
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <span className="flex items-center justify-center w-11 h-11 rounded-full bg-navy-50 text-navy-300">
                    <Inbox size={20} strokeWidth={1.8} />
                  </span>
                  <span className="text-sm">{emptyMessage}</span>
                </div>
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr
                key={row.id || i}
                className={`border-b border-navy-50 last:border-b-0 transition-colors
                  ${i % 2 === 1 ? 'bg-navy-50/30' : 'bg-white'}
                  ${onRowClick ? 'cursor-pointer hover:bg-blue-50/70' : 'hover:bg-navy-50/50'}`}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-4 py-3 text-gray-700 tnum"
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
