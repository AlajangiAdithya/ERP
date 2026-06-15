const variants = {
  primary: `bg-gradient-to-b from-navy-600 to-navy-800 text-white shadow-btn
    hover:from-navy-700 hover:to-navy-900 focus:ring-navy-500`,
  secondary: `bg-white text-navy-700 border border-navy-200 shadow-sm
    hover:bg-navy-50 hover:border-navy-300 focus:ring-navy-500`,
  danger: `bg-gradient-to-b from-red-500 to-red-700 text-white shadow-btn
    hover:from-red-600 hover:to-red-800 focus:ring-red-500`,
  ghost: 'text-navy-700 hover:bg-navy-100/70 focus:ring-navy-500',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

// Inline spinner so the button needs no icon import and stays self-contained.
function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function Button({ children, variant = 'primary', size = 'md', className = '', loading = false, disabled, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.98]
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100
        ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
