// ──────────────────────────────────────────────────────────────
// Work Order — Supply Chain workflow + per-batch closure cycles.
//
// Order flow (no SC review step):
//   SUPPLY_CHAIN logs the external Supply Order → status PENDING_ADMIN
//   (ADMIN notified) → ADMIN accepts (acceptance form) → WO assigned to a unit →
//   That unit's MANAGER accepts → unit logs qty-wise invoices until delivered.
//
// Closure flow (one cycle per delivery batch; multiple cycles can run per WO):
//   Unit head opens a closure cycle for the delivered batch → uploads docs →
//   QC verifies (issues QC Verification Certificate) → ADMIN (L5) approves →
//   FINANCE sends invoice + delivery challan to customer → 48h SLA starts →
//   FINANCE acks customer-signed receipt (stops 48h SLA, starts 45-day window) →
//   ACCOUNTS confirms payment received → cycle CLOSED.
//
// Field-level permissions:
//   - Bank Guarantee + Insurance       : append-only history (BgEntry / InsuranceEntry)
//     editable by SUPPLY_CHAIN / ADMIN only (Accounts may view, not modify)
//   - Delivery Details                 : SUPPLY_CHAIN / ADMIN / ACCOUNTING
//   - PDC date and PDC extensions      : SUPPLY_CHAIN / ADMIN only
//     • Every PDC extension MUST also extend the BG (bankGuaranteeExtendedUpto)
//     • New WOs default BG date = PDC + 2 months when none supplied
//   - 3-month PDC alert                : ADMIN-only acknowledgement with remark
//   - Remarks                          : any role with view access
//   - Closure financial fields (invoice, send, delivery-ack, payment, SLA, breach):
//     hidden from MANAGER / QC; visible only to ADMIN(L5) / FINANCE / ACCOUNTING.
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
// Level-5 management — only these usernames may sign off the mgmt-approve step.
const L5_USERNAMES = ['sureshbabu', 'rameshbabu', 'madhubabu'];

// 48-hour SLA window that starts when Finance sends the invoice.
const SLA_WINDOW_MS = 48 * 60 * 60 * 1000;

// 45-day payment window that starts when Finance acks customer delivery receipt.
const PAYMENT_WINDOW_MS = 45 * 24 * 60 * 60 * 1000;

// 90-day threshold for the admin "3-month before PDC" alert (red blinking button).
const PDC_ALERT_DAYS = 90;

// Default Bank Guarantee validity offset when a WO is created without a BG date:
// BG date = PDC date + 2 months.
const DEFAULT_BG_OFFSET_DAYS = 60;

// Add `days` (calendar days) to a Date and return a new Date.
const addDays = (date, days) => {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
};

// Required docs the unit head must upload before submitting a cycle to QC.
const REQUIRED_UNIT_DOC_TYPES = [
  'WORK_COMPLETION_REPORT',
  'TEST_REPORT',
  'DISPATCH_CHECKLIST',
];

// Roles whose responses must NOT include closure financial data
// (invoice no, send/payment metadata, SLA fields).
const FINANCE_HIDDEN_ROLES = new Set(['MANAGER', 'QC']);

// FINANCE + QC included so the closure-workflow UI can fetch WO details.
const WO_VIEW_ROLES = ['SUPPLY_CHAIN', 'ADMIN', 'MANAGER', 'SAFETY', 'ACCOUNTING', 'FINANCE', 'QC'];
const WO_STATUSES = [
  'PENDING_ADMIN', 'ADMIN_ACCEPTED', 'UNIT_ACCEPTED',
  'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED', 'ON_HOLD',
];
const DELIVERY_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'PARTIAL', 'DELIVERED', 'DELAYED'];

const USER_SELECT = { select: { id: true, name: true, role: true } };

const CLOSURE_INCLUDE = {
  openedBy:            USER_SELECT,
  unitDocsSubmittedBy: USER_SELECT,
  qcVerifiedBy:        USER_SELECT,
  mgmtApprovedBy:      USER_SELECT,
  invoiceSentBy:       USER_SELECT,
  deliveryAckBy:       USER_SELECT,
  paymentReceivedBy:   USER_SELECT,
  docs: {
    orderBy: { uploadedAt: 'asc' },
    include: { uploadedBy: USER_SELECT },
  },
  holdRequests: {
    orderBy: { raisedAt: 'asc' },
    include: { raisedBy: USER_SELECT, resolvedBy: USER_SELECT },
  },
  weeklyFollowups: {
    orderBy: { weekNumber: 'asc' },
    include: { contactedBy: USER_SELECT },
  },
};

const WO_INCLUDE = {
  assignedUnit:             { select: { id: true, name: true, code: true } },
  createdBy:                USER_SELECT,
  adminAcceptedBy:          USER_SELECT,
  unitAcceptedBy:           USER_SELECT,
  deliveryDetailsUpdatedBy: USER_SELECT,
  pdc3MonthAckBy:           USER_SELECT,
  extensions:               { orderBy: { extensionNo: 'asc' }, include: { grantedBy: USER_SELECT } },
  invoices:                 { orderBy: { invoiceDate: 'asc' }, include: { createdBy: USER_SELECT } },
  closures: {
    orderBy: { cycleNumber: 'asc' },
    include: CLOSURE_INCLUDE,
  },
  bgEntries:        { orderBy: { addedAt: 'desc' }, include: { addedBy: USER_SELECT } },
  insuranceEntries: { orderBy: { addedAt: 'desc' }, include: { addedBy: USER_SELECT } },
};

