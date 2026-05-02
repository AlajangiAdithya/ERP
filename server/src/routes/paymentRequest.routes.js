const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate } = require('../utils/helpers');
const { canApprove, getTier, getTierLabel } = require('../utils/approvalTiers');

const router = express.Router();

const createSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  amount: z.number().positive(),
  paymentType: z.enum(['ADVANCE', 'PARTIAL', 'FINAL']),
  notes: z.string().optional(),
});

// GET /api/payment-requests — role-filtered list
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, purchaseOrderId, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};

    if (req.user.role === 'PURCHASE_OFFICER') {
      where.createdById = req.user.id;
    }
    // ACCOUNTING and ADMIN see all

    if (status) where.status = status;
    if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId;

    const [requests, total] = await Promise.all([
      prisma.paymentRequest.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true } },
          processedBy: { select: { id: true, name: true } },
          purchaseOrder: {
            select: {
              id: true, orderNumber: true, customName: true, supplierName: true,
              totalAmount: true, totalPaid: true, advancePaid: true, status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.paymentRequest.count({ where }),
    ]);

    res.json({ requests, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get payment requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/payment-requests/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const request = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        processedBy: { select: { id: true, name: true } },
        purchaseOrder: {
          include: {
            items: true,
            createdBy: { select: { id: true, name: true } },
            purchaseRequest: {
              select: { requestNumber: true, manager: { select: { name: true } }, unit: { select: { name: true } } },
            },
          },
        },
      },
    });

    if (!request) return res.status(404).json({ error: 'Payment request not found' });
    res.json(request);
  } catch (error) {
    console.error('Get payment request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/payment-requests — PO creates payment request
router.post('/', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: data.purchaseOrderId },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    // Validate amount doesn't exceed remaining
    const remaining = order.totalAmount - order.totalPaid;
    if (data.amount > remaining) {
      return res.status(400).json({ error: `Payment amount exceeds remaining balance of ₹${remaining.toLocaleString('en-IN')}` });
    }

    const paymentNumber = generateOrderNumber('PAY');

    const request = await prisma.paymentRequest.create({
      data: {
        paymentNumber,
        purchaseOrderId: data.purchaseOrderId,
        amount: data.amount,
        paymentType: data.paymentType,
        notes: data.notes || null,
        createdById: req.user.id,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        purchaseOrder: { select: { orderNumber: true, customName: true, supplierName: true } },
      },
    });

    // Notify the right group based on amount tier
    const tier = getTier(data.amount);
    const tierLabel = getTierLabel(tier);
    const targetRole = tier === 'L1' ? 'ACCOUNTING' : 'ADMIN';

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_REQUEST',
        title: `Payment Request (${tier}): ${order.customName}`,
        message: `${data.paymentType} payment of ₹${data.amount.toLocaleString('en-IN')} requested for order "${order.customName}" (${order.orderNumber}) to ${order.supplierName}. Approval tier: ${tier} — ${tierLabel}.${data.notes ? ' Notes: ' + data.notes : ''}`,
        targetRole,
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'PaymentRequest',
        entityId: request.id,
        details: { paymentNumber, amount: data.amount, paymentType: data.paymentType, orderNumber: order.orderNumber },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(request);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create payment request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/payment-requests/:id/pay — ACCOUNTING marks as paid (subject to tier rules)
router.put('/:id/pay', authenticate, authorize('ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const request = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: { purchaseOrder: { include: { items: true, purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } } } } },
    });

    if (!request) return res.status(404).json({ error: 'Payment request not found' });
    if (request.status === 'PAID') {
      return res.status(400).json({ error: 'Payment already processed' });
    }
    if (request.status === 'REJECTED') {
      return res.status(400).json({ error: 'Cannot pay a rejected request' });
    }

    // Tiered approval gate: accounting can self-approve only <1L; otherwise needs the right admin
    const tier = getTier(request.amount);
    if (!canApprove(req.user, request.amount)) {
      return res.status(403).json({
        error: `This payment is ₹${request.amount.toLocaleString('en-IN')} (${tier}). Approval required from: ${getTierLabel(tier)}.`,
        tier,
        requiredApprovers: getTierLabel(tier),
      });
    }

    const order = request.purchaseOrder;
    const wasPendingAccounting = order.status === 'PENDING_ACCOUNTING';

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.paymentRequest.update({
        where: { id: req.params.id },
        data: {
          status: 'PAID',
          processedById: req.user.id,
          processedAt: new Date(),
        },
        include: {
          createdBy: { select: { id: true, name: true } },
          processedBy: { select: { id: true, name: true } },
          purchaseOrder: { select: { orderNumber: true, customName: true } },
        },
      });

      const newTotalPaid = order.totalPaid + request.amount;
      const newAdvancePaid = request.paymentType === 'ADVANCE'
        ? order.advancePaid + request.amount
        : order.advancePaid;

      const orderUpdate = { totalPaid: newTotalPaid, advancePaid: newAdvancePaid };

      if (wasPendingAccounting) {
        // First payment approved → order is officially ORDERED
        orderUpdate.status = newTotalPaid >= order.totalAmount ? 'PAID' : 'ORDERED';
      } else if (newTotalPaid >= order.totalAmount) {
        orderUpdate.status = 'PAID';
      } else if (request.paymentType === 'ADVANCE') {
        orderUpdate.status = 'ADVANCE_PAID';
      }
      // Otherwise keep current status (e.g. stay ORDERED during partial payments)

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: orderUpdate,
      });

      if (wasPendingAccounting) {
        // Mark all PO items as ORDERED and mirror to PR items
        for (const item of order.items) {
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { itemStatus: 'ORDERED', statusUpdatedAt: new Date(), statusUpdatedBy: req.user.id },
          });
          if (item.purchaseRequestItemId) {
            await tx.purchaseRequestItem.update({
              where: { id: item.purchaseRequestItemId },
              data: { itemStatus: 'ORDERED' },
            });
          }
        }
        await tx.purchaseRequest.update({
          where: { id: order.purchaseRequest.id },
          data: { status: 'ORDER_PLACED' },
        });
      }

      return result;
    });

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_PROCESSED',
        title: `Payment Processed: ${order.customName}`,
        message: `${request.paymentType} payment of ₹${request.amount.toLocaleString('en-IN')} for order "${order.customName}" has been processed.`,
        targetRole: 'PURCHASE_OFFICER',
        sentById: req.user.id,
      },
    });

    if (wasPendingAccounting && order.purchaseRequest?.managerId) {
      await prisma.notification.create({
        data: {
          type: 'ORDER_PLACED',
          title: `Order Placed: ${order.customName}`,
          message: `Accounting approved the payment for your purchase request ${order.purchaseRequest.requestNumber}. The order has been placed with ${order.supplierName}.`,
          targetUserId: order.purchaseRequest.managerId,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'PROCESS_PAYMENT',
        entity: 'PaymentRequest',
        entityId: request.id,
        details: {
          paymentNumber: request.paymentNumber,
          amount: request.amount,
          paymentType: request.paymentType,
          transitionedOrderToPlaced: wasPendingAccounting,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Pay error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/payment-requests/:id/reject — ACCOUNTING rejects
router.put('/:id/reject', authenticate, authorize('ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const { notes } = req.body;

    const request = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: { purchaseOrder: { select: { customName: true, orderNumber: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Payment request not found' });
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Can only reject pending requests' });
    }

    const updated = await prisma.paymentRequest.update({
      where: { id: req.params.id },
      data: {
        status: 'REJECTED',
        notes: notes || request.notes,
        processedById: req.user.id,
        processedAt: new Date(),
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        processedBy: { select: { id: true, name: true } },
        purchaseOrder: { select: { orderNumber: true, customName: true } },
      },
    });

    // Notify PO
    await prisma.notification.create({
      data: {
        type: 'PAYMENT_REJECTED',
        title: `Payment Rejected: ${request.purchaseOrder.customName}`,
        message: `${request.paymentType} payment of ₹${request.amount.toLocaleString('en-IN')} for order "${request.purchaseOrder.customName}" was rejected.${notes ? ' Reason: ' + notes : ''}`,
        targetRole: 'PURCHASE_OFFICER',
        sentById: req.user.id,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Reject payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
