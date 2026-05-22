export default function DashboardHero({ title, subtitle, actions }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white border border-navy-100/70 shadow-card">
      {/* Left navy accent strip */}
      <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-blue-500 via-navy-600 to-navy-800" aria-hidden="true" />

      {/* Rocket photo — anchored right, very subtle, faded to white */}
      <div
        className="absolute inset-y-0 right-0 w-2/3 bg-cover bg-right opacity-[0.12] pointer-events-none hidden sm:block"
        style={{
          backgroundImage: "url('/rocket.jpg')",
          maskImage: 'linear-gradient(to left, black 10%, transparent 85%)',
          WebkitMaskImage: 'linear-gradient(to left, black 10%, transparent 85%)',
        }}
        aria-hidden="true"
      />

      {/* Soft decorative orbs */}
      <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-blue-500/[0.07] blur-3xl pointer-events-none" aria-hidden="true" />
      <div className="absolute -left-10 -bottom-16 w-56 h-56 rounded-full bg-navy-500/[0.05] blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-6 py-6 pl-7">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-[23px] font-bold text-navy-800 tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] text-navy-500 mt-1.5">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 relative z-10">{actions}</div>
        )}
      </div>
    </div>
  );
}
