const express = require('express');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { generateSequentialNumber, paginate, isUniqueViolation, withDocRetry, getFinancialYear } = require('../utils/helpers');
const { canApprove, getTier, getTierLabel, getApproversForTier } = require('../utils/approvalTiers');
const { quotationUpload, publicUrlFor } = require('../middleware/upload');
const { recomputePRItemQuotationStatus, syncPRStatusAfterChange } = require('../utils/prClosure');

const router = express.Router();

// Wrap multer single-file middleware to convert multer errors into proper 400s
// (rather than the global 500 handler). Field name: `quotationPdf`.
function acceptQuotationPdf(req, res, next) {
  quotationUpload.single('quotationPdf')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Quotation upload failed' });
    // When sent as multipart, body fields arrive as strings — parse `payload` JSON.
    if (req.body && typeof req.body.payload === 'string') {
      try { req.body = JSON.parse(req.body.payload); }
      catch { return res.status(400).json({ error: 'Invalid payload JSON' }); }
    }
    next();
  });
}

const createSchema = z.object({
  purchaseRequestId: z.string().uuid(),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid().optional().nullable(),
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    supplierId: z.string().uuid().optional().nullable(),
    supplierName: z.string().min(1),
    supplierContact: z.string().optional(),
    supplierAddress: z.string().optional(),
  })).min(1),
});

const unionCreateSchema = z.object({
  purchaseRequestIds: z.array(z.string().uuid()).min(2),
  notes: z.string().optional(),
  items: z.array(z.object({
    productId: z.string().uuid().optional().nullable(),
    productName: z.string().min(1),
    productUnit: z.string().min(1).default('pcs'),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    supplierId: z.string().uuid().optional().nullable(),
    supplierName: z.string().min(1),
    supplierContact: z.string().optional(),
    supplierAddress: z.string().optional(),
    sources: z.array(z.object({
      purchaseRequestItemId: z.string().uuid(),
      allocatedQty: z.number().positive(),
    })).min(2),
  })).min(1),
});

// Given a free-text supplier name (+ optional supplierId from client), return a
// canonical supplier id by upserting on case-insensitive name. Used to attach
// supplierId to every Quotation/QuotationItem so the supplier history stays accurate.
async function resolveSupplierId(name, contact, address, hintId) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  if (hintId) {
    const ok = await prisma.supplier.findUnique({ where: { id: hintId } });
    if (ok) return ok.id;
  }
  const existing = await prisma.supplier.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing.id;
  const created = await prisma.supplier.create({
    data: { name: trimmed, contact: (contact || '').trim() || null, address: (address || '').trim() || null },
  });
  return created.id;
}

// Tolerance for float-sum vs total comparison (kg/litre/pcs all use Float)
const QTY_TOLERANCE = 0.001;

// Verify every supplier referenced by a quotation has the required compliance
// documents on file. Returns a list of issues (empty when all good).
//
// Hard blocker: the one-time Vendor Evaluation PDF must be on file.
// Soft warning: the Supplier Assessment PDF is stamped per FY and expires at
//   the start of the next FY. An expired assessment surfaces in the response
//   so the UI can warn the PO, but does NOT prevent submission — purchase work
//   continues while procurement gets the new assessment uploaded.
async function checkSuppliersCompliance(supplierIds) {
  const ids = [...new Set(supplierIds.filter(Boolean))];
  if (ids.length === 0) return { hardIssues: [], softWarnings: [] };
  const currentFY = getFinancialYear();
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      vendorEvaluationPdfUrl: true,
      supplierAssessmentPdfUrl: true,
      assessmentFiscalYear: true,
    },
  });
  const hardIssues = [];
  const softWarnings = [];
  for (const s of suppliers) {
    if (!s.vendorEvaluationPdfUrl) {
      hardIssues.push({ supplierId: s.id, supplierName: s.name, missing: ['vendor-evaluation'] });
    }
    if (!s.supplierAssessmentPdfUrl || s.assessmentFiscalYear !== currentFY) {
      softWarnings.push({
        supplierId: s.id,
        supplierName: s.name,
        expiredFY: s.assessmentFiscalYear || null,
      });
    }
  }
  return { hardIssues, softWarnings };
}

function complianceErrorPayload(issues) {
  const currentFY = getFinancialYear();
  const lines = issues.map(i => `${i.supplierName}: Vendor Evaluation PDF`);
  return {
    error: `Cannot submit quotation — the following supplier(s) need a Vendor Evaluation PDF uploaded first:\n${lines.join('\n')}`,
    complianceIssues: issues,
    currentFinancialYear: currentFY,
  };
}

