// Material pool endpoints.
//
// A pool is a lightweight "intent to bundle" object: the PO declares that
// these PR-items share a material and should be quoted together. Quoting
// itself still happens through /api/quotations/union — the pool just makes
// the bundle persistent so multiple competing union quotes can attach to it
// over time without the PO re-picking the lines from scratch each round.
//
// Lifecycle:
//   OPEN      → no submitted quote yet; PO can add/remove items freely
//   QUOTED    → ≥1 union quotation submitted to admin (still amendable: PO can
//               revise quotes by re-submitting; pool composition locked)
//   APPROVED  → admin selected one of the union quotes; PO is live
//   CANCELLED → pool dissolved; PR-items return to single-quote land
//
// A pool's productName + productUnit must match every item exactly. Cross-unit
// pooling is allowed (and is the whole point — different units' PRs share a
// supplier order).

const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, withDocRetry, getFinancialYear } = require('../utils/helpers');
const { resolveSupplierId, checkSuppliersCompliance, complianceErrorPayload } = require('../utils/quotationHelpers');
const { recomputePRItemQuotationStatus, syncPRStatusAfterChange } = require('../utils/prClosure');

const router = express.Router();

const quoteFromPoolSchema = z.object({
  supplierName: z.string().min(1),
  supplierContact: z.string().optional(),
  supplierAddress: z.string().optional(),
  supplierId: z.string().uuid().optional().nullable(),
  unitPrice: z.number().nonnegative(),
  notes: z.string().optional(),
});

const createPoolSchema = z.object({
  purchaseRequestItemIds: z.array(z.string().uuid()).min(2),
});

const addItemSchema = z.object({
  purchaseRequestItemId: z.string().uuid(),
});

// Items are eligible for pooling when they're still awaiting a quote and not
// already pooled. Once a pool gets a submitted quote, member items move into
// QUOTATION_SUBMITTED via the existing prClosure logic; they're then locked
// in the pool until the pool closes.
async function loadEligibleItems(itemIds) {
  return prisma.purchaseRequestItem.findMany({
    where: { id: { in: itemIds } },
    include: {
      request: { select: { id: true, requestNumber: true, status: true, unitId: true } },
      materialPoolMembership: { select: { poolId: true } },
    },
  });
}

function assertSameMaterial(items) {
  const productNames = new Set(items.map(i => (i.productName || '').trim().toLowerCase()));
  const productUnits = new Set(items.map(i => (i.productUnit || 'pcs').trim().toLowerCase()));
  if (productNames.size > 1) {
    throw new Error('All pool items must share the same product name');
  }
  if (productUnits.size > 1) {
    throw new Error('All pool items must share the same unit of measure');
  }
}

