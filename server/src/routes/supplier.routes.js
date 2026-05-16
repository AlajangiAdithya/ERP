const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const { paginate } = require('../utils/helpers');

const router = express.Router();

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
router.get('/', authenticate, async (req, res) => {
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
      return res.json({ suppliers, total: suppliers.length, page: 1, totalPages: 1 });
    }

    const { skip, take } = paginate(page, limit);
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, skip, take }),
      prisma.supplier.count({ where }),
    ]);

    res.json({ suppliers, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('List suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/suppliers/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (error) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/suppliers — create (Purchase Officer + Admin)
router.post('/', authenticate, authorizeMinRole('PURCHASE_OFFICER'), auditLog('CREATE', 'Supplier'), async (req, res) => {
  try {
    const data = supplierSchema.parse(req.body);
    // Case-insensitive dedupe: if a supplier with this name already exists, return it.
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' } },
    });
    if (existing) return res.status(200).json(existing);
    const supplier = await prisma.supplier.create({ data });
    res.status(201).json(supplier);
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
    res.json(supplier);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error.code === 'P2025') return res.status(404).json({ error: 'Supplier not found' });
    if (error.code === 'P2002') return res.status(409).json({ error: 'Supplier name already exists' });
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
