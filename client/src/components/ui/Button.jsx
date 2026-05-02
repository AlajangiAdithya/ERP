const variants = {
  primary: 'bg-navy-700 text-white hover:bg-navy-800 focus:ring-navy-500',
  secondary: 'bg-white text-navy-700 border border-navy-200 hover:bg-navy-50 focus:ring-navy-500',
  danger: 'bg-brand-red text-white hover:bg-red-700 focus:ring-red-500',
  ghost: 'text-navy-700 hover:bg-navy-50 focus:ring-navy-500',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
};

export default function Button({ children, variant = 'primary', size = 'md', className = '', disabled, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-medium rounded-md transition-colors
        focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed
        ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
