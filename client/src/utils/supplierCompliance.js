// Date-driven SA/VE compliance — mirror of server/src/utils/supplierCompliance.js.
//   - SA (Supplier Assessment) = primary doc, kept forever, valid 1 year.
//   - VE (Vendor Re-Evaluation) = recurring yearly doc; latest is active.
//   - Active clock = latest VE if present, else SA.
//   - A doc with a URL but no date is grandfathered (treated as valid).

export const WARN_DAYS = 7; // red blinking warning fires this many days before expiry.
const DAY_MS = 24 * 60 * 60 * 1000;

const addYear = (d) => {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + 1);
  return x;
};

export function supplierComplianceStatus(s, now = new Date()) {
  const hasSA = !!s?.supplierAssessmentPdfUrl;
  const hasVE = !!s?.vendorEvaluationPdfUrl;
  const saDate = s?.supplierAssessmentDate ? new Date(s.supplierAssessmentDate) : null;
  const veDate = s?.vendorEvaluationDate ? new Date(s.vendorEvaluationDate) : null;

  const activeKind = hasVE ? 'VE' : hasSA ? 'SA' : null;
  const activeDate = hasVE ? veDate : saDate;
  const activeExpiry = activeDate ? addYear(activeDate) : null;

  const daysToExpiry = activeExpiry
    ? Math.ceil((activeExpiry.getTime() - now.getTime()) / DAY_MS)
    : null;
  const expired = activeExpiry ? activeExpiry.getTime() < now.getTime() : false;
  const expiringSoon = daysToExpiry !== null && !expired && daysToExpiry <= WARN_DAYS;
  const compliant = hasSA && !expired;

  let reason = null;
  if (!hasSA) {
    reason = 'Supplier Assessment (SA) PDF required';
  } else if (expired) {
    reason = hasVE
      ? 'Vendor Re-Evaluation (VE) has expired — upload a new VE'
      : 'Supplier Assessment (SA) has expired — upload a Vendor Re-Evaluation (VE)';
  }

  return {
    hasSA, hasVE, saDate, veDate,
    activeKind, activeExpiry, daysToExpiry,
    expired, expiringSoon, compliant, reason,
  };
}