// Strip closure financial fields for MANAGER/QC (only L5/FINANCE/ACCOUNTING see them).
const sanitizeClosuresFor = (closures, user) => {
  if (!Array.isArray(closures)) return closures;
  if (!user || !FINANCE_HIDDEN_ROLES.has(user.role)) return closures;
  return closures.map((c) => ({
    ...c,
    invoiceNumber: null,
    invoiceDate: null,
    invoiceDescription: null,
    invoiceFileUrl: null,
    invoiceSentAt: null,
    invoiceSentById: null,
    invoiceSentBy: null,
    slaDeadlineAt: null,
    last24hReminderAt: null,
    slaBreachedAt: null,
    deliveryAckAt: null,
    deliveryAckById: null,
    deliveryAckBy: null,
    deliveryAckNote: null,
    deliveryAckSignedUrl: null,
    paymentDueAt: null,
    paymentDelayedAt: null,
    lastWeeklyReminderAt: null,
    weeklyFollowups: [],
    paymentReceivedAt: null,
    paymentReceivedById: null,
    paymentReceivedBy: null,
    paymentNote: null,
  }));
};

// Effective PDC = latest extension if any, else original pdcDate.
const effectivePdc = (wo) => {
  const last = wo.extensions?.length ? wo.extensions[wo.extensions.length - 1] : null;
  return last ? last.newPdcDate : wo.pdcDate;
};

