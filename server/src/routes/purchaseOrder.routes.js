const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate, applyDateFilter } = require('../utils/helpers');

const router = express.Router();

const ORDER_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  quotation: { select: { id: true, quotationNumber: true, supplierName: true, totalAmount: true, isUnion: true } },
  purchaseRequest: {
    select: {
      id: true, requestNumber: true, status: true, managerId: true,
      manager: { select: { id: true, name: true, role: true } },
      unit: { select: { id: true, name: true, code: true } },
    },
  },
  sourceRequests: {
    include: {
      purchaseRequest: {
        select: {
          id: true, requestNumber: true, status: true, managerId: true,
          manager: { select: { id: true, name: true, role: true } },
          unit: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  items: {
    include: {
      allocations: {
        include: {
          purchaseRequestItem: {
            select: {
              id: true, productId: true, productName: true, productUnit: true, requestedQty: true,
              request: {
                select: {
                  id: true, requestNumber: true,
                  unit: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
        },
      },
    },
  },
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
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });

    // Role-based filtering
    if (req.user.role === 'QC') {
      where.status = { in: ['GOODS_ARRIVED', 'QC_PENDING'] };
    } else if (req.user.role === 'STORE_MANAGER') {
      where.status = { in: ['QC_PASSED'] };
    } else if (req.user.role === 'MANAGER' || req.user.role === 'LAB') {
      // Unit managers/labs only see POs originating from their own purchase requests
      where.OR = [
        { purchaseRequest: { managerId: req.user.id } },
        { sourceRequests: { some: { purchaseRequest: { managerId: req.user.id } } } },
      ];
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
    const [groups, orders] = await Promise.all([
      prisma.purchaseOrder.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { not: 'COMPLETED' } },
        select: { totalAmount: true, totalPaid: true, advancePaid: true },
      }),
    ]);

    const counts = {};
    let total = 0;
    for (const g of groups) {
      counts[g.status] = g._count;
      total += g._count;
    }

    const totalOrderValue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalPaidAmount = orders.reduce((s, o) => s + o.totalPaid, 0);
    const totalAdvancePaid = orders.reduce((s, o) => s + o.advancePaid, 0);

    res.json({
      statusCounts: {
        pendingAccounting: counts['PENDING_ACCOUNTING'] || 0,
        ordered: counts['ORDERED'] || 0,
        placed: counts['PLACED'] || 0,
        advancePaid: counts['ADVANCE_PAID'] || 0,
        paymentPending: counts['PAYMENT_PENDING'] || 0,
        paid: counts['PAID'] || 0,
        goodsArrived: counts['GOODS_ARRIVED'] || 0,
        qcPending: counts['QC_PENDING'] || 0,
        qcPassed: counts['QC_PASSED'] || 0,
        qcFailed: counts['QC_FAILED'] || 0,
        inwardDone: counts['INWARD_DONE'] || 0,
        completed: counts['COMPLETED'] || 0,
      },
      paymentSummary: { totalOrderValue, totalPaidAmount, totalAdvancePaid, pendingPayment: totalOrderValue - totalPaidAmount },
      total,
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

    // Manager/Lab can only view POs tied to their own purchase requests
    if (req.user.role === 'MANAGER' || req.user.role === 'LAB') {
      const ownsPrimary = order.purchaseRequest?.managerId === req.user.id;
      const ownsSource = (order.sourceRequests || []).some(
        (s) => s.purchaseRequest?.managerId === req.user.id
      );
      if (!ownsPrimary && !ownsSource) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    res.json(order);
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/goods-arrived — PO marks goods as arrived (supports partial deliveries)
router.put('/:id/goods-arrived', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    const allowedStatuses = ['ORDERED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID'];
    if (!allowedStatuses.includes(order.status)) {
      return res.status(400).json({
        error: order.status === 'GOODS_ARRIVED' || order.status === 'QC_PENDING' || order.status === 'QC_PASSED'
          ? 'A delivery batch is already being processed (QC / inward). Complete that first.'
          : `Cannot mark goods arrived when order status is ${order.status}`,
      });
    }

    const totalOrdered = order.items.reduce((s, i) => s + i.quantity, 0);
    const totalReceived = order.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
    const isPartial = totalReceived > 0;

    const sourcePRs = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);
    const sourcePRIds = sourcePRs.map((p) => p.id);

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

      if (sourcePRIds.length) {
        await tx.purchaseRequest.updateMany({
          where: { id: { in: sourcePRIds } },
          data: { status: 'GOODS_ARRIVED' },
        });
      }

      return result;
    });

    const deliveryNote = isPartial
      ? `More goods arrived for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName}. Previously received ${totalReceived} of ${totalOrdered} items. Please inspect the new delivery.`
      : `Goods for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName} have arrived. Please proceed with quality inspection.`;

    await prisma.notification.create({
      data: {
        type: 'GOODS_ARRIVED',
        title: `${isPartial ? 'More ' : ''}Goods Arrived: ${order.customName}`,
        message: deliveryNote,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });

    for (const pr of sourcePRs) {
      if (!pr.managerId) continue;
      await prisma.notification.create({
        data: {
          type: 'GOODS_ARRIVED',
          title: `${isPartial ? 'More ' : ''}Goods Arrived: Your PR ${pr.requestNumber}`,
          message: order.isUnion
            ? `Goods for Union PO "${order.customName}" (${order.orderNumber}) — your PR ${pr.requestNumber} — have arrived and are being inspected.`
            : (isPartial
              ? `More goods for "${order.customName}" (${pr.requestNumber}) have arrived (${totalReceived} of ${totalOrdered} already received).`
              : `Goods for your purchase request "${order.customName}" (${pr.requestNumber}) have arrived and are being inspected.`),
          targetUserId: pr.managerId,
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
        details: {
          orderNumber: order.orderNumber, customName: order.customName,
          isPartialDelivery: isPartial, totalReceived, totalOrdered,
        },
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
    const { items } = req.body; // [{ id, receivedQty, batchNumber? }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items with received quantities are required' });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            allocations: {
              include: {
                purchaseRequestItem: {
                  select: {
                    id: true, productId: true, productName: true, productUnit: true,
                    request: {
                      select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        purchaseRequest: {
          select: {
            id: true, requestNumber: true, managerId: true,
            manager: { select: { id: true, name: true, role: true } },
            items: { select: { id: true, productId: true, productName: true, productUnit: true } },
          },
        },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (order.status !== 'QC_PASSED') {
      return res.status(400).json({ error: 'Inward entry can only be done after QC approval' });
    }

    const sourcePRs = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);
    const sourcePRIds = sourcePRs.map((p) => p.id);

    const updated = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const orderItem = order.items.find(i => i.id === item.id);
        if (!orderItem) continue;

        const receivedQty = parseFloat(item.receivedQty) || 0;
        if (receivedQty <= 0) continue;

        // Increment aggregate receivedQty on the PO item (works for both union and non-union)
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: receivedQty } },
        });

        const isUnionItem = orderItem.allocations && orderItem.allocations.length > 0;

        // Build per-allocation share list. For non-union items, this is a single synthetic share
        // covering the original purchaseRequestItemId path.
        let shares;
        if (isUnionItem) {
          const totalAllocated = orderItem.allocations.reduce((s, a) => s + a.allocatedQty, 0);
          // Pro-rata share, rounded to 2 decimals to avoid float drift in stock counts
          const rawShares = orderItem.allocations.map((a) => ({
            allocation: a,
            share: Math.round((receivedQty * (a.allocatedQty / totalAllocated)) * 100) / 100,
          }));
          // Push the rounding remainder onto the largest-allocation share so the supplier total is exact
          const distributed = rawShares.reduce((s, x) => s + x.share, 0);
          const remainder = Math.round((receivedQty - distributed) * 100) / 100;
          if (remainder !== 0) {
            const largestIdx = rawShares.reduce(
              (best, cur, idx, arr) => (cur.allocation.allocatedQty > arr[best].allocation.allocatedQty ? idx : best),
              0,
            );
            rawShares[largestIdx].share = Math.round((rawShares[largestIdx].share + remainder) * 100) / 100;
          }
          shares = rawShares;
        } else {
          shares = [{ allocation: null, share: receivedQty }];
        }

        // Resolve / create the product (shared across allocations — products are global)
        let productId = null;
        if (isUnionItem) {
          const firstPrItem = orderItem.allocations[0]?.purchaseRequestItem;
          if (firstPrItem?.productId) productId = firstPrItem.productId;
        } else if (orderItem.purchaseRequestItemId) {
          const prItem = order.purchaseRequest?.items.find(i => i.id === orderItem.purchaseRequestItemId);
          if (prItem?.productId) productId = prItem.productId;
        }

        if (!productId) {
          const existing = await tx.product.findFirst({
            where: { name: { equals: orderItem.productName, mode: 'insensitive' }, isActive: true },
          });
          if (existing) productId = existing.id;
        }

        if (!productId) {
          const sku = generateOrderNumber('SKU');
          const newProduct = await tx.product.create({
            data: {
              name: orderItem.productName,
              sku,
              unit: orderItem.productUnit || 'pcs',
              currentStock: 0,
              isActive: true,
            },
          });
          productId = newProduct.id;

          if (isUnionItem) {
            const prItemIds = orderItem.allocations
              .map((a) => a.purchaseRequestItem?.id)
              .filter(Boolean);
            if (prItemIds.length) {
              await tx.purchaseRequestItem.updateMany({
                where: { id: { in: prItemIds } },
                data: { productId },
              });
            }
          } else if (orderItem.purchaseRequestItemId) {
            await tx.purchaseRequestItem.update({
              where: { id: orderItem.purchaseRequestItemId },
              data: { productId },
            });
          }
        }

        // One Product stock update for the aggregate received qty
        await tx.product.update({
          where: { id: productId },
          data: { currentStock: { increment: receivedQty } },
        });

        // One stock movement + batch per share so the audit trail attributes each unit's slice
        for (const { allocation, share } of shares) {
          if (share <= 0) continue;
          const prRef = allocation?.purchaseRequestItem?.purchaseRequest;
          const unitTag = prRef?.unit?.code ? ` [${prRef.unit.code}]` : '';
          const prTag = prRef?.requestNumber ? ` — ${prRef.requestNumber}` : '';

          const movement = await tx.stockMovement.create({
            data: {
              productId,
              type: 'IN',
              quantity: share,
              batchNumber: item.batchNumber || null,
              referenceType: 'PurchaseOrder',
              referenceId: order.id,
              notes: `PO ${order.orderNumber} — ${order.supplierName}${prTag}${unitTag}`,
              performedBy: req.user.id,
            },
          });

          await tx.productBatch.create({
            data: {
              productId,
              batchNo: item.batchNumber || null,
              quantity: share,
              remaining: share,
              referenceType: 'PurchaseOrder',
              referenceId: movement.id,
              notes: `PO ${order.orderNumber} — ${orderItem.productName}${prTag}${unitTag}`,
              createdById: req.user.id,
            },
          });

          if (allocation) {
            await tx.purchaseOrderItemAllocation.update({
              where: { id: allocation.id },
              data: { receivedQty: { increment: share } },
            });
          }
        }
      }

      // Check if ALL items are now fully received
      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: req.params.id },
      });
      const allFullyReceived = refreshedItems.every(i => i.receivedQty >= i.quantity);

      let result;
      if (allFullyReceived) {
        result = await tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: 'INWARD_DONE' },
          include: ORDER_INCLUDE,
        });
        if (sourcePRIds.length) {
          await tx.purchaseRequest.updateMany({
            where: { id: { in: sourcePRIds } },
            data: { status: 'INWARD_DONE' },
          });
        }
      } else {
        // Partial delivery: reset to ORDERED so PO can mark next batch as arrived
        result = await tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: 'ORDERED', goodsArrived: false },
          include: ORDER_INCLUDE,
        });
      }

      return { result, allFullyReceived, refreshedItems };
    });

    const { result: updatedOrder, allFullyReceived, refreshedItems } = updated;
    const totalReceived = refreshedItems.reduce((s, i) => s + i.receivedQty, 0);
    const totalOrdered = refreshedItems.reduce((s, i) => s + i.quantity, 0);

    for (const pr of sourcePRs) {
      if (!pr.managerId) continue;
      const inwardMsg = allFullyReceived
        ? (order.isUnion
          ? `All items for Union PO "${order.customName}" (${order.orderNumber}) — your PR ${pr.requestNumber} — have been received and entered into stores. Please send MIV to collect your items.`
          : `All items for order "${order.customName}" (${pr.requestNumber}) have been received and entered into stores. Please send MIV to collect your items.`)
        : (order.isUnion
          ? `Partial delivery for Union PO "${order.customName}" (${order.orderNumber}): ${totalReceived} of ${totalOrdered} items received. Your PR ${pr.requestNumber} share has been incremented pro-rata. Remaining items will follow.`
          : `Partial delivery: ${totalReceived} of ${totalOrdered} items for order "${order.customName}" (${pr.requestNumber}) have been received. Remaining items will follow.`);
      await prisma.notification.create({
        data: {
          type: 'INWARD_COMPLETE',
          title: `${allFullyReceived ? 'All ' : 'Partial '}Items Received: ${order.customName}`,
          message: inwardMsg,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }

    if (!allFullyReceived) {
      await prisma.notification.create({
        data: {
          type: 'PARTIAL_DELIVERY',
          title: `Partial Delivery Complete: ${order.customName}`,
          message: `${totalReceived} of ${totalOrdered} items received for "${order.customName}" (${order.orderNumber}). Order is active for the next delivery.`,
          targetRole: 'PURCHASE_OFFICER',
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
          allFullyReceived,
          totalReceived,
          totalOrdered,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updatedOrder);
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

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_REQUEST',
        title: `Payment Request: ${order.customName}`,
        message: `New ${data.paymentType.toLowerCase()} payment request of ₹${data.amount.toLocaleString('en-IN')} for order "${order.customName}" (${order.orderNumber}). Supplier: ${order.supplierName}. Please approve to send to Accounting.`,
        targetRole: 'ADMIN',
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
        items: { include: { allocations: true } },
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
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
      if (item.allocations && item.allocations.length > 0) {
        const prItemIds = item.allocations.map((a) => a.purchaseRequestItemId);
        await tx.purchaseRequestItem.updateMany({
          where: { id: { in: prItemIds } },
          data: { itemStatus },
        });
      } else if (item.purchaseRequestItemId) {
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
      const recipients = order.isUnion
        ? (order.sourceRequests || []).map((s) => s.purchaseRequest).filter((p) => p?.managerId)
        : (order.purchaseRequest?.managerId ? [order.purchaseRequest] : []);
      for (const pr of recipients) {
        await prisma.notification.create({
          data: {
            type: 'ITEM_STATUS_UPDATE',
            title: `${item.productName} is ${itemStatus === 'ON_THE_WAY' ? 'on the way' : 'received'}`,
            message: `Item "${item.productName}" on order "${order.customName}" (${pr.requestNumber}) is now ${itemStatus.replace('_', ' ').toLowerCase()}.`,
            targetUserId: pr.managerId,
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
