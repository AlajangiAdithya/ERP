export default function Input({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input
        className={`w-full px-3 py-2 border rounded-md text-sm transition-colors
          focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500
          ${error ? 'border-red-400' : 'border-gray-300'}
          disabled:bg-gray-50 disabled:text-gray-500`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-brand-red">{error}</p>}
    </div>
  );
}

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <select
        className={`w-full px-3 py-2 border rounded-md text-sm transition-colors
          focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500
          ${error ? 'border-red-400' : 'border-gray-300'}
          disabled:bg-gray-50 disabled:text-gray-500`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-brand-red">{error}</p>}
    </div>
  );
}

export function Textarea({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <textarea
        className={`w-full px-3 py-2 border rounded-md text-sm transition-colors
          focus:outline-none focus:ring-2 focus:ring-navy-500 focus:border-navy-500
          ${error ? 'border-red-400' : 'border-gray-300'}`}
        rows={3}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-brand-red">{error}</p>}
    </div>
  );
}
