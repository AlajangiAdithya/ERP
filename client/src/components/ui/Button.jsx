const variants = {
  primary: 'bg-gradient-to-r from-navy-700 to-navy-800 text-white hover:from-navy-800 hover:to-navy-900 shadow-md hover:shadow-lg focus:ring-navy-500 border border-navy-600/50',
  secondary: 'bg-white text-navy-700 border border-navy-200 shadow-sm hover:bg-slate-50 hover:border-navy-300 hover:shadow focus:ring-navy-500',
  danger: 'bg-gradient-to-r from-red-600 to-brand-red text-white hover:from-brand-red hover:to-red-700 shadow-md hover:shadow-lg focus:ring-red-500 border border-red-500/50',
  ghost: 'text-navy-700 hover:bg-navy-50 focus:ring-navy-500',
};

const sizes = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

export default function Button({ children, variant = 'primary', size = 'md', className = '', disabled, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all duration-200
        focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]
        ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
