const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate } = require('../utils/helpers');

const router = express.Router();

// Roles that can create/manage their own MIV requests (same privileges as MANAGER)
const REQUESTER_ROLES = ['MANAGER', 'LAB'];

const createRequestSchema = z.object({
  notes: z.string().optional(),
  remarks: z.string().optional(),
  referenceNo: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    purpose: z.string().optional(),
  })).min(1),
});

// GET /api/requests — list requests based on role
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};

    // Role-based filtering — requester roles see only their own
    if (REQUESTER_ROLES.includes(req.user.role)) {
      where.managerId = req.user.id;
    }
    // STORE_MANAGER and ADMIN see all
    if (status) where.status = status;

    const [requests, total] = await Promise.all([
      prisma.productRequest.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true, username: true, role: true } },
          unit: { select: { id: true, name: true, code: true } },
          items: {
            include: { product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.productRequest.count({ where }),
    ]);

    res.json({ requests, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/requests/pending-count
router.get('/pending-count', authenticate, async (req, res) => {
  try {
    const count = await prisma.productRequest.count({ where: { status: 'PENDING' } });
    res.json({ count });
  } catch (error) {
    console.error('Pending count error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/requests/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const request = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, name: true, username: true, role: true, unit: { select: { name: true, code: true } } } },
        unit: { select: { id: true, name: true, code: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true, category: true } } },
        },
      },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });

    // Requester roles can only view their own requests
    if (REQUESTER_ROLES.includes(req.user.role) && request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/requests — Requester creates a product request
router.post('/', authenticate, authorize('MANAGER', 'LAB'), async (req, res) => {
  try {
    const data = createRequestSchema.parse(req.body);

    if (!req.user.unitId) {
      return res.status(400).json({ error: 'You must be assigned to a unit to create requests' });
    }

    const requestNumber = generateOrderNumber('REQ');

    const request = await prisma.productRequest.create({
      data: {
        requestNumber,
        managerId: req.user.id,
        unitId: req.user.unitId,
        notes: data.notes || null,
        remarks: data.remarks || null,
        referenceNo: data.referenceNo || null,
        items: {
          create: data.items.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            purpose: item.purpose || null,
          })),
        },
      },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: {
          include: { product: { select: { id: true, name: true, sku: true, unit: true } } },
        },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'ProductRequest',
        entityId: request.id,
        details: {
          requestNumber,
          unit: req.user.unit?.code,
          itemCount: data.items.length,
        },
        ipAddress: req.ip,
      },
    });

    // Notify store managers
    await prisma.notification.create({
      data: {
        type: 'NEW_REQUEST',
        title: `New Request: ${requestNumber}`,
        message: `${req.user.name} (${req.user.unit?.name}) has submitted a new product request with ${data.items.length} item(s).`,
        targetRole: 'STORE_MANAGER',
        sentById: req.user.id,
      },
    });

    res.status(201).json(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/requests/:id/approve — Store Manager approves
router.put('/:id/approve', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { clearanceNotes, items, mirNo, issueNo, issueDate } = req.body;

    const request = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
      include: { items: true, manager: { select: { name: true } }, unit: { select: { name: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending requests can be approved' });
    }

    // Update approved quantities, qtyIssued, and materialBatchNo if provided
    if (items && Array.isArray(items)) {
      for (const item of items) {
        const updateData = { approvedQty: item.approvedQty };
        if (item.qtyIssued !== undefined) updateData.qtyIssued = item.qtyIssued;
        if (item.materialBatchNo !== undefined) updateData.materialBatchNo = item.materialBatchNo || null;
        await prisma.requestItem.update({
          where: { id: item.id },
          data: updateData,
        });
      }
    } else {
      // Auto-approve full quantities
      for (const item of request.items) {
        await prisma.requestItem.update({
          where: { id: item.id },
          data: { approvedQty: item.quantity },
        });
      }
    }

    const updated = await prisma.productRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        clearanceNotes: clearanceNotes || null,
        clearedById: req.user.id,
        clearedAt: new Date(),
        mirNo: mirNo || null,
        issueNo: issueNo || null,
        issueDate: issueDate ? new Date(issueDate) : null,
      },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'APPROVE',
        entity: 'ProductRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'APPROVED' },
        ipAddress: req.ip,
      },
    });

    // Notify the creator (look up their role)
    const creator = await prisma.user.findUnique({ where: { id: request.managerId }, select: { role: true } });
    await prisma.notification.create({
      data: {
        type: 'REQUEST_APPROVED',
        title: `Request ${request.requestNumber} Approved`,
        message: `Your product request ${request.requestNumber} has been approved. You can now collect the items.`,
        targetRole: creator?.role || 'MANAGER',
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Approve request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/requests/:id/reject — Store Manager rejects
router.put('/:id/reject', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { clearanceNotes } = req.body;

    const request = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
      include: { manager: { select: { name: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending requests can be rejected' });
    }

    const updated = await prisma.productRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        clearanceNotes: clearanceNotes || 'Request rejected',
        clearedById: req.user.id,
        clearedAt: new Date(),
      },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REJECT',
        entity: 'ProductRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'REJECTED', reason: clearanceNotes },
        ipAddress: req.ip,
      },
    });

    // Notify the creator (look up their role)
    const creator = await prisma.user.findUnique({ where: { id: request.managerId }, select: { role: true } });
    await prisma.notification.create({
      data: {
        type: 'REQUEST_REJECTED',
        title: `Request ${request.requestNumber} Rejected`,
        message: `Your product request ${request.requestNumber} has been rejected. Reason: ${clearanceNotes || 'No reason provided'}`,
        targetRole: creator?.role || 'MANAGER',
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Reject request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/requests/:id/collect — Requester collects items (full or partial)
// Body: { items?: [{ id, collectedQty }] }  — defaults to each item's remaining approvedQty
router.put('/:id/collect', authenticate, authorize('MANAGER', 'LAB'), async (req, res) => {
  try {
    const request = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { product: true } }, unit: true },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only collect your own requests' });
    }
    if (request.status !== 'APPROVED' && request.status !== 'PARTIAL') {
      return res.status(400).json({ error: 'Only approved or partially collected requests can be collected' });
    }

    // Build collect-plan: how much each item takes this round (delta)
    const bodyItems = Array.isArray(req.body?.items) ? req.body.items : null;
    const plan = [];
    for (const item of request.items) {
      const approved = item.approvedQty ?? item.quantity;
      const alreadyTaken = item.collectedQty || 0;
      const maxRemaining = Math.max(0, approved - alreadyTaken);

      let take;
      if (bodyItems) {
        const override = bodyItems.find((b) => b.id === item.id);
        if (!override) { take = 0; continue; } // omitted = collect 0 this round
        take = Number(override.collectedQty);
        if (!Number.isFinite(take) || take < 0) {
          return res.status(400).json({ error: `Invalid collectedQty for item ${item.id}` });
        }
      } else {
        take = maxRemaining; // default: collect everything remaining
      }

      if (take > maxRemaining) {
        return res.status(400).json({
          error: `collectedQty ${take} exceeds remaining ${maxRemaining} for ${item.product.name}`,
        });
      }
      if (take > 0) plan.push({ item, take });
    }

    if (plan.length === 0) {
      return res.status(400).json({ error: 'Nothing to collect — provide at least one item with qty > 0' });
    }

    // FIFO: deduct from oldest batches first
    const fifoIssuedByItem = {};
    await prisma.$transaction(async (tx) => {
      for (const { item, take } of plan) {
        const batches = await tx.productBatch.findMany({
          where: { productId: item.productId, remaining: { gt: 0 } },
          orderBy: { receivedDate: 'asc' },
        });

        let toFulfill = take;
        const issuedSlices = [];
        for (const batch of batches) {
          if (toFulfill <= 0) break;
          const slice = Math.min(batch.remaining, toFulfill);
          await tx.productBatch.update({
            where: { id: batch.id },
            data: { remaining: batch.remaining - slice },
          });
          issuedSlices.push({
            batchId: batch.id,
            batchNo: batch.batchNo,
            receivedDate: batch.receivedDate,
            quantity: slice,
          });
          toFulfill -= slice;
        }
        fifoIssuedByItem[item.id] = issuedSlices;

        await tx.product.update({
          where: { id: item.productId },
          data: { currentStock: { decrement: take } },
        });

        await tx.requestItem.update({
          where: { id: item.id },
          data: { collectedQty: { increment: take } },
        });

        const batchNote = issuedSlices.length > 0
          ? ` [FIFO: ${issuedSlices.map(s => `${s.batchNo || 'NO-BATCH'}×${s.quantity}`).join(', ')}]`
          : '';

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: take,
            referenceType: 'ProductRequest',
            referenceId: request.id,
            batchNumber: issuedSlices.map(s => s.batchNo).filter(Boolean).join(', ') || null,
            notes: `Collected by ${req.user.name} for ${request.unit.name} (${request.requestNumber})${batchNote}`,
            performedBy: req.user.id,
            unitId: request.unitId,
          },
        });
      }

      // Determine final status: COLLECTED if every item fully taken, else PARTIAL
      const refreshed = await tx.requestItem.findMany({ where: { requestId: request.id } });
      const fullyDone = refreshed.every((ri) => (ri.collectedQty || 0) >= (ri.approvedQty ?? ri.quantity));

      await tx.productRequest.update({
        where: { id: req.params.id },
        data: fullyDone
          ? { status: 'COLLECTED', collectedAt: new Date() }
          : { status: 'PARTIAL' },
      });
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'COLLECT',
        entity: 'ProductRequest',
        entityId: request.id,
        details: {
          requestNumber: request.requestNumber,
          unit: request.unit.code,
          items: plan.map(({ item, take }) => ({
            product: item.product.name,
            qtyTaken: take,
            fifoBatches: fifoIssuedByItem[item.id] || [],
          })),
        },
        ipAddress: req.ip,
      },
    });

    // Check for low stock and auto-notify
    for (const item of request.items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (product && product.minStockLevel > 0 && product.currentStock <= product.minStockLevel) {
        const existing = await prisma.notification.findFirst({
          where: { productId: product.id, isRead: false, type: 'LOW_STOCK' },
        });
        if (!existing) {
          await prisma.notification.create({
            data: {
              type: 'LOW_STOCK',
              title: `LOW STOCK: ${product.name}`,
              message: `${product.name} (${product.sku}) stock is at ${product.currentStock} ${product.unit}. Minimum level: ${product.minStockLevel}.`,
              productId: product.id,
              targetRole: 'STORE_MANAGER',
            },
          });
        }
      }
    }

    const updated = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } } } },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Collect request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/requests/:id/kill-remaining — Requester closes a PARTIAL request without collecting more
