const express = require('express');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { poDocumentUpload, goodsArrivedUpload, publicUrlFor, UPLOAD_ROOT } = require('../middleware/upload');
const {
  generateSequentialNumber, generateMirNumber, generateProductSku,
  normalizeMaterialType, paginate, applyDateFilter, isUniqueViolation,
} = require('../utils/helpers');
const { cancelLeftoverPRItems } = require('../utils/prClosure');

// Wraps multer so we can return a clean 400 on malformed/oversize uploads.
function acceptPoDocument(req, res, next) {
  poDocumentUpload.single('poDocument')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'PO document upload failed' });
    next();
  });
}

// Invoice PDF (required) and optional supplier lot report PDF accompanying a
// "mark goods arrived" lot. Both are routed to their own /uploads subdirs by
// the goodsArrivedUpload storage. The route saves the resulting URLs onto the
// QCInspection so QC can open both documents inline.
function acceptGoodsArrived(req, res, next) {
  goodsArrivedUpload.fields([
    { name: 'invoiceFile', maxCount: 1 },
    { name: 'lotReportFile', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Document upload failed' });
    next();
  });
}

// Unlink the file referenced by a /uploads/... URL. Best-effort: missing files don't throw.
function unlinkPublicFile(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) return;
  const relative = publicUrl.replace(/^\/uploads\//, '');
  const target = path.join(UPLOAD_ROOT, relative);
  // Block traversal — only delete files inside UPLOAD_ROOT.
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) return;
  fs.promises.unlink(resolved).catch(() => {});
}

const router = express.Router();

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts, Planning (+ ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'PLANNING', 'SAFETY'];

