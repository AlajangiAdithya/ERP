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

const unionCreateSchema = z.object({
  purchaseRequestIds: z.array(z.string().uuid()).min(2),
  notes: z.string().optional(),
  items: z.array(z.object({
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    supplierName: z.string().min(1),
    supplierContact: z.string().optional(),
    supplierAddress: z.string().optional(),
    sources: z.array(z.object({
      purchaseRequestItemId: z.string().uuid(),
      allocatedQty: z.number().positive(),
    })).min(2),
  })).min(1),
});

// Tolerance for float-sum vs total comparison (kg/litre/pcs all use Float)
const QTY_TOLERANCE = 0.001;

// GET /api/quotations?purchaseRequestId=X — list quotations for a PR (includes unions touching that PR)
router.get('/', authenticate, async (req, res) => {
  try {
    const { purchaseRequestId, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (purchaseRequestId) {
      where.OR = [
        { purchaseRequestId },
        { sourceRequests: { some: { purchaseRequestId } } },
      ];
    }

    const [quotations, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: {
          createdBy: { select: { id: true, name: true } },
          items: true,
          purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
          sourceRequests: {
            include: {
              purchaseRequest: {
                select: {
                  id: true, requestNumber: true, status: true, requestId: true,
                  manager: { select: { id: true, name: true } },
                  unit: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
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
        sourceRequests: {
          include: {
            purchaseRequest: {
              select: {
                id: true, requestNumber: true, status: true, requestId: true,
                manager: { select: { id: true, name: true } },
                unit: { select: { id: true, name: true, code: true } },
                items: true,
              },
            },
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

// POST /api/quotations — PO creates a single-PR quotation
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

// POST /api/quotations/union — PO creates a union quotation aggregating items from multiple PRs.
// Each item carries `sources: [{ purchaseRequestItemId, allocatedQty }]` so the per-unit slice
// is preserved end-to-end (carried to PurchaseOrderItemAllocation on admin approval).
router.post('/union', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = unionCreateSchema.parse(req.body);
    const uniquePrIds = [...new Set(data.purchaseRequestIds)];
    if (uniquePrIds.length < 2) {
      return res.status(400).json({ error: 'A union quotation must span at least 2 distinct purchase requests' });
    }

    const prs = await prisma.purchaseRequest.findMany({
      where: { id: { in: uniquePrIds } },
      include: { items: true, manager: { select: { id: true, name: true } }, unit: { select: { name: true, code: true } } },
    });
    if (prs.length !== uniquePrIds.length) {
      return res.status(404).json({ error: 'One or more purchase requests not found' });
    }
    for (const pr of prs) {
      if (pr.status !== 'APPROVED') {
        return res.status(400).json({ error: `PR ${pr.requestNumber} is not in APPROVED state for new quotations (status: ${pr.status})` });
      }
    }

    // Build a fast lookup of valid PR-item ownership
    const prItemOwner = new Map();
    for (const pr of prs) {
      for (const it of pr.items) prItemOwner.set(it.id, pr.id);
    }

    // Validate every item's source allocations
    for (const item of data.items) {
      const sumAllocations = item.sources.reduce((s, src) => s + src.allocatedQty, 0);
      if (Math.abs(sumAllocations - item.quantity) > QTY_TOLERANCE) {
        return res.status(400).json({
          error: `Item "${item.productName}" allocation sum (${sumAllocations}) does not equal total quantity (${item.quantity})`,
        });
      }
      const seenPrIds = new Set();
      for (const src of item.sources) {
        const ownerPrId = prItemOwner.get(src.purchaseRequestItemId);
        if (!ownerPrId) {
          return res.status(400).json({ error: `Allocation references unknown PR item ${src.purchaseRequestItemId}` });
        }
        if (!uniquePrIds.includes(ownerPrId)) {
          return res.status(400).json({ error: `PR item ${src.purchaseRequestItemId} does not belong to the selected purchase requests` });
        }
        seenPrIds.add(ownerPrId);
      }
      if (seenPrIds.size < 2) {
        return res.status(400).json({ error: `Item "${item.productName}" must aggregate from at least 2 distinct purchase requests` });
      }
    }

    const totalAmount = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const quotationNumber = generateOrderNumber('QT');

    const quotation = await prisma.quotation.create({
      data: {
        quotationNumber,
        purchaseRequestId: null,
        isUnion: true,
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
            sourceAllocations: item.sources,
          })),
        },
        sourceRequests: {
          create: uniquePrIds.map(prId => ({ purchaseRequestId: prId })),
        },
      },
      include: {
        items: true,
        createdBy: { select: { id: true, name: true } },
        sourceRequests: { include: { purchaseRequest: { select: { id: true, requestNumber: true, unit: { select: { name: true, code: true } } } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE_UNION_QUOTATION',
        entity: 'Quotation',
        entityId: quotation.id,
        details: {
          quotationNumber,
          totalAmount: quotation.totalAmount,
          sourcePurchaseRequests: prs.map(p => ({ id: p.id, requestNumber: p.requestNumber, unit: p.unit?.code })),
          itemCount: data.items.length,
        },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(quotation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Create union quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/quotations/:id — PO updates a quotation
router.put('/:id', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: { purchaseRequest: true, sourceRequests: { include: { purchaseRequest: true } } },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.isSelected) {
      return res.status(400).json({ error: 'Cannot edit a selected quotation' });
    }
    if (quotation.isUnion) {
      return res.status(400).json({ error: 'Union quotations cannot be edited inline — delete and recreate to change' });
    }
    if (!['APPROVED', 'QUOTATION_SUBMITTED'].includes(quotation.purchaseRequest.status)) {
      return res.status(400).json({ error: 'Cannot edit quotations at this stage' });
    }

    const { notes, items } = req.body;

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
      include: { purchaseRequest: true, sourceRequests: true },
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
        details: { quotationNumber: quotation.quotationNumber, isUnion: quotation.isUnion },
        ipAddress: req.ip,
      },
    });

    res.json({ message: 'Quotation deleted' });
  } catch (error) {
    console.error('Delete quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/quotations/submit/:purchaseRequestId — PO submits single-PR quotations to ADMIN
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

// POST /api/quotations/union/submit — PO submits competing union quotations covering a PR set
// Body: { purchaseRequestIds: [uuid, ...] } — transitions every listed PR to QUOTATION_SUBMITTED
// and notifies admin once with the full set of unions touching those PRs.
const unionSubmitSchema = z.object({
  purchaseRequestIds: z.array(z.string().uuid()).min(2),
});

router.post('/union/submit', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { purchaseRequestIds } = unionSubmitSchema.parse(req.body);
    const uniquePrIds = [...new Set(purchaseRequestIds)];

    const prs = await prisma.purchaseRequest.findMany({
      where: { id: { in: uniquePrIds } },
      include: { manager: { select: { id: true, name: true } }, unit: { select: { name: true, code: true } } },
    });
    if (prs.length !== uniquePrIds.length) {
      return res.status(404).json({ error: 'One or more purchase requests not found' });
    }
    for (const pr of prs) {
      if (pr.status !== 'APPROVED') {
        return res.status(400).json({ error: `PR ${pr.requestNumber} is not in APPROVED state (current: ${pr.status})` });
      }
    }

    // Pull every union quotation that touches any of these PRs and is not yet selected
    const unions = await prisma.quotation.findMany({
      where: {
        isUnion: true,
        isSelected: false,
        sourceRequests: { some: { purchaseRequestId: { in: uniquePrIds } } },
      },
      include: {
        sourceRequests: { select: { purchaseRequestId: true } },
      },
    });

    if (unions.length === 0) {
      return res.status(400).json({ error: 'At least one union quotation is required before submission' });
    }

    // Every union must be fully contained inside the submitted PR set, otherwise the
    // approval flow will fail (because admin select requires every source PR in QUOTATION_SUBMITTED).
    for (const u of unions) {
      const outside = u.sourceRequests.find(s => !uniquePrIds.includes(s.purchaseRequestId));
      if (outside) {
        return res.status(400).json({
          error: `Union quotation ${u.quotationNumber} also covers PRs outside this submission. Include all of its source PRs together.`,
        });
      }
    }

    await prisma.purchaseRequest.updateMany({
      where: { id: { in: uniquePrIds } },
      data: { status: 'QUOTATION_SUBMITTED' },
    });

    const maxTotal = Math.max(...unions.map(q => q.totalAmount));
    const minTotal = Math.min(...unions.map(q => q.totalAmount));
    const maxTier = getTier(maxTotal);

    await prisma.notification.create({
      data: {
        type: 'QUOTATION_REVIEW',
        title: `Union Quotation Review Required (${unions.length} competing)`,
        message: `${unions.length} union quotation(s) submitted covering ${uniquePrIds.length} PRs (${prs.map(p => p.requestNumber).join(', ')}). Range: ₹${minTotal.toLocaleString('en-IN')} - ₹${maxTotal.toLocaleString('en-IN')}. Approval tier: ${maxTier} — ${getTierLabel(maxTier)}.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'SUBMIT_UNION_QUOTATIONS',
        entity: 'Quotation',
        entityId: unions[0].id,
        details: {
          unionQuotationNumbers: unions.map(u => u.quotationNumber),
          purchaseRequests: prs.map(p => ({ id: p.id, requestNumber: p.requestNumber })),
          unionCount: unions.length,
          maxTotal,
        },
        ipAddress: req.ip,
      },
    });

    res.json({ message: 'Union quotations submitted for admin approval', unionCount: unions.length });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Submit union quotations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/quotations/:id/select — ADMIN approves a quotation + creates PurchaseOrder(s)
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
        sourceRequests: {
          include: {
            purchaseRequest: {
              include: {
                manager: { select: { id: true, name: true, role: true } },
                unit: { select: { name: true, code: true } },
                items: true,
              },
            },
          },
        },
      },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });

    // For union: derive PR list from sourceRequests; for single: from purchaseRequest
    const sourcePRs = quotation.isUnion
      ? quotation.sourceRequests.map(s => s.purchaseRequest)
      : [quotation.purchaseRequest];

    if (sourcePRs.length === 0 || sourcePRs.some(pr => !pr)) {
      return res.status(400).json({ error: 'Quotation has no resolvable source purchase requests' });
    }

    for (const pr of sourcePRs) {
      if (pr.status !== 'QUOTATION_SUBMITTED') {
        return res.status(400).json({
          error: `PR ${pr.requestNumber} is not in QUOTATION_SUBMITTED state (current: ${pr.status})`,
        });
      }
    }

    const tier = getTier(quotation.totalAmount);
    if (!canApprove(req.user, quotation.totalAmount)) {
      return res.status(403).json({
        error: `This quotation totals ₹${quotation.totalAmount.toLocaleString('en-IN')} (${tier}). Approval required from: ${getTierLabel(tier)}.`,
        tier,
        requiredApprovers: getTierLabel(tier),
      });
    }

    // Order name: for unions, build a synthetic name listing source PR requestIds;
    // for single PR, keep the existing behavior.
    const orderName = quotation.isUnion
      ? `UNION: ${sourcePRs.map(p => p.requestId || p.requestNumber).join(' + ')}`
      : quotation.purchaseRequest.requestId;

    // For non-union: match by productName as before.
    const allPRItems = sourcePRs.flatMap(p => p.items);
    const matchPRItem = (productName) => {
      const exact = allPRItems.find((i) => i.productName === productName);
      if (exact) return exact.id;
      const ci = allPRItems.find((i) => i.productName.toLowerCase() === productName.toLowerCase());
      return ci ? ci.id : null;
    };

    // Group items by supplierName (one PO per supplier, as today)
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
        const orderNumber = generateOrderNumber(quotation.isUnion ? 'PO-UN' : 'PO');

        // Build per-item create payload. For union items the quotation item carries `sourceAllocations`;
        // those become PurchaseOrderItemAllocation rows. Non-union falls back to the existing
        // purchaseRequestItemId field.
        const itemCreates = g.items.map((item) => {
          const base = {
            productName: item.productName,
            productUnit: item.productUnit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            itemStatus: 'WAITING',
          };
          if (quotation.isUnion && Array.isArray(item.sourceAllocations) && item.sourceAllocations.length > 0) {
            return {
              ...base,
              purchaseRequestItemId: null,
              allocations: {
                create: item.sourceAllocations.map(src => ({
                  purchaseRequestItemId: src.purchaseRequestItemId,
                  allocatedQty: src.allocatedQty,
                  receivedQty: 0,
                })),
              },
            };
          }
          return {
            ...base,
            purchaseRequestItemId: matchPRItem(item.productName),
          };
        });

        const po = await tx.purchaseOrder.create({
          data: {
            orderNumber,
            customName: orderName,
            // For union POs, leave purchaseRequestId null and rely on sourceRequests; for single, keep legacy link
            purchaseRequestId: quotation.isUnion ? null : sourcePRs[0].id,
            isUnion: quotation.isUnion,
            quotationId: quotation.id,
            supplierName: g.supplierName,
            totalAmount: groupTotal,
            status: 'PENDING_ACCOUNTING',
            createdById: req.user.id,
            items: { create: itemCreates },
            ...(quotation.isUnion ? {
              sourceRequests: { create: sourcePRs.map(pr => ({ purchaseRequestId: pr.id })) },
            } : {}),
          },
          include: { items: { include: { allocations: true } }, sourceRequests: true },
        });
        orders.push(po);
      }

      // Transition every source PR to QUOTATION_APPROVED
      await tx.purchaseRequest.updateMany({
        where: { id: { in: sourcePRs.map(p => p.id) } },
        data: { status: 'QUOTATION_APPROVED' },
      });

      return orders;
    });

    const supplierSummary = createdOrders
      .map(o => `${o.supplierName} (₹${o.totalAmount.toLocaleString('en-IN')}, ${o.orderNumber})`)
      .join('; ');

    if (quotation.isUnion) {
      // Notify the PO once, plus each source PR's creator individually
      await prisma.notification.create({
        data: {
          type: 'QUOTATION_APPROVED',
          title: `Union Quotation Approved: ${quotation.quotationNumber}`,
          message: `Admin approved union quotation covering ${sourcePRs.length} PRs. ${createdOrders.length} union purchase order(s) created — ${supplierSummary}. Place the orders to trigger payment requests.`,
          targetRole: 'PURCHASE_OFFICER',
          sentById: req.user.id,
        },
      });
      for (const pr of sourcePRs) {
        if (!pr.managerId) continue;
        await prisma.notification.create({
          data: {
            type: 'PURCHASE_REQUEST_APPROVED',
            title: `Your PR ${pr.requestNumber} is now under a Union PO`,
            message: `Your purchase request ${pr.requestNumber} has been consolidated into union order(s) ${createdOrders.map(o => o.orderNumber).join(', ')} alongside ${sourcePRs.length - 1} other unit(s). Suppliers: ${[...new Set(createdOrders.map(o => o.supplierName))].join(', ')}.`,
            targetUserId: pr.managerId,
            sentById: req.user.id,
          },
        });
      }
    } else {
      await prisma.notification.create({
        data: {
          type: 'QUOTATION_APPROVED',
          title: `Quotation Approved: ${quotation.purchaseRequest.requestNumber}`,
          message: `Admin approved quotation for order "${orderName}". ${createdOrders.length} purchase order(s) created — ${supplierSummary}. Place the orders to trigger payment requests.`,
          targetRole: 'PURCHASE_OFFICER',
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: quotation.isUnion ? 'SELECT_UNION_QUOTATION' : 'SELECT_QUOTATION',
        entity: 'Quotation',
        entityId: quotation.id,
        details: {
          quotationNumber: quotation.quotationNumber,
          isUnion: quotation.isUnion,
          totalAmount: quotation.totalAmount,
          orderName,
          sourcePurchaseRequests: sourcePRs.map(p => ({ id: p.id, requestNumber: p.requestNumber })),
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
