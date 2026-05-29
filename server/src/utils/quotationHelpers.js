// Shared helpers for quotation routes. Lives here so both
// quotation.routes.js and materialPool.routes.js can use the same
// supplier resolution + compliance check logic without circular imports.

const prisma = require('../config/db');
const { getFinancialYear } = require('./helpers');

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

// Hard blocker: Vendor Evaluation PDF must be on file.
// Soft warning: Supplier Assessment PDF (per-FY) — expired = warn but allow.
async function checkSuppliersCompliance(supplierIds) {
  const ids = [...new Set(supplierIds.filter(Boolean))];
  if (ids.length === 0) return { hardIssues: [], softWarnings: [] };
  const currentFY = getFinancialYear();
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      vendorEvaluationPdfUrl: true,
      supplierAssessmentPdfUrl: true,
      assessmentFiscalYear: true,
    },
  });
  const hardIssues = [];
  const softWarnings = [];
  for (const s of suppliers) {
    if (!s.vendorEvaluationPdfUrl) {
      hardIssues.push({ supplierId: s.id, supplierName: s.name, missing: ['vendor-evaluation'] });
    }
    if (!s.supplierAssessmentPdfUrl || s.assessmentFiscalYear !== currentFY) {
      softWarnings.push({
        supplierId: s.id,
        supplierName: s.name,
        expiredFY: s.assessmentFiscalYear || null,
      });
    }
  }
  return { hardIssues, softWarnings };
}

function complianceErrorPayload(issues) {
  const currentFY = getFinancialYear();
  const lines = issues.map(i => `${i.supplierName}: Vendor Evaluation PDF`);
  return {
    error: `Cannot submit quotation — the following supplier(s) need a Vendor Evaluation PDF uploaded first:\n${lines.join('\n')}`,
    complianceIssues: issues,
    currentFinancialYear: currentFY,
  };
}

module.exports = {
  QTY_TOLERANCE,
  resolveSupplierId,
  checkSuppliersCompliance,
  complianceErrorPayload,
};
