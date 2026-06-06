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
const VEHICLE_SELECT = {
  select: {
    id: true, regNumber: true, vehicleType: true, make: true, model: true,
    driverName: true, driverPhone: true, status: true,
  },
};
const GATEPASS_INCLUDE = {
  createdBy: USER_SELECT,
  siteIncharge: USER_SELECT,
  storeIncharge: USER_SELECT,
  accountsApprover: USER_SELECT,
  finalApprover: USER_SELECT,
  destinationUnit: UNIT_SELECT,
  collectedBy: USER_SELECT,
  // Gate Pass v2 relations
  requestedBy: USER_SELECT,
  assignedVehicle: VEHICLE_SELECT,
  logisticsBy: USER_SELECT,
  siteOfficeAckBy: USER_SELECT,
  localReturnedBy: USER_SELECT,
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
  'PENDING_STORE_REVIEW', 'PENDING_LOGISTICS', 'IN_TRANSIT', 'PENDING_RETURN',
  'PENDING_ACCEPTANCE', 'ACCEPTED',
  'APPROVED', 'RETURNED', 'CLOSED', 'REJECTED', 'OPEN',
];
const KINDS = ['LOCAL_JOB', 'OUTSIDE'];

const toDate = (v) => (v ? new Date(v) : null);

const notify = async (data) => {
  try {
    await prisma.notification.create({ data });
  } catch (e) {
    console.error('[notify] failed', {
      type: data?.type,
      targetUserId: data?.targetUserId,
      code: e?.code,
      message: e?.message,
    });
  }
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
router.post('/', authenticate, authorize('MANAGER', 'STORE_MANAGER', 'ADMIN'), acceptFimGpPdf, async (req, res) => {
  try {
    const {
      siteName, remarks, items, direction: rawDirection,
      customerName, customerGatePassNo, customerGatePassDate,
      inwardKind: rawInwardKind, destinationUnitId,
      customerGpDocType: rawDocType,
      vehicleNo: rawVehicleNo, driverName: rawDriverName,
      gpRequisitionNo: rawGpRequisitionNo,
      // Gate Pass v2 (OUTWARD) — kind-aware fields
      kind: rawKind,
      jobWorkNo: rawJobWorkNo,
      jobWorkDate: rawJobWorkDate,
      vendorDetails: rawVendorDetails,
      requestedById: rawRequestedById,
      destinationOffice: rawDestinationOffice,
    } = req.body;

    const customerGpDocType = GP_DOC_TYPES.includes(rawDocType) ? rawDocType : null;
    const customerGpPdfUrl = req.file ? publicUrlFor('fim-gp', req.file.filename) : null;

    const direction = DIRECTIONS.includes(rawDirection) ? rawDirection : 'OUTWARD';
    const isInward = direction === 'INWARD';

    // Gate Pass v2: OUTWARD now requires a `kind` (LOCAL_JOB | OUTSIDE).
    // Legacy OUTWARD callers (FIM return via /fim-batches/:id/send-out) skip this and
    // create rows with kind=null — those flow through the legacy approve path.
    const kind = !isInward && KINDS.includes(rawKind) ? rawKind : null;
    if (!isInward && kind === 'OUTSIDE' && !rawDestinationOffice?.trim()) {
      return res.status(400).json({ error: 'Destination office is required for OUTSIDE gate passes' });
    }

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

    // INWARD STORES is now final on creation — items go straight into Products,
    // so the gate pass is ACCEPTED immediately. DIRECT_TO_UNIT still awaits the
    // destination unit marking it Collected.
    const initialStatus = isInward
      ? (inwardKind === 'STORES' ? 'ACCEPTED' : 'PENDING_ACCEPTANCE')
      : 'PENDING_STORE';

    let passNumber;
    let fimNumber = null;
    const gatePass = await withDocRetry(async () => {
      passNumber = await generateSequentialNumber(prisma, 'GP');
      // FIM/Customer Property Register number — only for INWARD STORES intake.
      if (isInward && inwardKind === 'STORES') {
        fimNumber = await generateSequentialNumber(prisma, 'FIM');
      }
      return prisma.gatePass.create({
        data: {
          passNumber,
          fimNumber: isInward && inwardKind === 'STORES' ? fimNumber : null,
          gpRequisitionNo: isInward ? (rawGpRequisitionNo?.trim() || null) : null,
          passType: primaryType,
          direction,
          // OUTWARD v2 kind + headers
          kind,
          jobWorkNo: !isInward && kind === 'LOCAL_JOB' ? (rawJobWorkNo?.trim() || null) : null,
          jobWorkDate: !isInward && kind === 'LOCAL_JOB' ? (toDate(rawJobWorkDate) || null) : null,
          vendorDetails: !isInward && kind === 'LOCAL_JOB' ? (rawVendorDetails?.trim() || null) : null,
          requestedById: !isInward && rawRequestedById ? rawRequestedById : null,
          destinationOffice: !isInward && kind === 'OUTSIDE' ? rawDestinationOffice.trim() : null,
          siteName: siteName?.trim() || null,
          partyName: derivedPartyName,
          customerName: isInward ? customerName.trim() : null,
          customerGatePassNo: isInward ? customerGatePassNo.trim() : null,
          customerGatePassDate: isInward ? toDate(customerGatePassDate) : null,
          // customerContact is no longer collected — leave NULL on new rows.
          customerContact: null,
          customerGpDocType: isInward ? customerGpDocType : null,
          customerGpPdfUrl: isInward ? customerGpPdfUrl : null,
          // Vehicle / driver — register column "VEHICLE NO / DRIVER SIGN".
          vehicleNo: isInward ? (rawVehicleNo?.trim() || null) : null,
          driverName: isInward ? (rawDriverName?.trim() || null) : null,
          inwardKind: isInward ? inwardKind : null,
          destinationUnitId: isInward && inwardKind === 'DIRECT_TO_UNIT' ? destinationUnitId : null,
          remarks: remarks?.trim() || null,
          status: initialStatus,
          createdById: req.user.id,
          // Site Incharge sign no longer auto-set for v2 OUTWARD; the creator's
          // signature is captured separately via /store-approve / review steps.
          siteInchargeById: (isInward || kind) ? null : req.user.id,
          siteInchargeAt: (isInward || kind) ? null : new Date(),
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
              remarks: it.remarks?.trim() || null,
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

    // INWARD STORES auto-inward: every item gets its own auto-created Product
    // (using the item description as the product name) and a FIM ProductBatch.
    // No follow-up acceptance step needed — the inward is final at this point.
    if (isInward && inwardKind === 'STORES') {
      const owningUnitId = req.user.unitId || null;
      try {
        await prisma.$transaction(async (tx) => {
          for (const src of gatePass.items) {
            const qty = src.quantity || 0;
            if (qty <= 0) continue;

            const matType = normalizeMaterialType('Others');
            let productId;
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                const sku = await generateProductSku(tx, matType);
                const product = await tx.product.create({
                  data: {
                    name: src.description.trim(),
                    sku,
                    category: matType,
                    unit: src.unit || 'pcs',
                    currentStock: 0,
                    isActive: true,
                  },
                });
                productId = product.id;
                break;
              } catch (err) {
                if (!isUniqueViolation(err) || attempt === 4) throw err;
              }
            }

            await tx.product.update({
              where: { id: productId },
              data: { currentStock: { increment: qty } },
            });

            const movement = await tx.stockMovement.create({
              data: {
                productId,
                type: 'IN',
                quantity: qty,
                referenceType: 'InwardGatePass',
                referenceId: gatePass.id,
                notes: `FIM from ${gatePass.customerName || 'customer'} (Customer GP ${gatePass.customerGatePassNo || '—'})`,
                performedBy: req.user.id,
                unitId: owningUnitId,
              },
            });

            await tx.productBatch.create({
              data: {
                productId,
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
              data: { inwardedQty: qty },
            });
          }
        });
      } catch (err) {
        console.error('Auto-inward on creation failed:', err);
      }
    }

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
          message: `${req.user.name} recorded inward FIM gate pass ${gatePass.passNumber} from ${gatePass.customerName} (Customer GP ${gatePass.customerGatePassNo}). Items added to stock.`,
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

// ──────────────────────────────────────────────────────────────────────────────
// OUTWARD v2 — Local Job / Outside dual flow
//
// LOCAL_JOB: PENDING_STORE → (store-approve) → PENDING_STORE_REVIEW → (store-review)
//            → PENDING_LOGISTICS → (logistics-assign+dispatch) → IN_TRANSIT
//            → (stores-ack-arrival) → CLOSED  [returnable acks on RETURN; non-returnable acks on REACH]
//
// OUTSIDE:   PENDING_STORE → (store-approve) → PENDING_ACCOUNTS → (accounts-invoice)
//            → PENDING_STORE_REVIEW → (store-review) → PENDING_LOGISTICS
//            → (logistics-assign+dispatch w/ signed PDF) → IN_TRANSIT
//            → (site-office-ack) → CLOSED
//
// Legacy OUTWARD rows (kind=null, e.g. FIM /send-out) use the original
// PENDING_STORE → PENDING_ACCOUNTS → APPROVED path retained below.
// ──────────────────────────────────────────────────────────────────────────────

// PUT /api/gatepasses/:id/store-approve
// Stores reviews items + approves. For OUTSIDE, routes to PENDING_ACCOUNTS for invoice entry.
// For LOCAL_JOB, routes to PENDING_STORE_REVIEW (skipping accounts). Legacy (kind=null)
// keeps the old behaviour: vehicleNo/driverName required, routes to PENDING_ACCOUNTS.
router.put('/:id/store-approve', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { driverName, vehicleNo, remarks } = req.body || {};

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.status !== 'PENDING_STORE') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Store Incharge approval' });
    }

    const isLegacy = !existing.kind;
    if (isLegacy) {
      if (!driverName?.trim()) return res.status(400).json({ error: 'Driver name is required' });
      if (!vehicleNo?.trim()) return res.status(400).json({ error: 'Vehicle number is required' });
    }

    const nextStatus = isLegacy
      ? 'PENDING_ACCOUNTS'
      : (existing.kind === 'OUTSIDE' ? 'PENDING_ACCOUNTS' : 'PENDING_STORE_REVIEW');

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: nextStatus,
        driverName: isLegacy ? driverName.trim() : existing.driverName,
        vehicleNo: isLegacy ? vehicleNo.trim() : existing.vehicleNo,
        storeInchargeById: req.user.id,
        storeInchargeAt: now,
        remarks: remarks?.trim() || existing.remarks,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STORE_INCHARGE_APPROVAL',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, from: 'PENDING_STORE', to: nextStatus, kind: updated.kind },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_STAGE',
      title: `Gate Pass ${updated.passNumber}: stores approved`,
      message: nextStatus === 'PENDING_ACCOUNTS'
        ? `${req.user.name} approved stores stage. Awaiting Accounts to add invoice details.`
        : `${req.user.name} approved stores stage. Awaiting Stores final review.`,
      targetRole: nextStatus === 'PENDING_ACCOUNTS' ? 'ACCOUNTING' : 'STORE_MANAGER',
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Store Incharge approval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/accounts-invoice
// OUTSIDE only: Accounts attaches invoice / DC numbers and forwards to Stores for final review.
// (Replaces the old /accounts-approve for v2; legacy rows still use /accounts-approve below.)
router.put('/:id/accounts-invoice', authenticate, authorize('ACCOUNTING', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { invoiceNo, dcNo, remarks } = req.body || {};

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.kind !== 'OUTSIDE') {
      return res.status(400).json({ error: 'Invoice step applies to OUTSIDE gate passes only' });
    }
    if (existing.status !== 'PENDING_ACCOUNTS') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Accounts' });
    }
    if (!invoiceNo?.trim() && !dcNo?.trim()) {
      return res.status(400).json({ error: 'Invoice No or DC No is required' });
    }

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_STORE_REVIEW',
        invoiceNo: invoiceNo?.trim() || existing.invoiceNo,
        dcNo: dcNo?.trim() || existing.dcNo,
        remarks: remarks?.trim() || existing.remarks,
        accountsById: req.user.id,
        accountsAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ACCOUNTS_INVOICE',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, invoiceNo: updated.invoiceNo, dcNo: updated.dcNo },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_STAGE',
      title: `Gate Pass ${updated.passNumber}: invoice added`,
      message: `${req.user.name} (Accounts) added invoice details. Awaiting Stores final review.`,
      targetRole: 'STORE_MANAGER',
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Accounts invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/store-review
// Stores final review (both LOCAL_JOB and OUTSIDE). Forwards to Logistics for vehicle assignment.
router.put('/:id/store-review', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { remarks } = req.body || {};
    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (!existing.kind) return res.status(400).json({ error: 'Only v2 (LOCAL_JOB/OUTSIDE) gate passes use store-review' });
    if (existing.status !== 'PENDING_STORE_REVIEW') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Stores review' });
    }

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_LOGISTICS',
        remarks: remarks?.trim() || existing.remarks,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'STORE_REVIEW',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, kind: updated.kind },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_STAGE',
      title: `Gate Pass ${updated.passNumber}: ready for logistics`,
      message: `${req.user.name} completed stores review. Logistics, please assign a vehicle.`,
      targetRole: 'LOGISTICS',
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Store review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/logistics-assign
// Logistics assigns a vehicle from the vehicle register.
router.put('/:id/logistics-assign', authenticate, authorize('LOGISTICS', 'ADMIN'), async (req, res) => {
  try {
    const { vehicleId } = req.body || {};
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId is required' });

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (!existing.kind) return res.status(400).json({ error: 'Only v2 (LOCAL_JOB/OUTSIDE) gate passes use logistics assignment' });
    if (existing.status !== 'PENDING_LOGISTICS') {
      return res.status(400).json({ error: 'Gate pass is not awaiting Logistics' });
    }

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return res.status(400).json({ error: 'Vehicle not found' });
    if (vehicle.status !== 'ACTIVE') return res.status(400).json({ error: 'Vehicle is not ACTIVE' });

    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        assignedVehicleId: vehicle.id,
        logisticsById: req.user.id,
        logisticsAt: new Date(),
        vehicleNo: vehicle.regNumber,
        driverName: vehicle.driverName,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'LOGISTICS_ASSIGN_VEHICLE',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, vehicleId: vehicle.id, regNumber: vehicle.regNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Logistics assign error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gatepasses/:id/logistics-dispatch
// Logistics confirms dispatch. For OUTSIDE, requires the driver-signed PDF upload.
// Multipart: field `signedPdf` (PDF). Body fields: remarks.
router.post('/:id/logistics-dispatch', authenticate, authorize('LOGISTICS', 'ADMIN'),
  (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('multipart/form-data')) return next();
    fimGpUpload.single('signedPdf')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Signed PDF upload failed' });
      next();
    });
  },
  async (req, res) => {
    try {
      const { remarks } = req.body || {};
      const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
      if (!existing.kind) return res.status(400).json({ error: 'Only v2 gate passes use logistics-dispatch' });
      if (existing.status !== 'PENDING_LOGISTICS') {
        return res.status(400).json({ error: 'Gate pass is not awaiting Logistics dispatch' });
      }
      if (!existing.assignedVehicleId) {
        return res.status(400).json({ error: 'Assign a vehicle before dispatching' });
      }
      if (existing.kind === 'OUTSIDE' && !req.file) {
        return res.status(400).json({ error: 'Driver-signed delivery PDF is required for OUTSIDE dispatch' });
      }

      const signedPdfUrl = req.file ? publicUrlFor('fim-gp', req.file.filename) : null;

      const updated = await prisma.gatePass.update({
        where: { id: req.params.id },
        data: {
          status: 'IN_TRANSIT',
          dispatchedAt: new Date(),
          signedDeliveryPdfUrl: signedPdfUrl || existing.signedDeliveryPdfUrl,
          remarks: remarks?.trim() || existing.remarks,
        },
        include: GATEPASS_INCLUDE,
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'LOGISTICS_DISPATCH',
          entity: 'GatePass',
          entityId: updated.id,
          details: { passNumber: updated.passNumber, kind: updated.kind, hasSignedPdf: !!signedPdfUrl },
          ipAddress: req.ip,
        },
      });

      // Notify the right party for arrival ack.
      if (updated.kind === 'OUTSIDE') {
        await notify({
          type: 'GATE_PASS_STAGE',
          title: `Gate Pass ${updated.passNumber}: in transit to ${updated.destinationOffice}`,
          message: `${req.user.name} dispatched vehicle ${updated.vehicleNo || ''}. Site office, please acknowledge arrival with reached date.`,
          targetRole: 'SITE_OFFICE',
          sentById: req.user.id,
        });
      } else {
        await notify({
          type: 'GATE_PASS_STAGE',
          title: `Gate Pass ${updated.passNumber}: in transit`,
          message: `${req.user.name} dispatched vehicle ${updated.vehicleNo || ''}. Stores, please acknowledge ${updated.passType === 'RETURNABLE' ? 'return' : 'arrival'} when applicable.`,
          targetRole: 'STORE_MANAGER',
          sentById: req.user.id,
        });
      }

      res.json(updated);
    } catch (error) {
      console.error('Logistics dispatch error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// PUT /api/gatepasses/:id/site-office-ack
// OUTSIDE only: site office (e.g., Hyderabad) acknowledges arrival with the reached date.
// Closes the gate pass.
router.put('/:id/site-office-ack', authenticate, authorize('SITE_OFFICE', 'ADMIN'), async (req, res) => {
  try {
    const { reachedDate, remarks } = req.body || {};
    if (!reachedDate) return res.status(400).json({ error: 'reachedDate is required' });

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.kind !== 'OUTSIDE') return res.status(400).json({ error: 'Site office ack applies to OUTSIDE only' });
    if (existing.status !== 'IN_TRANSIT') return res.status(400).json({ error: 'Gate pass is not in transit' });

    const now = new Date();
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        reachedDate: new Date(reachedDate),
        siteOfficeAckById: req.user.id,
        siteOfficeAckAt: now,
        remarks: remarks?.trim() || existing.remarks,
        approvedById: req.user.id,
        approvedAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'SITE_OFFICE_ACK',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, reachedDate: updated.reachedDate },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_APPROVED',
      title: `Gate Pass ${updated.passNumber}: arrived`,
      message: `${req.user.name} confirmed arrival on ${new Date(reachedDate).toLocaleDateString()}. Gate pass closed.`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Site office ack error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/stores-ack
// LOCAL_JOB only: Stores acknowledges either return (RETURNABLE) or arrival (NON_RETURNABLE).
// Closes the gate pass.
router.put('/:id/stores-ack', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { remarks } = req.body || {};

    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.kind !== 'LOCAL_JOB') return res.status(400).json({ error: 'Stores ack applies to LOCAL_JOB only' });
    if (existing.status !== 'IN_TRANSIT') return res.status(400).json({ error: 'Gate pass is not in transit' });

    const now = new Date();
    const isReturnable = existing.passType === 'RETURNABLE';
    const updated = await prisma.gatePass.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        localReturnedAt: isReturnable ? now : existing.localReturnedAt,
        localReturnedById: req.user.id,
        actualReturnDate: isReturnable ? now : existing.actualReturnDate,
        remarks: remarks?.trim() || existing.remarks,
        approvedById: req.user.id,
        approvedAt: now,
      },
      include: GATEPASS_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: isReturnable ? 'LOCAL_JOB_RETURN_ACK' : 'LOCAL_JOB_ARRIVAL_ACK',
        entity: 'GatePass',
        entityId: updated.id,
        details: { passNumber: updated.passNumber, passType: updated.passType },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_APPROVED',
      title: `Gate Pass ${updated.passNumber}: closed`,
      message: `${req.user.name} acknowledged ${isReturnable ? 'return' : 'arrival'}. Gate pass closed.`,
      targetUserId: updated.createdById,
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('Stores ack error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/:id/accounts-approve — LEGACY (kind=null OUTWARD rows, e.g. FIM /send-out)
router.put('/:id/accounts-approve', authenticate, authorize('ACCOUNTING', 'FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.gatePass.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Gate pass not found' });
    if (existing.kind) {
      return res.status(400).json({ error: 'Use /accounts-invoice for v2 OUTSIDE gate passes' });
    }
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
      PENDING_ACCOUNTS: ['ACCOUNTING', 'FINANCE', 'ADMIN'],
      PENDING_STORE_REVIEW: ['STORE_MANAGER', 'ADMIN'],
      PENDING_LOGISTICS: ['LOGISTICS', 'ADMIN'],
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
  readyToSendOutBy: USER_SELECT,
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

// PUT /api/gatepasses/fim-batches/:id/remarks
// Unit manager (of the assigned unit) or Admin can edit unit remarks any time —
// even after acceptance. Acceptance itself stays final; only the remark text changes.
router.put('/fim-batches/:id/remarks', authenticate, authorize('MANAGER', 'STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { remark } = req.body || {};
    const text = (remark == null ? '' : String(remark)).trim();

    const batch = await prisma.productBatch.findUnique({ where: { id: req.params.id } });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.isFim) return res.status(400).json({ error: 'Only FIM batches have unit remarks' });

    // Only the assigned-unit manager (or Stores/Admin) can edit.
    if (req.user.role === 'MANAGER' && req.user.unitId !== batch.assignedToUnitId) {
      return res.status(403).json({ error: 'Only a manager of the assigned unit can edit this remark' });
    }

    const updated = await prisma.productBatch.update({
      where: { id: batch.id },
      data: { unitAcceptedRemarks: text || null },
      include: BATCH_FIM_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIM_REMARK_EDIT',
        entity: 'ProductBatch',
        entityId: updated.id,
        details: { productId: updated.productId, length: text.length },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('FIM remark edit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/fim-batches/:id/mark-ready
// Assigned unit manager (or Admin) marks a RETURNABLE FIM batch ready to send back.
// Stores can only create the outward gate pass once this flag is set.
router.put('/fim-batches/:id/mark-ready', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { note } = req.body || {};

    const batch = await prisma.productBatch.findUnique({
      where: { id: req.params.id },
      include: { sourceInwardGatePassItem: true, product: { select: { id: true, name: true } } },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.isFim) return res.status(400).json({ error: 'Only FIM batches can be marked ready' });
    if (!batch.assignedToUnitId) return res.status(400).json({ error: 'Batch must be assigned to a unit first' });
    if (!batch.unitAcceptedAt) return res.status(400).json({ error: 'Batch must be accepted by the unit before marking ready' });
    if (batch.sourceInwardGatePassItem?.itemPassType !== 'RETURNABLE') {
      return res.status(400).json({ error: 'Only RETURNABLE FIM can be sent back to customer' });
    }
    if (req.user.role !== 'ADMIN' && req.user.unitId !== batch.assignedToUnitId) {
      return res.status(403).json({ error: 'Only the assigned unit manager can mark this ready' });
    }
    if (batch.readyToSendOutAt) {
      return res.status(400).json({ error: 'Batch is already marked ready to send out' });
    }

    const updated = await prisma.productBatch.update({
      where: { id: batch.id },
      data: {
        readyToSendOutAt: new Date(),
        readyToSendOutById: req.user.id,
        readyToSendOutNote: note ? String(note).trim() : null,
      },
      include: BATCH_FIM_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIM_MARK_READY_SEND_OUT',
        entity: 'ProductBatch',
        entityId: updated.id,
        details: { productId: updated.productId, unitId: batch.assignedToUnitId },
        ipAddress: req.ip,
      },
    });

    // Notify Stores that this FIM is ready to be collected from the unit.
    const unitLabel = updated.assignedToUnit?.name || updated.assignedToUnit?.code || 'the unit';
    await notify({
      type: 'GATE_PASS_REQUEST',
      title: `FIM ready to collect: ${updated.product.name}`,
      message: `${req.user.name} marked FIM ${updated.product.name} (qty ${updated.quantity}) ready to collect from ${unitLabel}. Stores can now create the return gate pass.`,
      targetRole: 'STORE_MANAGER',
      sentById: req.user.id,
    });

    res.json(updated);
  } catch (error) {
    console.error('FIM mark-ready error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/gatepasses/fim-batches/:id/unmark-ready
// Assigned unit manager (or Admin) can withdraw the ready flag before Stores ships it.
router.put('/fim-batches/:id/unmark-ready', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const batch = await prisma.productBatch.findUnique({
      where: { id: req.params.id },
      include: { sourceInwardGatePassItem: { include: { outwardLinkedItems: { select: { id: true } } } } },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.isFim) return res.status(400).json({ error: 'Only FIM batches use this flag' });
    if (req.user.role !== 'ADMIN' && req.user.unitId !== batch.assignedToUnitId) {
      return res.status(403).json({ error: 'Only the assigned unit manager can withdraw the ready flag' });
    }
    if (!batch.readyToSendOutAt) {
      return res.status(400).json({ error: 'Batch is not marked ready' });
    }
    if ((batch.sourceInwardGatePassItem?.outwardLinkedItems || []).length > 0) {
      return res.status(400).json({ error: 'Cannot withdraw — Stores has already created the return gate pass' });
    }

    const updated = await prisma.productBatch.update({
      where: { id: batch.id },
      data: {
        readyToSendOutAt: null,
        readyToSendOutById: null,
        readyToSendOutNote: null,
      },
      include: BATCH_FIM_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIM_UNMARK_READY_SEND_OUT',
        entity: 'ProductBatch',
        entityId: updated.id,
        details: { productId: updated.productId },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('FIM unmark-ready error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/gatepasses/fim-batches/:id/send-out
// Stores creates an OUTWARD gate pass to return a RETURNABLE FIM batch to the
// customer. Blocked until the assigned unit manager has marked the batch ready.
// Pre-fills customer / item data and links back via sourceInwardGatePassItemId
// so the cycle closes. Body: { vehicleNo?, driverName?, remarks? }.
router.post('/fim-batches/:id/send-out', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { vehicleNo, driverName, remarks } = req.body || {};

    const batch = await prisma.productBatch.findUnique({
      where: { id: req.params.id },
      include: {
        product: { select: { id: true, name: true, sku: true, unit: true } },
        sourceInwardGatePass: true,
        sourceInwardGatePassItem: true,
      },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!batch.isFim) return res.status(400).json({ error: 'Only FIM batches can be sent back to customer' });
    if (!batch.sourceInwardGatePass || !batch.sourceInwardGatePassItem) {
      return res.status(400).json({ error: 'FIM batch is missing its source gate pass link' });
    }
    if (batch.sourceInwardGatePassItem.itemPassType !== 'RETURNABLE') {
      return res.status(400).json({ error: 'Only RETURNABLE FIM can be sent back to customer' });
    }
    if (!batch.readyToSendOutAt) {
      return res.status(400).json({ error: 'Unit manager must mark this FIM ready before Stores can send it out' });
    }

    const inward = batch.sourceInwardGatePass;
    const item = batch.sourceInwardGatePassItem;

    let outwardPassNumber;
    const outwardGp = await withDocRetry(async () => {
      outwardPassNumber = await generateSequentialNumber(prisma, 'GP');
      return prisma.gatePass.create({
        data: {
          passNumber: outwardPassNumber,
          passType: 'RETURNABLE',
          direction: 'OUTWARD',
          partyName: inward.customerName,
          customerName: inward.customerName,
          customerGatePassNo: inward.customerGatePassNo,
          customerGatePassDate: inward.customerGatePassDate,
          vehicleNo: vehicleNo?.trim() || null,
          driverName: driverName?.trim() || null,
          remarks: (remarks?.trim()
            || `Return of FIM ${inward.fimNumber || inward.passNumber} to ${inward.customerName}`),
          status: 'PENDING_STORE',
          createdById: req.user.id,
          siteInchargeById: req.user.id,
          siteInchargeAt: new Date(),
          items: {
            create: [{
              description: batch.product.name,
              quantity: batch.quantity,
              unit: batch.product.unit || 'pcs',
              dispatchedTo: inward.customerName,
              itemPurpose: `Return of FIM ${inward.fimNumber || inward.passNumber}`,
              itemPassType: 'DELIVERY_CHALLAN',
              gatePassDetails: inward.fimNumber || inward.passNumber,
              sourceInwardGatePassItemId: item.id,
              remarks: remarks?.trim() || null,
            }],
          },
        },
        include: GATEPASS_INCLUDE,
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'FIM_SEND_OUT',
        entity: 'GatePass',
        entityId: outwardGp.id,
        details: {
          outwardPassNumber: outwardGp.passNumber,
          inwardPassNumber: inward.passNumber,
          fimNumber: inward.fimNumber,
          productId: batch.productId,
          quantity: batch.quantity,
        },
        ipAddress: req.ip,
      },
    });

    await notify({
      type: 'GATE_PASS_REQUEST',
      title: `FIM return: ${outwardGp.passNumber}`,
      message: `${req.user.name} initiated return of FIM ${inward.fimNumber || inward.passNumber} (${batch.product.name}) to ${inward.customerName}. Awaiting Store Incharge.`,
      targetRole: 'STORE_MANAGER',
      sentById: req.user.id,
    });

    res.status(201).json(outwardGp);
  } catch (error) {
    console.error('FIM send-out error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
