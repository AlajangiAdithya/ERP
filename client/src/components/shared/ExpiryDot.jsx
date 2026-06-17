import { supplierComplianceStatus } from '../../utils/supplierCompliance';

// Red blinking dot shown when a supplier's active SA/VE document is expired or
// within 7 days of expiry. Renders nothing while the document is comfortably
// valid (or when there are no documents at all — that's handled elsewhere).
// Pass either a `supplier` (raw fields) or a precomputed `status`.
export default function ExpiryDot({ supplier, status, showLabel = true, className = '' }) {
  const st = status || supplierComplianceStatus(supplier);
  if (!st || (!st.expired && !st.expiringSoon)) return null;

  const label = st.expired
    ? `${st.activeKind === 'VE' ? 'Re-evaluation' : 'Assessment'} expired`
    : `Expires in ${st.daysToExpiry} day${st.daysToExpiry === 1 ? '' : 's'}`;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={label}>
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
      </span>
      {showLabel && <span className="text-[10px] font-semibold text-red-600">{label}</span>}
    </span>
  );
}
