const fieldClasses = (error) => `w-full px-3.5 py-2 bg-white border rounded-lg text-sm text-navy-800 transition-all duration-150
  placeholder:text-gray-400 hover:border-navy-300
  focus:outline-none focus:ring-2 focus:ring-blue-500/25 focus:border-blue-600
  ${error ? 'border-red-400 hover:border-red-400 focus:border-red-500 focus:ring-red-500/20' : 'border-navy-200'}
  disabled:bg-navy-50/60 disabled:text-gray-500 disabled:hover:border-navy-200`;

const labelClasses = 'block text-[13px] font-semibold text-navy-700 mb-1.5';

export default function Input({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className={labelClasses}>{label}</label>}
      <input className={fieldClasses(error)} {...props} />
      {error && <p className="mt-1.5 text-xs font-medium text-brand-red">{error}</p>}
    </div>
  );
}

export function Select({ label, error, children, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className={labelClasses}>{label}</label>}
      <select className={fieldClasses(error)} {...props}>
        {children}
      </select>
      {error && <p className="mt-1.5 text-xs font-medium text-brand-red">{error}</p>}
    </div>
  );
}

export function Textarea({ label, error, className = '', ...props }) {
  return (
    <div className={className}>
      {label && <label className={labelClasses}>{label}</label>}
      <textarea className={fieldClasses(error)} rows={3} {...props} />
      {error && <p className="mt-1.5 text-xs font-medium text-brand-red">{error}</p>}
    </div>
  );
}
