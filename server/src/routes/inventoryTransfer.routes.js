const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate, applyDateFilter } = require('../utils/helpers');

const router = express.Router();

const TRANSFER_INCLUDE = {
  fromUnit: { select: { id: true, name: true, code: true } },
  toUnit: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
};

const createSchema = z.object({
  fromUnitId: z.string().uuid(),
  toUnitId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.string().optional(),
  notes: z.string().optional(),
});

// GET /api/inventory-transfers — list (scope: STORE_MANAGER sees only their own unit's in/out; ADMIN sees all)
router.get('/', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const { status, direction, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (status && ['PENDING', 'APPROVED', 'REJECTED', 'TRANSFERRED'].includes(status)) {
      where.status = status;
    }

    if (!req.user.unitId) return res.json({ transfers: [], total: 0, page: 1, totalPages: 0 });
    if (direction === 'incoming') {
      where.toUnitId = req.user.unitId;
    } else if (direction === 'outgoing') {
      where.fromUnitId = req.user.unitId;
    } else {
      where.OR = [{ fromUnitId: req.user.unitId }, { toUnitId: req.user.unitId }];
    }

    const [transfers, total] = await Promise.all([
      prisma.inventoryTransferRequest.findMany({
        where,
        include: TRANSFER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.inventoryTransferRequest.count({ where }),
    ]);

    res.json({ transfers, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('List transfers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/inventory-transfers/:id
router.get('/:id', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });

    if (t.fromUnitId !== req.user.unitId && t.toUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(t);
  } catch (error) {
    console.error('Get transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/inventory-transfers — Store Manager of the destination unit creates a request
router.post('/', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    if (data.fromUnitId === data.toUnitId) {
      return res.status(400).json({ error: 'Source and destination units must be different' });
    }

    if (!req.user.unitId || data.toUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'You can only request transfers into your own unit' });
    }

    const [fromUnit, toUnit, product] = await Promise.all([
      prisma.unit.findUnique({ where: { id: data.fromUnitId } }),
      prisma.unit.findUnique({ where: { id: data.toUnitId } }),
      prisma.product.findUnique({ where: { id: data.productId } }),
    ]);
    if (!fromUnit || !toUnit) return res.status(400).json({ error: 'Invalid unit reference' });
    if (!product) return res.status(400).json({ error: 'Invalid product reference' });

    const transferNumber = generateOrderNumber('TRF');

    const created = await prisma.inventoryTransferRequest.create({
      data: {
        transferNumber,
        fromUnitId: data.fromUnitId,
        toUnitId: data.toUnitId,
        productId: data.productId,
        quantity: data.quantity,
        reason: data.reason || null,
        notes: data.notes || null,
        requestedById: req.user.id,
      },
      include: TRANSFER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'InventoryTransferRequest',
        entityId: created.id,
        details: {
          transferNumber,
          from: fromUnit.code,
          to: toUnit.code,
          product: product.name,
          quantity: data.quantity,
        },
        ipAddress: req.ip,
      },
    });

    // Notify source-unit manager(s)
    const sourceManagers = await prisma.user.findMany({
      where: { role: 'MANAGER', unitId: data.fromUnitId, isActive: true },
      select: { id: true },
    });
    if (sourceManagers.length) {
      await prisma.notification.createMany({
        data: sourceManagers.map((m) => ({
          type: 'TRANSFER_REQUEST',
          title: `Transfer Request: ${transferNumber}`,
          message: `${toUnit.name} is requesting ${data.quantity} ${product.unit} of ${product.name} from ${fromUnit.name}.`,
          productId: product.id,
          targetUserId: m.id,
          sentById: req.user.id,
        })),
      });
    }

    res.status(201).json(created);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory-transfers/:id/approve — Source-unit Store Manager approves
router.put('/:id/approve', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });
    if (t.status !== 'PENDING') return res.status(400).json({ error: 'Only pending transfers can be approved' });

    if (t.fromUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Only the source unit manager can approve a transfer' });
    }

    const updated = await prisma.inventoryTransferRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        approvedById: req.user.id,
        approvedAt: new Date(),
      },
      include: TRANSFER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'APPROVE',
        entity: 'InventoryTransferRequest',
        entityId: t.id,
        details: { transferNumber: t.transferNumber },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'TRANSFER_APPROVED',
        title: `Transfer ${t.transferNumber} Approved`,
        message: `${t.fromUnit.name} approved the transfer of ${t.quantity} ${t.product.unit} of ${t.product.name}.`,
        targetUserId: t.requestedById,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory-transfers/:id/reject
router.put('/:id/reject', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });
    if (t.status !== 'PENDING') return res.status(400).json({ error: 'Only pending transfers can be rejected' });

    if (t.fromUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Only the source unit manager can reject a transfer' });
    }

    const updated = await prisma.inventoryTransferRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        approvedById: req.user.id,
        approvedAt: new Date(),
        rejectionReason: reason || null,
      },
      include: TRANSFER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REJECT',
        entity: 'InventoryTransferRequest',
        entityId: t.id,
        details: { transferNumber: t.transferNumber, reason: reason || null },
        ipAddress: req.ip,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'TRANSFER_REJECTED',
        title: `Transfer ${t.transferNumber} Rejected`,
        message: `${t.fromUnit.name} rejected the transfer request. Reason: ${reason || 'Not specified'}`,
        targetUserId: t.requestedById,
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Reject transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/inventory-transfers/:id/complete — after approve, record stock movements on both sides
router.put('/:id/complete', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const t = await prisma.inventoryTransferRequest.findUnique({
      where: { id: req.params.id },
      include: TRANSFER_INCLUDE,
    });
    if (!t) return res.status(404).json({ error: 'Transfer not found' });
    if (t.status !== 'APPROVED') return res.status(400).json({ error: 'Only approved transfers can be completed' });

    // Either side's unit manager can mark as transferred once received
    if (t.fromUnitId !== req.user.unitId && t.toUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await prisma.$transaction(async (tx) => {
      // OUT from source unit
      await tx.stockMovement.create({
        data: {
          productId: t.productId,
          type: 'OUT',
          quantity: t.quantity,
          referenceType: 'InventoryTransfer',
          referenceId: t.id,
          notes: `Unit transfer: ${t.fromUnit.code} → ${t.toUnit.code} (${t.transferNumber})`,
          performedBy: req.user.id,
          unitId: t.fromUnitId,
        },
      });
      // IN to destination unit
      await tx.stockMovement.create({
        data: {
          productId: t.productId,
          type: 'IN',
          quantity: t.quantity,
          referenceType: 'InventoryTransfer',
          referenceId: t.id,
          notes: `Unit transfer received: ${t.fromUnit.code} → ${t.toUnit.code} (${t.transferNumber})`,
          performedBy: req.user.id,
          unitId: t.toUnitId,
        },
      });

      await tx.inventoryTransferRequest.update({
        where: { id: t.id },
        data: { status: 'TRANSFERRED', completedAt: new Date() },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'COMPLETE',
        entity: 'InventoryTransferRequest',
        entityId: t.id,
        details: {
          transferNumber: t.transferNumber,
          from: t.fromUnit.code,
          to: t.toUnit.code,
          product: t.product.name,
          quantity: t.quantity,
        },
        ipAddress: req.ip,
      },
    });

    const updated = await prisma.inventoryTransferRequest.findUnique({
      where: { id: t.id },
      include: TRANSFER_INCLUDE,
    });
    res.json(updated);
  } catch (error) {
    console.error('Complete transfer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
