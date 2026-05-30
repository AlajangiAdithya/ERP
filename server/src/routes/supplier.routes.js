const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { paginate, getFinancialYear } = require('../utils/helpers');
const {
  vendorEvaluationUpload,
  supplierAssessmentUpload,
  publicUrlFor,
} = require('../middleware/upload');

const router = express.Router();

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING'];

// Decorate a supplier with compliance flags computed from current FY.
// `hasVendorEvaluation`  — one-time PDF is on file.
// `assessmentValidForCurrentFY` — assessment was uploaded against the current FY.
// `currentFinancialYear` — server's view of the current FY (so the client doesn't
//                          have to redo the date math).
const withCompliance = (supplier) => {
  if (!supplier) return supplier;
  const currentFY = getFinancialYear();
  return {
    ...supplier,
    currentFinancialYear: currentFY,
    hasVendorEvaluation: !!supplier.vendorEvaluationPdfUrl,
    assessmentValidForCurrentFY:
      !!supplier.supplierAssessmentPdfUrl && supplier.assessmentFiscalYear === currentFY,
  };
};

const supplierSchema = z.object({
  name: z.string().min(1).transform(s => s.trim()),
  contact: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  gstNumber: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// GET /api/suppliers?search=&productId=&page=&limit=
// productId filter: returns only suppliers who have previously quoted/supplied that product.
router.get('/', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { search, productId, page, limit } = req.query;

    let supplierIdFilter = null;
    if (productId) {
      // Find supplier ids referenced from QuotationItem or PurchaseOrderItem for this product.
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
        ...qSuppliers.map(s => s.supplierId).filter(Boolean),
        ...poSuppliers.map(s => s.supplierId).filter(Boolean),
      ]);
      supplierIdFilter = [...ids];
    }

    const where = { isActive: true };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (supplierIdFilter) where.id = { in: supplierIdFilter.length ? supplierIdFilter : ['__none__'] };

    if (limit === 'all') {
      const suppliers = await prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
      return res.json({
        suppliers: suppliers.map(withCompliance),
        total: suppliers.length,
        page: 1,
        totalPages: 1,
        currentFinancialYear: getFinancialYear(),
      });
    }

    const { skip, take } = paginate(page, limit);
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      prisma.supplier.count({ where }),
    ]);

    res.json({
      suppliers: suppliers.map(withCompliance),
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
      currentFinancialYear: getFinancialYear(),
    });
  } catch (error) {
    console.error('List suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suppliers/:id
router.get('/:id', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(withCompliance(supplier));
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Multer wrappers that turn errors into 400s. Each accepts a single PDF named
// `file` so the client uses the same field for both endpoints.
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

// POST /api/suppliers/:id/vendor-evaluation — Purchase Officer uploads the
// vendor evaluation PDF the first time a supplier is onboarded. The form has
// no expiry; once uploaded it sticks. We still allow re-upload (e.g. to fix a
// wrong file) but log it as an audit event.
router.post(
  '/:id/vendor-evaluation',
  authenticate,
  authorizeMinRole('PURCHASE_OFFICER'),
  acceptVendorEvaluation,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
      const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
      if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

      const url = publicUrlFor('vendor-evaluations', req.file.filename);
      const updated = await prisma.supplier.update({
        where: { id: req.params.id },
        data: { vendorEvaluationPdfUrl: url, vendorEvaluationUploadedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: supplier.vendorEvaluationPdfUrl ? 'REPLACE' : 'CREATE',
          entity: 'Supplier.VendorEvaluation',
          entityId: supplier.id,
          details: { supplierName: supplier.name, url },
          ipAddress: req.ip,
        },
      });

      res.json(withCompliance(updated));
    } catch (error) {
      console.error('Vendor evaluation upload error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/suppliers/:id/supplier-assessment — Purchase Officer uploads the
// annual assessment. Stamps the current financial year so we can detect
// expiry at the start of the next FY.
router.post(
  '/:id/supplier-assessment',
  authenticate,
  authorizeMinRole('PURCHASE_OFFICER'),
  acceptSupplierAssessment,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'A PDF file is required' });
      const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
      if (!supplier) return res.status(404).json({ error: 'Supplier not found' });

      const url = publicUrlFor('supplier-assessments', req.file.filename);
      const fy = getFinancialYear();
      const updated = await prisma.supplier.update({
        where: { id: req.params.id },
        data: {
          supplierAssessmentPdfUrl: url,
          assessmentFiscalYear: fy,
          assessmentUploadedAt: new Date(),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'CREATE',
          entity: 'Supplier.Assessment',
          entityId: supplier.id,
          details: { supplierName: supplier.name, fiscalYear: fy, url },
          ipAddress: req.ip,
        },
      });

      res.json(withCompliance(updated));
    } catch (error) {
      console.error('Supplier assessment upload error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/suppliers — create (Purchase Officer + Admin)
router.post('/', authenticate, authorizeMinRole('PURCHASE_OFFICER'), auditLog('CREATE', 'Supplier'), async (req, res) => {
  try {
    const data = supplierSchema.parse(req.body);
    // Case-insensitive dedupe: if a supplier with this name already exists, return it.
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    });
    if (existing) return res.status(200).json(withCompliance(existing));
    const supplier = await prisma.supplier.create({ data });
    res.status(201).json(withCompliance(supplier));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Supplier name already exists' });
    }
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/suppliers/:id (Admin only — contact info update)
router.patch('/:id', authenticate, authorizeMinRole('PURCHASE_OFFICER'), auditLog('UPDATE', 'Supplier'), async (req, res) => {
  try {
    const data = supplierSchema.partial().parse(req.body);
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data });
    res.json(withCompliance(supplier));
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Supplier not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Supplier name already exists' });
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