// GET /api/quotations/pool-candidates — PR line items still open for quoting,
// across every open PR. Used by the "Pool by Material" view so the Purchase Officer
// can manually pick lines from different PRs and pool them into one union quotation.
//
// Items already covered by a quotation (SUBMITTED/HELD) are still included so the
// PO can add competing quotes from other suppliers — only QUOTATION_APPROVED
// (already on a PO) and CANCELLED items are excluded.
router.get('/pool-candidates', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const items = await prisma.purchaseRequestItem.findMany({
      where: {
        itemQuotationStatus: { in: ['AWAITING_QUOTATION', 'QUOTATION_SUBMITTED', 'QUOTATION_HELD'] },
        request: { status: { in: ['APPROVED', 'IN_PROGRESS', 'QUOTATION_SUBMITTED', 'QUOTATION_APPROVED'] } },
      },
      include: {
        request: {
          select: {
            id: true,
            requestNumber: true,
            status: true,
            createdAt: true,
            manager: { select: { id: true, name: true } },
            unit: { select: { id: true, name: true, code: true } },
          },
        },
      },
      orderBy: [
        { productName: 'asc' },
        { request: { createdAt: 'asc' } },
      ],
    });

    // Tally how many union quotations already cover each PR-item so the UI can
    // show a "N quotes already" hint per row.
    const itemIds = items.map(i => i.id);
    const existingQuoteCounts = new Map(itemIds.map(id => [id, 0]));
    if (itemIds.length > 0) {
      // Union quotations: walk sourceAllocations on QuotationItem
      const unionItems = await prisma.quotationItem.findMany({
        where: {
          quotation: { isUnion: true, isSelected: false },
        },
        select: { quotationId: true, sourceAllocations: true },
      });
      for (const qi of unionItems) {
        if (!Array.isArray(qi.sourceAllocations)) continue;
        for (const src of qi.sourceAllocations) {
          if (existingQuoteCounts.has(src.purchaseRequestItemId)) {
            existingQuoteCounts.set(src.purchaseRequestItemId, existingQuoteCounts.get(src.purchaseRequestItemId) + 1);
          }
        }
      }
      // Single-PR quotations: match by productName within the same PR
      const prIdsTouched = [...new Set(items.map(i => i.request.id))];
      const singleItems = await prisma.quotationItem.findMany({
        where: {
          quotation: { isUnion: false, isSelected: false, purchaseRequestId: { in: prIdsTouched } },
        },
        select: { quotation: { select: { purchaseRequestId: true } }, productName: true },
      });
      const singleByPr = new Map();
      for (const qi of singleItems) {
        const k = `${qi.quotation.purchaseRequestId}::${(qi.productName || '').toLowerCase().trim()}`;
        singleByPr.set(k, (singleByPr.get(k) || 0) + 1);
      }
      for (const it of items) {
        const k = `${it.request.id}::${(it.productName || '').toLowerCase().trim()}`;
        const n = singleByPr.get(k) || 0;
        existingQuoteCounts.set(it.id, (existingQuoteCounts.get(it.id) || 0) + n);
      }
    }

    res.json({
      items: items.map(i => ({ ...i, existingQuoteCount: existingQuoteCounts.get(i.id) || 0 })),
    });
  } catch (error) {
    console.error('Get pool candidates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
          items: {
            include: {
              // Supplier compliance PDFs so admin can preview Vendor Evaluation
              // and current-FY Assessment before approving.
              supplier: {
                select: {
                  id: true, name: true,
                  vendorEvaluationPdfUrl: true,
                  supplierAssessmentPdfUrl: true,
                  assessmentFiscalYear: true,
                },
              },
            },
          },
          purchaseRequest: { select: { id: true, requestNumber: true, status: true } },
          sourceRequests: {
            include: {
              purchaseRequest: {
                select: {
                  id: true, requestNumber: true, status: true,
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

    res.json({ quotations, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take), currentFinancialYear: getFinancialYear() });
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
        items: {
          include: {
            supplier: {
              select: {
                id: true, name: true,
                vendorEvaluationPdfUrl: true,
                supplierAssessmentPdfUrl: true,
                assessmentFiscalYear: true,
              },
            },
          },
        },
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
                id: true, requestNumber: true, status: true,
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
router.post('/', authenticate, authorize('PURCHASE_OFFICER'), acceptQuotationPdf, async (req, res) => {
  try {
    const data = createSchema.parse(req.body);

    const pr = await prisma.purchaseRequest.findUnique({
      where: { id: data.purchaseRequestId },
    });

    if (!pr) return res.status(404).json({ error: 'Purchase request not found' });
    // A PR can collect new quotations while items are still awaiting coverage —
    // IN_PROGRESS and QUOTATION_APPROVED are valid because earlier batches may
    // already have moved into POs while later items are still waiting on a quote.
    if (!['APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(pr.status)) {
      return res.status(400).json({ error: 'Can only add quotations to approved purchase requests' });
    }

    const totalAmount = data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    // Resolve supplierId for each item (upsert by case-insensitive name).
    const itemsWithSupplier = [];
    for (const item of data.items) {
      const supplierId = await resolveSupplierId(item.supplierName, item.supplierContact, item.supplierAddress, item.supplierId);
      itemsWithSupplier.push({ ...item, supplierId });
    }

    // Block only if a referenced supplier has no Vendor Evaluation PDF on file.
    // An expired Supplier Assessment is returned as a soft warning so the UI
    // can show a banner — quotation submission still proceeds.
    const { hardIssues, softWarnings: createSoftWarnings } =
      await checkSuppliersCompliance(itemsWithSupplier.map(i => i.supplierId));
    if (hardIssues.length > 0) {
      return res.status(400).json(complianceErrorPayload(hardIssues));
    }

    // Use the most common supplierId for the top-level Quotation snapshot.
    const supplierCounts = new Map();
    for (const it of itemsWithSupplier) {
      if (it.supplierId) supplierCounts.set(it.supplierId, (supplierCounts.get(it.supplierId) || 0) + 1);
    }
    const topLevelSupplierId = [...supplierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const quotationPdfUrl = req.file ? publicUrlFor('quotations', req.file.filename) : null;

    let quotationNumber;
    const quotation = await withDocRetry(async () => {
      quotationNumber = await generateSequentialNumber(prisma, 'QT');
      return prisma.quotation.create({
        data: {
          quotationNumber,
          purchaseRequestId: data.purchaseRequestId,
          totalAmount,
          notes: data.notes || null,
          quotationPdfUrl,
          createdById: req.user.id,
          supplierId: topLevelSupplierId,
          items: {
            create: itemsWithSupplier.map(item => ({
              productId: item.productId || null,
              productName: item.productName,
              productUnit: item.productUnit || 'pcs',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              supplierId: item.supplierId,
              supplierName: item.supplierName.trim(),
              supplierContact: item.supplierContact || null,
              supplierAddress: item.supplierAddress || null,
            })),
          },
        },
        include: { items: true, createdBy: { select: { id: true, name: true } } },
      });
    });

    // Flip every referenced PR item from AWAITING_QUOTATION → QUOTATION_SUBMITTED
    // (only items still in AWAITING are touched — items already approved on another
    // quotation are left alone). Then re-sync the parent PR's headline status.
    await prisma.$transaction(async (tx) => {
      const prItems = await tx.purchaseRequestItem.findMany({
        where: { requestId: data.purchaseRequestId },
        select: { id: true },
      });
      await recomputePRItemQuotationStatus(tx, prItems.map(i => i.id));
      await syncPRStatusAfterChange(tx, data.purchaseRequestId);
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

    res.status(201).json({
      ...quotation,
      assessmentWarnings: createSoftWarnings,
      currentFinancialYear: getFinancialYear(),
    });
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
router.post('/union', authenticate, authorize('PURCHASE_OFFICER'), acceptQuotationPdf, async (req, res) => {
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
      if (!['APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(pr.status)) {
        return res.status(400).json({ error: `PR ${pr.requestNumber} is not in a valid state for new quotations (status: ${pr.status})` });
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

    const itemsWithSupplier = [];
    for (const item of data.items) {
      const supplierId = await resolveSupplierId(item.supplierName, item.supplierContact, item.supplierAddress, item.supplierId);
      itemsWithSupplier.push({ ...item, supplierId });
    }

    const { hardIssues, softWarnings: unionSoftWarnings } =
      await checkSuppliersCompliance(itemsWithSupplier.map(i => i.supplierId));
    if (hardIssues.length > 0) {
      return res.status(400).json(complianceErrorPayload(hardIssues));
    }

    const supplierCounts = new Map();
    for (const it of itemsWithSupplier) {
      if (it.supplierId) supplierCounts.set(it.supplierId, (supplierCounts.get(it.supplierId) || 0) + 1);
    }
    const topLevelSupplierId = [...supplierCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const quotationPdfUrl = req.file ? publicUrlFor('quotations', req.file.filename) : null;

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
          quotationPdfUrl,
          createdById: req.user.id,
          supplierId: topLevelSupplierId,
          items: {
            create: itemsWithSupplier.map(item => ({
              productId: item.productId || null,
              productName: item.productName,
              productUnit: item.productUnit || 'pcs',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              supplierId: item.supplierId,
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
    });

    // Flip referenced PR items across every source PR to QUOTATION_SUBMITTED
    // (only items still awaiting). Item ids come straight from the validated
    // sourceAllocations payload.
    const referencedItemIds = [...new Set(data.items.flatMap(it => it.sources.map(s => s.purchaseRequestItemId)))];
    await prisma.$transaction(async (tx) => {
      await recomputePRItemQuotationStatus(tx, referencedItemIds);
      for (const prId of uniquePrIds) {
        await syncPRStatusAfterChange(tx, prId);
      }
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

    res.status(201).json({
      ...quotation,
      assessmentWarnings: unionSoftWarnings,
      currentFinancialYear: getFinancialYear(),
    });
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

      const itemsWithSupplier = [];
      for (const item of items) {
        const supplierId = await resolveSupplierId(item.supplierName, item.supplierContact, item.supplierAddress, item.supplierId);
        itemsWithSupplier.push({ ...item, supplierId });
      }

      const { hardIssues } = await checkSuppliersCompliance(itemsWithSupplier.map(i => i.supplierId));
      if (hardIssues.length > 0) {
        return res.status(400).json(complianceErrorPayload(hardIssues));
      }

      const updated = await prisma.quotation.update({
        where: { id: req.params.id },
        data: {
          notes: notes !== undefined ? notes : quotation.notes,
          totalAmount,
          items: {
            create: itemsWithSupplier.map(item => ({
              productId: item.productId || null,
              productName: item.productName,
              productUnit: item.productUnit || 'pcs',
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice: item.quantity * item.unitPrice,
              supplierId: item.supplierId,
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
    if (!['APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(pr.status)) {
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

    // Recompute per-item statuses and let syncPRStatusAfterChange pick the right
    // PR.status. With partial coverage the PR can stay at QUOTATION_APPROVED/IN_PROGRESS
    // (some items already on POs) — we never downgrade.
    await prisma.$transaction(async (tx) => {
      const prItems = await tx.purchaseRequestItem.findMany({
        where: { requestId: purchaseRequestId },
        select: { id: true },
      });
      await recomputePRItemQuotationStatus(tx, prItems.map(i => i.id));
      await syncPRStatusAfterChange(tx, purchaseRequestId);
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
      if (!['APPROVED', 'QUOTATION_SUBMITTED', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(pr.status)) {
        return res.status(400).json({ error: `PR ${pr.requestNumber} is not in a valid state for submission (current: ${pr.status})` });
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

    await prisma.$transaction(async (tx) => {
      for (const prId of uniquePrIds) {
        const prItems = await tx.purchaseRequestItem.findMany({
          where: { requestId: prId },
          select: { id: true },
        });
        await recomputePRItemQuotationStatus(tx, prItems.map(i => i.id));
        await syncPRStatusAfterChange(tx, prId);
      }
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

// POST /api/quotations/:id/hold — ADMIN puts the quotation on hold and asks
// the Purchase Officer to fix something (typically: upload missing supplier
// compliance PDFs). The PR stays in QUOTATION_SUBMITTED so the PO can fix the
// issue (no resubmission of the quotation needed) and admin can re-approve.
const holdSchema = z.object({
  holdNote: z.string().min(1).transform(s => s.trim()),
});

router.post('/:id/hold', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { holdNote } = holdSchema.parse(req.body);

    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, name: true } },
        items: { select: { productName: true, sourceAllocations: true } },
        purchaseRequest: { select: { id: true } },
        sourceRequests: { select: { purchaseRequestId: true } },
      },
    });
    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (quotation.isSelected) {
      return res.status(400).json({ error: 'Cannot hold a quotation that has already been approved' });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.update({
        where: { id: req.params.id },
        data: { holdNote, heldAt: new Date() },
      });
      // Recompute every item across every linked PR — the held quotation now
      // demotes any item that was only covered by this quotation back to "HELD".
      const linkedPRIds = quotation.isUnion
        ? quotation.sourceRequests.map(s => s.purchaseRequestId)
        : (quotation.purchaseRequest ? [quotation.purchaseRequest.id] : []);
      for (const prId of linkedPRIds) {
        const prItems = await tx.purchaseRequestItem.findMany({
          where: { requestId: prId },
          select: { id: true },
        });
        await recomputePRItemQuotationStatus(tx, prItems.map(i => i.id));
        await syncPRStatusAfterChange(tx, prId);
      }
      return q;
    });

    await prisma.notification.create({
      data: {
        type: 'QUOTATION_HOLD',
        title: `Quotation ${quotation.quotationNumber} on hold — action required`,
        message: `Admin held quotation ${quotation.quotationNumber}. Reason: ${holdNote}. Please attach the required documents and re-notify admin.`,
        targetUserId: quotation.createdById,
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'HOLD_QUOTATION',
        entity: 'Quotation',
        entityId: quotation.id,
        details: { quotationNumber: quotation.quotationNumber, holdNote },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Hold note is required' });
    }
    console.error('Hold quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/quotations/:id/resubmit — PO fixes a held quotation (optionally
// updates totals/notes/items and the attached PDF) and re-notifies admin.
// Clears the hold fields.
//
// Multipart body: `payload` (JSON) + optional `quotationPdf` file.
// payload: { notes?, items?, clearPdf?: boolean }
//   - `items` optional — PO may fix the issue purely on the supplier side
//     (e.g. uploaded missing compliance PDF) and resubmit unchanged.
//   - `clearPdf: true` removes the existing quotationPdfUrl.
//   - A new file uploaded via `quotationPdf` replaces the existing one.
router.put('/:id/resubmit', authenticate, authorize('PURCHASE_OFFICER'), acceptQuotationPdf, async (req, res) => {
  try {
    const quotation = await prisma.quotation.findUnique({
      where: { id: req.params.id },
      include: {
        purchaseRequest: { select: { id: true, requestNumber: true } },
        sourceRequests: { include: { purchaseRequest: { select: { id: true, requestNumber: true } } } },
      },
    });

    if (!quotation) return res.status(404).json({ error: 'Quotation not found' });
    if (!quotation.heldAt) {
      return res.status(400).json({ error: 'Only held quotations can be resubmitted' });
    }
    if (quotation.isSelected) {
      return res.status(400).json({ error: 'Cannot resubmit a quotation that has already been approved' });
    }

    const { notes, items, clearPdf } = req.body || {};
    const newPdfUrl = req.file ? publicUrlFor(req.file) : null;
    // Decide what to do with the PDF: new upload replaces, clearPdf wipes,
    // otherwise keep the existing one.
    let nextPdfUrl = quotation.quotationPdfUrl;
    if (newPdfUrl) nextPdfUrl = newPdfUrl;
    else if (clearPdf === true || clearPdf === 'true') nextPdfUrl = null;

    const result = await prisma.$transaction(async (tx) => {
      // Optional item rewrite — mirrors PUT /:id behaviour for non-union quotations.
      // Union quotation items keep their sourceAllocations untouched (PO cannot
      // restructure allocations during a resubmit; that requires delete+recreate).
      if (Array.isArray(items) && items.length > 0 && !quotation.isUnion) {
        for (const item of items) {
          if (!item.supplierName || !String(item.supplierName).trim()) {
            throw new Error('Each item requires a supplier name');
          }
        }
        await tx.quotationItem.deleteMany({ where: { quotationId: req.params.id } });
        const totalAmount = items.reduce((sum, it) => sum + (it.quantity * it.unitPrice), 0);

        const itemsWithSupplier = [];
        for (const item of items) {
          const supplierId = await resolveSupplierId(item.supplierName, item.supplierContact, item.supplierAddress, item.supplierId);
          itemsWithSupplier.push({ ...item, supplierId });
        }

        const { hardIssues } = await checkSuppliersCompliance(itemsWithSupplier.map(i => i.supplierId));
        if (hardIssues.length > 0) {
          throw Object.assign(new Error('compliance'), { compliance: hardIssues });
        }

        await tx.quotation.update({
          where: { id: req.params.id },
          data: {
            notes: notes !== undefined ? notes : quotation.notes,
            totalAmount,
            holdNote: null,
            heldAt: null,
            quotationPdfUrl: nextPdfUrl,
            items: {
              create: itemsWithSupplier.map(it => ({
                productId: it.productId || null,
                productName: it.productName,
                productUnit: it.productUnit || 'pcs',
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                totalPrice: it.quantity * it.unitPrice,
                supplierId: it.supplierId,
                supplierName: String(it.supplierName).trim(),
                supplierContact: it.supplierContact || null,
                supplierAddress: it.supplierAddress || null,
              })),
            },
          },
        });
      } else {
        // Notes / PDF-only resubmit: clear hold fields (+ update PDF if changed).
        await tx.quotation.update({
          where: { id: req.params.id },
          data: {
            notes: notes !== undefined ? notes : quotation.notes,
            holdNote: null,
            heldAt: null,
            quotationPdfUrl: nextPdfUrl,
          },
        });
      }

      // Linked PRs: re-flip items back to QUOTATION_SUBMITTED.
      const linkedPRIds = quotation.isUnion
        ? quotation.sourceRequests.map(s => s.purchaseRequestId)
        : (quotation.purchaseRequest ? [quotation.purchaseRequest.id] : []);
      for (const prId of linkedPRIds) {
        const prItems = await tx.purchaseRequestItem.findMany({
          where: { requestId: prId },
          select: { id: true },
        });
        await recomputePRItemQuotationStatus(tx, prItems.map(i => i.id));
        await syncPRStatusAfterChange(tx, prId);
      }

      return tx.quotation.findUnique({
        where: { id: req.params.id },
        include: { items: true, createdBy: { select: { id: true, name: true } } },
      });
    });

    // Notify every approver eligible to act on this quotation's tier — they
    // need to know the held quote is back in the queue.
    const tier = getTier(result.totalAmount);
    const approvers = await getApproversForTier(tier);
    for (const a of approvers) {
      await prisma.notification.create({
        data: {
          type: 'QUOTATION_RESUBMITTED',
          title: `Quotation ${quotation.quotationNumber} resubmitted — review`,
          message: `Held quotation ${quotation.quotationNumber} was updated and resubmitted by ${req.user.name}. Tier ${tier} (${getTierLabel(tier)}). Please re-review.`,
          targetUserId: a.id,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'RESUBMIT_QUOTATION',
        entity: 'Quotation',
        entityId: req.params.id,
        details: {
          quotationNumber: quotation.quotationNumber,
          totalAmount: result.totalAmount,
          itemsRewritten: Array.isArray(items) && items.length > 0,
        },
        ipAddress: req.ip,
      },
    });

    res.json(result);
  } catch (error) {
    if (error?.compliance) {
      return res.status(400).json(complianceErrorPayload(error.compliance));
    }
    if (error?.message === 'Each item requires a supplier name') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Resubmit quotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/quotations/:id/select — ADMIN approves a quotation + creates PurchaseOrder(s)
router.put('/:id/select', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const selectionNote = typeof req.body?.selectionNote === 'string' ? req.body.selectionNote.trim() : '';
    if (!selectionNote) {
      return res.status(400).json({ error: 'Selection note is required when approving a quotation' });
    }

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

    // Quotations can be approved while the PR is mid-flight (some items already
    // approved/ordered, others still awaiting). Reject only states where no work
    // belongs (pending admin, rejected, etc.).
    for (const pr of sourcePRs) {
      if (!['QUOTATION_SUBMITTED', 'IN_PROGRESS', 'QUOTATION_APPROVED'].includes(pr.status)) {
        return res.status(400).json({
          error: `PR ${pr.requestNumber} is not ready for quotation approval (current: ${pr.status})`,
        });
      }
    }

    // Hold-fix gate: a held quotation must be resubmitted by the PO first
    // (which clears holdNote/heldAt) before admin can approve it.
    if (quotation.heldAt) {
      return res.status(400).json({
        error: 'Quotation is on hold. The Purchase Officer must resubmit it before approval.',
      });
    }

    const tier = getTier(quotation.totalAmount);
    if (!canApprove(req.user, quotation.totalAmount)) {
      return res.status(403).json({
        error: `This quotation totals ₹${quotation.totalAmount.toLocaleString('en-IN')} (${tier}). Approval required from: ${getTierLabel(tier)}.`,
        tier,
        requiredApprovers: getTierLabel(tier),
      });
    }

    // Re-check supplier compliance at approval time. Vendor Evaluation is still
    // a hard block (no PO without one), but an expired Supplier Assessment is
    // only a soft warning — admin can approve and let procurement chase the
    // updated assessment after the PO is in flight.
    const approvalSupplierIds = quotation.items.map(i => i.supplierId).filter(Boolean);
    const { hardIssues: approvalHard } = await checkSuppliersCompliance(approvalSupplierIds);
    if (approvalHard.length > 0) {
      return res.status(400).json(complianceErrorPayload(approvalHard));
    }

    // PO display name: derived from the source PR number(s). For unions list every
    // source PR; for single, use that PR's number directly.
    const orderName = quotation.isUnion
      ? `UNION: ${sourcePRs.map(p => p.requestNumber).join(' + ')}`
      : quotation.purchaseRequest.requestNumber;

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
          supplierId: item.supplierId || null,
          supplierName: item.supplierName.trim(),
          supplierContact: item.supplierContact || null,
          supplierAddress: item.supplierAddress || null,
          items: [],
        });
      }
      const g = groups.get(key);
      if (!g.supplierId && item.supplierId) g.supplierId = item.supplierId;
      g.items.push(item);
    }

    if (groups.size === 0) {
      return res.status(400).json({ error: 'Quotation has no items with suppliers' });
    }

    const createdOrders = await prisma.$transaction(async (tx) => {
      // Make selection exclusive: any other quotation tied to these PRs (single
      // or via the sources junction) gets isSelected=false. Two admins racing
      // on competing quotations for the same PR can no longer both win.
      const sourcePrIds = sourcePRs.map(p => p.id);
      await tx.quotation.updateMany({
        where: {
          id: { not: req.params.id },
          isSelected: true,
          OR: [
            { purchaseRequestId: { in: sourcePrIds } },
            { sourceRequests: { some: { purchaseRequestId: { in: sourcePrIds } } } },
          ],
        },
        data: { isSelected: false },
      });
      await tx.quotation.update({
        where: { id: req.params.id },
        data: { isSelected: true, selectionNote },
      });

      const orders = [];
      for (const g of groups.values()) {
        const groupTotal = g.items.reduce((sum, it) => sum + it.totalPrice, 0);
        const orderNumber = await generateSequentialNumber(tx, 'PO');

        // Build per-item create payload. For union items the quotation item carries `sourceAllocations`;
        // those become PurchaseOrderItemAllocation rows. Non-union falls back to the existing
        // purchaseRequestItemId field.
        const itemCreates = g.items.map((item) => {
          const base = {
            productId: item.productId || null,
            productName: item.productName,
            productUnit: item.productUnit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
            itemStatus: 'WAITING',
            supplierId: item.supplierId || g.supplierId || null,
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
            supplierId: g.supplierId || null,
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

      // Roll purchasedQty up onto each PurchaseRequestItem so reports and
      // overrun guards reflect what the PO actually committed to.
      const prItemDeltas = new Map();
      for (const po of orders) {
        for (const poItem of po.items) {
          if (po.isUnion) {
            for (const alloc of (poItem.allocations || [])) {
              prItemDeltas.set(
                alloc.purchaseRequestItemId,
                (prItemDeltas.get(alloc.purchaseRequestItemId) || 0) + alloc.allocatedQty,
              );
            }
          } else if (poItem.purchaseRequestItemId) {
            prItemDeltas.set(
              poItem.purchaseRequestItemId,
              (prItemDeltas.get(poItem.purchaseRequestItemId) || 0) + poItem.quantity,
            );
          }
        }
      }
      for (const [prItemId, delta] of prItemDeltas) {
        await tx.purchaseRequestItem.update({
          where: { id: prItemId },
          data: { purchasedQty: { increment: delta } },
        });
      }

      // Recompute per-item statuses (selected items → QUOTATION_APPROVED) and
      // sync the parent PR.status. If a PR still has AWAITING items the PR
      // stays at IN_PROGRESS instead of jumping straight to QUOTATION_APPROVED.
      for (const pr of sourcePRs) {
        const prItems = await tx.purchaseRequestItem.findMany({
          where: { requestId: pr.id },
          select: { id: true },
        });
        await recomputePRItemQuotationStatus(tx, prItems.map(i => i.id));
        await syncPRStatusAfterChange(tx, pr.id);
      }

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
