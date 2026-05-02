const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateOrderNumber, paginate } = require('../utils/helpers');
const { canApprove, getTier, getTierLabel } = require('../utils/approvalTiers');

const router = express.Router();

const createSchema = z.object({
  purchaseRequestId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    supplierName: z.string().min(1),
    supplierContact: z.string().optional(),
    supplierAddress: z.string().optional(),
  })).min(1),
});

// GET /api/quotations?purchaseRequestId=X — list quotations for a PR
router.get('/', authenticate, async (req, res) => {
  try {
    const { purchaseRequestId, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (purchaseRequestId) where.purchaseRequestId = purchaseRequestId;

    const [quotations, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true } },
          items: true,
          purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.quotation.count({ where }),
    ]);

    res.json({ quotations, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get quotations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/quotations/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: true,
        purchaseRequest: {
          select: {
            id: true, requestNumber: true, status: true,
            manager: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true, code: true } },
            items: true,
          },
        },
      },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    res.json(quotation);
  } catch (error) {
    console.error('Get quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quotations — PO creates a quotation for a PR
router.post('/', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id: data.purchaseRequestId },
    });

    if (!pr) return res.status(404).json({ error: 'Purchase request not found' });
    if (!['APPROVED', 'QUOTATION_SUBMITTED'].includes(pr.status)) {
      return res.status(400).json({ error: 'Can only add quotations to approved purchase requests' });
    }

    const totalAmount = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const quotationNumber = generateOrderNumber('QT');

    const quotation = await prisma.quotation.create({
      data: {
        quotationNumber,
        purchaseRequestId: data.purchaseRequestId,
        totalAmount,
        notes: data.notes || null,
        createdById: req.user.id,
        items: {
          create: data.items.map(item => ({
            productName: item.productName,
            productUnit: item.productUnit || 'pcs',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
            supplierName: item.supplierName.trim(),
            supplierContact: item.supplierContact || null,
            supplierAddress: item.supplierAddress || null,
          })),
        },
      },
      include: { items: true, createdBy: { select: { id: true, name: true } } },
    });

    const suppliers = [...new Set(data.items.map(i => i.supplierName.trim()))];
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'Quotation',
        entityId: quotation.id,
        details: { quotationNumber, suppliers, totalAmount, purchaseRequestId: data.purchaseRequestId },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(quotation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/quotations/:id — PO updates a quotation
router.put('/:id', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { purchaseRequest: true },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.isSelected) {
      return res.status(400).json({ error: 'Cannot edit a selected quotation' });
    }
    if (!['APPROVED', 'QUOTATION_SUBMITTED'].includes(quotation.purchaseRequest.status)) {
      return res.status(400).json({ error: 'Cannot edit quotations at this stage' });
    }

    const { notes, items } = req.body;

    // Delete old items and recreate if items provided
    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (!item.supplierName || !String(item.supplierName).trim()) {
          return res.status(400).json({ error: 'Each item requires a supplier name' });
        }
      }
      await prisma.quotationItem.deleteMany({ where: { quotationId: req.params.id } });
      const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

      const updated = await prisma.quotation.update({
        where: { id: req.params.id },
        data: {
          notes: notes !== undefined ? notes : quotation.notes,
          totalAmount,
          items: {
            create: items.map(item => ({
              productName: item.productName,
              productUnit: item.productUnit || 'pcs',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              supplierName: String(item.supplierName).trim(),
              supplierContact: item.supplierContact || null,
              supplierAddress: item.supplierAddress || null,
            })),
          },
        },
        include: { items: true, createdBy: { select: { id: true, name: true } } },
      });
      return res.json(updated);
    }

    const updated = await prisma.quotation.update({
      where: { id: req.params.id },
      data: {
        notes: notes !== undefined ? notes : quotation.notes,
      },
      include: { items: true, createdBy: { select: { id: true, name: true } } },
    });
    res.json(updated);
  } catch (error) {
    console.error('Update quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/quotations/:id — PO deletes (only before submission)
router.delete('/:id', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { purchaseRequest: true },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.isSelected) {
      return res.status(400).json({ error: 'Cannot delete a selected quotation' });
    }

    await prisma.quotation.delete({ where: { id: req.params.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETE',
        entity: 'Quotation',
        entityId: req.params.id,
        details: { quotationNumber: quotation.quotationNumber },
        ipAddress: req.ip,
      },
    });

    res.json({ message: 'Quotation deleted' });
  } catch (error) {
    console.error('Delete quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quotations/submit/:purchaseRequestId — PO submits all quotations to ADMIN for approval
router.post('/submit/:purchaseRequestId', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { purchaseRequestId } = req.params;

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id: purchaseRequestId },
      include: { manager: { select: { id: true, name: true } }, unit: { select: { name: true } } },
    });

    if (!pr) return res.status(404).json({ error: 'Purchase request not found' });
    if (pr.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Quotations can only be submitted for approved purchase requests' });
    }

    const quotations = await prisma.quotation.findMany({
      where: { purchaseRequestId },
      include: { items: true },
    });

    if (quotations.length === 0) {
      return res.status(400).json({ error: 'At least one quotation is required before submission' });
    }

    const maxTotal = Math.max(...quotations.map(q => q.totalAmount));
    const minTotal = Math.min(...quotations.map(q => q.totalAmount));
    const maxTier = getTier(maxTotal);

    await prisma.purchaseRequest.update({
      where: { id: purchaseRequestId },
      data: { status: 'QUOTATION_SUBMITTED' },
    });

    await prisma.notification.create({
      data: {
        type: 'QUOTATION_REVIEW',
        title: `Quotation Review Required: ${pr.requestNumber}`,
        message: `${quotations.length} quotation(s) submitted for ${pr.requestNumber} from ${pr.manager?.name} (${pr.unit?.name}). Range: ₹${minTotal.toLocaleString('en-IN')} - ₹${maxTotal.toLocaleString('en-IN')}. Approval tier: ${maxTier} — ${getTierLabel(maxTier)}.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'SUBMIT_QUOTATIONS',
        entity: 'PurchaseRequest',
        entityId: purchaseRequestId,
        details: { requestNumber: pr.requestNumber, quotationCount: quotations.length, maxTotal },
        ipAddress: req.ip,
      },
    });

    res.json({ message: 'Quotations submitted for admin approval', quotationCount: quotations.length });
  } catch (error) {
    console.error('Submit quotations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/quotations/:id/select — ADMIN approves a quotation + creates PurchaseOrder (PENDING_ACCOUNTING)
router.put('/:id/select', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: {
          include: {
            manager: { select: { id: true, name: true, role: true } },
            unit: { select: { name: true } },
            items: true,
          },
        },
      },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    const pr = quotation.purchaseRequest;
    if (pr.status !== 'QUOTATION_SUBMITTED') {
      return res.status(400).json({ error: 'Quotations have not been submitted for approval yet' });
    }

    // Tiered approval — gate by total quotation amount
    const tier = getTier(quotation.totalAmount);
    if (!canApprove(req.user, quotation.totalAmount)) {
      return res.status(403).json({
        error: `This quotation totals ₹${quotation.totalAmount.toLocaleString('en-IN')} (${tier}). Approval required from: ${getTierLabel(tier)}.`,
        tier,
        requiredApprovers: getTierLabel(tier),
      });
    }

    const orderName = pr.requestId;

    // Match each quotation item to a PR item by productName (best-effort)
    const matchPRItem = (productName) => {
      const exact = pr.items.find((i) => i.productName === productName);
      if (exact) return exact.id;
      const ci = pr.items.find((i) => i.productName.toLowerCase() === productName.toLowerCase());
      return ci ? ci.id : null;
    };

    // Group items by supplierName (trim + case-insensitive key; keep first-seen casing for display)
    const groups = new Map();
    for (const item of quotation.items) {
      const key = (item.supplierName || '').trim().toLowerCase();
      if (!key) continue;
      if (!groups.has(key)) {
        groups.set(key, {
          supplierName: item.supplierName.trim(),
          supplierContact: item.supplierContact || null,
          supplierAddress: item.supplierAddress || null,
          items: [],
        });
      }
      groups.get(key).items.push(item);
    }

    if (groups.size === 0) {
      return res.status(400).json({ error: 'Quotation has no items with suppliers' });
    }

    const createdOrders = await prisma.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id: req.params.id },
        data: { isSelected: true },
      });

      const orders = [];
      for (const g of groups.values()) {
        const groupTotal = g.items.reduce((sum, it) => sum + it.totalPrice, 0);
        const orderNumber = generateOrderNumber('PO');
        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber,
            customName: orderName,
            purchaseRequestId: pr.id,
            quotationId: quotation.id,
            supplierName: g.supplierName,
            totalAmount: groupTotal,
            status: 'PENDING_ACCOUNTING',
            createdById: req.user.id,
            items: {
              create: g.items.map((item) => ({
                productName: item.productName,
                productUnit: item.productUnit,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                itemStatus: 'WAITING',
                purchaseRequestItemId: matchPRItem(item.productName),
              })),
            },
          },
          include: { items: true },
        });
        orders.push(po);
      }

      await tx.purchaseRequest.update({
        where: { id: pr.id },
        data: { status: 'QUOTATION_APPROVED' },
      });

      return orders;
    });

    const supplierSummary = createdOrders
      .map(o => `${o.supplierName} (₹${o.totalAmount.toLocaleString('en-IN')}, ${o.orderNumber})`)
      .join('; ');

    await prisma.notification.create({
      data: {
        type: 'QUOTATION_APPROVED',
        title: `Quotation Approved: ${pr.requestNumber}`,
        message: `Admin approved quotation for order "${orderName}". ${createdOrders.length} purchase order(s) created — ${supplierSummary}. Place the orders to trigger payment requests.`,
        targetRole: 'PURCHASE_OFFICER',
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'SELECT_QUOTATION',
        entity: 'Quotation',
        entityId: quotation.id,
        details: {
          quotationNumber: quotation.quotationNumber,
          totalAmount: quotation.totalAmount,
          orderName,
          purchaseRequestNumber: pr.requestNumber,
          purchaseOrders: createdOrders.map(o => ({
            orderNumber: o.orderNumber,
            supplierName: o.supplierName,
            totalAmount: o.totalAmount,
          })),
        },
        ipAddress: req.ip,
      },
    });

    res.json({ message: 'Quotation approved and orders created', purchaseOrders: createdOrders });
  } catch (error) {
    console.error('Select quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
