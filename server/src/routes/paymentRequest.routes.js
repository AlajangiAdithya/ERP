const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, paginate, applyDateFilter, isUniqueViolation, withDocRetry } = require('../utils/helpers');

const router = express.Router();

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING'];

// Payment-request read access — narrower than CHAIN_ROLES. Only Admin,
// Purchase Officer (raises the request), and Accounting (approves & pays)
// need visibility into supplier payments.
const PAYMENT_VIEW_ROLES = ['ADMIN', 'PURCHASE_OFFICER', 'ACCOUNTING'];

const createSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  amount: z.number().positive(),
  paymentType: z.enum(['ADVANCE', 'PARTIAL', 'FINAL']),
  notes: z.string().optional(),
});

// GET /api/payment-requests — role-filtered list
router.get('/', authenticate, authorize(...PAYMENT_VIEW_ROLES), async (req, res) => {
  try {
    const { status, purchaseOrderId, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });

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
              isCreditOrder: true, creditPlacedAt: true, creditNote: true,
              creditPlacedBy: { select: { id: true, name: true } },
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
router.get('/:id', authenticate, authorize(...PAYMENT_VIEW_ROLES), async (req, res) => {
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
            creditPlacedBy: { select: { id: true, name: true } },
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

    let paymentNumber;
    const request = await withDocRetry(async () => {
      paymentNumber = await generateSequentialNumber(prisma, 'PAY');
      return prisma.paymentRequest.create({
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
    });

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_REQUEST',
        title: `Payment Request: ${order.customName}`,
        message: `${data.paymentType} payment of ₹${data.amount.toLocaleString('en-IN')} requested for order "${order.customName}" (${order.orderNumber}) to ${order.supplierName}. Please approve to send to Accounting.${data.notes ? ' Notes: ' + data.notes : ''}`,
        targetRole: 'ADMIN',
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

// PUT /api/payment-requests/:id/approve — ADMIN approves, then it goes to ACCOUNTING
router.put('/:id/approve', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const request = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: { purchaseOrder: { select: { customName: true, orderNumber: true, supplierName: true } } },
    });

    if (!request) return res.status(404).json({ error: 'Payment request not found' });
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Can only approve pending requests' });
    }

    const updated = await prisma.paymentRequest.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED' },
      include: {
        createdBy: { select: { id: true, name: true } },
        purchaseOrder: { select: { orderNumber: true, customName: true } },
      },
    });

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_APPROVED',
        title: `Payment Approved: ${request.purchaseOrder.customName}`,
        message: `${request.paymentType} payment of ₹${request.amount.toLocaleString('en-IN')} for order "${request.purchaseOrder.customName}" (${request.purchaseOrder.orderNumber}) has been approved by ${req.user.name}. Please process the payment.`,
        targetRole: 'ACCOUNTING',
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'APPROVE_PAYMENT',
        entity: 'PaymentRequest',
        entityId: request.id,
        details: { paymentNumber: request.paymentNumber, amount: request.amount },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Approve payment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/payment-requests/:id/pay — ACCOUNTING marks as paid (after admin approval)
router.put('/:id/pay', authenticate, authorize('ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const request = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseOrder: {
          include: {
            items: { include: { allocations: true } },
            purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } },
            sourceRequests: {
              include: {
                purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!request) return res.status(404).json({ error: 'Payment request not found' });
    if (request.status === 'PAID') {
      return res.status(400).json({ error: 'Payment already processed' });
    }
    if (request.status === 'REJECTED') {
      return res.status(400).json({ error: 'Cannot pay a rejected request' });
    }
    if (request.status === 'PENDING') {
      return res.status(400).json({ error: 'Payment must be approved by Admin before it can be marked as paid' });
    }

    const order = request.purchaseOrder;
    const wasPendingAccounting = order.status === 'PENDING_ACCOUNTING';
    // CREDIT_PLACED already ran the item/PR side-effects when the PO Officer
    // placed the order on credit, so the payment here just closes the books.
    const wasCreditPlaced = order.status === 'CREDIT_PLACED';

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
      const isFullyPaid = newTotalPaid >= order.totalAmount;

      const orderUpdate = { totalPaid: newTotalPaid, advancePaid: newAdvancePaid };

      if (wasPendingAccounting) {
        orderUpdate.status = isFullyPaid ? 'PAID' : 'ORDERED';
      } else if (wasCreditPlaced) {
        // Stay on CREDIT_PLACED until fully paid so everyone can see the
        // outstanding credit balance; once cleared, normal PAID applies.
        if (isFullyPaid) orderUpdate.status = 'PAID';
      } else if (isFullyPaid) {
        orderUpdate.status = 'PAID';
      } else if (request.paymentType === 'ADVANCE') {
        orderUpdate.status = 'ADVANCE_PAID';
      }

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: orderUpdate,
      });

      if (wasPendingAccounting) {
        for (const item of order.items) {
          await tx.purchaseOrderItem.update({
            where: { id: item.id },
            data: { itemStatus: 'ORDERED', statusUpdatedAt: new Date(), statusUpdatedBy: req.user.id },
          });
          if (order.isUnion) {
            const prItemIds = (item.allocations || []).map((a) => a.purchaseRequestItemId);
            if (prItemIds.length) {
              await tx.purchaseRequestItem.updateMany({
                where: { id: { in: prItemIds } },
                data: { itemStatus: 'ORDERED' },
              });
            }
          } else if (item.purchaseRequestItemId) {
            await tx.purchaseRequestItem.update({
              where: { id: item.purchaseRequestItemId },
              data: { itemStatus: 'ORDERED' },
            });
          }
        }

        const sourcePRIds = order.isUnion
          ? (order.sourceRequests || []).map((s) => s.purchaseRequest.id)
          : (order.purchaseRequest ? [order.purchaseRequest.id] : []);

        if (sourcePRIds.length) {
          await tx.purchaseRequest.updateMany({
            where: { id: { in: sourcePRIds } },
            data: { status: 'ORDER_PLACED' },
          });
        }
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

    if (wasPendingAccounting) {
      const recipients = order.isUnion
        ? (order.sourceRequests || []).map((s) => s.purchaseRequest).filter((pr) => pr?.managerId)
        : (order.purchaseRequest?.managerId ? [order.purchaseRequest] : []);

      for (const pr of recipients) {
        await prisma.notification.create({
          data: {
            type: 'ORDER_PLACED',
            title: order.isUnion
              ? `Union Order Placed: ${order.customName}`
              : `Order Placed: ${order.customName}`,
            message: order.isUnion
              ? `Your purchase request ${pr.requestNumber} is part of Union PO ${order.orderNumber}. Payment has been processed and the order has been placed with ${order.supplierName}.`
              : `Payment for your purchase request ${pr.requestNumber} has been processed. The order has been placed with ${order.supplierName}.`,
            targetUserId: pr.managerId,
            sentById: req.user.id,
          },
        });
      }
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
    if (!['PENDING', 'APPROVED'].includes(request.status)) {
      return res.status(400).json({ error: 'Can only reject pending or approved requests' });
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
