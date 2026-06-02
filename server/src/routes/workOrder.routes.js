// ──────────────────────────────────────────────────────────────
// Work Order — Supply Chain workflow.
//
// Flow:
//   SUPPLY_CHAIN logs the external Supply Order (status = ORDER_REVIEW) →
//   SUPPLY_CHAIN reviews + approves (status = PENDING_ADMIN) →
//   ADMIN accepts (acceptance form) → WO is assigned to a unit →
//   That unit's MANAGER accepts → unit logs qty-wise invoices until delivered.
//
// Field-level permissions (per client direction):
//   - Bank Guarantee + Insurance       : ACCOUNTING or SUPPLY_CHAIN (ADMIN always)
//   - Delivery Details                 : SUPPLY_CHAIN or ACCOUNTING (ADMIN always)
//   - PDC extensions                   : SUPPLY_CHAIN + assigned-unit MANAGER
//     • Every PDC extension MUST also extend the BG (bankGuaranteeExtendedUpto)
//   - Remarks                          : any role with view access (PATCH /:id/remarks)
//
// PDC extensions are appended as a numbered log; the latest extension's
// newPdcDate is the *effective* PDC used for on-time computation.
// On-time % = (#WOs completed on/before effective PDC) / (#completed) × 100.
// ──────────────────────────────────────────────────────────────

const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { closureDocUpload, publicUrlFor } = require('../middleware/upload');
const {
  generateSequentialNumber, paginate, applyDateFilter, withDocRetry,
} = require('../utils/helpers');

const router = express.Router();

// ── Closure workflow constants ──────────────────────────────────────
// Level-5 management — only these usernames are permitted to sign off the
// management-approval step of a Work Order closure.
const L5_USERNAMES = ['sureshbabu', 'rameshbabu', 'madhubabu'];

// 48-hour SLA window that starts when Finance clicks "Mark Customer Contacted".
const SLA_WINDOW_MS = 48 * 60 * 60 * 1000;

// Required documents the unit head must upload before submitting for QC.
const REQUIRED_UNIT_DOC_TYPES = [
  'WORK_COMPLETION_REPORT',
  'TEST_REPORT',
  'DISPATCH_CHECKLIST',
];


// FINANCE + QC included so the closure-workflow UI can fetch WO details for their stages.
const WO_VIEW_ROLES = ['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY', 'ACCOUNTING', 'FINANCE', 'QC'];
const WO_STATUSES = [
  'ORDER_REVIEW', 'PENDING_ADMIN', 'ADMIN_ACCEPTED', 'UNIT_ACCEPTED',
  'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED', 'ON_HOLD',
];
const DELIVERY_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PARTIAL', 'DELIVERED', 'DELAYED'];

const WO_INCLUDE = {
  assignedUnit:               { select: { id: true, name: true, code: true } },
  createdBy:                  { select: { id: true, name: true, role: true } },
  orderReviewedBy:            { select: { id: true, name: true, role: true } },
  orderApprovedBy:            { select: { id: true, name: true, role: true } },
  adminAcceptedBy:            { select: { id: true, name: true, role: true } },
  unitAcceptedBy:             { select: { id: true, name: true, role: true } },
  deliveryDetailsUpdatedBy:   { select: { id: true, name: true, role: true } },
  extensions:                 { orderBy: { extensionNo: 'asc' } },
  invoices:                   { orderBy: { invoiceDate: 'asc' } },
  closureDocs:                { orderBy: { uploadedAt: 'asc' }, include: { uploadedBy: { select: { id: true, name: true, role: true } } } },
  holdRequests:               { orderBy: { raisedAt: 'asc' },   include: {
    raisedBy:   { select: { id: true, name: true, role: true } },
    resolvedBy: { select: { id: true, name: true, role: true } },
  } },
  bills:                      { orderBy: { createdAt: 'asc' },  include: { createdBy: { select: { id: true, name: true, role: true } } } },
  unitDocsSubmittedBy:        { select: { id: true, name: true, role: true } },
  qcVerifiedBy:               { select: { id: true, name: true, role: true } },
  mgmtApprovedBy:             { select: { id: true, name: true, role: true } },
  financeReviewedBy:          { select: { id: true, name: true, role: true } },
  billCreatedBy:              { select: { id: true, name: true, role: true } },
  pdcClearedBy:               { select: { id: true, name: true, role: true } },
  customerContactedBy:        { select: { id: true, name: true, role: true } },
  accountsClosedBy:           { select: { id: true, name: true, role: true } },
};

// Effective PDC = latest extension if any, else original pdcDate.
const effectivePdc = (wo) => {
  const last = wo.extensions?.length ? wo.extensions[wo.extensions.length - 1] : null;
  return last ? last.newPdcDate : wo.pdcDate;
};

