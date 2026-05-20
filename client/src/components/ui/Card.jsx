export default function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-card border border-slate-200/60 p-6 sm:p-7 relative overflow-hidden transition-all duration-300 hover:shadow-cardHover ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
