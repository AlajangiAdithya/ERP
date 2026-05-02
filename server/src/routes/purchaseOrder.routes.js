const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate } = require('../utils/helpers');
const { getTier, getTierLabel } = require('../utils/approvalTiers');

const router = express.Router();

const ORDER_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  quotation: { select: { id: true, quotationNumber: true, supplierName: true, totalAmount: true } },
  purchaseRequest: {
    select: {
      id: true, requestNumber: true, status: true, managerId: true,
      manager: { select: { id: true, name: true, role: true } },
      unit: { select: { id: true, name: true, code: true } },
    },
  },
  items: true,
  paymentRequests: {
    include: { createdBy: { select: { id: true, name: true } }, processedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  },
  qcInspections: {
    include: { inspectedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  },
};

// GET /api/purchase-orders — role-filtered list
router.get('/', authenticate, async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};

    // Role-based filtering
    if (req.user.role === 'QC') {
      where.status = { in: ['GOODS_ARRIVED', 'QC_PENDING'] };
    } else if (req.user.role === 'STORE_MANAGER') {
      where.status = { in: ['QC_PASSED'] };
    }

    if (status && !['QC', 'STORE_MANAGER'].includes(req.user.role)) {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({ orders, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/dashboard — PO dashboard stats
router.get('/dashboard', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const [pendingAccounting, ordered, placed, advancePaid, paymentPending, paid, goodsArrived, qcPending, qcPassed, qcFailed, inwardDone, completed] = await Promise.all([
      prisma.purchaseOrder.count({ where: { status: 'PENDING_ACCOUNTING' } }),
      prisma.purchaseOrder.count({ where: { status: 'ORDERED' } }),
      prisma.purchaseOrder.count({ where: { status: 'PLACED' } }),
      prisma.purchaseOrder.count({ where: { status: 'ADVANCE_PAID' } }),
      prisma.purchaseOrder.count({ where: { status: 'PAYMENT_PENDING' } }),
      prisma.purchaseOrder.count({ where: { status: 'PAID' } }),
      prisma.purchaseOrder.count({ where: { status: 'GOODS_ARRIVED' } }),
      prisma.purchaseOrder.count({ where: { status: 'QC_PENDING' } }),
      prisma.purchaseOrder.count({ where: { status: 'QC_PASSED' } }),
      prisma.purchaseOrder.count({ where: { status: 'QC_FAILED' } }),
      prisma.purchaseOrder.count({ where: { status: 'INWARD_DONE' } }),
      prisma.purchaseOrder.count({ where: { status: 'COMPLETED' } }),
    ]);

    // Payment summary
    const orders = await prisma.purchaseOrder.findMany({
      where: { status: { not: 'COMPLETED' } },
      select: { totalAmount: true, totalPaid: true, advancePaid: true },
    });

    const totalOrderValue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalPaidAmount = orders.reduce((s, o) => s + o.totalPaid, 0);
    const totalAdvancePaid = orders.reduce((s, o) => s + o.advancePaid, 0);

    res.json({
      statusCounts: { pendingAccounting, ordered, placed, advancePaid, paymentPending, paid, goodsArrived, qcPending, qcPassed, qcFailed, inwardDone, completed },
      paymentSummary: { totalOrderValue, totalPaidAmount, totalAdvancePaid, pendingPayment: totalOrderValue - totalPaidAmount },
      total: pendingAccounting + ordered + placed + advancePaid + paymentPending + paid + goodsArrived + qcPending + qcPassed + qcFailed + inwardDone + completed,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: ORDER_INCLUDE,
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    res.json(order);
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/goods-arrived — PO marks goods as arrived
router.put('/:id/goods-arrived', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { purchaseRequest: { select: { id: true, requestNumber: true } } },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (order.goodsArrived) {
      return res.status(400).json({ error: 'Goods already marked as arrived' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          goodsArrived: true,
          goodsArrivedAt: new Date(),
          status: 'GOODS_ARRIVED',
        },
        include: ORDER_INCLUDE,
      });

      await tx.purchaseRequest.update({
        where: { id: order.purchaseRequest.id },
        data: { status: 'GOODS_ARRIVED' },
      });

      return result;
    });

    // Notify QC team
    await prisma.notification.create({
      data: {
        type: 'GOODS_ARRIVED',
        title: `Goods Arrived: ${order.customName}`,
        message: `Goods for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName} have arrived. Please proceed with quality inspection.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });

    // Also notify the manager who raised the PR
    if (updated.purchaseRequest?.managerId) {
      await prisma.notification.create({
        data: {
          type: 'GOODS_ARRIVED',
          title: `Goods Arrived: Your PR ${order.purchaseRequest.requestNumber}`,
          message: `Goods for your purchase request "${order.customName}" (${order.purchaseRequest.requestNumber}) have arrived and are being inspected.`,
          targetUserId: updated.purchaseRequest.managerId,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'GOODS_ARRIVED',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: { orderNumber: order.orderNumber, customName: order.customName },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Goods arrived error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/inward — Store Manager does inward entry
router.put('/:id/inward', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { items } = req.body; // [{ id, receivedQty }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items with received quantities are required' });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: {
          select: { id: true, requestNumber: true, managerId: true, manager: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (order.status !== 'QC_PASSED') {
      return res.status(400).json({ error: 'Inward entry can only be done after QC approval' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Update received quantities for order items
      for (const item of items) {
        const orderItem = order.items.find(i => i.id === item.id);
        if (!orderItem) continue;

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: item.receivedQty },
        });
      }

      // Update order status
      const result = await tx.purchaseOrder.update({
        where: { id: req.params.id },
        data: { status: 'INWARD_DONE' },
        include: ORDER_INCLUDE,
      });

      // Update PR status
      await tx.purchaseRequest.update({
        where: { id: order.purchaseRequest.id },
        data: { status: 'INWARD_DONE' },
      });

      return result;
    });

    // Notify the original manager that items have arrived
    if (order.purchaseRequest.managerId) {
      await prisma.notification.create({
        data: {
          type: 'INWARD_COMPLETE',
          title: `Items Arrived: ${order.customName}`,
          message: `Items for order "${order.customName}" (${order.purchaseRequest.requestNumber}) have been received and entered into stores. Please send MIV to collect your items.`,
          targetUserId: order.purchaseRequest.managerId,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'INWARD_ENTRY',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          customName: order.customName,
          itemsReceived: items.length,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Inward entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/place-order — PO places the approved order by sending a payment request to accounting
const placeOrderSchema = z.object({
  paymentType: z.enum(['ADVANCE', 'PARTIAL', 'FINAL']),
  amount: z.number().positive(),
  notes: z.string().optional(),
});

router.post('/:id/place-order', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = placeOrderSchema.parse(req.body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true, requestId: true } },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (order.status !== 'PENDING_ACCOUNTING') {
      return res.status(400).json({ error: 'Order can only be placed when it is pending accounting approval' });
    }

    const outstanding = order.totalAmount - order.totalPaid;
    if (data.amount > outstanding + 0.01) {
      return res.status(400).json({ error: `Requested amount exceeds outstanding balance (₹${outstanding.toLocaleString('en-IN')})` });
    }

    const paymentNumber = generateOrderNumber('PAY');
    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        paymentNumber,
        purchaseOrderId: order.id,
        amount: data.amount,
        paymentType: data.paymentType,
        notes: data.notes || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    const tier = getTier(data.amount);
    const tierLabel = getTierLabel(tier);
    const targetRole = tier === 'L1' ? 'ACCOUNTING' : 'ADMIN';

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_REQUEST',
        title: `Payment Request (${tier}): ${order.customName}`,
        message: `New ${data.paymentType.toLowerCase()} payment request of ₹${data.amount.toLocaleString('en-IN')} for order "${order.customName}" (${order.orderNumber}). Supplier: ${order.supplierName}. Approval tier: ${tier} — ${tierLabel}.`,
        targetRole,
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'PLACE_ORDER',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          customName: order.customName,
          paymentNumber,
          paymentType: data.paymentType,
          amount: data.amount,
        },
        ipAddress: req.ip,
      },
    });

    res.status(201).json({ message: 'Order placed. Awaiting accounting approval.', paymentRequest });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Place order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/items/:itemId/status — PO updates per-item procurement status
const itemStatusSchema = z.object({
  itemStatus: z.enum(['WAITING', 'ORDERED', 'ON_THE_WAY', 'RECEIVED', 'CANCELLED']),
});

router.put('/:id/items/:itemId/status', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { itemStatus } = itemStatusSchema.parse(req.body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    const item = order.items.find((i) => i.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found on this order' });

    if (!['ORDERED', 'PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED'].includes(order.status)) {
      return res.status(400).json({ error: 'Item status can only be updated on active orders' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          itemStatus,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user.id,
        },
      });
      if (item.purchaseRequestItemId) {
        await tx.purchaseRequestItem.update({
          where: { id: item.purchaseRequestItemId },
          data: { itemStatus },
        });
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE_ITEM_STATUS',
        entity: 'PurchaseOrderItem',
        entityId: item.id,
        details: {
          orderNumber: order.orderNumber,
          productName: item.productName,
          previousStatus: item.itemStatus,
          newStatus: itemStatus,
        },
        ipAddress: req.ip,
      },
    });

    if (itemStatus === 'ON_THE_WAY' || itemStatus === 'RECEIVED') {
      if (order.purchaseRequest?.managerId) {
        await prisma.notification.create({
          data: {
            type: 'ITEM_STATUS_UPDATE',
            title: `${item.productName} is ${itemStatus === 'ON_THE_WAY' ? 'on the way' : 'received'}`,
            message: `Item "${item.productName}" on order "${order.customName}" (${order.purchaseRequest.requestNumber}) is now ${itemStatus.replace('_', ' ').toLowerCase()}.`,
            targetUserId: order.purchaseRequest.managerId,
            sentById: req.user.id,
          },
        });
      }
    }

    const refreshed = await prisma.purchaseOrder.findUnique({
      where: { id: order.id },
      include: ORDER_INCLUDE,
    });
    res.json(refreshed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Update item status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
