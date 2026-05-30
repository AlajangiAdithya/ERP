// ──────────────────────────────────────────────────────────────
// Work Order — Supply Chain workflow.
//
// Flow:
//   SUPPLY_CHAIN drafts a WO (captures external Supply Order + customer details
//     + PDC + bank guarantee + insurance + scope per RAPS/WO/01 form) →
//   ADMIN accepts (acceptance form) → WO is assigned to a unit →
//   That unit's MANAGER accepts → unit logs qty-wise invoices until delivered.
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

const WO_VIEW_ROLES = ['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY'];
const WO_STATUSES = [
  'PENDING_ADMIN', 'ADMIN_ACCEPTED', 'UNIT_ACCEPTED',
  'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED',
];
const DELIVERY_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PARTIAL', 'DELIVERED', 'DELAYED'];

const WO_INCLUDE = {
  assignedUnit:    { select: { id: true, name: true, code: true } },
  createdBy:       { select: { id: true, name: true, role: true } },
  adminAcceptedBy: { select: { id: true, name: true, role: true } },
  unitAcceptedBy:  { select: { id: true, name: true, role: true } },
  extensions:      { orderBy: { extensionNo: 'asc' } },
  invoices:        { orderBy: { invoiceDate: 'asc' } },
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

// ── POST /api/work-orders — SUPPLY_CHAIN drafts ────────────────
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
          status: 'PENDING_ADMIN',
          createdById: req.user.id,
        },
        include: WO_INCLUDE,
      });
    });

    // Notify all admins that a new WO is awaiting acceptance.
    await prisma.notification.create({
      data: {
        type: 'WORK_ORDER_PENDING_ADMIN',
        title: `Work Order ${created.workOrderNumber} awaiting acceptance`,
        message: `${req.user.name} created a Work Order for ${created.customerName} (Qty ${created.orderQuantity} ${created.orderUnit}, PDC ${new Date(created.pdcDate).toLocaleDateString()}). Please review and accept.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    res.status(201).json(decorate(created));
  } catch (error) {
    console.error('Create work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id — edit (SUPPLY_CHAIN before admin accept) ──
router.patch('/:id', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (req.user.role === 'SUPPLY_CHAIN' && existing.status !== 'PENDING_ADMIN') {
      return res.status(400).json({ error: 'Cannot edit after admin acceptance' });
    }

    const body = req.body || {};
    const data = {};
    const passthrough = [
      'supplyOrderNo', 'supplyOrderDescription', 'customerName', 'customerContact',
      'orderUnit', 'deliveryClause', 'fimDetails', 'inspectionAgency', 'qapNo',
      'drawingsDetails', 'processDrawingsDetails', 'toolingScope', 'packingDetails',
      'transportationDetails', 'majorWorksAtSite', 'projectCoordinator',
      'otherInformation', 'orderTermsAndScope', 'remarks',
      'bankGuaranteeNo', 'insuranceNo', 'ionNumber',
    ];
    for (const f of passthrough) if (body[f] !== undefined) data[f] = body[f] || null;
    if (body.orderQuantity !== undefined) data.orderQuantity = Number(body.orderQuantity);
    if (body.supplyOrderDate) data.supplyOrderDate = new Date(body.supplyOrderDate);
    if (body.pdcDate) data.pdcDate = new Date(body.pdcDate);
    if (body.bankGuaranteeDate !== undefined) {
      data.bankGuaranteeDate = body.bankGuaranteeDate ? new Date(body.bankGuaranteeDate) : null;
    }
    if (body.insuranceDate !== undefined) {
      data.insuranceDate = body.insuranceDate ? new Date(body.insuranceDate) : null;
    }
    if (body.assignedUnitId !== undefined) {
      if (body.assignedUnitId) {
        const u = await prisma.unit.findUnique({ where: { id: body.assignedUnitId } });
        if (!u) return res.status(400).json({ error: 'Assigned unit not found' });
      }
      data.assignedUnitId = body.assignedUnitId || null;
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

// ── POST /api/work-orders/:id/admin-accept — ADMIN ────────────
router.post('/:id/admin-accept', authenticate, authorize('ADMIN'), async (req, res) => {
  try {
    const { accept = true, note, assignedUnitId } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'PENDING_ADMIN') {
      return res.status(400).json({ error: 'Work order is not awaiting admin acceptance' });
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

    // Notify the assigned unit's managers + the creator.
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
router.post('/:id/unit-accept', authenticate, authorize('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { note } = req.body || {};
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status !== 'ADMIN_ACCEPTED') {
      return res.status(400).json({ error: 'Work order is not awaiting unit acceptance' });
    }
    if (req.user.role === 'MANAGER' && existing.assignedUnitId !== req.user.unitId) {
      return res.status(403).json({ error: 'Not your unit' });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: 'UNIT_ACCEPTED',
        unitAcceptedAt: new Date(),
        unitAcceptedById: req.user.id,
        unitAcceptanceNote: note || null,
      },
      include: WO_INCLUDE,
    });

    await prisma.notification.create({
      data: {
        type: 'WORK_ORDER_UNIT_ACCEPTED',
        title: `WO ${updated.workOrderNumber} accepted by unit`,
        message: `${req.user.name} accepted Work Order ${updated.workOrderNumber} on behalf of the assigned unit.`,
        targetUserId: existing.createdById,
        sentById: req.user.id,
      },
    });

    res.json(decorate(updated));
  } catch (error) {
    console.error('Unit accept WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/extensions — log a PDC extension ────────
router.post('/:id/extensions', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { newPdcDate, reason } = req.body || {};
    if (!newPdcDate) return res.status(400).json({ error: 'newPdcDate is required' });

    const existing = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: { extensions: { orderBy: { extensionNo: 'desc' }, take: 1 } },
    });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (['CANCELLED', 'REJECTED'].includes(existing.status)) {
      return res.status(400).json({ error: 'Cannot extend a cancelled/rejected work order' });
    }

    const nextNo = (existing.extensions[0]?.extensionNo || 0) + 1;
    const ext = await prisma.workOrderExtension.create({
      data: {
        workOrderId: existing.id,
        extensionNo: nextNo,
        newPdcDate: new Date(newPdcDate),
        reason: reason || null,
        grantedById: req.user.id,
      },
    });

    res.status(201).json(ext);
  } catch (error) {
    console.error('Add WO extension error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/invoices — log qty-wise invoice ─────────
// Manager of the assigned unit (or SUPPLY_CHAIN/ADMIN) records each invoice.
router.post('/:id/invoices', authenticate, authorize('MANAGER', 'SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
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
