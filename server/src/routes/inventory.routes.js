const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize, authorizeMinRole } = require('../middleware/rbac');
const { auditLog } = require('../middleware/audit');
const {
  paginate, applyDateFilter,
  generateProductSku, normalizeMaterialType, isUniqueViolation,
} = require('../utils/helpers');

const router = express.Router();

// POST /api/inventory/inward — Core inward entry flow
router.post('/inward', authenticate, authorize('ADMIN', 'STORE_MANAGER'), async (req, res) => {
  try {
    const { productId, quantity, batchNumber, notes, unitId } = req.body;
    const qty = parseFloat(quantity);

    if (!productId || !qty || qty <= 0) {
      return res.status(400).json({ error: 'Product and valid quantity are required' });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    // Owning unit: prefer explicit body unitId (STORE_MANAGER/ADMIN have no unit
    // of their own and must pick which unit owns the stock); otherwise the
    // requester's own unit. Validate when provided.
    let owningUnitId = unitId || req.user.unitId || null;
    if (unitId) {
      const targetUnit = await prisma.unit.findUnique({ where: { id: unitId }, select: { id: true } });
      if (!targetUnit) return res.status(400).json({ error: 'Selected unit does not exist' });
      owningUnitId = targetUnit.id;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { currentStock: { increment: qty } },
      });

      const movement = await tx.stockMovement.create({
        data: {
          productId,
          type: 'IN',
          quantity: qty,
          batchNumber: batchNumber || null,
          referenceType: 'InwardEntry',
          notes: notes || null,
          performedBy: req.user.id,
          unitId: owningUnitId,
        },
      });

      const batch = await tx.productBatch.create({
        data: {
          productId,
          batchNo: batchNumber || null,
          quantity: qty,
          remaining: qty,
          referenceType: 'InwardEntry',
          referenceId: movement.id,
          notes: notes || null,
          createdById: req.user.id,
        },
      });

      if (owningUnitId) {
        await tx.productUnitStock.upsert({
          where: { productId_unitId: { productId, unitId: owningUnitId } },
          update: { quantity: { increment: qty } },
          create: { productId, unitId: owningUnitId, quantity: qty },
        });
      }

      return { product: updatedProduct, movement, batch };
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'InwardEntry',
        entityId: result.movement.id,
        details: { productId, quantity: qty, batchNumber },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Inward entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/movements
router.get('/movements', authenticate, async (req, res) => {
  try {
    const { productId, type, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (productId) where.productId = productId;
    if (type) where.type = type;

    const [movements, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json({ movements, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get movements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/adjustment
router.post('/adjustment', authenticate, authorizeMinRole('STORE_MANAGER'), auditLog('CREATE', 'StockAdjustment'), async (req, res) => {
  try {
    const schema = z.object({
      productId: z.string().uuid(),
      quantity: z.number(),
      notes: z.string().optional(),
    });
    const { productId, quantity, notes } = schema.parse(req.body);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const result = await prisma.$transaction([
      prisma.product.update({
        where: { id: productId },
        data: { currentStock: { increment: quantity } },
      }),
      prisma.stockMovement.create({
        data: {
          productId,
          type: 'ADJUSTMENT',
          quantity,
          referenceType: 'Adjustment',
          notes,
          performedBy: req.user.id,
        },
      }),
    ]);

    res.status(201).json({ product: result[0], movement: result[1] });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Stock adjustment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory/inward-new — Create new product and add inward entry in one transaction
router.post('/inward-new', authenticate, authorize('ADMIN', 'STORE_MANAGER'), async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1),
      // SKU is now auto-generated from materialType — incoming sku is ignored.
      sku: z.string().optional(),
      category: z.string().optional(), // legacy
      materialType: z.string().optional(),
      unit: z.string().default('pcs'),
      quantity: z.number().positive(),
      batchNumber: z.string().optional(),
      notes: z.string().optional(),
      unitId: z.string().uuid().optional().nullable(),
    });
    const data = schema.parse(req.body);

    const matType = normalizeMaterialType(data.materialType || data.category);
    let owningUnitId = data.unitId || req.user.unitId || null;
    if (data.unitId) {
      const targetUnit = await prisma.unit.findUnique({ where: { id: data.unitId }, select: { id: true } });
      if (!targetUnit) return res.status(400).json({ error: 'Selected unit does not exist' });
      owningUnitId = targetUnit.id;
    }

    let result = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        result = await prisma.$transaction(async (tx) => {
          const sku = await generateProductSku(tx, matType);
          const product = await tx.product.create({
            data: {
              name: data.name,
              sku,
              category: matType,
              unit: data.unit,
              currentStock: data.quantity,
              isActive: true,
            },
          });

          const movement = await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: 'IN',
              quantity: data.quantity,
              batchNumber: data.batchNumber || null,
              referenceType: 'InwardEntry',
              notes: data.notes || null,
              performedBy: req.user.id,
              unitId: owningUnitId,
            },
          });

          const batch = await tx.productBatch.create({
            data: {
              productId: product.id,
              batchNo: data.batchNumber || null,
              quantity: data.quantity,
              remaining: data.quantity,
              referenceType: 'InwardEntryNewProduct',
              referenceId: movement.id,
              notes: data.notes || null,
              createdById: req.user.id,
            },
          });

          if (owningUnitId) {
            await tx.productUnitStock.upsert({
              where: { productId_unitId: { productId: product.id, unitId: owningUnitId } },
              update: { quantity: { increment: data.quantity } },
              create: { productId: product.id, unitId: owningUnitId, quantity: data.quantity },
            });
          }

          return { product, movement, batch };
        });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 4) throw err;
      }
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'InwardEntryNewProduct',
        entityId: result.product.id,
        details: { name: data.name, sku: result.product.sku, quantity: data.quantity, batchNumber: data.batchNumber },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    console.error('Inward entry new product error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory/batches — list product batches (FIFO view)
router.get('/batches', authenticate, async (req, res) => {
  try {
    const { productId, activeOnly } = req.query;
    const where = {};
    if (productId) where.productId = productId;
    if (activeOnly === 'true') where.remaining = { gt: 0 };

    const batches = await prisma.productBatch.findMany({
      where,
      include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
      orderBy: [{ productId: 'asc' }, { receivedDate: 'asc' }],
    });

    res.json({ batches });
  } catch (error) {
    console.error('Get batches error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