// Decorate a single WO with computed fields. If `user` is supplied, strip
// closure financial fields the user is not allowed to see.
const decorate = (wo, user) => {
  if (!wo) return wo;
  const pdc = effectivePdc(wo);
  const completed = wo.completedAt ? new Date(wo.completedAt) : null;
  const isCompleted = wo.status === 'COMPLETED' || wo.status === 'CLOSED';
  const onTime = completed && pdc ? completed <= new Date(pdc) : null;
  const daysToPdc = pdc
    ? Math.ceil((new Date(pdc) - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  const overdue = !isCompleted && pdc && new Date() > new Date(pdc);
  // 3-month-to-PDC alert state. Active when within the 90-day window, WO is
  // still live, and admin has not yet acknowledged. Cleared automatically once
  // ack is recorded — re-arms only if a future PDC extension pushes PDC back
  // beyond 90 days and then back inside again (admin would need to ack again
  // only if we reset the ack-fields; current behaviour keeps the ack sticky).
  const inAlertWindow = daysToPdc != null && daysToPdc > 0 && daysToPdc <= PDC_ALERT_DAYS;
  const woClosed = ['CLOSED', 'CANCELLED', 'REJECTED'].includes(wo.status);
  const pdc3MonthAlertActive = inAlertWindow && !woClosed && !wo.pdc3MonthAckAt;
  const closures = sanitizeClosuresFor(wo.closures, user);
  return {
    ...wo,
    closures,
    effectivePdcDate: pdc,
    onTime,
    daysToPdc,
    overdue,
    pdc3MonthAlertActive,
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

const isL5 = (user) => user.role === 'ADMIN' && L5_USERNAMES.includes(user.username);

// Notify the L5 admins + FINANCE/ACCOUNTING about a closure-cycle event.
// (NOT QC or MANAGER — they shouldn't see invoice/payment chatter.)
const notifyL5Finance = async (title, message, sentById) => {
  const rows = [];
  for (const username of L5_USERNAMES) {
    const u = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (u) rows.push({ type: 'WO_CLOSURE_UPDATE', title, message, targetUserId: u.id, sentById });
  }
  for (const role of ['FINANCE', 'ACCOUNTING']) {
    rows.push({ type: 'WO_CLOSURE_UPDATE', title, message, targetRole: role, sentById });
  }
  if (rows.length) await prisma.notification.createMany({ data: rows });
};

// Guard: the caller may only touch this closure if they own the relevant stage.
// MANAGER must be assigned to the WO's unit.
const ensureClosureAccess = (wo, user) => {
  if (user.role === 'MANAGER' && wo.assignedUnitId !== user.unitId) {
    return 'Not your unit';
  }
  return null;
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

    const [rows, total] = await Promise.all([
      prisma.workOrder.findMany({
        where,
        include: WO_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip, take,
      }),
      prisma.workOrder.count({ where }),
    ]);

    const workOrders = rows.map((w) => decorate(w, req.user));
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

// ── GET /api/work-orders/closure/sla-feed — ticker feed ────────────
// Returns open SLA cycles (INVOICE_SENT, awaiting delivery ack). Visible to
// roles who actually own the delivery-follow-up chain.
router.get(
  '/closure/sla-feed',
  authenticate,
  authorize('ADMIN', 'FINANCE', 'ACCOUNTING'),
  async (req, res) => {
    try {
      const rows = await prisma.workOrderClosure.findMany({
        where: {
          stage: 'INVOICE_SENT',
          slaDeadlineAt: { not: null },
        },
        select: {
          id: true,
          cycleNumber: true,
          stage: true,
          slaDeadlineAt: true,
          invoiceSentAt: true,
          invoiceNumber: true,
          last24hReminderAt: true,
          slaBreachedAt: true,
          workOrder: { select: { id: true, workOrderNumber: true, customerName: true } },
        },
        orderBy: { slaDeadlineAt: 'asc' },
        take: 50,
      });
      const now = Date.now();
      const feed = rows.map((r) => {
        const dl = r.slaDeadlineAt ? new Date(r.slaDeadlineAt).getTime() : null;
        const hoursLeft = dl != null ? Math.round((dl - now) / (1000 * 60 * 60)) : null;
        return { ...r, hoursLeft, breached: dl != null && now > dl };
      });
      res.json({ feed });
    } catch (error) {
      console.error('SLA feed error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── GET /api/work-orders/closure/payment-feed — 45-day window feed ──
// Returns open cycles in DELIVERY_ACKNOWLEDGED stage (45-day payment window).
// Accounting + Admin use this for follow-ups; Finance gets visibility too.
router.get(
  '/closure/payment-feed',
  authenticate,
  authorize('ADMIN', 'FINANCE', 'ACCOUNTING'),
  async (req, res) => {
    try {
      const rows = await prisma.workOrderClosure.findMany({
        where: {
          stage: 'DELIVERY_ACKNOWLEDGED',
          paymentDueAt: { not: null },
        },
        select: {
          id: true,
          cycleNumber: true,
          stage: true,
          deliveryAckAt: true,
          paymentDueAt: true,
          paymentDelayedAt: true,
          lastWeeklyReminderAt: true,
          invoiceNumber: true,
          workOrder: { select: { id: true, workOrderNumber: true, customerName: true } },
          weeklyFollowups: {
            orderBy: { weekNumber: 'desc' },
            take: 1,
            select: { weekNumber: true, contactedAt: true },
          },
        },
        orderBy: { paymentDueAt: 'asc' },
        take: 50,
      });
      const now = Date.now();
      const feed = rows.map((r) => {
        const due = r.paymentDueAt ? new Date(r.paymentDueAt).getTime() : null;
        const daysLeft = due != null ? Math.ceil((due - now) / (1000 * 60 * 60 * 24)) : null;
        const lastFollowup = r.weeklyFollowups?.[0] || null;
        return {
          ...r,
          daysLeft,
          delayed: due != null && now > due,
          lastFollowupWeek: lastFollowup?.weekNumber || 0,
          lastFollowupAt: lastFollowup?.contactedAt || null,
        };
      });
      res.json({ feed });
    } catch (error) {
      console.error('Payment feed error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

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
    res.json(decorate(wo, req.user));
  } catch (error) {
    console.error('Get work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders — SUPPLY_CHAIN logs supply order ──────
// Lands directly in PENDING_ADMIN. No SC review step — ADMIN is notified.
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

    const pdcDate = new Date(body.pdcDate);
    // Default BG date to PDC + 2 months when the SC user did not supply one.
    // (BG runs alongside the order and is normally 2 months past PDC.)
    const bgDate = body.bankGuaranteeDate
      ? new Date(body.bankGuaranteeDate)
      : (body.bankGuaranteeNo ? addDays(pdcDate, DEFAULT_BG_OFFSET_DAYS) : null);

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
          pdcDate,
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
          bankGuaranteeDate: bgDate,
          insuranceNo: body.insuranceNo || null,
          insuranceDate: body.insuranceDate ? new Date(body.insuranceDate) : null,
          assignedUnitId,
          status: 'PENDING_ADMIN',
          createdById: req.user.id,
        },
        include: WO_INCLUDE,
      });
    });

    // Seed BG / Insurance history if either was supplied on creation.
    const seedRows = [];
    if (created.bankGuaranteeNo) {
      seedRows.push(prisma.workOrderBgEntry.create({
        data: {
          workOrderId: created.id,
          bgNo: created.bankGuaranteeNo,
          bgDate: created.bankGuaranteeDate,
          addedById: req.user.id,
        },
      }));
    }
    if (created.insuranceNo) {
      seedRows.push(prisma.workOrderInsuranceEntry.create({
        data: {
          workOrderId: created.id,
          insuranceNo: created.insuranceNo,
          insuranceDate: created.insuranceDate,
          addedById: req.user.id,
        },
      }));
    }
    if (seedRows.length) await Promise.all(seedRows);

    // Notify ADMIN that a new WO is awaiting acceptance.
    await prisma.notification.create({
      data: {
        type: 'WORK_ORDER_PENDING_ADMIN',
        title: `Work Order ${created.workOrderNumber} awaiting acceptance`,
        message: `${req.user.name} logged supply order ${created.supplyOrderNo} for ${created.customerName} (Qty ${created.orderQuantity} ${created.orderUnit}, PDC ${new Date(created.pdcDate).toLocaleDateString()}). Please review and accept.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    // Re-fetch to include the newly created BG/Insurance entries.
    const full = await prisma.workOrder.findUnique({ where: { id: created.id }, include: WO_INCLUDE });
    res.status(201).json(decorate(full, req.user));
  } catch (error) {
    console.error('Create work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id — edit core fields ──
// BG / Insurance are no longer edited here — they go through the history
// endpoints below (POST /:id/bg-entries and POST /:id/insurance-entries).
router.patch('/:id', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });

    const body = req.body || {};
    const data = {};

    // SUPPLY_CHAIN can edit core fields while still PENDING_ADMIN. ADMIN may edit anytime.
    const canEditCore = req.user.role === 'ADMIN'
      || (req.user.role === 'SUPPLY_CHAIN' && existing.status === 'PENDING_ADMIN');

    if (!canEditCore) {
      return res.status(403).json({ error: 'Not allowed to edit this work order at its current status' });
    }

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

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: 'No editable fields supplied' });
    }

    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data,
      include: WO_INCLUDE,
    });
    res.json(decorate(updated, req.user));
  } catch (error) {
    console.error('Update work order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── BG / Insurance history ──────────────────────────────────────────
// Append-only — newest entry becomes the active value on the WO.
// Only SUPPLY_CHAIN (and ADMIN as override) may modify; Accounts can view.
const BG_INS_ROLES = ['SUPPLY_CHAIN', 'ADMIN'];

router.post('/:id/bg-entries', authenticate, authorize(...BG_INS_ROLES), async (req, res) => {
  try {
    const { bgNo, bgDate, validUpto, fileUrl, fileName, note } = req.body || {};
    if (!bgNo) return res.status(400).json({ error: 'bgNo is required' });
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    const entry = await prisma.workOrderBgEntry.create({
      data: {
        workOrderId: wo.id,
        bgNo: String(bgNo).trim(),
        bgDate: bgDate ? new Date(bgDate) : null,
        validUpto: validUpto ? new Date(validUpto) : null,
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        note: note || null,
        addedById: req.user.id,
      },
      include: { addedBy: USER_SELECT },
    });
    // Newest entry → mirror onto the WO's "current" fields.
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        bankGuaranteeNo: entry.bgNo,
        bankGuaranteeDate: entry.bgDate,
      },
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error('Add BG entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/insurance-entries', authenticate, authorize(...BG_INS_ROLES), async (req, res) => {
  try {
    const { insuranceNo, insuranceDate, validUpto, fileUrl, fileName, note } = req.body || {};
    if (!insuranceNo) return res.status(400).json({ error: 'insuranceNo is required' });
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });

    const entry = await prisma.workOrderInsuranceEntry.create({
      data: {
        workOrderId: wo.id,
        insuranceNo: String(insuranceNo).trim(),
        insuranceDate: insuranceDate ? new Date(insuranceDate) : null,
        validUpto: validUpto ? new Date(validUpto) : null,
        fileUrl: fileUrl || null,
        fileName: fileName || null,
        note: note || null,
        addedById: req.user.id,
      },
      include: { addedBy: USER_SELECT },
    });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: {
        insuranceNo: entry.insuranceNo,
        insuranceDate: entry.insuranceDate,
      },
    });
    res.status(201).json(entry);
  } catch (error) {
    console.error('Add Insurance entry error:', error);
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

    res.json(decorate(updated, req.user));
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

    res.json(decorate(updated, req.user));
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

    res.json(decorate(updated, req.user));
  } catch (error) {
    console.error('Reassign WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/extensions — log a PDC extension ────────
// Open ONLY to SUPPLY_CHAIN (and ADMIN as override). Per workflow rules,
// the unit manager can no longer change PDC — only Supply Chain owns the date.
// PDC extension MUST carry a bankGuaranteeExtendedUpto date — the BG always
// extends with the PDC.
router.post('/:id/extensions', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
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
        bankGuaranteeExtendedUpto: new Date(bankGuaranteeExtendedUpto),
        requestLetterStatus: requestLetterStatus || null,
        prcStatus: prcStatus || null,
        grantedById: req.user.id,
      },
      include: { grantedBy: USER_SELECT },
    });

    res.status(201).json(ext);
  } catch (error) {
    console.error('Add WO extension error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id/extensions/:extId — update extension fields ─
router.patch('/:id/extensions/:extId', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const wo = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
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

// ── PUT /api/work-orders/:id/delivery-details ──
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
    res.json(decorate(updated, req.user));
  } catch (error) {
    console.error('Update delivery details error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/work-orders/:id/remarks ──
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
    res.json(decorate(updated, req.user));
  } catch (error) {
    console.error('Update WO remarks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/invoices — qty-wise invoice log (no amount) ─
router.post('/:id/invoices', authenticate, authorize('MANAGER', 'SUPPLY_CHAIN'), async (req, res) => {
  try {
    const { invoiceNo, invoiceDate, quantity, remarks } = req.body || {};
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
    if (newDelivered > existing.orderQuantity) {
      const remaining = Math.max(existing.orderQuantity - existing.deliveredQty, 0);
      return res.status(400).json({
        error: `Invoice qty exceeds remaining (only ${remaining} ${existing.orderUnit} left of ${existing.orderQuantity}).`,
      });
    }
    const fullyDone = newDelivered >= existing.orderQuantity;

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.workOrderInvoice.create({
        data: {
          workOrderId: existing.id,
          invoiceNo: String(invoiceNo).trim(),
          invoiceDate: new Date(invoiceDate),
          quantity: qty,
          remarks: remarks || null,
          createdById: req.user.id,
        },
      });

      const wo = await tx.workOrder.update({
        where: { id: existing.id },
        data: {
          deliveredQty: newDelivered,
          invoicedQty: newInvoiced,
          status: fullyDone ? 'COMPLETED' : 'IN_PROGRESS',
          deliveryStatus: fullyDone ? 'DELIVERED' : 'PARTIAL',
          completedAt: fullyDone ? new Date() : existing.completedAt,
        },
        include: WO_INCLUDE,
      });

      return { invoice, workOrder: wo };
    });

    res.status(201).json({
      invoice: result.invoice,
      workOrder: decorate(result.workOrder, req.user),
    });
  } catch (error) {
    console.error('Log WO invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/close — manual close ──
// Only allowed when every closure cycle is PAYMENT_RECEIVED (or there are
// no cycles at all — e.g. cancelled mid-flight). Accounts-driven payment
// confirmation is the real "this WO is done" signal; this endpoint is a
// safety net for admins.
router.post('/:id/close', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { reason, force } = req.body || {};
    const existing = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: { closures: true },
    });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (existing.status === 'CLOSED' || existing.status === 'CANCELLED') {
      return res.status(400).json({ error: 'Already closed/cancelled' });
    }
    const openCycles = existing.closures.filter((c) => c.stage !== 'PAYMENT_RECEIVED');
    if (openCycles.length) {
      return res.status(400).json({
        error: `Cannot close — ${openCycles.length} closure cycle(s) still open. All cycles must reach PAYMENT_RECEIVED first.`,
      });
    }
    const shortfall = (existing.orderQuantity || 0) - (existing.deliveredQty || 0);
    if (shortfall > 0 && !force) {
      return res.status(400).json({
        error: `Delivered ${existing.deliveredQty} of ${existing.orderQuantity} ${existing.orderUnit}. Pass { force: true, reason } to short-close.`,
        shortfall,
      });
    }
    if (shortfall > 0 && !reason) {
      return res.status(400).json({ error: 'Reason is required when force-closing with shortfall.' });
    }
    const closeStamp = `Closed by ${req.user.name || req.user.username || req.user.id} on ${new Date().toISOString()}${shortfall > 0 ? ` (short-close: -${shortfall} ${existing.orderUnit})` : ''}${reason ? `. Reason: ${reason}` : ''}`;
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: 'CLOSED',
        completedAt: existing.completedAt || new Date(),
        remarks: `${existing.remarks ? existing.remarks + '\n' : ''}${closeStamp}`,
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated, req.user));
  } catch (error) {
    console.error('Close WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/work-orders/:id/cancel ──
// Blocked once finance has signed off on any closure cycle — cancelling after
// an invoice has been sent or payment received would lose audit trail of real
// customer obligations / revenue.
router.post('/:id/cancel', authenticate, authorize('SUPPLY_CHAIN', 'ADMIN'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const existing = await prisma.workOrder.findUnique({
      where: { id: req.params.id },
      include: { closures: { select: { stage: true, cycleNumber: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Work order not found' });
    if (['CLOSED', 'CANCELLED'].includes(existing.status)) {
      return res.status(400).json({ error: `Cannot cancel — WO is already ${existing.status}` });
    }
    const settled = existing.closures.filter((c) =>
      ['INVOICE_SENT', 'PAYMENT_RECEIVED'].includes(c.stage),
    );
    if (settled.length) {
      return res.status(400).json({
        error: `Cannot cancel — ${settled.length} closure cycle(s) past finance sign-off. Resolve through the closure workflow instead.`,
      });
    }
    const updated = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        status: 'CANCELLED',
        remarks: reason
          ? `${existing.remarks ? existing.remarks + '\n' : ''}Cancelled: ${reason}`
          : (existing.remarks || 'Cancelled'),
      },
      include: WO_INCLUDE,
    });
    res.json(decorate(updated, req.user));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ error: 'Work order not found' });
    console.error('Cancel WO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/work-orders/:id/delivery-status — manual override ──
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
    res.json(decorate(updated, req.user));
  } catch (error) {
    console.error('Set delivery status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 3-MONTH PDC ALERT — admin-only acknowledgement
//
// Admins see a red blinking button on any WO whose effective PDC is ≤ 90 days
// away (handled in the decorator). They click it, enter a remark and call this
// endpoint to silence the alert. The ack is sticky — the WO remembers who
// cleared it, when, and the remark. Re-opening only happens if the PDC gets
// pushed beyond 90 days and slides back in (very rare; would need a manual
// re-arm — not auto-handled here).
// ════════════════════════════════════════════════════════════════════

router.post(
  '/:id/pdc-alert/acknowledge',
  authenticate,
  authorize('ADMIN'),
  async (req, res) => {
    try {
      const { note } = req.body || {};
      if (!note || !String(note).trim()) {
        return res.status(400).json({ error: 'Acknowledgement remark is required' });
      }
      const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Work order not found' });
      if (existing.pdc3MonthAckAt) {
        return res.status(400).json({ error: '3-month PDC alert already acknowledged' });
      }
      const updated = await prisma.workOrder.update({
        where: { id: req.params.id },
        data: {
          pdc3MonthAckAt: new Date(),
          pdc3MonthAckById: req.user.id,
          pdc3MonthAckNote: String(note).trim(),
        },
        include: WO_INCLUDE,
      });
      res.json(decorate(updated, req.user));
    } catch (error) {
      console.error('Acknowledge PDC alert error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ════════════════════════════════════════════════════════════════════
// PER-BATCH CLOSURE WORKFLOW
//
// Each closure cycle is one delivery batch. A WO can have many cycles
// running in parallel (e.g. WO for 10 units: batch 1 = 2 units, batch 2 =
// 3 units, each with its own QC → Mgmt → Finance → Accounts chain).
//
// Stages: UNIT_DOCS_PENDING → QC_VERIFIED → MGMT_APPROVED →
//         INVOICE_SENT (48h SLA) → DELIVERY_ACKNOWLEDGED (45-day pay window) →
//         PAYMENT_RECEIVED (cycle CLOSED)
//         (any pre-INVOICE stage can be sent back to ON_HOLD by QC/Finance)
// ════════════════════════════════════════════════════════════════════

// Helper: fetch a closure cycle by id, scoped to the WO id from the route.
const loadClosure = async (workOrderId, closureId) => {
  const closure = await prisma.workOrderClosure.findUnique({
    where: { id: closureId },
    include: { workOrder: true },
  });
  if (!closure || closure.workOrderId !== workOrderId) return null;
  return closure;
};

// ── POST /api/work-orders/:id/closures — open a new cycle for a batch ──
// Triggered when the unit head has delivered a batch and wants to start its
// closure chain. Multiple cycles per WO are allowed.
router.post(
  '/:id/closures',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  async (req, res) => {
    try {
      const { deliveryQty, deliveryNote, deliveredAt } = req.body || {};
      const qty = Number(deliveryQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: 'deliveryQty must be > 0' });
      }
      const wo = await prisma.workOrder.findUnique({
        where: { id: req.params.id },
        include: { closures: { select: { cycleNumber: true, deliveryQty: true } } },
      });
      if (!wo) return res.status(404).json({ error: 'Work order not found' });
      const denied = ensureClosureAccess(wo, req.user);
      if (denied) return res.status(403).json({ error: denied });
      if (!['UNIT_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(wo.status)) {
        return res.status(400).json({
          error: `Cannot open a closure cycle on a WO in status ${wo.status}`,
        });
      }
      const alreadyCovered = wo.closures.reduce((s, c) => s + (c.deliveryQty || 0), 0);
      if (alreadyCovered + qty > wo.orderQuantity) {
        return res.status(400).json({
          error: `Cycle qty exceeds remaining WO qty (already covered ${alreadyCovered} of ${wo.orderQuantity})`,
        });
      }
      const nextCycle = (wo.closures.reduce((m, c) => Math.max(m, c.cycleNumber), 0) || 0) + 1;
      const closure = await prisma.workOrderClosure.create({
        data: {
          workOrderId: wo.id,
          cycleNumber: nextCycle,
          stage: 'UNIT_DOCS_PENDING',
          deliveryQty: qty,
          deliveryNote: deliveryNote || null,
          deliveredAt: deliveredAt ? new Date(deliveredAt) : new Date(),
          openedById: req.user.id,
        },
        include: CLOSURE_INCLUDE,
      });
      res.status(201).json(closure);
    } catch (error) {
      console.error('Open closure cycle error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST /api/work-orders/:id/closures/:closureId/docs — upload a doc ──
router.post(
  '/:id/closures/:closureId/docs',
  authenticate,
  authorize('MANAGER', 'QC', 'FINANCE', 'ACCOUNTING', 'ADMIN'),
  closureDocUpload.single('file'),
  async (req, res) => {
    try {
      const closure = await loadClosure(req.params.id, req.params.closureId);
      if (!closure) return res.status(404).json({ error: 'Closure cycle not found' });
      const denied = ensureClosureAccess(closure.workOrder, req.user);
      if (denied) return res.status(403).json({ error: denied });
      const { docType, note } = req.body || {};
      if (!req.file) return res.status(400).json({ error: 'file is required' });
      if (!docType) return res.status(400).json({ error: 'docType is required' });
      const doc = await prisma.workOrderClosureDoc.create({
        data: {
          closureId: closure.id,
          docType,
          fileUrl: publicUrlFor('wo-closure', req.file.filename),
          fileName: req.file.originalname || req.file.filename,
          stage: closure.stage,
          uploadedById: req.user.id,
          note: note || null,
        },
        include: { uploadedBy: USER_SELECT },
      });
      res.status(201).json(doc);
    } catch (error) {
      console.error('Closure doc upload error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── DELETE /api/work-orders/:id/closures/:closureId/docs/:docId ──
router.delete(
  '/:id/closures/:closureId/docs/:docId',
  authenticate,
  authorize('MANAGER', 'QC', 'FINANCE', 'ACCOUNTING', 'ADMIN'),
  async (req, res) => {
    try {
      const doc = await prisma.workOrderClosureDoc.findUnique({ where: { id: req.params.docId } });
      if (!doc || doc.closureId !== req.params.closureId) return res.status(404).json({ error: 'Doc not found' });
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

// ── POST .../submit-to-qc — unit hands the cycle to QC ──
router.post(
  '/:id/closures/:closureId/submit-to-qc',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  async (req, res) => {
    try {
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true, docs: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      const denied = ensureClosureAccess(closure.workOrder, req.user);
      if (denied) return res.status(403).json({ error: denied });
      if (closure.stage !== 'UNIT_DOCS_PENDING') {
        return res.status(400).json({ error: `Cycle must be UNIT_DOCS_PENDING (currently ${closure.stage})` });
      }
      const present = new Set(closure.docs.map((d) => d.docType));
      const missing = REQUIRED_UNIT_DOC_TYPES.filter((t) => !present.has(t));
      if (missing.length) {
        return res.status(400).json({ error: 'Missing required documents', missing });
      }
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          unitDocsSubmittedAt: new Date(),
          unitDocsSubmittedById: req.user.id,
        },
        include: CLOSURE_INCLUDE,
      });
      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_QC_PENDING',
          title: `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — QC verification pending`,
          message: `${req.user.name} submitted closure docs (cycle #${closure.cycleNumber}, qty ${closure.deliveryQty}). Please verify and issue the QC Verification Certificate.`,
          targetRole: 'QC',
          sentById: req.user.id,
        },
      });
      res.json(updated);
    } catch (error) {
      console.error('Closure submit-to-qc error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../qc-verify — QC issues certificate & forwards to L5 mgmt ──
router.post(
  '/:id/closures/:closureId/qc-verify',
  authenticate,
  authorize('QC', 'ADMIN'),
  async (req, res) => {
    try {
      const { certificateUrl, note } = req.body || {};
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      if (closure.stage !== 'UNIT_DOCS_PENDING' || !closure.unitDocsSubmittedAt) {
        return res.status(400).json({ error: 'Cycle is not awaiting QC verification' });
      }
      const certificateNumber = await withDocRetry(() => generateSequentialNumber(prisma, 'WOQC'));
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'QC_VERIFIED',
          qcVerifiedAt: new Date(),
          qcVerifiedById: req.user.id,
          qcCertificateNumber: certificateNumber,
          qcCertificateUrl: certificateUrl || null,
        },
        include: CLOSURE_INCLUDE,
      });
      const rows = [];
      for (const username of L5_USERNAMES) {
        const u = await prisma.user.findUnique({ where: { username }, select: { id: true } });
        if (u) {
          rows.push({
            type: 'WO_CLOSURE_MGMT_PENDING',
            title: `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — Mgmt approval needed`,
            message: `QC ${req.user.name} issued certificate ${certificateNumber}${note ? `. Note: ${note}` : ''}. Please review and approve.`,
            targetUserId: u.id,
            sentById: req.user.id,
          });
        }
      }
      if (rows.length) await prisma.notification.createMany({ data: rows });
      res.json(updated);
    } catch (error) {
      console.error('Closure qc-verify error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../mgmt-approve — L5 sign-off ──
router.post(
  '/:id/closures/:closureId/mgmt-approve',
  authenticate,
  authorize('ADMIN'),
  async (req, res) => {
    try {
      if (!isL5(req.user)) {
        return res.status(403).json({ error: 'Only Level-5 management can approve closure' });
      }
      const { note } = req.body || {};
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      if (closure.stage !== 'QC_VERIFIED') {
        return res.status(400).json({ error: 'Cycle is not awaiting management approval' });
      }
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'MGMT_APPROVED',
          mgmtApprovedAt: new Date(),
          mgmtApprovedById: req.user.id,
          mgmtApprovalNote: note || null,
        },
        include: CLOSURE_INCLUDE,
      });
      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_FINANCE_PENDING',
          title: `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — Finance action`,
          message: `${req.user.name} approved cycle #${closure.cycleNumber}. Please prepare and send invoice to the customer.`,
          targetRole: 'FINANCE',
          sentById: req.user.id,
        },
      });
      res.json(updated);
    } catch (error) {
      console.error('Closure mgmt-approve error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../send-invoice — Finance marks invoice + delivery challan sent ──
// Starts the 48-hour delivery-ack SLA. Finance dispatches the invoice +
// delivery challan to the customer and clicks "These are sent" — the system
// generates an invoice number, stamps invoiceSentAt and sets slaDeadlineAt.
// The 48h clock is closed when Finance acks the customer-signed receipt
// (POST /delivery-ack), NOT when payment lands.
router.post(
  '/:id/closures/:closureId/send-invoice',
  authenticate,
  authorize('FINANCE', 'ADMIN'),
  async (req, res) => {
    try {
      const { invoiceDate, description, invoiceFileUrl } = req.body || {};
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      if (closure.stage !== 'MGMT_APPROVED') {
        return res.status(400).json({ error: 'Cycle must be MGMT_APPROVED before sending invoice' });
      }
      const invoiceNumber = await withDocRetry(() => generateSequentialNumber(prisma, 'INV'));
      const now = new Date();
      const deadline = new Date(now.getTime() + SLA_WINDOW_MS);
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'INVOICE_SENT',
          invoiceNumber,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : now,
          invoiceDescription: description || null,
          invoiceFileUrl: invoiceFileUrl || null,
          invoiceSentAt: now,
          invoiceSentById: req.user.id,
          slaDeadlineAt: deadline,
          last24hReminderAt: null,
          slaBreachedAt: null,
        },
        include: CLOSURE_INCLUDE,
      });
      await notifyL5Finance(
        `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — Invoice ${invoiceNumber} sent (48h SLA)`,
        `${req.user.name} sent invoice ${invoiceNumber} + delivery challan to ${closure.workOrder.customerName}. Awaiting customer signed receipt — 48h deadline: ${deadline.toLocaleString('en-IN')}.`,
        req.user.id,
      );
      res.json(updated);
    } catch (error) {
      console.error('Closure send-invoice error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../delivery-ack — Finance confirms customer-signed receipt ──
// Customer signs the delivery paper and sends it back; Finance clicks the
// Delivery Ack button. This closes the 48h SLA and opens the 45-day payment
// window monitored by Accounts.
router.post(
  '/:id/closures/:closureId/delivery-ack',
  authenticate,
  authorize('FINANCE', 'ADMIN'),
  async (req, res) => {
    try {
      const { note, signedDocUrl } = req.body || {};
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) {
        return res.status(404).json({ error: 'Closure cycle not found' });
      }
      if (closure.stage !== 'INVOICE_SENT') {
        return res.status(400).json({ error: 'Cycle must be INVOICE_SENT before acking delivery' });
      }
      const now = new Date();
      const paymentDue = new Date(now.getTime() + PAYMENT_WINDOW_MS);
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'DELIVERY_ACKNOWLEDGED',
          deliveryAckAt: now,
          deliveryAckById: req.user.id,
          deliveryAckNote: note || null,
          deliveryAckSignedUrl: signedDocUrl || null,
          paymentDueAt: paymentDue,
          paymentDelayedAt: null,
          lastWeeklyReminderAt: null,
        },
        include: CLOSURE_INCLUDE,
      });
      await notifyL5Finance(
        `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — Delivery acknowledged (45-day pay window)`,
        `${req.user.name} confirmed customer receipt of invoice ${closure.invoiceNumber || '(no number)'} + delivery challan. 45-day payment window starts now — due by ${paymentDue.toLocaleString('en-IN')}.`,
        req.user.id,
      );
      res.json(updated);
    } catch (error) {
      console.error('Closure delivery-ack error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../weekly-followup — Accounts logs a weekly customer follow-up ──
// During the 45-day payment window, Accounts/Admin see a flashing weekly
// reminder. They contact the customer, write down what was said, and submit
// here to silence this week's reminder and start the clock on the next week.
router.post(
  '/:id/closures/:closureId/weekly-followup',
  authenticate,
  authorize('ACCOUNTING', 'ADMIN'),
  async (req, res) => {
    try {
      const { customerResponse, note } = req.body || {};
      if ((!customerResponse || !String(customerResponse).trim())
          && (!note || !String(note).trim())) {
        return res.status(400).json({ error: 'Either customerResponse or note is required' });
      }
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true, weeklyFollowups: { orderBy: { weekNumber: 'desc' }, take: 1 } },
      });
      if (!closure || closure.workOrderId !== req.params.id) {
        return res.status(404).json({ error: 'Closure cycle not found' });
      }
      if (closure.stage !== 'DELIVERY_ACKNOWLEDGED') {
        return res.status(400).json({
          error: 'Weekly follow-ups only apply during the 45-day payment window (DELIVERY_ACKNOWLEDGED)',
        });
      }
      const nextWeek = (closure.weeklyFollowups[0]?.weekNumber || 0) + 1;
      const now = new Date();
      const followup = await prisma.workOrderClosureWeeklyFollowup.create({
        data: {
          closureId: closure.id,
          weekNumber: nextWeek,
          contactedAt: now,
          contactedById: req.user.id,
          customerResponse: customerResponse || null,
          note: note || null,
        },
        include: { contactedBy: USER_SELECT },
      });
      await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: { lastWeeklyReminderAt: now },
      });
      res.status(201).json(followup);
    } catch (error) {
      console.error('Closure weekly-followup error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../hold — QC or Finance sends the cycle back with a checklist ──
router.post(
  '/:id/closures/:closureId/hold',
  authenticate,
  authorize('QC', 'FINANCE', 'ADMIN'),
  async (req, res) => {
    try {
      const { missingItems, reason } = req.body || {};
      if (!Array.isArray(missingItems) || !missingItems.length) {
        return res.status(400).json({ error: 'missingItems[] is required (each item: { docType, note })' });
      }
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      if (['INVOICE_SENT', 'PAYMENT_RECEIVED'].includes(closure.stage)) {
        return res.status(400).json({ error: `Cycle cannot be put on hold at stage ${closure.stage}` });
      }
      const [hold, updated] = await prisma.$transaction([
        prisma.workOrderHoldRequest.create({
          data: {
            closureId: closure.id,
            raisedById: req.user.id,
            missingItems,
            reason: reason || null,
          },
          include: { raisedBy: USER_SELECT },
        }),
        prisma.workOrderClosure.update({
          where: { id: closure.id },
          data: { stage: 'ON_HOLD' },
          include: CLOSURE_INCLUDE,
        }),
      ]);
      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_ON_HOLD',
          title: `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — On hold`,
          message: `${req.user.name} flagged missing items: ${missingItems.map((m) => m.docType).join(', ')}${reason ? `. Reason: ${reason}` : ''}.`,
          targetRole: 'MANAGER',
          sentById: req.user.id,
        },
      });
      res.json({ hold, closure: updated });
    } catch (error) {
      console.error('Closure hold error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../resolve-hold — unit re-submits; cycle restarts at UNIT_DOCS_PENDING ──
router.post(
  '/:id/closures/:closureId/resolve-hold',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  async (req, res) => {
    try {
      const { holdId, note } = req.body || {};
      if (!holdId) return res.status(400).json({ error: 'holdId is required' });
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      const denied = ensureClosureAccess(closure.workOrder, req.user);
      if (denied) return res.status(403).json({ error: denied });
      if (closure.stage !== 'ON_HOLD') {
        return res.status(400).json({ error: 'Cycle is not on hold' });
      }
      const hold = await prisma.workOrderHoldRequest.findUnique({ where: { id: holdId } });
      if (!hold || hold.closureId !== closure.id) return res.status(404).json({ error: 'Hold not found' });
      if (hold.resolvedAt) return res.status(400).json({ error: 'Hold already resolved' });

      const [, updated] = await prisma.$transaction([
        prisma.workOrderHoldRequest.update({
          where: { id: hold.id },
          data: { resolvedAt: new Date(), resolvedById: req.user.id, resolvedNote: note || null },
        }),
        prisma.workOrderClosure.update({
          where: { id: closure.id },
          data: {
            // Re-enter unit-docs so QC + Mgmt re-approve the new submission.
            stage: 'UNIT_DOCS_PENDING',
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
          include: CLOSURE_INCLUDE,
        }),
      ]);
      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_HOLD_RESOLVED',
          title: `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — Hold cleared`,
          message: `${req.user.name} re-submitted closure docs. QC + Mgmt re-approval required.`,
          targetRole: 'QC',
          sentById: req.user.id,
        },
      });
      res.json(updated);
    } catch (error) {
      console.error('Closure resolve-hold error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../payment-received — Accounts closes the cycle ──
// This is the ONLY way to close a cycle. Payment can only be logged AFTER
// Finance has acknowledged customer delivery (stage = DELIVERY_ACKNOWLEDGED),
// since that's when the 45-day payment clock starts. Setting stage =
// PAYMENT_RECEIVED stops both the 45-day window and the weekly reminder loop.
// WO itself doesn't auto-close — admin uses /close once every cycle is settled.
router.post(
  '/:id/closures/:closureId/payment-received',
  authenticate,
  authorize('ACCOUNTING', 'ADMIN'),
  async (req, res) => {
    try {
      const { note } = req.body || {};
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      if (closure.stage !== 'DELIVERY_ACKNOWLEDGED') {
        return res.status(400).json({
          error: 'Payment can only be logged after Finance acknowledges customer delivery',
        });
      }
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'PAYMENT_RECEIVED',
          paymentReceivedAt: new Date(),
          paymentReceivedById: req.user.id,
          paymentNote: note || null,
        },
        include: CLOSURE_INCLUDE,
      });
      await notifyL5Finance(
        `WO ${closure.workOrder.workOrderNumber} cycle #${closure.cycleNumber} — Payment received`,
        `${req.user.name} confirmed payment received for invoice ${closure.invoiceNumber || '(no number)'}${note ? `. Note: ${note}` : ''}. Cycle closed.`,
        req.user.id,
      );
      res.json(updated);
    } catch (error) {
      console.error('Closure payment-received error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

module.exports = router;
