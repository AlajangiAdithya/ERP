export default function Card({ children, className = '', ...props }) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-card border border-navy-100/70 p-6
        transition-shadow duration-200 hover:shadow-cardHover ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