// Decorate a single WO with computed fields.
const decorate = (wo) => {
  if (!wo) return wo;
  const pdc = effectivePdc(wo);
  const completed = wo.completedAt ? new Date(wo.completedAt) : null;
  const isCompleted = wo.status === 'COMPLETED' || wo.status === 'CLOSED';
  const onTime = completed && pdc ? completed <= new Date(pdc) : null;
  const daysToPdc = pdc
    ? Math.ceil((new Date(pdc) - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  const overdue = !isCompleted && pdc && new Date() > new Date(pdc);
  return {
    ...wo,
    effectivePdcDate: pdc,
    onTime,
    daysToPdc,
    overdue,
  };
};

// Aggregate on-time % across a list of WOs.
const computeOnTimeStats = (workOrders) => {
  const completedList = workOrders.filter((w) => w.status === 'COMPLETED' || w.status === 'CLOSED');
  if (!completedList.length) return { completedCount: 0, onTimeCount: 0, onTimePercent: null };
  const onTimeCount = completedList.filter((w) => w.onTime === true).length;
  return {
    completedCount: completedList.length,
    onTimeCount,
    onTimePercent: Math.round((onTimeCount / completedList.length) * 1000) / 10,
  };
};

// ── GET /api/work-orders ──────────────────────────────────────
router.get('/', authenticate, authorize(...WO_VIEW_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate, unitId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    applyDateFilter(where, { fromDate, toDate });
    if (status && WO_STATUSES.includes(status)) where.status = status;
    if (unitId) where.assignedUnitId = unitId;

    // MANAGER sees WOs assigned to their unit only.
    if (req.user.role === 'MANAGER') {
      where.assignedUnitId = req.user.unitId;
    }
    // SUPPLY_CHAIN, ADMIN, SAFETY: see all.

    const [rows, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: WO_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip, take,
      }),
      prisma.workOrder.count({ where }),
    ]);

    const workOrders = rows.map(decorate);
    const stats = computeOnTimeStats(workOrders);

    res.json({
      workOrders,
      total,
      page: Math.ceil(skip / take) + 1,
      totalPages: Math.ceil(total / take),
      stats,
    });
  } catch (error) {
    console.error('List work orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/work-orders/:id ──────────────────────────────────
router.get('/:id', authenticate, authorize(...WO_VIEW_ROLES), async (req, res) => {
  try {
    const wo = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: WO_INCLUDE,
    });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    if (req.user.role === 'MANAGER' && wo.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your work order' });
    }
    res.json(decorate(wo));
  } catch (error) {
    console.error('Get work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders — SUPPLY_CHAIN logs supply order ──────
// Lands in ORDER_REVIEW. The Supply Chain team then runs through review +
// approval to generate the internal Work Order.
router.post('/', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const body = req.body || {};
    const required = ['supplyOrderNo', 'supplyOrderDate', 'customerName', 'orderQuantity', 'pdcDate'];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === '') {
        return res.status(400).json({ error: `${f} is required` });
      }
    }

    let assignedUnitId = body.assignedUnitId || null;
    if (assignedUnitId) {
      const unit = await prisma.unit.findUnique({ where: { id: assignedUnitId } });
      if (!unit) return res.status(400).json({ error: 'Assigned unit not found' });
    }

    const created = await withDocRetry(async () => {
      const workOrderNumber = await generateSequentialNumber(prisma, 'WO');
      return prisma.workOrder.create({
        data: {
          workOrderNumber,
          ionNumber: body.ionNumber || null,
          supplyOrderNo: String(body.supplyOrderNo).trim(),
          supplyOrderDate: new Date(body.supplyOrderDate),
          supplyOrderDescription: body.supplyOrderDescription || null,
          nomenclature: body.nomenclature || null,
          customerName: String(body.customerName).trim(),
          customerContact: body.customerContact || null,
          orderQuantity: Number(body.orderQuantity),
          orderUnit: body.orderUnit || 'Nos',
          pdcDate: new Date(body.pdcDate),
          deliveryClause: body.deliveryClause || null,
          fimDetails: body.fimDetails || null,
          inspectionAgency: body.inspectionAgency || null,
          qapNo: body.qapNo || null,
          drawingsDetails: body.drawingsDetails || null,
          processDrawingsDetails: body.processDrawingsDetails || null,
          toolingScope: body.toolingScope || null,
          packingDetails: body.packingDetails || null,
          transportationDetails: body.transportationDetails || null,
          majorWorksAtSite: body.majorWorksAtSite || null,
          projectCoordinator: body.projectCoordinator || null,
          otherInformation: body.otherInformation || null,
          orderTermsAndScope: body.orderTermsAndScope || null,
          remarks: body.remarks || null,
          bankGuaranteeNo: body.bankGuaranteeNo || null,
          bankGuaranteeDate: body.bankGuaranteeDate ? new Date(body.bankGuaranteeDate) : null,
          insuranceNo: body.insuranceNo || null,
          insuranceDate: body.insuranceDate ? new Date(body.insuranceDate) : null,
          assignedUnitId,
          status: 'ORDER_REVIEW',
          createdById: req.user.id,
        },
        include: WO_INCLUDE,
      });
    });

    // Notify the Supply Chain team that an order is awaiting review/approval.
    await prisma.notification.create({
      data: {
        type: 'WORK_ORDER_PENDING_REVIEW',
        title: `Order ${created.supplyOrderNo} awaiting review`,
        message: `${req.user.name} logged supply order ${created.supplyOrderNo} for ${created.customerName} (Qty ${created.orderQuantity} ${created.orderUnit}, PDC ${new Date(created.pdcDate).toLocaleDateString()}). Generate the order review form and approve.`,
        targetRole: 'SUPPLY_CHAIN',
        sentById: req.user.id,
      },
    });

    res.status(201).json(decorate(created));
  } catch (error) {
    console.error('Create work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id — edit (before admin acceptance) ──
// ACCOUNTING can hit this endpoint but only to set BG/Insurance fields.
router.patch('/:id', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN', 'ACCOUNTING'), async (req, res) => {
  try {
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });

    const body = req.body || {};
    const data = {};

    // SUPPLY_CHAIN can edit the bulk of the WO while it's still in
    // ORDER_REVIEW or PENDING_ADMIN. After admin acceptance only the
    // BG/Insurance + delivery + remarks endpoints (or ADMIN) can touch it.
    const canEditCore = req.user.role === 'ADMIN'
      || (req.user.role === 'SUPPLY_CHAIN' && ['ORDER_REVIEW', 'PENDING_ADMIN'].includes(existing.status));

    if (canEditCore) {
      const passthrough = [
        'supplyOrderNo', 'supplyOrderDescription', 'nomenclature',
        'customerName', 'customerContact',
        'orderUnit', 'deliveryClause', 'fimDetails', 'inspectionAgency', 'qapNo',
        'drawingsDetails', 'processDrawingsDetails', 'toolingScope', 'packingDetails',
        'transportationDetails', 'majorWorksAtSite', 'projectCoordinator',
        'otherInformation', 'orderTermsAndScope', 'ionNumber',
      ];
      for (const f of passthrough) if (body[f] !== undefined) data[f] = body[f] || null;
      if (body.orderQuantity !== undefined) data.orderQuantity = Number(body.orderQuantity);
      if (body.supplyOrderDate) data.supplyOrderDate = new Date(body.supplyOrderDate);
      if (body.pdcDate) data.pdcDate = new Date(body.pdcDate);
      if (body.assignedUnitId !== undefined) {
        if (body.assignedUnitId) {
          const u = await prisma.unit.findUnique({ where: { id: body.assignedUnitId } });
          if (!u) return res.status(400).json({ error: 'Assigned unit not found' });
        }
        data.assignedUnitId = body.assignedUnitId || null;
      }
    }

    // BG / Insurance — Accounts or Supply Chain (ADMIN always).
    const canEditBgInsurance = ['SUPPLY_CHAIN', 'ADMIN', 'ACCOUNTING'].includes(req.user.role);
    if (canEditBgInsurance) {
      if (body.bankGuaranteeNo !== undefined) data.bankGuaranteeNo = body.bankGuaranteeNo || null;
      if (body.bankGuaranteeDate !== undefined) {
        data.bankGuaranteeDate = body.bankGuaranteeDate ? new Date(body.bankGuaranteeDate) : null;
      }
      if (body.insuranceNo !== undefined) data.insuranceNo = body.insuranceNo || null;
      if (body.insuranceDate !== undefined) {
        data.insuranceDate = body.insuranceDate ? new Date(body.insuranceDate) : null;
      }
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'No editable fields supplied for your role/status' });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data,
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Update work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/review — Supply Chain marks review form filled ──
// Captures the "order review form" step. Status stays ORDER_REVIEW; approval
// is a separate step so two different SC users can review then approve.
router.post('/:id/review', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { note } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'ORDER_REVIEW') {
      return res.status(400).json({ error: 'Order is not in review state' });
    }
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        orderReviewedAt: new Date(),
        orderReviewedById: req.user.id,
        orderReviewNote: note || null,
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Review WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/approve — Supply Chain approves; moves to PENDING_ADMIN ──
router.post('/:id/approve', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { note } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'ORDER_REVIEW') {
      return res.status(400).json({ error: 'Order is not in review state' });
    }
    if (!existing.orderReviewedAt) {
      return res.status(400).json({ error: 'Review must be completed before approval' });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: 'PENDING_ADMIN',
        orderApprovedAt: new Date(),
        orderApprovedById: req.user.id,
        orderApprovalNote: note || null,
      },
      include: WO_INCLUDE,
    });

    await prisma.notification.create({
      data: {
        type: 'WORK_ORDER_PENDING_ADMIN',
        title: `Work Order ${updated.workOrderNumber} awaiting acceptance`,
        message: `${req.user.name} approved order ${updated.supplyOrderNo} (${updated.customerName}, Qty ${updated.orderQuantity} ${updated.orderUnit}, PDC ${new Date(updated.pdcDate).toLocaleDateString()}). Please review and accept.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    res.json(decorate(updated));
  } catch (error) {
    console.error('Approve WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/admin-accept — ADMIN ────────────
router.post('/:id/admin-accept', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { accept = true, note, assignedUnitId } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'PENDING_ADMIN') {
      return res.status(400).json({ error: 'Work order is not awaiting admin acceptance. Use reassign for on-hold WOs.' });
    }

    let unitId = assignedUnitId || existing.assignedUnitId;
    if (accept) {
      if (!unitId) {
        return res.status(400).json({ error: 'Assign a unit before accepting' });
      }
      const u = await prisma.unit.findUnique({ where: { id: unitId } });
      if (!u) return res.status(400).json({ error: 'Assigned unit not found' });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: accept ? 'ADMIN_ACCEPTED' : 'REJECTED',
        adminAcceptedAt: accept ? new Date() : null,
        adminAcceptedById: accept ? req.user.id : null,
        adminAcceptanceNote: note || null,
        assignedUnitId: accept ? unitId : existing.assignedUnitId,
      },
      include: WO_INCLUDE,
    });

    if (accept && unitId) {
      await prisma.notification.create({
        data: {
          type: 'WORK_ORDER_ASSIGNED_TO_UNIT',
          title: `Work Order ${updated.workOrderNumber} assigned to your unit`,
          message: `Admin accepted WO ${updated.workOrderNumber} (Customer: ${updated.customerName}). Please review and accept to start execution.`,
          targetRole: 'MANAGER',
          sentById: req.user.id,
        },
      });
    }
    await prisma.notification.create({
      data: {
        type: accept ? 'WORK_ORDER_ADMIN_ACCEPTED' : 'WORK_ORDER_REJECTED',
        title: `WO ${updated.workOrderNumber} ${accept ? 'accepted' : 'rejected'}`,
        message: `Admin ${req.user.name} ${accept ? 'accepted' : 'rejected'} Work Order ${updated.workOrderNumber}.`,
        targetUserId: existing.createdById,
        sentById: req.user.id,
      },
    });

    res.json(decorate(updated));
  } catch (error) {
    console.error('Admin accept WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/unit-accept — MANAGER of assigned unit ──
router.post('/:id/unit-accept', authenticate, authorize('MANAGER'), async (req, res) => {
  try {
    const { accept = true, note } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'ADMIN_ACCEPTED') {
      return res.status(400).json({ error: 'Work order is not awaiting unit acceptance' });
    }
    if (existing.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: accept
        ? {
            status: 'UNIT_ACCEPTED',
            unitAcceptedAt: new Date(),
            unitAcceptedById: req.user.id,
            unitAcceptanceNote: note || null,
          }
        : {
            status: 'ON_HOLD',
            unitAcceptedAt: null,
            unitAcceptedById: null,
            unitAcceptanceNote: note || 'Rejected by unit',
          },
      include: WO_INCLUDE,
    });

    if (accept) {
      await prisma.notification.create({
        data: {
          type: 'WORK_ORDER_UNIT_ACCEPTED',
          title: `WO ${updated.workOrderNumber} accepted by unit`,
          message: `${req.user.name} accepted Work Order ${updated.workOrderNumber}.`,
          targetUserId: existing.createdById,
          sentById: req.user.id,
        },
      });
    } else {
      await prisma.notification.createMany({
        data: [
          {
            type: 'WORK_ORDER_UNIT_REJECTED',
            title: `WO ${updated.workOrderNumber} on hold — unit rejected`,
            message: `${req.user.name} rejected Work Order ${updated.workOrderNumber}${note ? `: ${note}` : ''}. Reassign to another unit.`,
            targetUserId: existing.createdById,
            sentById: req.user.id,
          },
          {
            type: 'WORK_ORDER_UNIT_REJECTED',
            title: `WO ${updated.workOrderNumber} on hold — unit rejected`,
            message: `${req.user.name} rejected Work Order ${updated.workOrderNumber}${note ? `: ${note}` : ''}. Reassign to another unit.`,
            targetRole: 'ADMIN',
            sentById: req.user.id,
          },
        ],
      });
    }

    res.json(decorate(updated));
  } catch (error) {
    console.error('Unit accept WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/reassign — SUPPLY_CHAIN/ADMIN ───
router.post('/:id/reassign', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { assignedUnitId, note } = req.body || {};
    if (!assignedUnitId) return res.status(400).json({ error: 'assignedUnitId is required' });

    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'ON_HOLD') {
      return res.status(400).json({ error: 'Work order is not on hold' });
    }

    const unit = await prisma.unit.findUnique({ where: { id: assignedUnitId } });
    if (!unit) return res.status(400).json({ error: 'Assigned unit not found' });

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        assignedUnitId,
        status: 'ADMIN_ACCEPTED',
        unitAcceptedAt: null,
        unitAcceptedById: null,
        unitAcceptanceNote: null,
        adminAcceptanceNote: note
          ? `${existing.adminAcceptanceNote ? existing.adminAcceptanceNote + '\n' : ''}Reassigned to ${unit.name}: ${note}`
          : existing.adminAcceptanceNote,
      },
      include: WO_INCLUDE,
    });

    await prisma.notification.create({
      data: {
        type: 'WORK_ORDER_ASSIGNED_TO_UNIT',
        title: `Work Order ${updated.workOrderNumber} reassigned to your unit`,
        message: `${req.user.name} reassigned WO ${updated.workOrderNumber} (Customer: ${updated.customerName}). Please review and accept.`,
        targetRole: 'MANAGER',
        sentById: req.user.id,
      },
    });

    res.json(decorate(updated));
  } catch (error) {
    console.error('Reassign WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/extensions — log a PDC extension ────────
// Open to SUPPLY_CHAIN and the concerned unit MANAGER. PDC extension MUST
// carry a bankGuaranteeExtendedUpto date — the BG always extends with the PDC.
router.post('/:id/extensions', authenticate, authorize('SUPPLY_CHAIN', 'MANAGER'), async (req, res) => {
  try {
    const {
      newPdcDate, reason, bankGuaranteeExtendedUpto,
      requestLetterStatus, prcStatus,
    } = req.body || {};
    if (!newPdcDate) return res.status(400).json({ error: 'newPdcDate is required' });
    if (!bankGuaranteeExtendedUpto) {
      return res.status(400).json({
        error: 'bankGuaranteeExtendedUpto is required — Bank Guarantee must be extended whenever PDC is extended',
      });
    }

    const existing = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: { extensions: { orderBy: { extensionNo: 'desc' }, take: 1 } },
    });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && existing.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    if (['CANCELLED', 'REJECTED', 'ORDER_REVIEW'].includes(existing.status)) {
      return res.status(400).json({ error: 'Cannot extend a cancelled/rejected/in-review work order' });
    }

    const nextNo = (existing.extensions[0]?.extensionNo || 0) + 1;
    const ext = await prisma.workOrderExtension.create({
      data: {
        workOrderId: existing.id,
        extensionNo: nextNo,
        newPdcDate: new Date(newPdcDate),
        reason: reason || null,
        bankGuaranteeExtendedUpto: new Date(bankGuaranteeExtendedUpto),
        requestLetterStatus: requestLetterStatus || null,
        prcStatus: prcStatus || null,
        grantedById: req.user.id,
      },
    });

    res.status(201).json(ext);
  } catch (error) {
    console.error('Add WO extension error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id/extensions/:extId — update extension fields ─
// SUPPLY_CHAIN / assigned MANAGER can update request-letter and PRC statuses
// as they progress through the approvals.
router.patch('/:id/extensions/:extId', authenticate, authorize('SUPPLY_CHAIN', 'MANAGER'), async (req, res) => {
  try {
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && wo.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    const body = req.body || {};
    const data = {};
    if (body.requestLetterStatus !== undefined) data.requestLetterStatus = body.requestLetterStatus || null;
    if (body.prcStatus !== undefined) data.prcStatus = body.prcStatus || null;
    if (body.bankGuaranteeExtendedUpto !== undefined) {
      data.bankGuaranteeExtendedUpto = body.bankGuaranteeExtendedUpto
        ? new Date(body.bankGuaranteeExtendedUpto)
        : null;
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'No editable fields supplied' });
    const ext = await prisma.workOrderExtension.update({
      where: { id: req.params.extId },
      data,
    });
    res.json(ext);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Extension not found' });
    console.error('Update WO extension error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/work-orders/:id/delivery-details — SUPPLY_CHAIN or ACCOUNTING ──
router.put('/:id/delivery-details', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN', 'ACCOUNTING'), async (req, res) => {
  try {
    const { deliveryDetails } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        deliveryDetails: deliveryDetails || null,
        deliveryDetailsUpdatedAt: new Date(),
        deliveryDetailsUpdatedById: req.user.id,
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Update delivery details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id/remarks — anybody who can see the WO can edit ──
// Per client direction: "In remarks - any body can write anything."
router.patch('/:id/remarks', authenticate, authorize(...WO_VIEW_ROLES), async (req, res) => {
  try {
    const { remarks } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && existing.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: { remarks: remarks || null },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Update WO remarks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/invoices — log qty-wise invoice ─────────
router.post('/:id/invoices', authenticate, authorize('MANAGER', 'SUPPLY_CHAIN'), async (req, res) => {
  try {
    const { invoiceNo, invoiceDate, quantity, amount, remarks } = req.body || {};
    if (!invoiceNo || !invoiceDate || quantity === undefined) {
      return res.status(400).json({ error: 'invoiceNo, invoiceDate and quantity are required' });
    }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'quantity must be > 0' });
    }

    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && existing.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    if (!['UNIT_ACCEPTED', 'IN_PROGRESS', 'ADMIN_ACCEPTED'].includes(existing.status)) {
      return res.status(400).json({ error: 'Work order is not in an executable state' });
    }

    const newDelivered = existing.deliveredQty + qty;
    const newInvoiced = existing.invoicedQty + qty;
    const newAmount = existing.invoicedAmount + (Number(amount) || 0);
    const fullyDone = newDelivered >= existing.orderQuantity;

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.workOrderInvoice.create({
        data: {
          workOrderId: existing.id,
          invoiceNo: String(invoiceNo).trim(),
          invoiceDate: new Date(invoiceDate),
          quantity: qty,
          amount: amount != null ? Number(amount) : null,
          remarks: remarks || null,
          createdById: req.user.id,
        },
      });

      const wo = await tx.workOrder.update({
        where: { id: existing.id },
        data: {
          deliveredQty: newDelivered,
          invoicedQty: newInvoiced,
          invoicedAmount: newAmount,
          status: fullyDone ? 'COMPLETED' : 'IN_PROGRESS',
          deliveryStatus: fullyDone ? 'DELIVERED' : 'PARTIAL',
          completedAt: fullyDone ? new Date() : null,
        },
        include: WO_INCLUDE,
      });

      return { invoice, workOrder: wo };
    });

    res.status(201).json({
      invoice: result.invoice,
      workOrder: decorate(result.workOrder),
    });
  } catch (error) {
    console.error('Log WO invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/close — manual close ────────────────────
router.post('/:id/close', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Already closed/cancelled' });
    }
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        completedAt: existing.completedAt || new Date(),
        remarks: reason ? `${existing.remarks ? existing.remarks + '\n' : ''}Closed: ${reason}` : existing.remarks,
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Close WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/cancel ──────────────────────────────────
router.post('/:id/cancel', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: 'CANCELLED',
        remarks: reason ? `${reason}` : 'Cancelled',
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Work order not found' });
    console.error('Cancel WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/work-orders/:id/delivery-status — manual override ────────
router.put('/:id/delivery-status', authenticate, authorize('MANAGER', 'SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { deliveryStatus } = req.body || {};
    if (!DELIVERY_STATUSES.includes(deliveryStatus)) {
      return res.status(400).json({ error: 'Invalid deliveryStatus' });
    }
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && existing.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: { deliveryStatus },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Set delivery status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════
// CLOSURE WORKFLOW
// Runs after a WO reaches COMPLETED. Unit head submits docs → QC verifies →
// Mgmt L5 approves → Finance bills (or sends ON_HOLD) → PDC clearance →
// "Mark Customer Contacted" starts the 48h SLA → Accounts logs receipt.
// ════════════════════════════════════════════════════════════════════

const isL5 = (user) => user.role === 'ADMIN' && L5_USERNAMES.includes(user.username);

const notifyL5AndStakeholders = async (woNumber, title, message, sentById) => {
  const rows = [];
  for (const username of L5_USERNAMES) {
    const u = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (u) rows.push({ type: 'WO_CLOSURE_UPDATE', title, message, targetUserId: u.id, sentById });
  }
  for (const role of ['FINANCE', 'QC', 'ACCOUNTING']) {
    rows.push({ type: 'WO_CLOSURE_UPDATE', title, message, targetRole: role, sentById });
  }
  if (rows.length) await prisma.notification.createMany({ data: rows });
};

// ── POST /api/work-orders/:id/closure/start — unit head opens the closure ──
router.post('/:id/closure/start', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && wo.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    if (!['COMPLETED', 'CLOSED'].includes(wo.status)) {
      return res.status(400).json({ error: 'Closure can only start once the WO is COMPLETED' });
    }
    if (wo.closureStage !== 'NOT_STARTED') {
      return res.status(400).json({ error: `Closure already at stage ${wo.closureStage}` });
    }
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: { closureStage: 'UNIT_DOCS_PENDING', closureStartedAt: new Date() },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure start error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/docs — unit/QC/finance/accounts upload ──
router.post(
  '/:id/closure/docs',
  authenticate,
  authorize('MANAGER', 'QC', 'FINANCE', 'ACCOUNTING', 'ADMIN'),
  closureDocUpload.single('file'),
  async (req, res) => {
    try {
      const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
      if (!wo) return res.status(404).json({ error: 'Work order not found' });
      if (req.user.role === 'MANAGER' && wo.assignedUnitId !== req.user.unitId) {
        return res.status(403).json({ error: 'Not your unit' });
      }
      const { docType, note } = req.body || {};
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      if (!docType) return res.status(400).json({ error: 'docType is required' });
      const doc = await prisma.workOrderClosureDoc.create({
        data: {
          workOrderId: wo.id,
          docType,
          fileUrl: publicUrlFor('wo-closure', req.file.filename),
          fileName: req.file.originalname || req.file.filename,
          stage: wo.closureStage,
          uploadedById: req.user.id,
          note: note || null,
        },
        include: { uploadedBy: { select: { id: true, name: true, role: true } } },
      });
      res.status(201).json(doc);
    } catch (error) {
      console.error('Closure doc upload error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── DELETE /api/work-orders/:id/closure/docs/:docId ──
router.delete(
  '/:id/closure/docs/:docId',
  authenticate,
  authorize('MANAGER', 'QC', 'FINANCE', 'ACCOUNTING', 'ADMIN'),
  async (req, res) => {
    try {
      const doc = await prisma.workOrderClosureDoc.findUnique({ where: { id: req.params.docId } });
      if (!doc || doc.workOrderId !== req.params.id) return res.status(404).json({ error: 'Doc not found' });
      // Uploader OR ADMIN can delete; otherwise reject.
      if (doc.uploadedById !== req.user.id && req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'You can only delete docs you uploaded' });
      }
      await prisma.workOrderClosureDoc.delete({ where: { id: doc.id } });
      res.json({ ok: true });
    } catch (error) {
      console.error('Closure doc delete error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST /api/work-orders/:id/closure/submit-to-qc — unit hands over to QC ──
router.post('/:id/closure/submit-to-qc', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const wo = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: { closureDocs: true },
    });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && wo.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    if (wo.closureStage !== 'UNIT_DOCS_PENDING') {
      return res.status(400).json({ error: `Closure must be in UNIT_DOCS_PENDING (currently ${wo.closureStage})` });
    }
    const present = new Set(wo.closureDocs.map((d) => d.docType));
    const missing = REQUIRED_UNIT_DOC_TYPES.filter((t) => !present.has(t));
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required documents', missing });
    }
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        unitDocsSubmittedAt: new Date(),
        unitDocsSubmittedById: req.user.id,
      },
      include: WO_INCLUDE,
    });
    await prisma.notification.create({
      data: {
        type: 'WO_CLOSURE_QC_PENDING',
        title: `WO ${wo.workOrderNumber} — QC verification pending`,
        message: `${req.user.name} submitted closure docs for WO ${wo.workOrderNumber}. Please verify and issue the QC Verification Certificate.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure submit-to-qc error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/qc-verify — QC signs & forwards to Mgmt ──
router.post('/:id/closure/qc-verify', authenticate, authorize('QC', 'ADMIN'), async (req, res) => {
  try {
    const { certificateUrl, note } = req.body || {};
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (wo.closureStage !== 'UNIT_DOCS_PENDING' || !wo.unitDocsSubmittedAt) {
      return res.status(400).json({ error: 'WO is not awaiting QC verification' });
    }
    const certificateNumber = await withDocRetry(() => generateSequentialNumber(prisma, 'WOQC'));
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        closureStage: 'QC_VERIFIED',
        qcVerifiedAt: new Date(),
        qcVerifiedById: req.user.id,
        qcCertificateNumber: certificateNumber,
        qcCertificateUrl: certificateUrl || null,
      },
      include: WO_INCLUDE,
    });
    // Notify the L5 admins.
    const rows = [];
    for (const username of L5_USERNAMES) {
      const u = await prisma.user.findUnique({ where: { username }, select: { id: true } });
      if (u) {
        rows.push({
          type: 'WO_CLOSURE_MGMT_PENDING',
          title: `WO ${wo.workOrderNumber} — Mgmt approval needed`,
          message: `QC ${req.user.name} issued certificate ${certificateNumber} for WO ${wo.workOrderNumber}${note ? `. Note: ${note}` : ''}. Please review and approve.`,
          targetUserId: u.id,
          sentById: req.user.id,
        });
      }
    }
    if (rows.length) await prisma.notification.createMany({ data: rows });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure qc-verify error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/mgmt-approve — L5 sign-off ──
router.post('/:id/closure/mgmt-approve', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    if (!isL5(req.user)) {
      return res.status(403).json({ error: 'Only Level-5 management can approve closure' });
    }
    const { note } = req.body || {};
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (wo.closureStage !== 'QC_VERIFIED') {
      return res.status(400).json({ error: 'WO is not awaiting management approval' });
    }
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        closureStage: 'MGMT_APPROVED',
        mgmtApprovedAt: new Date(),
        mgmtApprovedById: req.user.id,
        mgmtApprovalNote: note || null,
      },
      include: WO_INCLUDE,
    });
    await prisma.notification.create({
      data: {
        type: 'WO_CLOSURE_FINANCE_PENDING',
        title: `WO ${wo.workOrderNumber} — Finance review pending`,
        message: `${req.user.name} approved closure. Please review and generate the bill, or raise a hold.`,
        targetRole: 'FINANCE',
        sentById: req.user.id,
      },
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure mgmt-approve error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/finance-bill — generate bill ──
router.post('/:id/closure/finance-bill', authenticate, authorize('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { billDate, lineItems, gstAmount, pdcDate, bankGuaranteeNo, remarks, pdfUrl } = req.body || {};
    if (!Array.isArray(lineItems) || !lineItems.length) {
      return res.status(400).json({ error: 'lineItems[] is required' });
    }
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (wo.closureStage !== 'MGMT_APPROVED') {
      return res.status(400).json({ error: 'WO must be MGMT_APPROVED before billing' });
    }
    const cleanItems = lineItems.map((it, idx) => {
      const qty = Number(it.qty || it.quantity || 0);
      const rate = Number(it.rate || 0);
      const amount = it.amount != null ? Number(it.amount) : qty * rate;
      return {
        description: String(it.description || '').trim() || `Item ${idx + 1}`,
        qty, rate, amount,
      };
    });
    const subtotal = cleanItems.reduce((s, it) => s + (it.amount || 0), 0);
    const gst = Number(gstAmount) || 0;
    const total = subtotal + gst;

    const billNumber = await withDocRetry(() => generateSequentialNumber(prisma, 'BILL'));

    const [bill, updated] = await prisma.$transaction([
      prisma.workOrderBill.create({
        data: {
          workOrderId: wo.id,
          billNumber,
          billDate: billDate ? new Date(billDate) : new Date(),
          lineItems: cleanItems,
          subtotal,
          gstAmount: gst,
          total,
          pdcDate: pdcDate ? new Date(pdcDate) : wo.pdcDate,
          bankGuaranteeNo: bankGuaranteeNo || wo.bankGuaranteeNo || null,
          remarks: remarks || null,
          pdfUrl: pdfUrl || null,
          createdById: req.user.id,
        },
      }),
      prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          closureStage: 'BILL_GENERATED',
          financeReviewedAt: new Date(),
          financeReviewedById: req.user.id,
          billGeneratedAt: new Date(),
          billNumber,
          billUrl: pdfUrl || null,
          billCreatedById: req.user.id,
        },
        include: WO_INCLUDE,
      }),
    ]);

    await notifyL5AndStakeholders(
      wo.workOrderNumber,
      `WO ${wo.workOrderNumber} — Bill ${billNumber} generated`,
      `${req.user.name} generated bill ${billNumber} for WO ${wo.workOrderNumber} (Total ₹${total.toFixed(2)}). PDC clearance pending.`,
      req.user.id,
    );

    res.json({ bill, workOrder: decorate(updated) });
  } catch (error) {
    console.error('Closure finance-bill error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/finance-hold — Finance flags missing docs ──
router.post('/:id/closure/finance-hold', authenticate, authorize('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { missingItems, reason } = req.body || {};
    if (!Array.isArray(missingItems) || !missingItems.length) {
      return res.status(400).json({ error: 'missingItems[] is required (each item: { docType, note })' });
    }
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (!['MGMT_APPROVED', 'FINANCE_REVIEW'].includes(wo.closureStage)) {
      return res.status(400).json({ error: 'WO is not at the finance-review stage' });
    }
    const [hold, updated] = await prisma.$transaction([
      prisma.workOrderHoldRequest.create({
        data: {
          workOrderId: wo.id,
          raisedById: req.user.id,
          missingItems,
          reason: reason || null,
        },
        include: { raisedBy: { select: { id: true, name: true, role: true } } },
      }),
      prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          closureStage: 'ON_HOLD',
          financeReviewedAt: new Date(),
          financeReviewedById: req.user.id,
        },
        include: WO_INCLUDE,
      }),
    ]);
    await prisma.notification.create({
      data: {
        type: 'WO_CLOSURE_ON_HOLD',
        title: `WO ${wo.workOrderNumber} — On hold (missing docs)`,
        message: `${req.user.name} flagged missing items for WO ${wo.workOrderNumber}: ${missingItems.map((m) => m.docType).join(', ')}${reason ? `. Reason: ${reason}` : ''}.`,
        targetRole: 'MANAGER',
        sentById: req.user.id,
      },
    });
    res.json({ hold, workOrder: decorate(updated) });
  } catch (error) {
    console.error('Closure finance-hold error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/resolve-hold — unit re-submits ──
router.post('/:id/closure/resolve-hold', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { holdId, note } = req.body || {};
    if (!holdId) return res.status(400).json({ error: 'holdId is required' });
    const hold = await prisma.workOrderHoldRequest.findUnique({ where: { id: holdId } });
    if (!hold || hold.workOrderId !== req.params.id) return res.status(404).json({ error: 'Hold not found' });
    if (hold.resolvedAt) return res.status(400).json({ error: 'Hold already resolved' });
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'MANAGER' && wo.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }
    if (wo.closureStage !== 'ON_HOLD') {
      return res.status(400).json({ error: 'WO is not on hold' });
    }
    const [, updated] = await prisma.$transaction([
      prisma.workOrderHoldRequest.update({
        where: { id: hold.id },
        data: { resolvedAt: new Date(), resolvedById: req.user.id, resolvedNote: note || null },
      }),
      prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          // Re-enter the unit-docs stage so QC + Mgmt re-approve the new submission.
          closureStage: 'UNIT_DOCS_PENDING',
          unitDocsSubmittedAt: null,
          unitDocsSubmittedById: null,
          qcVerifiedAt: null,
          qcVerifiedById: null,
          qcCertificateUrl: null,
          qcCertificateNumber: null,
          mgmtApprovedAt: null,
          mgmtApprovedById: null,
          mgmtApprovalNote: null,
        },
        include: WO_INCLUDE,
      }),
    ]);
    await prisma.notification.create({
      data: {
        type: 'WO_CLOSURE_HOLD_RESOLVED',
        title: `WO ${wo.workOrderNumber} — Hold cleared, re-verification needed`,
        message: `${req.user.name} re-submitted closure docs for WO ${wo.workOrderNumber}. QC + Mgmt re-approval required.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure resolve-hold error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/pdc-clear — Finance confirms PDC ──
router.post('/:id/closure/pdc-clear', authenticate, authorize('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { note } = req.body || {};
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (wo.closureStage !== 'BILL_GENERATED') {
      return res.status(400).json({ error: 'WO must be BILL_GENERATED before PDC clearance' });
    }
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        closureStage: 'PDC_CLEARED',
        pdcClearedAt: new Date(),
        pdcClearedById: req.user.id,
        pdcClearanceNote: note || null,
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure pdc-clear error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/mark-contacted — starts the 48h SLA ──
router.post('/:id/closure/mark-contacted', authenticate, authorize('FINANCE', 'ADMIN'), async (req, res) => {
  try {
    const { note } = req.body || {};
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (wo.closureStage !== 'PDC_CLEARED') {
      return res.status(400).json({ error: 'WO must be PDC_CLEARED before marking customer contacted' });
    }
    const now = new Date();
    const deadline = new Date(now.getTime() + SLA_WINDOW_MS);
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        closureStage: 'CUSTOMER_CONTACTED',
        customerContactedAt: now,
        customerContactedById: req.user.id,
        customerContactNote: note || null,
        slaDeadlineAt: deadline,
        last24hReminderAt: null,
        slaBreachedAt: null,
      },
      include: WO_INCLUDE,
    });
    await notifyL5AndStakeholders(
      wo.workOrderNumber,
      `WO ${wo.workOrderNumber} — Customer contacted, 48h SLA started`,
      `${req.user.name} marked customer contacted at ${now.toLocaleString('en-IN')}. SLA deadline: ${deadline.toLocaleString('en-IN')}.`,
      req.user.id,
    );
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure mark-contacted error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/closure/accounts-log — Accounts logs receipt + closes ──
router.post('/:id/closure/accounts-log', authenticate, authorize('ACCOUNTING', 'ADMIN'), async (req, res) => {
  try {
    const { note, close } = req.body || {};
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    if (!['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'].includes(wo.closureStage)) {
      return res.status(400).json({ error: 'WO is not in the accounts-tracking window' });
    }
    const data = {
      closureStage: close ? 'CLOSURE_COMPLETE' : 'ACCOUNTS_TRACKING',
      accountsReceiptNote: note || wo.accountsReceiptNote,
    };
    if (close) {
      data.accountsClosedAt = new Date();
      data.accountsClosedById = req.user.id;
      data.closureCompletedAt = new Date();
    }
    const updated = await prisma.workOrder.update({
      where: { id: wo.id },
      data,
      include: WO_INCLUDE,
    });
    if (close) {
      await notifyL5AndStakeholders(
        wo.workOrderNumber,
        `WO ${wo.workOrderNumber} — Closure complete`,
        `${req.user.name} logged receipt and closed WO ${wo.workOrderNumber}.`,
        req.user.id,
      );
    }
    res.json(decorate(updated));
  } catch (error) {
    console.error('Closure accounts-log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/work-orders/closure/inbox — role-filtered queue ──
router.get(
  '/closure/inbox',
  authenticate,
  authorize('MANAGER', 'QC', 'FINANCE', 'ACCOUNTING', 'ADMIN'),
  async (req, res) => {
    try {
      const where = {};
      const role = req.user.role;
      if (role === 'MANAGER') {
        where.assignedUnitId = req.user.unitId;
        where.closureStage = { in: ['UNIT_DOCS_PENDING', 'ON_HOLD'] };
      } else if (role === 'QC') {
        where.closureStage = 'UNIT_DOCS_PENDING';
        where.unitDocsSubmittedAt = { not: null };
      } else if (role === 'FINANCE') {
        where.closureStage = { in: ['MGMT_APPROVED', 'BILL_GENERATED'] };
      } else if (role === 'ACCOUNTING') {
        where.closureStage = { in: ['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'] };
      } else if (role === 'ADMIN') {
        if (isL5(req.user)) {
          where.closureStage = { in: ['QC_VERIFIED', 'CUSTOMER_CONTACTED'] };
        }
        // non-L5 ADMIN sees everything in flight
        else {
          where.closureStage = { notIn: ['NOT_STARTED', 'CLOSURE_COMPLETE'] };
        }
      }
      const rows = await prisma.workOrder.findMany({
        where,
        include: WO_INCLUDE,
        orderBy: [{ slaDeadlineAt: 'asc' }, { closureStartedAt: 'asc' }],
        take: 200,
      });
      res.json({ workOrders: rows.map(decorate) });
    } catch (error) {
      console.error('Closure inbox error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── GET /api/work-orders/closure/sla-feed — ticker feed for L5/FINANCE/QC/ACCOUNTING ──
router.get(
  '/closure/sla-feed',
  authenticate,
  authorize('ADMIN', 'FINANCE', 'QC', 'ACCOUNTING'),
  async (req, res) => {
    try {
      const rows = await prisma.workOrder.findMany({
        where: {
          closureStage: { in: ['CUSTOMER_CONTACTED', 'ACCOUNTS_TRACKING'] },
          slaDeadlineAt: { not: null },
        },
        select: {
          id: true, workOrderNumber: true, customerName: true,
          closureStage: true, slaDeadlineAt: true, customerContactedAt: true,
          last24hReminderAt: true, slaBreachedAt: true,
        },
        orderBy: { slaDeadlineAt: 'asc' },
        take: 50,
      });
      const now = Date.now();
      const feed = rows.map((r) => {
        const dl = r.slaDeadlineAt ? new Date(r.slaDeadlineAt).getTime() : null;
        const hoursLeft = dl != null ? Math.round((dl - now) / (1000 * 60 * 60)) : null;
        return {
          ...r,
          hoursLeft,
          breached: dl != null && now > dl,
        };
      });
      res.json({ feed });
    } catch (error) {
      console.error('SLA feed error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

module.exports = router;
