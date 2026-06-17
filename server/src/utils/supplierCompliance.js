// Supplier compliance status — shared by the supplier API (to decorate rows for
// the UI) and the quotation gate (to block non-compliant suppliers).
//
// Model:
//   - SA (Supplier Assessment) = the PRIMARY doc, captured once, kept forever.
//   - VE (Vendor Re-Evaluation) = recurring yearly doc; the LATEST one is active,
//     older ones are retained but unused.
//   - Each doc is valid for 1 year from its Purchase-entered document date.
//   - The active clock is the latest VE if one exists, otherwise the SA.
//   - A doc that has a URL but no date is grandfathered (treated as valid) so
//     pre-existing uploads don't suddenly block procurement.

const WARN_DAYS = 7; // red blinking warning fires this many days before expiry.
const DAY_MS = 24 * 60 * 60 * 1000;

// Calendar-aware "+1 year".
function addYear(date) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

// Compute compliance from a supplier's denormalized SA + latest-VE fields.
function supplierComplianceStatus(s, now = new Date()) {
  const hasSA = !!s.supplierAssessmentPdfUrl;
  const hasVE = !!s.vendorEvaluationPdfUrl;
  const saDate = s.supplierAssessmentDate ? new Date(s.supplierAssessmentDate) : null;
  const veDate = s.vendorEvaluationDate ? new Date(s.vendorEvaluationDate) : null;

  // Active doc governs the expiry clock: latest VE if any, else SA.
  const activeKind = hasVE ? 'VE' : hasSA ? 'SA' : null;
  const activeDate = hasVE ? veDate : saDate;
  const activeExpiry = activeDate ? addYear(activeDate) : null;

  const daysToExpiry = activeExpiry
    ? Math.ceil((activeExpiry.getTime() - now.getTime()) / DAY_MS)
    : null;
  // Undated active doc → grandfathered valid (never "expired", no warning).
  const expired = activeExpiry ? activeExpiry.getTime() < now.getTime() : false;
  const expiringSoon = daysToExpiry !== null && !expired && daysToExpiry <= WARN_DAYS;

  // Compliant for procurement: SA on file AND the active doc not expired.
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
    hasSA,
    hasVE,
    saDate: saDate ? saDate.toISOString() : null,
    veDate: veDate ? veDate.toISOString() : null,
    activeKind,
    activeExpiry: activeExpiry ? activeExpiry.toISOString() : null,
    daysToExpiry,
    expired,
    expiringSoon,
    compliant,
    reason,
  };
}

module.exports = { supplierComplianceStatus, addYear, WARN_DAYS };
