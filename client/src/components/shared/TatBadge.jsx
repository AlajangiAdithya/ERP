import { Timer, AlertTriangle, Clock } from 'lucide-react';
import { tatStatus, tatBadgeClass, formatElapsed } from '../../utils/tat';

// Small ageing pill for a pending task. Yellow past the warn window (24h),
// red past the breach window (48h). Renders nothing while on-time unless
// `showOk` is set. Re-computes from `since` on each render — parents that
// want a live countdown should re-render periodically (lists refetch on poll).
//
//   <TatBadge since={wo.createdAt} label="pending admin" />
//   <TatBadge since={wo.adminAcceptedAt} warnHours={24} breachHours={48} />
export default function TatBadge({
  since,
  warnHours = 24,
  breachHours = 48,
  label,
  showOk = false,
  className = '',
}) {
  const { level, hours } = tatStatus(since, { warnHours, breachHours });
  if (level === 'none') return null;
  if (level === 'ok' && !showOk) return null;

  const Icon = level === 'breach' ? AlertTriangle : level === 'warn' ? Timer : Clock;
  const elapsed = formatElapsed(hours);
  const tip = level === 'breach'
    ? `Overdue — pending ${elapsed} (over ${breachHours}h SLA)`
    : level === 'warn'
      ? `Ageing — pending ${elapsed} (over ${warnHours}h)`
      : `Pending ${elapsed}`;

  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ring-inset
        ${tatBadgeClass[level]} ${level === 'breach' ? 'animate-pulse' : ''} ${className}`}
    >
      <Icon size={11} aria-hidden="true" />
      {elapsed}
      {label ? <span className="font-normal opacity-75">· {label}</span> : null}
    </span>
  );
}
