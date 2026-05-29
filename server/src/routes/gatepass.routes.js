const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { fimGpUpload, publicUrlFor } = require('../middleware/upload');
const {
  generateSequentialNumber, paginate, applyDateFilter, isUniqueViolation,
  withDocRetry, generateProductSku, normalizeMaterialType,
} = require('../utils/helpers');

const router = express.Router();

// Accept an optional customer-GP PDF upload alongside the inward gate-pass create.
// Field name from the client: `customerGpPdf`. multipart bodies arrive with
// `items` as a JSON string — the handler parses it.
function acceptFimGpPdf(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) return next();
  fimGpUpload.single('customerGpPdf')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Customer GP PDF upload failed' });
    if (typeof req.body.items === 'string') {
      try { req.body.items = JSON.parse(req.body.items); }
      catch { return res.status(400).json({ error: 'Malformed items payload' }); }
    }
    next();
  });
}

const GP_DOC_TYPES = ['ORIGINAL', 'DUPLICATE'];

const USER_SELECT = { select: { id: true, name: true, role: true } };
const UNIT_SELECT = { select: { id: true, name: true, code: true } };
const GATEPASS_INCLUDE = {
  createdBy: USER_SELECT,
  siteIncharge: USER_SELECT,
  storeIncharge: USER_SELECT,
  accountsApprover: USER_SELECT,
  finalApprover: USER_SELECT,
  destinationUnit: UNIT_SELECT,
  collectedBy: USER_SELECT,
  items: {
    include: {
      sourceInwardGatePassItem: {
        include: { gatePass: { select: { id: true, passNumber: true, customerName: true, customerGatePassNo: true } } },
      },
      outwardLinkedItems: {
        include: { gatePass: { select: { id: true, passNumber: true, direction: true, date: true } } },
      },
      fimBatches: {
        include: {
          product: { select: { id: true, name: true, sku: true, unit: true } },
          assignedToUnit: UNIT_SELECT,
          assignedBy: USER_SELECT,
          unitAcceptedBy: USER_SELECT,
        },
      },
    },
  },
};

const PASS_TYPES = ['RETURNABLE', 'NON_RETURNABLE', 'DELIVERY_CHALLAN'];
const INWARD_PASS_TYPES = ['RETURNABLE', 'NON_RETURNABLE']; // DC is outward-only
const DIRECTIONS = ['INWARD', 'OUTWARD'];
const INWARD_KINDS = ['STORES', 'DIRECT_TO_UNIT'];
const ALL_STATUSES = [
  'DRAFT', 'PENDING_STORE', 'PENDING_ACCOUNTS', 'PENDING_APPROVAL',
  'PENDING_ACCEPTANCE', 'ACCEPTED',
  'APPROVED', 'RETURNED', 'CLOSED', 'REJECTED', 'OPEN',
];

const toDate = (v) => (v ? new Date(v) : null);

const notify = async (data) => {
  try { await prisma.notification.create({ data }); } catch (e) { console.error('notify failed', e); }
};

