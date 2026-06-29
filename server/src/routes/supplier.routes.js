const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { paginate, getFinancialYear, withDocRetry } = require('../utils/helpers');
const { supplierComplianceStatus } = require('../utils/supplierCompliance');
const {
  vendorEvaluationUpload,
  supplierAssessmentUpload,
  publicUrlFor,
} = require('../middleware/upload');

const router = express.Router();

// Approved Supplier List viewers: per client spec — admin, managers, purchase,
// stores, designs. (Other procurement roles can still see suppliers through
// quotation/PO contexts; this scope governs the register UI.)
// ACCOUNTING + FINANCE added as read-only observers; the client hides edit
// controls from them (canEdit = PURCHASE_OFFICER/ADMIN only).
const VIEW_ROLES = ['ADMIN', 'MANAGER', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'DESIGNS', 'ACCOUNTING', 'FINANCE'];

// Decorate a supplier with compliance flags computed from current FY plus the
// latest re-evaluation snapshot for the "Evaluation Details" panel. The client
// reads `currentReEvaluation` to populate the right-hand columns.
const decorate = (supplier, currentFY) => {
  if (!supplier) return supplier;
  const fy = currentFY || getFinancialYear();
  const latestReEval = supplier.reEvaluations?.find((r) => r.financialYear === fy)
                    || supplier.reEvaluations?.[0]
                    || null;
  // Strip the array — the panel only needs the latest record.
  const { reEvaluations, ...rest } = supplier;
  return {
    ...rest,
    currentFinancialYear: fy,
    hasVendorEvaluation: !!supplier.vendorEvaluationPdfUrl,
    // Date-driven SA/VE compliance (see utils/supplierCompliance.js). Drives the
    // red blinking expiry dot and the procurement gate.
    compliance: supplierComplianceStatus(supplier),
    currentReEvaluation: latestReEval,
  };
};

