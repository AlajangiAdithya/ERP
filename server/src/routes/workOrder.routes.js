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
const {
  generateSequentialNumber, paginate, applyDateFilter, withDocRetry,
} = require('../utils/helpers');

const router = express.Router();

const WO_VIEW_ROLES = ['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY', 'ACCOUNTING'];
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

module.exports = router;
