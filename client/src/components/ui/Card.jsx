export default function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`bg-white rounded-xl shadow-card border border-navy-100/60 p-6 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