const ORDER_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  creditPlacedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  quotation: {
    select: {
      id: true, quotationNumber: true, supplierName: true, supplierContact: true,
      supplierAddress: true, totalAmount: true, isUnion: true, createdAt: true,
    },
  },
  purchaseRequest: {
    select: {
      id: true, requestNumber: true, status: true, managerId: true, createdAt: true,
      manager: { select: { id: true, name: true, role: true } },
      unit: { select: { id: true, name: true, code: true } },
      items: {
        select: {
          id: true, productName: true, productUnit: true, requestedQty: true,
          materialSpecification: true, specAttachmentUrl: true, specAttachmentName: true,
          drawingNo: true, qapNo: true, itemRemarks: true,
        },
      },
    },
  },
  sourceRequests: {
    include: {
      purchaseRequest: {
        select: {
          id: true, requestNumber: true, status: true, managerId: true,
          manager: { select: { id: true, name: true, role: true } },
          unit: { select: { id: true, name: true, code: true } },
          items: {
            select: {
              id: true, productName: true, productUnit: true, requestedQty: true,
              materialSpecification: true, specAttachmentUrl: true, specAttachmentName: true,
              drawingNo: true, qapNo: true, itemRemarks: true,
            },
          },
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
              materialSpecification: true, drawingNo: true, qapNo: true, itemRemarks: true,
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
    include: {
      inspectedBy: { select: { id: true, name: true } },
      requestCreatedBy: { select: { id: true, name: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  },
};

// GET /api/purchase-orders — role-filtered list
router.get('/', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });

    // Role-based status visibility (intersected with the tab/status filter below)
    // Stores own "mark goods arrived", so they must see every status an order can
    // be in once it has been placed — including CREDIT_PLACED (credit orders sit
    // here until goods arrive, with no payment step in between).
    const STORE_MANAGER_STATUSES = ['ORDERED', 'PLACED', 'CREDIT_PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'PARTIAL', 'INWARD_DONE', 'COMPLETED', 'CLOSED'];
    const QC_STATUSES = ['GOODS_ARRIVED', 'QC_PENDING'];

    if (req.user.role === 'QC') {
      where.status = { in: QC_STATUSES };
    } else if (req.user.role === 'STORE_MANAGER') {
      // Stores need to anticipate incoming material, act on QC_PASSED, and review history.
      // Union POs follow the same status flow so this also exposes them.
      where.status = { in: STORE_MANAGER_STATUSES };
    } else if (req.user.role === 'MANAGER' || req.user.role === 'LAB') {
      // Unit managers/labs only see POs originating from their own purchase requests
      where.OR = [
        { purchaseRequest: { managerId: req.user.id } },
        { sourceRequests: { some: { purchaseRequest: { managerId: req.user.id } } } },
      ];
    }

    // Apply explicit status filter from tabs, intersected with role permissions
    if (status) {
      if (req.user.role === 'QC') {
        where.status = QC_STATUSES.includes(status) ? status : { in: [] };
      } else if (req.user.role === 'STORE_MANAGER') {
        where.status = STORE_MANAGER_STATUSES.includes(status) ? status : { in: [] };
      } else {
        where.status = status;
      }
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
        creditPlaced: counts['CREDIT_PLACED'] || 0,
        ordered: counts['ORDERED'] || 0,
        placed: counts['PLACED'] || 0,
        advancePaid: counts['ADVANCE_PAID'] || 0,
        paymentPending: counts['PAYMENT_PENDING'] || 0,
        paid: counts['PAID'] || 0,
        goodsArrived: counts['GOODS_ARRIVED'] || 0,
        qcPending: counts['QC_PENDING'] || 0,
        qcPassed: counts['QC_PASSED'] || 0,
        qcFailed: counts['QC_FAILED'] || 0,
        partial: counts['PARTIAL'] || 0,
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

// GET /api/purchase-orders/po-dashboard-feed — actionable lists for the PO dashboard
// Replaces the old "Active Purchase Assignments" tile which incorrectly merged
// purchasedQty (set via record-purchase) with receivedQty (set via inward).
// This feed returns four distinct buckets, each computed from authoritative
// fields so partial deliveries are never shown as fully delivered.
router.get('/po-dashboard-feed', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [partialOrders, awaitingQc, pendingPrs, openOrders] = await Promise.all([
      // Partially received: status PARTIAL is the canonical marker (set whenever
      // a lot arrives but the PO still has open quantity remaining).
      prisma.purchaseOrder.findMany({
        where: { status: 'PARTIAL' },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true, status: true,
          items: { select: { id: true, productName: true, productUnit: true, quantity: true, receivedQty: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // Awaiting QC inspection
      prisma.purchaseOrder.findMany({
        where: { status: { in: ['GOODS_ARRIVED', 'QC_PENDING'] } },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true,
          goodsArrivedAt: true,
        },
        orderBy: { goodsArrivedAt: 'desc' },
        take: 10,
      }),
      // PRs approved but no quotations entered yet — the PO needs to source quotes.
      prisma.purchaseRequest.findMany({
        where: {
          status: 'APPROVED',
          quotations: { none: {} },
          quotationSources: { none: {} },
        },
        select: {
          id: true, requestNumber: true, createdAt: true,
          manager: { select: { name: true } },
          unit: { select: { name: true, code: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
      // Open POs we'll filter for overdue (PR items.requiredByDate in the past)
      prisma.purchaseOrder.findMany({
        where: { status: { in: ['PENDING_ACCOUNTING', 'CREDIT_PLACED', 'ORDERED', 'PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'PARTIAL'] } },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true, status: true,
          purchaseRequest: { select: { items: { select: { requiredByDate: true } } } },
          sourceRequests: {
            select: {
              purchaseRequest: { select: { items: { select: { requiredByDate: true } } } },
            },
          },
        },
      }),
    ]);

    const partiallyReceived = partialOrders.map(o => {
      const totalOrdered = o.items.reduce((s, i) => s + (i.quantity || 0), 0);
      const totalReceived = o.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customName: o.customName,
        supplierName: o.supplierName,
        status: o.status,
        totalOrdered, totalReceived,
        items: o.items
          .filter(i => (i.receivedQty || 0) < (i.quantity || 0))
          .map(i => ({
            productName: i.productName, productUnit: i.productUnit,
            quantity: i.quantity, receivedQty: i.receivedQty || 0,
            pending: (i.quantity || 0) - (i.receivedQty || 0),
          })),
      };
    });

    const overdue = openOrders
      .map(o => {
        const dates = [
          ...(o.purchaseRequest?.items || []).map(i => i.requiredByDate),
          ...(o.sourceRequests || []).flatMap(s => (s.purchaseRequest?.items || []).map(i => i.requiredByDate)),
        ].filter(Boolean).map(d => new Date(d));
        if (dates.length === 0) return null;
        const earliest = dates.reduce((a, b) => (a < b ? a : b));
        if (earliest >= today) return null;
        const daysOverdue = Math.floor((today - earliest) / (1000 * 60 * 60 * 24));
        return {
          id: o.id, orderNumber: o.orderNumber, customName: o.customName,
          supplierName: o.supplierName, status: o.status,
          requiredByDate: earliest, daysOverdue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 10);

    res.json({
      partiallyReceived,
      awaitingQc,
      pendingQuotations: pendingPrs.map(pr => ({
        id: pr.id, requestNumber: pr.requestNumber,
        managerName: pr.manager?.name, unit: pr.unit,
        itemCount: pr._count?.items || 0, createdAt: pr.createdAt,
      })),
      overdue,
    });
  } catch (error) {
    console.error('PO dashboard feed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
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

// Inward Inspection Request (IIR) fields — purchase officer fills these when
// marking goods arrived. They feed straight into the QCInspection record so
// the QC team sees the full RAPS/IIR Rev 01 form (page 1) on arrival.
//
// `items` is the per-PO-item arrived qty for THIS lot. PO Officer enters how
// much of each ordered item physically reached stores with this delivery.
// e.g. ordered 1000 kg, this lot 400 kg → items: [{poItemId, arrivedQty: 400}].
const goodsArrivedItemSchema = z.object({
  poItemId: z.string().min(1, 'poItemId is required'),
  arrivedQty: z.preprocess(
    (v) => (typeof v === 'string' ? parseFloat(v) : v),
    z.number().positive('arrivedQty must be > 0'),
  ),
});

const goodsArrivedSchema = z.object({
  // Purchase Officer sets the batch number ONCE here. Locked thereafter — QC, Inward,
  // ProductBatch all read from QCInspection.batchNo. The MIV, FIFO list, stock movements
  // all carry this same identifier.
  batchNumber: z.string().trim().min(1, 'Batch number is required').max(64, 'Batch number too long'),
  invoiceNo: z.string().min(1, 'Invoice no. is required'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  dcNo: z.string().optional().nullable(),
  gatePassNo: z.string().optional().nullable(),
  gatePassType: z.string().optional().nullable(),
  probableDateOfReturn: z.string().optional().nullable(),
  materialReceiptDate: z.string().min(1, 'Material receipt date is required'),
  // Inspection scope ticked by Purchase Officer on the IIR form
  materialCategory: z.string().optional().nullable(),
  documentTypes: z.object({
    testReport: z.boolean().optional(),
    coc: z.boolean().optional(),
    coa: z.boolean().optional(),
    thirdParty: z.boolean().optional(),
    dimInspAtSupplier: z.boolean().optional(),
    dimInspAtRapsInward: z.boolean().optional(),
  }).partial().optional(),
  items: z.array(goodsArrivedItemSchema).min(1, 'At least one item with arrived qty is required'),
});

// PUT /api/purchase-orders/:id/place-on-credit — PO Officer places the order on word-of-trust.
// Order moves forward exactly like a paid order (items → ORDERED, source PRs → ORDER_PLACED)
// but no payment is required yet. The Payment Request is raised later and processed by Accounting;
// when that payment is marked PAID the PO transitions to PAID just like the normal flow.
const placeOnCreditSchema = z.object({
  creditNote: z.string().trim().max(500, 'Credit note too long (max 500 chars)').optional().nullable(),
});

router.put('/:id/place-on-credit', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { creditNote } = placeOnCreditSchema.parse(req.body || {});

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
    if (order.status !== 'PENDING_ACCOUNTING') {
      return res.status(400).json({
        error: `Cannot place on credit — order status is ${order.status}. Only orders awaiting accounting can be placed on credit.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: 'CREDIT_PLACED',
          isCreditOrder: true,
          creditPlacedAt: new Date(),
          creditPlacedById: req.user.id,
          creditNote: creditNote || null,
        },
        include: ORDER_INCLUDE,
      });

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

      return updatedOrder;
    });

    // FYI to Accounting — payment is still pending and will be raised separately.
    await prisma.notification.create({
      data: {
        type: 'ORDER_PLACED_ON_CREDIT',
        title: `Credit Order Placed: ${order.customName}`,
        message: `Order "${order.customName}" (${order.orderNumber}) for ₹${order.totalAmount.toLocaleString('en-IN')} with ${order.supplierName} has been placed on credit. Payment request will follow.`,
        targetRole: 'ACCOUNTING',
        sentById: req.user.id,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'ORDER_PLACED_ON_CREDIT',
        title: `Credit Order Placed: ${order.customName}`,
        message: `Order "${order.customName}" (${order.orderNumber}) was placed on credit. Payment processing will follow.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    const recipients = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest).filter((pr) => pr?.managerId)
      : (order.purchaseRequest?.managerId ? [order.purchaseRequest] : []);

    for (const pr of recipients) {
      await prisma.notification.create({
        data: {
          type: 'ORDER_PLACED',
          title: `Order Placed: ${pr.requestNumber}`,
          message: `Your order "${order.customName}" (${pr.requestNumber}) has been placed on credit with ${order.supplierName} and is now being processed.`,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ORDER_PLACED_ON_CREDIT',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          customName: order.customName,
          supplierName: order.supplierName,
          totalAmount: order.totalAmount,
          creditNote: creditNote || null,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
    console.error('Place on credit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/goods-arrived — Stores marks a lot as arrived.
// Accepts multipart/form-data so the invoice PDF can be uploaded alongside
// the IIR page-1 fields. `items` is a JSON-stringified array of per-PO-item
// arrived quantities for THIS lot (partial delivery).
router.put('/:id/goods-arrived', authenticate, authorize('STORE_MANAGER', 'ADMIN'), acceptGoodsArrived, async (req, res) => {
  const invoiceFile = req.files?.invoiceFile?.[0] || null;
  const lotReportFile = req.files?.lotReportFile?.[0] || null;
  const cleanupUploads = () => {
    if (invoiceFile) unlinkPublicFile(publicUrlFor('invoices', invoiceFile.filename));
    if (lotReportFile) unlinkPublicFile(publicUrlFor('lot-reports', lotReportFile.filename));
  };
  try {
    // Multer parsed form fields land as strings; rehydrate the structured pieces.
    const body = { ...req.body };
    if (typeof body.items === 'string') {
      try { body.items = JSON.parse(body.items); }
      catch { cleanupUploads(); return res.status(400).json({ error: 'items must be valid JSON' }); }
    }
    if (typeof body.documentTypes === 'string') {
      try { body.documentTypes = JSON.parse(body.documentTypes); }
      catch { cleanupUploads(); return res.status(400).json({ error: 'documentTypes must be valid JSON' }); }
    }

    const iir = goodsArrivedSchema.parse(body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        qcInspections: { select: { id: true, lotNumber: true, batchNo: true } },
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
      },
    });

    if (!order) {
      cleanupUploads();
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const allowedStatuses = ['ORDERED', 'CREDIT_PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'PARTIAL'];
    if (!allowedStatuses.includes(order.status)) {
      cleanupUploads();
      return res.status(400).json({
        error: order.status === 'GOODS_ARRIVED' || order.status === 'QC_PENDING' || order.status === 'QC_PASSED'
          ? 'A delivery batch is already being processed (QC / inward). Complete that first.'
          : `Cannot mark goods arrived when order status is ${order.status}`,
      });
    }

    // Validate each lot item exists on this PO and the cumulative arrived qty
    // (received so far + this lot) does not exceed the ordered quantity.
    const itemById = new Map(order.items.map((i) => [i.id, i]));
    for (const li of iir.items) {
      const poItem = itemById.get(li.poItemId);
      if (!poItem) {
        cleanupUploads();
        return res.status(400).json({ error: `Item ${li.poItemId} is not on this purchase order` });
      }
      const alreadyReceived = poItem.receivedQty || 0;
      if (alreadyReceived + li.arrivedQty > poItem.quantity + 0.0001) {
        cleanupUploads();
        const remaining = Math.max(0, poItem.quantity - alreadyReceived);
        return res.status(400).json({
          error: `Lot qty exceeds remaining for "${poItem.productName}": ` +
            `${alreadyReceived} of ${poItem.quantity} ${poItem.productUnit} already received, ` +
            `only ${remaining} left to arrive.`,
        });
      }
    }

    // Batch number must be unique across all lots on this PO so the FIFO/audit
    // trail can't be confused by two different lots sharing the same identifier.
    const incomingBatchNo = iir.batchNumber.trim();
    const duplicate = (order.qcInspections || []).find(
      (q) => (q.batchNo || '').trim().toLowerCase() === incomingBatchNo.toLowerCase(),
    );
    if (duplicate) {
      cleanupUploads();
      return res.status(400).json({
        error: `Batch number "${incomingBatchNo}" was already used on Lot ${duplicate.lotNumber || '?'} of this PO. Use a different batch number.`,
      });
    }

    const totalOrdered = order.items.reduce((s, i) => s + i.quantity, 0);
    const totalReceivedBefore = order.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
    const lotArrivedQty = iir.items.reduce((s, i) => s + i.arrivedQty, 0);
    const isFollowupLot = totalReceivedBefore > 0;
    const lotNumber = (order.qcInspections?.length || 0) + 1;
    const invoiceFileUrl = invoiceFile ? publicUrlFor('invoices', invoiceFile.filename) : null;
    const lotReportFileUrl = lotReportFile ? publicUrlFor('lot-reports', lotReportFile.filename) : null;

    const sourcePRs = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);
    const sourcePRIds = sourcePRs.map((p) => p.id);

    // Auto-create the inspection request (IIR page 1) so QC sees a populated
    // form directly. The PO supplies invoice / DC / gate pass / receipt details.
    const inspectionNumber = await generateSequentialNumber(prisma, 'QC');

    const { updated, inspection } = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          goodsArrived: true,
          goodsArrivedAt: new Date(),
          status: 'QC_PENDING',
        },
        include: ORDER_INCLUDE,
      });

      if (sourcePRIds.length) {
        await tx.purchaseRequest.updateMany({
          where: { id: { in: sourcePRIds } },
          data: { status: 'GOODS_ARRIVED' },
        });
      }

      const createdInspection = await tx.qCInspection.create({
        data: {
          inspectionNumber,
          purchaseOrderId: order.id,
          requestCreatedById: req.user.id,
          invoiceNo: iir.invoiceNo,
          invoiceDate: new Date(iir.invoiceDate),
          dcNo: iir.dcNo || null,
          gatePassNo: iir.gatePassNo || null,
          gatePassType: iir.gatePassType || null,
          probableDateOfReturn: iir.probableDateOfReturn ? new Date(iir.probableDateOfReturn) : null,
          materialReceiptDate: new Date(iir.materialReceiptDate),
          qtyOrdered: totalOrdered,
          qtyReceived: lotArrivedQty, // pre-fill so QC sees what arrived in this lot
          materialCategory: iir.materialCategory || null,
          documentTypes: iir.documentTypes || null,
          lotNumber,
          arrivedQty: lotArrivedQty,
          invoiceFileUrl,
          lotReportFileUrl,
          // Locked-in batch number set by Purchase Officer. Used as ProductBatch.batchNo
          // at inward and shown read-only on QC + Inward forms.
          batchNo: incomingBatchNo,
          items: {
            create: iir.items.map((li) => ({
              purchaseOrderItemId: li.poItemId,
              arrivedQty: li.arrivedQty,
            })),
          },
        },
        include: { items: true },
      });

      return { updated: updatedOrder, inspection: createdInspection };
    });

    const deliveryNote = isFollowupLot
      ? `Lot ${lotNumber} arrived for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName}. ${lotArrivedQty} unit(s) in this lot; ${totalReceivedBefore} previously received of ${totalOrdered} ordered. Please inspect.`
      : `Lot ${lotNumber} (${lotArrivedQty} of ${totalOrdered} units) for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName} has arrived. Please proceed with quality inspection.`;

    await prisma.notification.create({
      data: {
        type: 'INSPECTION_REQUEST',
        title: `Inspection Request ${inspection.inspectionNumber} (Lot ${lotNumber}): ${order.customName}`,
        message: `${deliveryNote} Inspection request ${inspection.inspectionNumber} has been auto-created — please fill the report.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });

    for (const pr of sourcePRs) {
      if (!pr.managerId) continue;
      await prisma.notification.create({
        data: {
          type: 'GOODS_ARRIVED',
          title: `${isFollowupLot ? 'More ' : ''}Goods Arrived (Lot ${lotNumber}): Your PR ${pr.requestNumber}`,
          message: order.isUnion
            ? `Lot ${lotNumber} for Union PO "${order.customName}" (${order.orderNumber}) — your PR ${pr.requestNumber} — has arrived (${lotArrivedQty} unit(s)) and is being inspected.`
            : (isFollowupLot
              ? `Lot ${lotNumber} for "${order.customName}" (${pr.requestNumber}) has arrived: ${lotArrivedQty} unit(s) in this lot, ${totalReceivedBefore} of ${totalOrdered} previously received.`
              : `Lot ${lotNumber} (${lotArrivedQty} of ${totalOrdered}) for your purchase request "${order.customName}" (${pr.requestNumber}) has arrived and is being inspected.`),
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
          lotNumber, lotArrivedQty, batchNumber: incomingBatchNo,
          isFollowupLot, totalReceivedBefore, totalOrdered,
          invoiceFileUrl,
          lotReportFileUrl,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    cleanupUploads();
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
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
                    id: true, productId: true, productName: true, productUnit: true, materialType: true,
                    request: {
                      // createdAt is required for FIFO ordering across source PRs on partial inward.
                      select: { id: true, requestNumber: true, createdAt: true, unit: { select: { id: true, name: true, code: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        purchaseRequest: {
          select: {
            id: true, requestNumber: true, managerId: true, unitId: true,
            manager: { select: { id: true, name: true, role: true } },
            items: { select: { id: true, productId: true, productName: true, productUnit: true, materialType: true } },
          },
        },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true, unitId: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (order.status !== 'QC_PASSED') {
      return res.status(400).json({ error: 'Inward entry can only be done after QC approval' });
    }

    // Find the lot being inwarded: the most recent QC inspection on this PO
    // whose result was finalised (PASSED/PARTIAL). Each "mark goods arrived"
    // creates exactly one inspection, and the workflow guarantees only one
    // active lot reaches QC_PASSED at a time.
    const activeInspection = await prisma.qCInspection.findFirst({
      where: { purchaseOrderId: req.params.id, result: { in: ['PASSED', 'PARTIAL'] } },
      orderBy: { lotNumber: 'desc' },
      select: { id: true, lotNumber: true, invoiceNo: true, qtyAccepted: true, batchNo: true },
    });
    const lotTag = activeInspection?.lotNumber ? ` — Lot ${activeInspection.lotNumber}` : '';
    // Locked batch number: set by Purchase Officer at goods-arrived, never editable downstream.
    // Every ProductBatch row created for this inward gets stamped with this exact identifier.
    const lockedBatchNo = activeInspection?.batchNo || null;

    // Inward qty is locked to whatever QC finalised on the inspection report.
    // Stores Incharge cannot reduce / inflate it — the submitted total must
    // equal QCInspection.qtyAccepted (within float tolerance).
    if (activeInspection?.qtyAccepted != null) {
      const submittedTotal = items.reduce((s, it) => s + (parseFloat(it.receivedQty) || 0), 0);
      if (Math.abs(submittedTotal - activeInspection.qtyAccepted) > 0.01) {
        return res.status(400).json({
          error: `Inward qty (${submittedTotal}) does not match QC-accepted qty (${activeInspection.qtyAccepted}). The inward total is locked to whatever QC finalised — Stores Incharge cannot alter it.`,
        });
      }
    }

    // Auto-generate MIR number (daily reset) on first inward only
    const mirNo = order.mirNo || (await generateMirNumber(prisma));

    const sourcePRs = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);
    const sourcePRIds = sourcePRs.map((p) => p.id);

    // P2034 = Prisma transaction conflict/deadlock. Retry up to 3 times with
    // exponential backoff + jitter; other errors propagate as before.
    const withInwardRetry = async (fn, attempt = 0) => {
      try { return await fn(); }
      catch (err) {
        if (err?.code === 'P2034' && attempt < 3) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt) + Math.random() * 50));
          return withInwardRetry(fn, attempt + 1);
        }
        throw err;
      }
    };
    const updated = await withInwardRetry(() => prisma.$transaction(async (tx) => {
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

        // Build per-allocation share list. For union items, allocate FIFO by source-PR
        // creation date: the PR that was raised earliest gets filled first, then the
        // next, and so on. This is the contract requested by the user — partial lots
        // honour the queue of requesters rather than splitting pro-rata.
        // For non-union items, this is a single synthetic share covering the original
        // purchaseRequestItemId path.
        let shares;
        if (isUnionItem) {
          const sortedAllocations = [...orderItem.allocations].sort((a, b) => {
            const aDate = a.purchaseRequestItem?.request?.createdAt
              ? new Date(a.purchaseRequestItem.request.createdAt).getTime()
              : 0;
            const bDate = b.purchaseRequestItem?.request?.createdAt
              ? new Date(b.purchaseRequestItem.request.createdAt).getTime()
              : 0;
            if (aDate !== bDate) return aDate - bDate;
            // Tie-breaker: earlier allocation (lower createdAt on the allocation row)
            return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          });

          // Use integer micro-units (×1000) so partial qty across many allocations
          // doesn't drift (e.g. 0.1 + 0.2 ≠ 0.30000000000000004). Convert to floats
          // only at the end when we write each share.
          const toMicro = (n) => Math.round((Number(n) || 0) * 1000);
          const fromMicro = (m) => Math.round(m) / 1000;
          const EPS_MICRO = 1; // 0.001

          let remainingMicro = toMicro(receivedQty);
          const rawShares = [];
          for (const alloc of sortedAllocations) {
            if (remainingMicro <= EPS_MICRO) break;
            const owedMicro = Math.max(0, toMicro(alloc.allocatedQty) - toMicro(alloc.receivedQty || 0));
            if (owedMicro <= 0) continue;
            const giveMicro = Math.min(owedMicro, remainingMicro);
            rawShares.push({ allocation: alloc, share: fromMicro(giveMicro) });
            remainingMicro -= giveMicro;
          }
          // Over-shipment (lot brought more than total still owed): dump the surplus
          // on the last unfilled allocation so the books balance. If every allocation
          // is already full, attribute it to the most recent (last) one.
          if (remainingMicro > EPS_MICRO) {
            if (rawShares.length > 0) {
              const last = rawShares[rawShares.length - 1];
              last.share = fromMicro(toMicro(last.share) + remainingMicro);
            } else if (sortedAllocations.length > 0) {
              rawShares.push({ allocation: sortedAllocations[sortedAllocations.length - 1], share: fromMicro(remainingMicro) });
            }
          }
          shares = rawShares;
        } else {
          shares = [{ allocation: null, share: receivedQty }];
        }

        // Resolve / create the product (shared across allocations — products are global).
        // Carry the PR item's materialType through so NRE products inherit their category
        // and existing products get their category synced on inward.
        let productId = null;
        let prMaterialType = null;
        if (isUnionItem) {
          const firstPrItem = orderItem.allocations[0]?.purchaseRequestItem;
          if (firstPrItem?.productId) productId = firstPrItem.productId;
          prMaterialType = normalizeMaterialType(firstPrItem?.materialType);
        } else if (orderItem.purchaseRequestItemId) {
          const prItem = order.purchaseRequest?.items.find(i => i.id === orderItem.purchaseRequestItemId);
          if (prItem?.productId) productId = prItem.productId;
          prMaterialType = normalizeMaterialType(prItem?.materialType);
        }

        if (!productId) {
          const existing = await tx.product.findFirst({
            where: { name: { equals: orderItem.productName, mode: 'insensitive' }, isActive: true },
          });
          if (existing) productId = existing.id;
        }

        if (!productId) {
          // Defensive: PR now creates NRE products itself, but if a legacy PR or
          // direct PO lands here we still generate a category-prefixed SKU.
          const sku = await generateProductSku(tx, prMaterialType);
          const newProduct = await tx.product.create({
            data: {
              name: orderItem.productName,
              sku,
              unit: orderItem.productUnit || 'pcs',
              category: prMaterialType,
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

        // Sync category from PR materialType if missing or different.
        // Existing category takes precedence only if it matches the PR type.
        const existingProduct = await tx.product.findUnique({
          where: { id: productId }, select: { category: true },
        });
        if (existingProduct && existingProduct.category !== prMaterialType) {
          await tx.product.update({
            where: { id: productId },
            data: { category: prMaterialType },
          });
        }

        // One Product stock update for the aggregate received qty
        await tx.product.update({
          where: { id: productId },
          data: { currentStock: { increment: receivedQty } },
        });

        // One stock movement + batch per share so the audit trail attributes each unit's slice.
        // Also increment per-unit stock (Phase 6) using the owning PR's unitId so material is
        // indented only to the requesting unit.
        for (const { allocation, share } of shares) {
          if (share <= 0) continue;
          const prRef = allocation?.purchaseRequestItem?.purchaseRequest;
          const unitTag = prRef?.unit?.code ? ` [${prRef.unit.code}]` : '';
          const prTag = prRef?.requestNumber ? ` — ${prRef.requestNumber}` : '';

          // Owning unit for this slice: union → from allocation's PR; single → from PO's PR
          const owningUnitId = allocation
            ? prRef?.unit?.id || null
            : order.purchaseRequest?.unitId || null;

          const movement = await tx.stockMovement.create({
            data: {
              productId,
              type: 'IN',
              quantity: share,
              referenceType: 'PurchaseOrder',
              referenceId: order.id,
              notes: `PO ${order.orderNumber} — ${order.supplierName}${prTag}${unitTag} (MIR ${mirNo})`,
              performedBy: req.user.id,
              unitId: owningUnitId,
            },
          });

          await tx.productBatch.create({
            data: {
              productId,
              receivedDate: new Date(),
              quantity: share,
              remaining: share,
              // Locked batch number from the QC inspection — same identifier across PO,
              // QC, Inward, MIV, FIFO. Client-supplied batch numbers are intentionally
              // ignored here so no one downstream can change the lot's identity.
              batchNo: lockedBatchNo,
              referenceType: 'PurchaseOrder',
              referenceId: movement.id,
              notes: `PO ${order.orderNumber}${lotTag} — ${orderItem.productName}${prTag}${unitTag} (MIR ${mirNo})`,
              createdById: req.user.id,
              sourceQcInspectionId: activeInspection?.id || null,
            },
          });

          if (allocation) {
            await tx.purchaseOrderItemAllocation.update({
              where: { id: allocation.id },
              data: { receivedQty: { increment: share } },
            });
          }

          // Phase 6: per-unit stock update
          if (owningUnitId) {
            await tx.productUnitStock.upsert({
              where: { productId_unitId: { productId, unitId: owningUnitId } },
              update: { quantity: { increment: share } },
              create: { productId, unitId: owningUnitId, quantity: share },
            });
          }
        }
      }

      // PO closes only when every line is fully received. Partial inwards keep
      // the PO open (status PARTIAL) so the next batch can still be inwarded.
      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: req.params.id },
      });
      const allFullyReceived = refreshedItems.every(i => i.receivedQty >= i.quantity);

      let result;
      if (allFullyReceived) {
        result = await tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: 'INWARD_DONE', mirNo, inwardedAt: new Date() },
          include: ORDER_INCLUDE,
        });
        if (sourcePRIds.length) {
          // Close a source PR only when every PO referencing it is fully received.
          // A PR may have spawned multiple POs (one per product) — wait for all.
          for (const prId of sourcePRIds) {
            const siblingOrders = await tx.purchaseOrder.findMany({
              where: {
                OR: [
                  { purchaseRequestId: prId },
                  { sourceRequests: { some: { purchaseRequestId: prId } } },
                ],
              },
              include: { items: true },
            });
            const everyOrderDone = siblingOrders.every(o =>
              o.id === req.params.id
                ? true
                : o.items.every(i => i.receivedQty >= i.quantity)
            );
            if (everyOrderDone) {
              await tx.purchaseRequest.update({
                where: { id: prId },
                data: { status: 'INWARD_DONE' },
              });
            }
          }
        }
      } else {
        // Partial delivery: keep PO open as PARTIAL with goodsArrived cleared
        // so the next batch can be marked arrived. MIR persists across batches.
        result = await tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: 'PARTIAL', goodsArrived: false, mirNo },
          include: ORDER_INCLUDE,
        });
      }

      return { result, allFullyReceived, refreshedItems };
    }));

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
          title: `Partial Delivery: ${order.customName}`,
          message: `${totalReceived} of ${totalOrdered} items received for "${order.customName}" (${order.orderNumber}). Order remains open as PARTIAL — mark goods arrived again when the next batch reaches stores.`,
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
  delayNote: z.string().optional(),
});

router.post('/:id/place-order', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = placeOrderSchema.parse(req.body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
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

    const paymentNumber = await generateSequentialNumber(prisma, 'PAY');
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

    // Save optional delay note on the order itself (separate from payment notes)
    if (data.delayNote && data.delayNote.trim()) {
      await prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { delayNote: data.delayNote.trim() },
      });
    }

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

// POST /api/purchase-orders/:id/po-document — PO uploads the signed PO PDF.
// Replaces any previously-uploaded copy and deletes the old file from disk.
router.post('/:id/po-document', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), acceptPoDocument, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PO PDF is required' });

    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) {
      unlinkPublicFile(publicUrlFor('po-docs', req.file.filename));
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    const newUrl = publicUrlFor('po-docs', req.file.filename);

    // If a PO PDF already existed, remove the old file before overwriting the DB pointer.
    if (order.poDocumentUrl) unlinkPublicFile(order.poDocumentUrl);

    const updated = await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { poDocumentUrl: newUrl },
      include: ORDER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: order.poDocumentUrl ? 'PO_DOC_REPLACED' : 'PO_DOC_UPLOADED',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: { orderNumber: order.orderNumber, filename: req.file.originalname },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Upload PO document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/purchase-orders/:id/po-document — PO removes the uploaded PDF entirely.
router.delete('/:id/po-document', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (!order.poDocumentUrl) return res.status(400).json({ error: 'No PO document uploaded' });

    unlinkPublicFile(order.poDocumentUrl);

    const updated = await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { poDocumentUrl: null },
      include: ORDER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'PO_DOC_DELETED',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: { orderNumber: order.orderNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Delete PO document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/close — Purchase Officer manually closes a PO.
//
// Two outcomes:
//   1. Clean close: every item fully received AND fully paid → status COMPLETED.
//   2. Force close (body.force=true): unreceived qty / unpaid balance is OK;
//      leftover PR items get cancelled and the PO is marked CLOSED + forceClosed.
//
// If the PO is incomplete and `force` is not set, returns 409 with the pending
// summary so the client can render a confirmation dialog ("X kg short, ₹Y unpaid
// — close anyway?").
const closeSchema = z.object({
  force: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

router.post('/:id/close', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const { force, reason } = closeSchema.parse(req.body || {});

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: { allocations: { select: { purchaseRequestItemId: true, allocatedQty: true, receivedQty: true } } },
        },
        paymentRequests: { select: { status: true, amount: true } },
        purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    if (['COMPLETED', 'CLOSED'].includes(order.status)) {
      return res.status(400).json({ error: 'Purchase order is already closed' });
    }

    // Compute what's still pending.
    const pendingItems = order.items
      .filter(i => i.receivedQty < i.quantity)
      .map(i => ({
        purchaseOrderItemId: i.id,
        productName: i.productName,
        productUnit: i.productUnit,
        ordered: i.quantity,
        received: i.receivedQty,
        shortQty: Number((i.quantity - i.receivedQty).toFixed(3)),
      }));
    const paymentRemaining = Number((order.totalAmount - order.totalPaid).toFixed(2));
    const hasOpenPayment = order.paymentRequests.some(p => p.status === 'PENDING' || p.status === 'APPROVED');

    const isComplete = pendingItems.length === 0 && paymentRemaining <= 0.01 && !hasOpenPayment;

    if (!isComplete && !force) {
      return res.status(409).json({
        error: 'Purchase order is not complete',
        pendingItems,
        paymentRemaining: paymentRemaining > 0.01 ? paymentRemaining : 0,
        openPaymentRequests: hasOpenPayment,
      });
    }

    // Linked PR ids (for force-close cancellation + notifications).
    const linkedPRs = order.isUnion
      ? order.sourceRequests.map(s => s.purchaseRequest).filter(Boolean)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);

    // PR-item ids whose ordered qty is still short on this PO. These get
    // cancelled on force-close so the PR can close out without waiting forever.
    const leftoverPRItemIds = [];
    if (!isComplete && force) {
      for (const poItem of order.items) {
        if (poItem.receivedQty >= poItem.quantity) continue;
        if (order.isUnion && poItem.allocations?.length) {
          for (const a of poItem.allocations) {
            if (a.receivedQty < a.allocatedQty) leftoverPRItemIds.push(a.purchaseRequestItemId);
          }
        } else if (poItem.purchaseRequestItemId) {
          leftoverPRItemIds.push(poItem.purchaseRequestItemId);
        }
      }
    }

    const finalStatus = isComplete ? 'COMPLETED' : 'CLOSED';

    const updated = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          closedAt: new Date(),
          closedById: req.user.id,
          closeReason: reason || (isComplete ? 'Clean close — fully received and paid' : 'Force closed with pending items/payment'),
          forceClosed: !isComplete,
        },
        include: ORDER_INCLUDE,
      });

      if (!isComplete && leftoverPRItemIds.length > 0) {
        await cancelLeftoverPRItems(tx, [...new Set(leftoverPRItemIds)], reason || 'PO force-closed');
      }

      return po;
    });

    // Notifications — managers (for each source PR), store manager team, and admins.
    const closeKindLabel = isComplete ? 'closed (fully received & paid)' : 'force-closed';
    for (const pr of linkedPRs) {
      if (!pr.managerId) continue;
      await prisma.notification.create({
        data: {
          type: isComplete ? 'PO_CLOSED' : 'PO_FORCE_CLOSED',
          title: `Purchase order ${order.orderNumber} ${closeKindLabel}`,
          message: isComplete
            ? `PO "${order.customName}" (${order.orderNumber}) on your PR ${pr.requestNumber} has been closed cleanly.`
            : `PO "${order.customName}" (${order.orderNumber}) on your PR ${pr.requestNumber} was force-closed. Any remaining qty on the PR has been cancelled.${reason ? ' Reason: ' + reason : ''}`,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }
    await prisma.notification.create({
      data: {
        type: isComplete ? 'PO_CLOSED' : 'PO_FORCE_CLOSED',
        title: `PO ${order.orderNumber} ${closeKindLabel}`,
        message: `${order.customName} (${order.orderNumber}) ${closeKindLabel} by ${req.user.name}. Supplier: ${order.supplierName}.`,
        targetRole: 'STORE_MANAGER',
        sentById: req.user.id,
      },
    });
    if (!isComplete) {
      await prisma.notification.create({
        data: {
          type: 'PO_FORCE_CLOSED',
          title: `PO ${order.orderNumber} force-closed`,
          message: `${order.customName} (${order.orderNumber}) was force-closed by ${req.user.name} with ${pendingItems.length} item(s) short and ₹${paymentRemaining.toLocaleString('en-IN')} unpaid.${reason ? ' Reason: ' + reason : ''}`,
          targetRole: 'ADMIN',
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: isComplete ? 'CLOSE_PO' : 'FORCE_CLOSE_PO',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          forceClosed: !isComplete,
          pendingItems,
          paymentRemaining,
          cancelledPRItemIds: leftoverPRItemIds,
          reason: reason || null,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Close PO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