// GET /api/material-pools — list pools the PO can act on. Admin sees pools with
// submitted quotations (consistent with admin's other quotation views).
router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    const where = {};
    if (status) where.status = status;
    if (req.user.role === 'PURCHASE_OFFICER') {
      where.OR = [{ createdById: req.user.id }, { status: { in: ['OPEN', 'QUOTED'] } }];
    } else if (req.user.role !== 'ADMIN' && req.user.role !== 'SAFETY' && req.user.role !== 'SUPPLY_CHAIN') {
      // Non-procurement roles don't need pool visibility.
      return res.json({ pools: [] });
    }
    const pools = await prisma.materialPool.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
        items: {
          include: {
            purchaseRequestItem: {
              include: {
                request: { select: { id: true, requestNumber: true, status: true, unit: { select: { id: true, name: true, code: true } }, createdAt: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ pools });
  } catch (err) {
    console.error('List material pools error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/material-pools/candidates?purchaseRequestItemId=... — returns other
// PR-items with the same material that are still poolable (un-pooled,
// awaiting quote). Used by the picker on the PR detail page.
router.get('/candidates', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { purchaseRequestItemId } = req.query;
    if (!purchaseRequestItemId) {
      return res.status(400).json({ error: 'purchaseRequestItemId is required' });
    }
    const anchor = await prisma.purchaseRequestItem.findUnique({
      where: { id: purchaseRequestItemId },
      include: { request: { select: { id: true, status: true } } },
    });
    if (!anchor) return res.status(404).json({ error: 'Item not found' });

    const candidates = await prisma.purchaseRequestItem.findMany({
      where: {
        id: { not: anchor.id },
        productName: { equals: anchor.productName, mode: 'insensitive' },
        productUnit: anchor.productUnit,
        itemQuotationStatus: 'AWAITING_QUOTATION',
        request: {
          status: { in: ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED'] },
        },
        materialPoolMembership: null,
      },
      include: {
        request: {
          select: {
            id: true, requestNumber: true, status: true, createdAt: true,
            manager: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: [{ request: { createdAt: 'asc' } }],
    });

    res.json({
      anchor: { id: anchor.id, productName: anchor.productName, productUnit: anchor.productUnit, requestId: anchor.request.id },
      candidates,
    });
  } catch (err) {
    console.error('List pool candidates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/material-pools — create a pool from ≥2 eligible PR-items.
router.post('/', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = createPoolSchema.parse(req.body);
    const uniqueIds = [...new Set(data.purchaseRequestItemIds)];
    if (uniqueIds.length < 2) {
      return res.status(400).json({ error: 'A pool needs at least 2 items' });
    }

    const items = await loadEligibleItems(uniqueIds);
    if (items.length !== uniqueIds.length) {
      return res.status(404).json({ error: 'One or more items not found' });
    }
    for (const it of items) {
      if (it.itemQuotationStatus !== 'AWAITING_QUOTATION') {
        return res.status(400).json({ error: `Item ${it.id} is not awaiting quotation (status: ${it.itemQuotationStatus})` });
      }
      if (it.materialPoolMembership) {
        return res.status(400).json({ error: `Item ${it.id} is already in a pool` });
      }
      if (!['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED'].includes(it.request.status)) {
        return res.status(400).json({ error: `PR ${it.request.requestNumber} is not in a poolable state (${it.request.status})` });
      }
    }
    try {
      assertSameMaterial(items);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const anchor = items[0];
    const pool = await prisma.materialPool.create({
      data: {
        productId: anchor.productId || null,
        productName: anchor.productName,
        productUnit: anchor.productUnit,
        status: 'OPEN',
        createdById: req.user.id,
        items: { create: items.map(it => ({ purchaseRequestItemId: it.id })) },
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: { include: { purchaseRequestItem: { include: { request: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } } } } } } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE_MATERIAL_POOL',
        entity: 'MaterialPool',
        entityId: pool.id,
        details: { productName: pool.productName, itemCount: items.length, prItemIds: uniqueIds },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(pool);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    console.error('Create material pool error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/material-pools/:id/items — add another PR-item to an OPEN pool.
router.post('/:id/items', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = addItemSchema.parse(req.body);
    const pool = await prisma.materialPool.findUnique({
      where: { id: req.params.id },
      include: { items: { include: { purchaseRequestItem: true } } },
    });
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.status !== 'OPEN') {
      return res.status(400).json({ error: `Pool is ${pool.status} — composition is locked` });
    }
    const [incoming] = await loadEligibleItems([data.purchaseRequestItemId]);
    if (!incoming) return res.status(404).json({ error: 'Item not found' });
    if (incoming.materialPoolMembership) {
      return res.status(400).json({ error: 'Item is already in a pool' });
    }
    if (incoming.itemQuotationStatus !== 'AWAITING_QUOTATION') {
      return res.status(400).json({ error: `Item is not awaiting quotation (${incoming.itemQuotationStatus})` });
    }
    if ((incoming.productName || '').trim().toLowerCase() !== pool.productName.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Item product name does not match the pool' });
    }
    if ((incoming.productUnit || 'pcs').trim().toLowerCase() !== pool.productUnit.trim().toLowerCase()) {
      return res.status(400).json({ error: 'Item UOM does not match the pool' });
    }
    await prisma.materialPoolItem.create({ data: { poolId: pool.id, purchaseRequestItemId: incoming.id } });
    const updated = await prisma.materialPool.findUnique({
      where: { id: pool.id },
      include: { items: { include: { purchaseRequestItem: { include: { request: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } } } } } } } },
    });
    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    console.error('Add pool item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/material-pools/:id/items/:itemId — remove a PR-item from a pool.
// Only allowed while the pool is OPEN. If it drops below 2 items, the pool
// dissolves entirely so the remaining item can be quoted as a single.
router.delete('/:id/items/:itemId', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const pool = await prisma.materialPool.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.status !== 'OPEN') {
      return res.status(400).json({ error: `Pool is ${pool.status} — composition is locked` });
    }
    const member = pool.items.find(i => i.id === req.params.itemId);
    if (!member) return res.status(404).json({ error: 'Item not in this pool' });

    await prisma.materialPoolItem.delete({ where: { id: member.id } });
    const remaining = pool.items.length - 1;
    if (remaining < 2) {
      await prisma.materialPool.delete({ where: { id: pool.id } });
      return res.json({ dissolved: true });
    }
    const updated = await prisma.materialPool.findUnique({
      where: { id: pool.id },
      include: { items: { include: { purchaseRequestItem: { include: { request: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } } } } } } } } },
    });
    res.json(updated);
  } catch (err) {
    console.error('Remove pool item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/material-pools/:id — dissolve an OPEN pool (no quotes attached).
router.delete('/:id', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const pool = await prisma.materialPool.findUnique({ where: { id: req.params.id } });
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (pool.status !== 'OPEN') {
      return res.status(400).json({ error: `Cannot dissolve pool in ${pool.status} state` });
    }
    await prisma.materialPool.delete({ where: { id: pool.id } });
    await prisma.auditLog.create({
      data: {
        userId: req.user.id, action: 'DISSOLVE_MATERIAL_POOL', entity: 'MaterialPool', entityId: pool.id,
        details: { productName: pool.productName }, ipAddress: req.ip,
      },
    });
    res.json({ dissolved: true });
  } catch (err) {
    console.error('Delete pool error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/material-pools/:id/quotations — create a competing union quotation
// against this pool. The PO only supplies supplier + price; the server derives
// the sourceAllocations from the pool's member items (each PR-item's full
// requestedQty, or adminApprovedQty when set). Multiple competing quotes can
// be created — each is a separate draft union until the PO sends them to
// admin via the existing /api/quotations/union/submit flow.
router.post('/:id/quotations', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = quoteFromPoolSchema.parse(req.body);
    const pool = await prisma.materialPool.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            purchaseRequestItem: {
              include: { request: { select: { id: true, requestNumber: true, status: true, unit: { select: { code: true } } } } },
            },
          },
        },
      },
    });
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    if (!['OPEN', 'QUOTED'].includes(pool.status)) {
      return res.status(400).json({ error: `Cannot quote a ${pool.status} pool` });
    }
    if (pool.items.length < 2) {
      return res.status(400).json({ error: 'Pool needs at least 2 items before it can be quoted' });
    }

    // Derive source allocations + total qty from pool members. Each PR-item
    // contributes its adminApprovedQty (if admin pruned the requested qty) or
    // requestedQty.
    const sources = pool.items.map(pi => {
      const it = pi.purchaseRequestItem;
      const qty = it.adminApprovedQty != null ? it.adminApprovedQty : it.requestedQty;
      return { purchaseRequestItemId: it.id, allocatedQty: qty };
    });
    const totalQty = sources.reduce((s, x) => s + x.allocatedQty, 0);
    const totalAmount = totalQty * data.unitPrice;

    // Validate PR statuses (same gates as /quotations/union).
    const uniquePrIds = [...new Set(pool.items.map(pi => pi.purchaseRequestItem.request.id))];
    for (const pi of pool.items) {
      const status = pi.purchaseRequestItem.request.status;
      if (!['APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(status)) {
        return res.status(400).json({ error: `PR ${pi.purchaseRequestItem.request.requestNumber} is not in a valid state (${status})` });
      }
    }

    const supplierId = await resolveSupplierId(data.supplierName, data.supplierContact, data.supplierAddress, data.supplierId);
    const { hardIssues, softWarnings } = await checkSuppliersCompliance([supplierId]);
    if (hardIssues.length > 0) {
      return res.status(400).json(complianceErrorPayload(hardIssues));
    }

    let quotationNumber;
    const quotation = await withDocRetry(async () => {
      quotationNumber = await generateSequentialNumber(prisma, 'QT');
      return prisma.quotation.create({
        data: {
          quotationNumber,
          purchaseRequestId: null,
          isUnion: true,
          totalAmount,
          notes: data.notes || null,
          createdById: req.user.id,
          supplierId,
          items: {
            create: [{
              productId: pool.productId || null,
              productName: pool.productName,
              productUnit: pool.productUnit,
              quantity: totalQty,
              unitPrice: data.unitPrice,
              totalPrice: totalAmount,
              supplierId,
              supplierName: data.supplierName.trim(),
              supplierContact: data.supplierContact || null,
              supplierAddress: data.supplierAddress || null,
              sourceAllocations: sources,
            }],
          },
          sourceRequests: { create: uniquePrIds.map(prId => ({ purchaseRequestId: prId })) },
        },
        include: {
          items: true,
          createdBy: { select: { id: true, name: true } },
          sourceRequests: { include: { purchaseRequest: { select: { id: true, requestNumber: true, unit: { select: { name: true, code: true } } } } } },
        },
      });
    });

    // Pool stays OPEN until at least one of its quotes is submitted to admin
    // (which the /quotations/union/submit endpoint handles). But we set it to
    // QUOTED right now if it isn't already so the UI shows "has quotes".
    // Note: we use a new status step — "QUOTED" means quotes exist (drafts or
    // submitted); admin selection later flips it to APPROVED.
    if (pool.status === 'OPEN') {
      await prisma.materialPool.update({ where: { id: pool.id }, data: { status: 'QUOTED' } });
    }

    await prisma.$transaction(async (tx) => {
      const referencedItemIds = sources.map(s => s.purchaseRequestItemId);
      await recomputePRItemQuotationStatus(tx, referencedItemIds);
      for (const prId of uniquePrIds) {
        await syncPRStatusAfterChange(tx, prId);
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE_POOL_QUOTATION',
        entity: 'Quotation',
        entityId: quotation.id,
        details: { poolId: pool.id, quotationNumber, supplierName: data.supplierName, totalAmount },
        ipAddress: req.ip,
      },
    });

    res.status(201).json({ ...quotation, assessmentWarnings: softWarnings, currentFinancialYear: getFinancialYear() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.errors });
    }
    console.error('Pool quote error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