router.put('/:id/kill-remaining', authenticate, authorize('MANAGER', 'LAB'), async (req, res) => {
  try {
    const request = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { product: true } }, unit: true },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only modify your own requests' });
    }
    if (request.status !== 'PARTIAL') {
      return res.status(400).json({ error: 'Only partially collected requests can be closed this way' });
    }

    const updated = await prisma.productRequest.update({
      where: { id: req.params.id },
      data: { status: 'COLLECTED', collectedAt: new Date() },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true, currentStock: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'KILL_REMAINING',
        entity: 'ProductRequest',
        entityId: request.id,
        details: {
          requestNumber: request.requestNumber,
          items: request.items.map((i) => ({
            product: i.product.name,
            approvedQty: i.approvedQty ?? i.quantity,
            collectedQty: i.collectedQty || 0,
            killedQty: Math.max(0, (i.approvedQty ?? i.quantity) - (i.collectedQty || 0)),
          })),
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Kill remaining error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/requests/:id/cancel — Requester cancels own pending request
router.put('/:id/cancel', authenticate, authorize('MANAGER', 'LAB'), async (req, res) => {
  try {
    const request = await prisma.productRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.managerId !== req.user.id) {
      return res.status(403).json({ error: 'You can only cancel your own requests' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Only pending requests can be cancelled' });
    }

    const updated = await prisma.productRequest.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
      include: {
        manager: { select: { id: true, name: true } },
        unit: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, unit: true } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CANCEL',
        entity: 'ProductRequest',
        entityId: request.id,
        details: { requestNumber: request.requestNumber, action: 'CANCELLED' },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Cancel request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
