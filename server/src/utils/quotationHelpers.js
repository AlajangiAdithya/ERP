// Shared helpers for quotation routes. Lives here so both
// quotation.routes.js and materialPool.routes.js can use the same
// supplier resolution + compliance check logic without circular imports.

const prisma = require('../config/db');
const { getFinancialYear } = require('./helpers');
const { supplierComplianceStatus } = require('./supplierCompliance');

// Tolerance for float-sum vs total comparison (kg/litre/pcs all use Float).
const QTY_TOLERANCE = 0.001;

// Given a free-text supplier name (+ optional hint id), return a canonical
// supplier id by upserting on case-insensitive name. Lets us attach
// supplierId to every Quotation/QuotationItem so supplier history stays
// accurate even when the PO types the supplier name with different casing.
async function resolveSupplierId(name, contact, address, hintId) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  if (hintId) {
    const ok = await prisma.supplier.findUnique({ where: { id: hintId } });
    if (ok) return ok.id;
  }
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing.id;
  const created = await prisma.supplier.create({
    data: { name: trimmed, contact: (contact || '').trim() || null, address: (address || '').trim() || null },
  });
  return created.id;
}

// Hard blocker: a supplier must have a Supplier Assessment (SA) on file AND its
// active evaluation doc (latest Vendor Re-Evaluation, or the SA itself for new
// suppliers) must not be expired. Both are required to proceed — there are no
// soft warnings here anymore (`softWarnings` kept for caller compatibility).
async function checkSuppliersCompliance(supplierIds) {
  const ids = [...new Set(supplierIds.filter(Boolean))];
  if (ids.length === 0) return { hardIssues: [], softWarnings: [] };
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      supplierAssessmentPdfUrl: true,
      supplierAssessmentDate: true,
      vendorEvaluationPdfUrl: true,
      vendorEvaluationDate: true,
    },
  });
  const hardIssues = [];
  for (const s of suppliers) {
    const status = supplierComplianceStatus(s);
    if (!status.compliant) {
      hardIssues.push({ supplierId: s.id, supplierName: s.name, reason: status.reason });
    }
  }
  return { hardIssues, softWarnings: [] };
}

function complianceErrorPayload(issues) {
  const lines = issues.map(i => `${i.supplierName}: ${i.reason}`);
  return {
    error: `Cannot submit quotation — the following supplier(s) are not compliant:\n${lines.join('\n')}`,
    complianceIssues: issues,
    currentFinancialYear: getFinancialYear(),
  };
}

module.exports = {
  QTY_TOLERANCE,
  resolveSupplierId,
  checkSuppliersCompliance,
  complianceErrorPayload,
};