// GET /api/gatepasses — list
router.get('/', authenticate, async (req, res) => {
  try {
    const { passType, status, page, limit, fromDate, toDate: toDateQ, mine, direction } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate: toDateQ });
    if (passType && PASS_TYPES.includes(passType)) where.passType = passType;
    if (status && ALL_STATUSES.includes(status)) where.status = status;
    if (direction && DIRECTIONS.includes(direction)) where.direction = direction;
    if (mine === 'true') where.createdById = req.user.id;

    // Unit managers only see INWARD gatepasses addressed to their unit
    // (so the Direct-to-Unit FIM lands on their Gate Pass tab automatically).
    if (req.user.role === 'MANAGER' && req.user.unitId && (direction === 'INWARD' || !direction)) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { direction: { not: 'INWARD' } },
            { destinationUnitId: req.user.unitId },
          ],
        },
      ];
    }

    const [gatePasses, total] = await Promise.all([
      prisma.gatePass.findMany({
        where,
        include: GATEPASS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.gatePass.count({ where }),
    ]);

    res.json({
      gatePasses,
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error('Get gate passes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/gatepasses/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({
      where: { id: req.params.id },
      include: GATEPASS_INCLUDE,
    });
    if (!gatePass) return res.status(404).json({ error: 'Gate pass not found' });
    res.json(gatePass);
  } catch (error) {
    console.error('Get gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gatepasses — Create an OUTWARD or INWARD gate pass.
// OUTWARD: Manager raises (RAMS/GPR/01) → Store → Accounts → Approved.
// INWARD: Stores / Manager records customer-supplied FIM. Status starts at
// PENDING_ACCEPTANCE; items get inwarded into Products via the From-Gatepass flow.
router.post('/', authenticate, authorize('MANAGER', 'STORE_MANAGER', 'LOGISTICS', 'ADMIN'), acceptFimGpPdf, async (req, res) => {
  try {
    const {
      siteName, remarks, items, direction: rawDirection,
      customerName, customerGatePassNo, customerGatePassDate,
      inwardKind: rawInwardKind, destinationUnitId,
      customerGpDocType: rawDocType,
    } = req.body;

    const customerGpDocType = GP_DOC_TYPES.includes(rawDocType) ? rawDocType : null;
    const customerGpPdfUrl = req.file ? publicUrlFor('fim-gp', req.file.filename) : null;

    const direction = DIRECTIONS.includes(rawDirection) ? rawDirection : 'OUTWARD';
    const isInward = direction === 'INWARD';

    // INWARD FIM is recorded by Stores Manager (or Admin) only — unit managers can't.
    if (isInward && !['STORE_MANAGER', 'ADMIN'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only Stores Manager can record inward FIM gate passes' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const inwardKind = isInward ? (INWARD_KINDS.includes(rawInwardKind) ? rawInwardKind : 'STORES') : null;

    if (isInward) {
      if (!customerName || !customerName.trim()) {
        return res.status(400).json({ error: 'Customer name is required for inward gate pass' });
      }
      if (!customerGatePassNo || !customerGatePassNo.trim()) {
        return res.status(400).json({ error: "Customer's gate pass number is required for inward gate pass" });
      }
      if (inwardKind === 'DIRECT_TO_UNIT') {
        if (!destinationUnitId) {
          return res.status(400).json({ error: 'Destination unit is required for direct-to-unit inward' });
        }
        const unit = await prisma.unit.findUnique({ where: { id: destinationUnitId } });
        if (!unit) return res.status(400).json({ error: 'Destination unit not found' });
      }
    }

    for (const it of items) {
      if (!it.description || !it.description.trim()) {
        return res.status(400).json({ error: 'Each item requires a name/description' });
      }
      if (it.quantity == null || isNaN(Number(it.quantity)) || Number(it.quantity) <= 0) {
        return res.status(400).json({ error: 'Each item requires a positive quantity' });
      }
      if (it.itemPassType) {
        if (!PASS_TYPES.includes(it.itemPassType)) {
          return res.status(400).json({ error: 'Invalid item gate pass type' });
        }
        if (isInward && !INWARD_PASS_TYPES.includes(it.itemPassType)) {
          return res.status(400).json({ error: 'Inward items must be RETURNABLE or NON_RETURNABLE' });
        }
      }
    }

    // For OUTWARD delivery-challan items linking back to an inward FIM item, verify
    // the source exists, is an inward item, and belongs to a non-rejected gate pass.
    if (!isInward) {
      const sourceIds = [...new Set(items.map(i => i.sourceInwardGatePassItemId).filter(Boolean))];
      if (sourceIds.length) {
        const sources = await prisma.gatePassItem.findMany({
          where: { id: { in: sourceIds } },
          include: { gatePass: { select: { id: true, direction: true, status: true } } },
        });
        if (sources.length !== sourceIds.length) {
          return res.status(400).json({ error: 'One or more source inward items not found' });
        }
        for (const s of sources) {
          if (s.gatePass.direction !== 'INWARD') {
            return res.status(400).json({ error: 'Source must be an inward gate pass item' });
          }
        }
      }
    }

    const primaryType = items.find((i) => i.itemPassType)?.itemPassType
      || (isInward ? 'RETURNABLE' : 'RETURNABLE');

    // Display "party" summary
    let derivedPartyName;
    if (isInward) {
      derivedPartyName = customerName.trim();
    } else {
      const dispatchTargets = [...new Set(items.map((i) => i.dispatchedTo?.trim()).filter(Boolean))];
      derivedPartyName = dispatchTargets.length
        ? dispatchTargets.join('; ')
        : (siteName?.trim() || 'In-house');
    }

    const initialStatus = isInward ? 'PENDING_ACCEPTANCE' : 'PENDING_STORE';

    let passNumber;
    const gatePass = await withDocRetry(async () => {
      passNumber = await generateSequentialNumber(prisma, 'GP');
      return prisma.gatePass.create({
        data: {
          passNumber,
          passType: primaryType,
          direction,
          siteName: siteName?.trim() || null,
          partyName: derivedPartyName,
          customerName: isInward ? customerName.trim() : null,
          customerGatePassNo: isInward ? customerGatePassNo.trim() : null,
          customerGatePassDate: isInward ? toDate(customerGatePassDate) : null,
          // customerContact is no longer collected — leave NULL on new rows.
          customerContact: null,
          customerGpDocType: isInward ? customerGpDocType : null,
          customerGpPdfUrl: isInward ? customerGpPdfUrl : null,
          inwardKind: isInward ? inwardKind : null,
          destinationUnitId: isInward && inwardKind === 'DIRECT_TO_UNIT' ? destinationUnitId : null,
          remarks: remarks?.trim() || null,
          status: initialStatus,
          createdById: req.user.id,
          siteInchargeById: isInward ? null : req.user.id,
          siteInchargeAt: isInward ? null : new Date(),
          items: {
            create: items.map((it) => ({
              description: it.description.trim(),
              quantity: Number(it.quantity),
              unit: it.unit || 'pcs',
              dispatchedTo: it.dispatchedTo?.trim() || null,
              itemPurpose: it.itemPurpose?.trim() || null,
              probableReturnDate: toDate(it.probableReturnDate),
              itemPassType: it.itemPassType || null,
              gatePassDetails: it.gatePassDetails?.trim() || null,
              transportation: it.transportation?.trim() || null,
              contactPersonDetails: it.contactPersonDetails?.trim() || null,
              sourceInwardGatePassItemId: !isInward && it.sourceInwardGatePassItemId
                ? it.sourceInwardGatePassItemId : null,
            })),
          },
        },
        include: GATEPASS_INCLUDE,
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'GatePass',
        entityId: gatePass.id,
        details: { passNumber, partyName: gatePass.partyName, direction },
        ipAddress: req.ip,
      },
    });

    if (isInward) {
      if (inwardKind === 'DIRECT_TO_UNIT') {
        // Notify any manager of the destination unit so they see it on their Gate Pass tab.
        const unitManagers = await prisma.user.findMany({
          where: { role: 'MANAGER', unitId: destinationUnitId, isActive: true },
          select: { id: true },
        });
        for (const u of unitManagers) {
          await notify({
            type: 'GATE_PASS_INWARD',
            title: `FIM headed to your unit: ${gatePass.passNumber}`,
            message: `${req.user.name} sent inward FIM ${gatePass.passNumber} from ${gatePass.customerName} (Customer GP ${gatePass.customerGatePassNo}) directly to your unit. Mark it Collected when received.`,
            targetUserId: u.id,
            sentById: req.user.id,
          });
        }
      } else {
        await notify({
          type: 'GATE_PASS_INWARD',
          title: `Inward Gate Pass: ${gatePass.passNumber}`,
          message: `${req.user.name} recorded inward gate pass ${gatePass.passNumber} from ${gatePass.customerName} (Customer GP ${gatePass.customerGatePassNo}). Awaiting acceptance into stores.`,
          targetRole: 'STORE_MANAGER',
          sentById: req.user.id,
        });
      }
    } else {
      await notify({
        type: 'GATE_PASS_REQUEST',
        title: `Gate Pass Request: ${gatePass.passNumber}`,
        message: `${req.user.name} submitted gate pass request ${gatePass.passNumber} (${items.length} item${items.length === 1 ? '' : 's'}). Awaiting Store Incharge review.`,
        targetRole: 'STORE_MANAGER',
        sentById: req.user.id,
      });
    }

    res.status(201).json(gatePass);
  } catch (error) {
    console.error('Create gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/store-approve — Store Incharge arranges vehicle and forwards to Accounts
router.put('/:id/store-approve', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { driverName, vehicleNo } = req.body || {};
    if (!driverName || !driverName.trim()) {
      return res.status(400).json({ error: 'Driver name is required' });
    }
    if (!vehicleNo || !vehicleNo.trim()) {
      return res.status(400).json({ error: 'Vehicle number is required' });
    }

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status !== 'PENDING_STORE') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Store Incharge approval' });
    }

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_ACCOUNTS',
        driverName: driverName.trim(),
        vehicleNo: vehicleNo.trim(),
        storeInchargeById: req.user.id,
        storeInchargeAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STORE_INCHARGE_APPROVAL',
        entity: 'GatePass',
        entityId: updated.id,
        details: {
          passNumber: updated.passNumber,
          driverName: updated.driverName,
          vehicleNo: updated.vehicleNo,
          from: 'PENDING_STORE',
          to: 'PENDING_ACCOUNTS',
        },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_STAGE',
      title: `Gate Pass ${updated.passNumber}: vehicle arranged`,
      message: `${req.user.name} arranged driver ${updated.driverName} / vehicle ${updated.vehicleNo}. Awaiting Accounts for payment.`,
      targetRole: 'ACCOUNTING',
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Store Incharge approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/accounts-approve — Accounts gives final approval (closes the workflow)
router.put('/:id/accounts-approve', authenticate, authorize('ACCOUNTING', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status !== 'PENDING_ACCOUNTS') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Accounts approval' });
    }

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'APPROVED',
        accountsById: req.user.id,
        accountsAt: now,
        approvedById: req.user.id,
        approvedAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ACCOUNTS_FINAL_APPROVAL',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, from: 'PENDING_ACCOUNTS', to: 'APPROVED' },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_APPROVED',
      title: `Gate Pass Approved: ${updated.passNumber}`,
      message: `${req.user.name} (Accounts) approved the gate pass. It is now active.`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Accounts approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/reject — any approver can reject at their stage
router.put('/:id/reject', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Rejection reason is required' });

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });

    const stageRole = {
      PENDING_STORE: ['STORE_MANAGER', 'ADMIN'],
      PENDING_ACCOUNTS: ['ACCOUNTING', 'ADMIN'],
    }[existing.status];

    if (!stageRole) return res.status(400).json({ error: 'Gate pass cannot be rejected at this stage' });
    if (!stageRole.includes(req.user.role)) return res.status(403).json({ error: 'Not authorised to reject at this stage' });

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectedReason: reason.trim() },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'REJECT',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, reason: reason.trim(), at: existing.status },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_REJECTED',
      title: `Gate Pass Rejected: ${updated.passNumber}`,
      message: `${req.user.name} rejected the request. Reason: ${reason.trim()}`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Reject gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/return — mark returnable items as returned
router.put('/:id/return', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { returnedBy, actualReturnDate, remarks } = req.body;

    const existing = await prisma.gatePass.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (!['APPROVED', 'OPEN'].includes(existing.status)) {
      return res.status(400).json({ error: 'Only approved gate passes can be marked as returned' });
    }

    const hasReturnable =
      existing.passType === 'RETURNABLE' ||
      existing.items.some((it) => it.itemPassType === 'RETURNABLE');
    if (!hasReturnable) {
      return res.status(400).json({ error: 'No returnable items on this gate pass' });
    }

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'RETURNED',
        returnedBy: returnedBy || req.user.name,
        actualReturnDate: actualReturnDate ? new Date(actualReturnDate) : new Date(),
        remarks: remarks != null ? remarks : existing.remarks,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'RETURN',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Return gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/accept-inward — Stores accepts inward gate pass items into Products.
// Body: { items: [{ itemId, productId?, newProduct?: {name, materialType, unit}, quantity, batchNumber? }] }
// Each item entry inwards the customer's material as FIM into either an existing Product
// or a freshly created one, and links the ProductBatch back to the source inward item.
router.put('/:id/accept-inward', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item to accept is required' });
    }

    const gatePass = await prisma.gatePass.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });
    if (!gatePass) return res.status(404).json({ error: 'Gate pass not found' });
    if (gatePass.direction !== 'INWARD') {
      return res.status(400).json({ error: 'Only INWARD gate passes can be accepted into stores' });
    }
    if (gatePass.inwardKind === 'DIRECT_TO_UNIT') {
      return res.status(400).json({ error: 'Direct-to-unit FIM does not go through stores acceptance — the destination unit marks it Collected.' });
    }
    if (!['PENDING_ACCEPTANCE', 'ACCEPTED'].includes(gatePass.status)) {
      return res.status(400).json({ error: `Gate pass is in status ${gatePass.status}; cannot accept items` });
    }

    const itemMap = new Map(gatePass.items.map(i => [i.id, i]));
    for (const row of items) {
      const src = itemMap.get(row.itemId);
      if (!src) return res.status(400).json({ error: `Item ${row.itemId} not on this gate pass` });
      const qty = parseFloat(row.quantity);
      if (!qty || qty <= 0) return res.status(400).json({ error: `Item ${src.description}: positive quantity required` });
      const remainingToInward = (src.quantity || 0) - (src.inwardedQty || 0);
      if (qty > remainingToInward + 1e-9) {
        return res.status(400).json({ error: `Item ${src.description}: cannot inward ${qty} (only ${remainingToInward} remaining)` });
      }
      if (!row.productId && !row.newProduct) {
        return res.status(400).json({ error: `Item ${src.description}: choose an existing product or provide newProduct details` });
      }
      if (row.newProduct && (!row.newProduct.name || !row.newProduct.name.trim())) {
        return res.status(400).json({ error: `Item ${src.description}: new product requires a name` });
      }
    }

    const owningUnitId = req.user.unitId || null;

    const out = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const row of items) {
        const src = itemMap.get(row.itemId);
        const qty = parseFloat(row.quantity);

        let productId = row.productId;
        let product;
        if (!productId) {
          // Create new product (FIM product), retry SKU collisions
          const matType = normalizeMaterialType(row.newProduct.materialType || 'Others');
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const sku = await generateProductSku(tx, matType);
              product = await tx.product.create({
                data: {
                  name: row.newProduct.name.trim(),
                  sku,
                  category: matType,
                  unit: row.newProduct.unit || src.unit || 'pcs',
                  currentStock: 0, // we'll increment below
                  isActive: true,
                },
              });
              productId = product.id;
              break;
            } catch (err) {
              if (!isUniqueViolation(err) || attempt === 4) throw err;
            }
          }
        } else {
          product = await tx.product.findUnique({ where: { id: productId } });
          if (!product) throw new Error(`Product ${productId} not found`);
        }

        const updatedProduct = await tx.product.update({
          where: { id: productId },
          data: { currentStock: { increment: qty } },
        });

        const movement = await tx.stockMovement.create({
          data: {
            productId,
            type: 'IN',
            quantity: qty,
            batchNumber: row.batchNumber || null,
            referenceType: 'InwardGatePass',
            referenceId: gatePass.id,
            notes: `FIM from ${gatePass.customerName || 'customer'} (Customer GP ${gatePass.customerGatePassNo || '—'})`,
            performedBy: req.user.id,
            unitId: owningUnitId,
          },
        });

        const batch = await tx.productBatch.create({
          data: {
            productId,
            batchNo: row.batchNumber || null,
            quantity: qty,
            remaining: qty,
            referenceType: 'InwardGatePass',
            referenceId: movement.id,
            notes: `FIM ${gatePass.passNumber} · ${src.description}`,
            createdById: req.user.id,
            isFim: true,
            sourceInwardGatePassId: gatePass.id,
            sourceInwardGatePassItemId: src.id,
          },
        });

        if (owningUnitId) {
          await tx.productUnitStock.upsert({
            where: { productId_unitId: { productId, unitId: owningUnitId } },
            update: { quantity: { increment: qty } },
            create: { productId, unitId: owningUnitId, quantity: qty },
          });
        }

        await tx.gatePassItem.update({
          where: { id: src.id },
          data: { inwardedQty: { increment: qty } },
        });

        created.push({ product: updatedProduct, movement, batch, sourceItemId: src.id });
      }

      // After all items processed, decide gate pass status.
      const refreshed = await tx.gatePass.findUnique({
        where: { id: gatePass.id },
        include: { items: true },
      });
      const allFullyInwarded = refreshed.items.every(i => (i.inwardedQty || 0) + 1e-9 >= (i.quantity || 0));
      const newStatus = allFullyInwarded ? 'ACCEPTED' : 'PENDING_ACCEPTANCE';
      if (newStatus !== refreshed.status) {
        await tx.gatePass.update({ where: { id: gatePass.id }, data: { status: newStatus } });
      }

      return { created, status: newStatus };
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'INWARD_ACCEPT',
        entity: 'GatePass',
        entityId: gatePass.id,
        details: {
          passNumber: gatePass.passNumber,
          itemsAccepted: out.created.length,
          newStatus: out.status,
        },
        ipAddress: req.ip,
      },
    });

    const updated = await prisma.gatePass.findUnique({
      where: { id: gatePass.id },
      include: GATEPASS_INCLUDE,
    });
    res.json(updated);
  } catch (error) {
    console.error('Accept inward gate pass error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/collect — Unit Manager marks a DIRECT_TO_UNIT inward FIM as collected.
// Collection status stays on the gatepass itself (no product-list entry, no stock movement).
router.put('/:id/collect', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const gatePass = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!gatePass) return res.status(404).json({ error: 'Gate pass not found' });
    if (gatePass.direction !== 'INWARD' || gatePass.inwardKind !== 'DIRECT_TO_UNIT') {
      return res.status(400).json({ error: 'Only direct-to-unit inward FIM can be marked Collected' });
    }
    if (gatePass.collectedAt) {
      return res.status(400).json({ error: 'Gate pass is already marked Collected' });
    }
    // Only a manager of the destination unit (or Admin) can mark it collected.
    if (req.user.role !== 'ADMIN' && req.user.unitId !== gatePass.destinationUnitId) {
      return res.status(403).json({ error: 'Only a manager of the destination unit can mark this Collected' });
    }

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: gatePass.id },
      data: {
        status: 'ACCEPTED',
        collectedAt: now,
        collectedById: req.user.id,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'INWARD_COLLECTED',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, destinationUnitId: updated.destinationUnitId },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_COLLECTED',
      title: `FIM collected: ${updated.passNumber}`,
      message: `${req.user.name} marked direct-to-unit FIM ${updated.passNumber} as collected by ${updated.destinationUnit?.name || 'their unit'}.`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Collect gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/close — close the gate pass
router.put('/:id/close', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { remarks } = req.body;

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status === 'CLOSED') {
      return res.status(400).json({ error: 'Gate pass is already closed' });
    }

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        remarks: remarks != null ? remarks : existing.remarks,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CLOSE',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Close gate pass error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── FIM Batch Assignment + One-shot Unit Acceptance ────
// These live on the FIM batch (ProductBatch with isFim=true) created by accept-inward.
// Workflow: Stores assigns a FIM batch to a unit → the unit's manager clicks Accept
// with a remark. Acceptance is final; no MIV required.

const BATCH_FIM_INCLUDE = {
  product: { select: { id: true, name: true, sku: true, unit: true } },
  assignedToUnit: UNIT_SELECT,
  assignedBy: USER_SELECT,
  unitAcceptedBy: USER_SELECT,
  sourceInwardGatePass: {
    select: {
      id: true, passNumber: true, customerName: true, customerGatePassNo: true,
      customerGatePassDate: true, customerGpDocType: true, customerGpPdfUrl: true,
    },
  },
  sourceInwardGatePassItem: {
    select: {
      id: true, description: true, probableReturnDate: true, itemPassType: true,
    },
  },
};

// PUT /api/gatepasses/fim-batches/:id/assign — Stores assigns a FIM batch to a unit.
// Cannot be changed once the unit has accepted.
router.put('/fim-batches/:id/assign', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { unitId } = req.body || {};
    if (!unitId) return res.status(400).json({ error: 'unitId is required' });

    const batch = await prisma.productBatch.findUnique({ where: { id: req.params.id } });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.isFim) return res.status(400).json({ error: 'Only FIM batches can be assigned to a unit this way' });
    if (batch.unitAcceptedAt) return res.status(400).json({ error: 'Batch already accepted by the unit — cannot reassign' });

    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) return res.status(400).json({ error: 'Unit not found' });

    const updated = await prisma.productBatch.update({
      where: { id: batch.id },
      data: {
        assignedToUnitId: unitId,
        assignedAt: new Date(),
        assignedById: req.user.id,
      },
      include: BATCH_FIM_INCLUDE,
    });

    // Notify unit managers so they see the pending FIM acceptance on their dashboard.
    const unitManagers = await prisma.user.findMany({
      where: { role: 'MANAGER', unitId, isActive: true },
      select: { id: true },
    });
    for (const u of unitManagers) {
      await notify({
        type: 'GATE_PASS_INWARD',
        title: `FIM assigned to your unit`,
        message: `${req.user.name} assigned FIM ${updated.product.name} (qty ${updated.quantity}) to your unit. Accept it with a remark.`,
        targetUserId: u.id,
        sentById: req.user.id,
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIM_ASSIGN',
        entity: 'ProductBatch',
        entityId: updated.id,
        details: { productId: updated.productId, unitId, quantity: updated.quantity },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('FIM assign error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/fim-batches/:id/unit-accept — Unit Manager finalises acceptance with a remark.
// One-shot: once set, cannot be undone or re-accepted.
router.put('/fim-batches/:id/unit-accept', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { remark } = req.body || {};
    if (!remark || !String(remark).trim()) {
      return res.status(400).json({ error: 'A remark is required to accept FIM' });
    }

    const batch = await prisma.productBatch.findUnique({
      where: { id: req.params.id },
      include: { product: { select: { id: true, name: true } } },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.isFim) return res.status(400).json({ error: 'Only FIM batches use unit acceptance' });
    if (!batch.assignedToUnitId) return res.status(400).json({ error: 'Batch has not been assigned to any unit yet' });
    if (batch.unitAcceptedAt) return res.status(400).json({ error: 'Batch is already accepted — acceptance is final' });

    // Only a manager of the assigned unit (or Admin) can accept.
    if (req.user.role !== 'ADMIN' && req.user.unitId !== batch.assignedToUnitId) {
      return res.status(403).json({ error: 'Only a manager of the assigned unit can accept this FIM' });
    }

    const updated = await prisma.productBatch.update({
      where: { id: batch.id },
      data: {
        unitAcceptedAt: new Date(),
        unitAcceptedById: req.user.id,
        unitAcceptedRemarks: String(remark).trim(),
      },
      include: BATCH_FIM_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIM_UNIT_ACCEPT',
        entity: 'ProductBatch',
        entityId: updated.id,
        details: { productId: updated.productId, unitId: batch.assignedToUnitId },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('FIM unit-accept error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