const supplierSchema = z.object({
  name: z.string().min(1).transform((s) => s.trim()),
  contact: z.string().optional().nullable(),
  contactPerson: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  scopeOfSupply: z.string().optional().nullable(),
  materialType: z.enum(['MATERIAL', 'JOB_WORK', 'SERVICE']).optional().nullable(),
  approvalStatus: z.enum(['APPROVED', 'CONDITIONAL', 'REJECTED', 'TERMINATED']).optional().nullable(),
  approvalDate: z.string().optional().nullable(),
  typeAndExtentOfControl: z.string().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

// Coerce ISO date strings → Date | null before sending to Prisma.
const toDate = (v) => (v ? new Date(v) : null);

// Auto-generate the next vendor ID as RAPS/SUP/<N>. Sequential across all FY;
// counter is global since once a supplier is onboarded the number is permanent.
async function nextVendorId() {
  const rows = await prisma.supplier.findMany({
    where: { vendorIdNo: { startsWith: 'RAPS/SUP/' } },
    select: { vendorIdNo: true },
  });
  let max = 0;
  for (const { vendorIdNo } of rows) {
    if (!vendorIdNo) continue;
    const tail = vendorIdNo.slice('RAPS/SUP/'.length);
    const n = parseInt(tail, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `RAPS/SUP/${String(max + 1).padStart(4, '0')}`;
}

// Sort-order options for the Approved Supplier List. Keyed by the `sort` query
// param so the order is applied in the DB (across all pages), not just the page
// the client is showing. Default = Vendor ID ascending (RAPS/SUP/#### is zero-
// padded, so a string sort matches numeric order).
const SORT_MAP = {
  vendor_asc:  { vendorIdNo: 'asc' },
  vendor_desc: { vendorIdNo: 'desc' },
  name_asc:    { name: 'asc' },
  name_desc:   { name: 'desc' },
  newest:      { createdAt: 'desc' },
  oldest:      { createdAt: 'asc' },
};
const resolveSort = (sort) => SORT_MAP[sort] || SORT_MAP.vendor_asc;

// ─── List & detail ──────────────────────────────────────────────────────

// GET /api/suppliers?search=&productId=&page=&limit=&fy=&sort=
router.get('/', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const { search, productId, page, limit, fy, sort } = req.query;
    const targetFY = fy || getFinancialYear();
    const orderBy = resolveSort(sort);

    let supplierIdFilter = null;
    if (productId) {
      const [qSuppliers, poSuppliers] = await Promise.all([
        prisma.quotationItem.findMany({
          where: { productId, supplierId: { not: null } },
          select: { supplierId: true },
          distinct: ['supplierId'],
        }),
        prisma.purchaseOrderItem.findMany({
          where: { productId, supplierId: { not: null } },
          select: { supplierId: true },
          distinct: ['supplierId'],
        }),
      ]);
      const ids = new Set([
        ...qSuppliers.map((s) => s.supplierId).filter(Boolean),
        ...poSuppliers.map((s) => s.supplierId).filter(Boolean),
      ]);
      supplierIdFilter = [...ids];
    }

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { vendorIdNo: { contains: search, mode: 'insensitive' } },
        { scopeOfSupply: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (supplierIdFilter) where.id = { in: supplierIdFilter.length ? supplierIdFilter : ['__none__'] };

    // Pull the latest 2 re-evaluations per supplier so decorate() can pick the
    // FY-matching one (or fall back to the most recent).
    const includeReEvals = {
      reEvaluations: { orderBy: { evaluationDate: 'desc' }, take: 5 },
    };

    if (limit === 'all') {
      const suppliers = await prisma.supplier.findMany({
        where, orderBy, include: includeReEvals,
      });
      return res.json({
        suppliers: suppliers.map((s) => decorate(s, targetFY)),
        total: suppliers.length,
        page: 1,
        totalPages: 1,
        currentFinancialYear: targetFY,
      });
    }

    const { skip, take } = paginate(page, limit);
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy, skip, take, include: includeReEvals }),
      prisma.supplier.count({ where }),
    ]);

    res.json({
      suppliers: suppliers.map((s) => decorate(s, targetFY)),
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
      currentFinancialYear: targetFY,
    });
  } catch (error) {
    console.error('List suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suppliers/:id?fy=
router.get('/:id', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const targetFY = req.query.fy || getFinancialYear();
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        reEvaluations:    { orderBy: { evaluationDate: 'desc' } },
        assessmentForms:  { orderBy: { createdAt: 'desc' } },
        vendorEvaluations: { orderBy: { documentDate: 'desc' } },
      },
    });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(decorate(supplier, targetFY));
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PDF upload (kept as fallback) ──────────────────────────────────────
function acceptVendorEvaluation(req, res, next) {
  vendorEvaluationUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}
function acceptSupplierAssessment(req, res, next) {
  supplierAssessmentUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}

router.post(
  '/:id/vendor-evaluation',
  authenticate,
  authorizeMinRole('PURCHASE_OFFICER'),
  acceptVendorEvaluation,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
      const documentDate = req.body.documentDate ? new Date(req.body.documentDate) : null;
      if (!documentDate || Number.isNaN(documentDate.getTime())) {
        return res.status(400).json({ error: 'A re-evaluation document date is required' });
      }
      const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
      if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

      const url = publicUrlFor('vendor-evaluations', req.file.filename);
      // Append to the VE history, then denormalize the latest (by document date)
      // onto the supplier so the gate and UI read it cheaply.
      await prisma.supplierVendorEvaluation.create({
        data: {
          supplierId: supplier.id,
          pdfUrl: url,
          documentDate,
          uploadedByUserId: req.user.id,
          uploadedByName: req.user.name,
        },
      });
      const latest = await prisma.supplierVendorEvaluation.findFirst({
        where: { supplierId: supplier.id },
        orderBy: { documentDate: 'desc' },
      });
      const updated = await prisma.supplier.update({
        where: { id: req.params.id },
        data: {
          vendorEvaluationPdfUrl: latest.pdfUrl,
          vendorEvaluationDate: latest.documentDate,
          vendorEvaluationUploadedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: supplier.vendorEvaluationPdfUrl ? 'REPLACE' : 'CREATE',
          entity: 'Supplier.VendorEvaluation',
          entityId: supplier.id,
          details: { supplierName: supplier.name, url, documentDate },
          ipAddress: req.ip,
        },
      });

      res.json(decorate(updated));
    } catch (error) {
      console.error('Vendor evaluation upload error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/:id/supplier-assessment',
  authenticate,
  authorizeMinRole('PURCHASE_OFFICER'),
  acceptSupplierAssessment,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
      const documentDate = req.body.documentDate ? new Date(req.body.documentDate) : null;
      if (!documentDate || Number.isNaN(documentDate.getTime())) {
        return res.status(400).json({ error: 'An assessment document date is required' });
      }
      const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
      if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

      const url = publicUrlFor('supplier-assessments', req.file.filename);
      const fy = getFinancialYear(documentDate);
      const updated = await prisma.supplier.update({
        where: { id: req.params.id },
        data: {
          supplierAssessmentPdfUrl: url,
          supplierAssessmentDate: documentDate,
          assessmentFiscalYear: fy,
          assessmentUploadedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: supplier.supplierAssessmentPdfUrl ? 'REPLACE' : 'CREATE',
          entity: 'Supplier.Assessment',
          entityId: supplier.id,
          details: { supplierName: supplier.name, documentDate, url },
          ipAddress: req.ip,
        },
      });

      res.json(decorate(updated));
    } catch (error) {
      console.error('Supplier assessment upload error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Create / update supplier ───────────────────────────────────────────

// POST /api/suppliers — create (Purchase Officer + Admin)
router.post('/', authenticate, authorizeMinRole('PURCHASE_OFFICER'), auditLog('CREATE', 'Supplier'), async (req, res) => {
  try {
    const parsed = supplierSchema.parse(req.body);
    const data = {
      ...parsed,
      approvalDate: toDate(parsed.approvalDate),
    };

    // Case-insensitive dedupe: if a supplier with this name already exists, return it.
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    });
    if (existing) return res.status(200).json(decorate(existing));

    // Retry on the (rare) race where two concurrent inserts pick the same vendorIdNo.
    const supplier = await withDocRetry(async () => {
      const vendorIdNo = await nextVendorId();
      return prisma.supplier.create({ data: { ...data, vendorIdNo } });
    });
    res.status(201).json(decorate(supplier));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Supplier name or vendor ID already exists' });
    }
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/suppliers/:id
router.patch('/:id', authenticate, authorizeMinRole('PURCHASE_OFFICER'), auditLog('UPDATE', 'Supplier'), async (req, res) => {
  try {
    const parsed = supplierSchema.partial().parse(req.body);
    const data = { ...parsed };
    if ('approvalDate' in parsed) data.approvalDate = toDate(parsed.approvalDate);
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data });
    res.json(decorate(supplier));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Supplier not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Supplier name already exists' });
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Re-evaluation routes ───────────────────────────────────────────────

const reEvalSchema = z.object({
  financialYear: z.string().min(1).optional(),
  initialEvaluationDate: z.string().optional().nullable(),
  initialEvaluationScope: z.string().optional().nullable(),
  noOrders6Months: z.boolean().optional().nullable(),
  noOrdersReason: z.string().optional().nullable(),
  managementChanged: z.boolean().optional().nullable(),
  newMgmtContinuingTerms: z.boolean().optional().nullable(),
  shiftedLocation: z.boolean().optional().nullable(),
  newAddress: z.string().optional().nullable(),
  performanceBelowPar: z.boolean().optional().nullable(),
  correctiveActionInitiated: z.string().optional().nullable(),
  recommendedTermination: z.boolean().optional().nullable(),
  correctiveActionEffective: z.boolean().optional().nullable(),
  noNonconformitiesReported: z.boolean().optional().nullable(),
  newMachinesAdded: z.boolean().optional().nullable(),
  wishToContinueForNewParts: z.boolean().optional().nullable(),
  isoCertified: z.boolean().optional().nullable(),
  overallDecision: z.enum(['CONTINUES', 'TERMINATED']).optional(),
  evaluationDate: z.string().optional().nullable(),
  nextReviewDate: z.string().optional().nullable(),
  performanceRating: z.number().optional().nullable(),
  remarks: z.string().optional().nullable(),
});

const buildReEvalData = (parsed) => ({
  ...parsed,
  initialEvaluationDate: toDate(parsed.initialEvaluationDate),
  evaluationDate:        toDate(parsed.evaluationDate),
  nextReviewDate:        toDate(parsed.nextReviewDate),
});

// GET /api/suppliers/:id/re-evaluations
router.get('/:id/re-evaluations', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const list = await prisma.supplierReEvaluation.findMany({
      where: { supplierId: req.params.id },
      orderBy: { evaluationDate: 'desc' },
    });
    res.json({ reEvaluations: list });
  } catch (error) {
    console.error('List re-evaluations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/suppliers/:id/re-evaluations
router.post('/:id/re-evaluations', authenticate, authorizeMinRole('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const parsed = reEvalSchema.parse(req.body);
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const fy = parsed.financialYear || getFinancialYear();
    const data = buildReEvalData({ ...parsed, financialYear: fy });
    const created = await prisma.supplierReEvaluation.create({
      data: {
        ...data,
        supplierId: supplier.id,
        evaluatedByUserId: req.user.id,
        evaluatedByName: req.user.name,
      },
    });

    // If decision is TERMINATED, reflect that on the master record.
    if (parsed.overallDecision === 'TERMINATED') {
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { approvalStatus: 'TERMINATED' },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'Supplier.ReEvaluation',
        entityId: created.id,
        details: { supplierName: supplier.name, fiscalYear: fy, decision: created.overallDecision },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Create re-evaluation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/suppliers/:id/re-evaluations/:reEvalId
router.patch('/:id/re-evaluations/:reEvalId', authenticate, authorizeMinRole('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const parsed = reEvalSchema.partial().parse(req.body);
    const data = buildReEvalData(parsed);
    const updated = await prisma.supplierReEvaluation.update({
      where: { id: req.params.reEvalId },
      data,
    });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Re-evaluation not found' });
    console.error('Update re-evaluation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Structured assessment form routes ─────────────────────────────────

const assessmentSchema = z.object({
  financialYear: z.string().min(1).optional(),
  companyName: z.string().optional().nullable(),
  companyAddress: z.string().optional().nullable(),
  businessType: z.enum(['PROPRIETORSHIP', 'PARTNERSHIP', 'PRIVATE_LTD', 'PUBLIC_LTD']).optional().nullable(),
  businessRole: z.enum(['MANUFACTURER', 'SUPPLIER', 'DEALER']).optional().nullable(),
  productsRange: z.string().optional().nullable(),
  machineryAndEquipment: z.string().optional().nullable(),
  majorCustomers: z.string().optional().nullable(),
  transportFacilities: z.string().optional().nullable(),
  deliveryPeriod: z.string().optional().nullable(),
  allowsCapabilityVerify: z.boolean().optional().nullable(),
  hasQualityControlSystem: z.boolean().optional().nullable(),
  isoCertified: z.boolean().optional().nullable(),
  isoCertificateUrl: z.string().optional().nullable(),
  testCertWithDelivery: z.boolean().optional().nullable(),
  readyToUpgradePerformance: z.boolean().optional().nullable(),
  reviewComments: z.string().optional().nullable(),
});

// GET /api/suppliers/:id/assessment-forms
router.get('/:id/assessment-forms', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const list = await prisma.supplierAssessmentForm.findMany({
      where: { supplierId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ assessmentForms: list });
  } catch (error) {
    console.error('List assessment forms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/suppliers/:id/assessment-forms
router.post('/:id/assessment-forms', authenticate, authorizeMinRole('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const parsed = assessmentSchema.parse(req.body);
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

    const fy = parsed.financialYear || getFinancialYear();
    const created = await prisma.supplierAssessmentForm.create({
      data: {
        ...parsed,
        financialYear: fy,
        supplierId: supplier.id,
        reviewedByUserId: req.user.id,
        reviewedByName: req.user.name,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'Supplier.AssessmentForm',
        entityId: created.id,
        details: { supplierName: supplier.name, fiscalYear: fy },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Create assessment form error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/suppliers/:id/assessment-forms/:formId
router.patch('/:id/assessment-forms/:formId', authenticate, authorizeMinRole('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const parsed = assessmentSchema.partial().parse(req.body);
    const updated = await prisma.supplierAssessmentForm.update({
      where: { id: req.params.formId },
      data: parsed,
    });
    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Assessment form not found' });
    console.error('Update assessment form error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Performance rating routes ──────────────────────────────────────────

const ratingItemSchema = z.object({
  id: z.string().optional(),
  supplierId: z.string().optional().nullable(),
  itemDescription: z.string().min(1),
  supplierName: z.string().min(1),
  suppliesReceived: z.number().int().min(0).optional().default(0),
  qtyAccepted: z.number().int().min(0).optional().default(0),
  qualityRating: z.number().min(0).max(60).optional().default(0),
  totalDeliveries: z.number().int().min(0).optional().default(0),
  deliveriesOnTime: z.number().int().min(0).optional().default(0),
  deliveriesLate: z.number().int().min(0).optional().default(0),
  deliveryRating: z.number().min(0).max(40).optional().default(0),
});

const ratingSchema = z.object({
  financialYear: z.string().min(1),
  periodFrom: z.string().optional().nullable(),
  periodTo: z.string().optional().nullable(),
  preparedDate: z.string().optional().nullable(),
  minimumCriteria: z.number().min(0).max(100).optional().default(85),
  remarks: z.string().optional().nullable(),
  items: z.array(ratingItemSchema).optional().default([]),
});

const computeOverall = (items) => {
  if (!items.length) return 0;
  const sum = items.reduce((acc, it) => acc + (it.qualityRating + it.deliveryRating), 0);
  return Number((sum / items.length).toFixed(2));
};

// Sync the latest performance rating into each supplier's latest re-eval row
// for the same FY, so the master list "Performance Rating after review" column
// reflects the new score automatically.
async function syncRatingToReEvals(tx, fy, items) {
  for (const it of items) {
    if (!it.supplierId) continue;
    const latest = await tx.supplierReEvaluation.findFirst({
      where: { supplierId: it.supplierId, financialYear: fy },
      orderBy: { evaluationDate: 'desc' },
    });
    if (latest) {
      await tx.supplierReEvaluation.update({
        where: { id: latest.id },
        data: { performanceRating: Number((it.qualityRating + it.deliveryRating).toFixed(2)) },
      });
    }
  }
}

// GET /api/suppliers/performance-ratings?fy=
router.get('/performance-ratings/all', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const list = await prisma.supplierPerformanceRating.findMany({
      orderBy: { financialYear: 'desc' },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    res.json({ ratings: list });
  } catch (error) {
    console.error('List ratings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suppliers/performance-ratings/:fy  — single FY's rating
router.get('/performance-ratings/by-fy/:fy', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const rating = await prisma.supplierPerformanceRating.findUnique({
      where: { financialYear: req.params.fy },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!rating) return res.status(404).json({ error: 'No rating recorded for that FY' });
    res.json(rating);
  } catch (error) {
    console.error('Get rating error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/suppliers/performance-ratings  — upsert by FY
router.post('/performance-ratings', authenticate, authorizeMinRole('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const parsed = ratingSchema.parse(req.body);
    const itemsWithTotals = parsed.items.map((it) => ({
      ...it,
      totalRating: Number((it.qualityRating + it.deliveryRating).toFixed(2)),
    }));
    const overall = computeOverall(itemsWithTotals);

    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplierPerformanceRating.findUnique({
        where: { financialYear: parsed.financialYear },
      });

      let header;
      if (existing) {
        header = await tx.supplierPerformanceRating.update({
          where: { id: existing.id },
          data: {
            periodFrom:      toDate(parsed.periodFrom),
            periodTo:        toDate(parsed.periodTo),
            preparedDate:    toDate(parsed.preparedDate),
            preparedByName:  req.user.name,
            preparedByUserId: req.user.id,
            minimumCriteria: parsed.minimumCriteria,
            remarks:         parsed.remarks,
            overallRating:   overall,
          },
        });
        await tx.supplierPerformanceRatingItem.deleteMany({ where: { ratingId: header.id } });
      } else {
        header = await tx.supplierPerformanceRating.create({
          data: {
            financialYear:    parsed.financialYear,
            periodFrom:       toDate(parsed.periodFrom),
            periodTo:         toDate(parsed.periodTo),
            preparedDate:     toDate(parsed.preparedDate),
            preparedByName:   req.user.name,
            preparedByUserId: req.user.id,
            minimumCriteria:  parsed.minimumCriteria,
            remarks:          parsed.remarks,
            overallRating:    overall,
          },
        });
      }

      if (itemsWithTotals.length) {
        await tx.supplierPerformanceRatingItem.createMany({
          data: itemsWithTotals.map((it) => ({
            ratingId: header.id,
            supplierId: it.supplierId || null,
            itemDescription: it.itemDescription,
            supplierName: it.supplierName,
            suppliesReceived: it.suppliesReceived,
            qtyAccepted: it.qtyAccepted,
            qualityRating: it.qualityRating,
            totalDeliveries: it.totalDeliveries,
            deliveriesOnTime: it.deliveriesOnTime,
            deliveriesLate: it.deliveriesLate,
            deliveryRating: it.deliveryRating,
            totalRating: it.totalRating,
          })),
        });
      }

      await syncRatingToReEvals(tx, parsed.financialYear, itemsWithTotals);

      return tx.supplierPerformanceRating.findUnique({
        where: { id: header.id },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPSERT',
        entity: 'Supplier.PerformanceRating',
        entityId: saved.id,
        details: { fiscalYear: parsed.financialYear, overallRating: saved.overallRating, items: saved.items.length },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(saved);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Upsert rating error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
