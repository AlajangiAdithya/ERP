// ──────────────────────────────────────────────────────────────
// Work Order — Supply Chain workflow + per-lot closure cycles.
//
// Order flow:
//   SUPPLY_CHAIN fills the Work Order form (WORK ORDER.docx fields) and assigns
//   a unit → status PENDING_ADMIN → ADMIN verifies (may change the unit) and
//   accepts → that unit's MANAGER accepts (work starts) or rejects (ON_HOLD →
//   admin/SC reassigns or resends to the same unit).
//
// Lot flow (one cycle per delivery lot; final lot = final WO closure):
//   MANAGER clicks "Work Done" for the lot → fills lot details + uploads ONE
//   lot report PDF → goes straight to QC →
//   QC verifies with a MANDATORY remark and forwards to Finance, or puts the
//   lot ON_HOLD (unit finishes the work, re-uploads the lot report, resends) →
//   FINANCE attaches physical invoice + delivery challan to the material (no
//   upload) and clicks "Invoice Sent" and "DC Sent" — when BOTH are clicked the
//   48h goods-ack SLA starts →
//   FINANCE clicks "Goods Ack Received" when the driver returns with the signed
//   receipt — 48h SLA stops, 45-day payment window starts →
//   ACCOUNTS sees a day-by-day countdown (45 → 44 → 43…), logs weekly
//   incoming-money status updates, and confirms payment → lot CLOSED.
//   When the final lot's payment lands and full qty is covered → WO auto-CLOSED.
//
// Field-level permissions:
//   - Bank Guarantee + Insurance       : append-only history (BgEntry / InsuranceEntry)
//     editable by SUPPLY_CHAIN / ADMIN only (Accounts may view, not modify)
//   - Delivery Details                 : SUPPLY_CHAIN / ADMIN / ACCOUNTING
//   - PDC date and PDC extensions      : SUPPLY_CHAIN / ADMIN only
//     • Every PDC extension MUST also extend the BG (bankGuaranteeExtendedUpto)
//     • BG date auto-defaults to PDC + 2 months (editable)
//   - 3-month PDC alert                : BOTH admin AND unit manager must each
//     acknowledge with their own remark before the alert stops
//   - Remarks                          : any role with view access
//   - Closure financial fields (invoice/DC sent, goods ack, payment, SLA):
//     hidden from MANAGER / QC; visible only to ADMIN / FINANCE / ACCOUNTING.
// ──────────────────────────────────────────────────────────────

const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { closureDocUpload, publicUrlFor } = require('../middleware/upload');
const {
  generateSequentialNumber, paginate, applyDateFilter, withDocRetry,
} = require('../utils/helpers');
const { syncAlarmsForWO } = require('../services/workOrderAlarms');

const router = express.Router();

// ── Closure workflow constants ──────────────────────────────────────
// Level-5 management usernames — used for targeted notifications.
const L5_USERNAMES = ['sureshbabu', 'rameshbabu', 'madhubabu'];

// 48-hour goods-ack SLA — starts when Finance has clicked BOTH "Invoice Sent"
// and "DC Sent"; ends when Finance clicks "Goods Ack Received".
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

// The unit manager uploads exactly ONE lot report PDF per lot — that single
// document is what QC verifies.
const LOT_REPORT_DOC_TYPE = 'LOT_REPORT';

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
  dcSentBy:            USER_SELECT,
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
  items: {
    include: { item: { select: { id: true, lineNo: true, description: true, uom: true } } },
  },
};

const WO_INCLUDE = {
  items:                    { orderBy: { lineNo: 'asc' } },
  assignedUnit:             { select: { id: true, name: true, code: true } },
  createdBy:                USER_SELECT,
  adminAcceptedBy:          USER_SELECT,
  unitAcceptedBy:           USER_SELECT,
  deliveryDetailsUpdatedBy: USER_SELECT,
  pdc3MonthAckBy:           USER_SELECT,
  pdc3MonthMgrAckBy:        USER_SELECT,
  extensions:               { orderBy: { extensionNo: 'asc' }, include: { grantedBy: USER_SELECT } },
  invoices:                 { orderBy: { invoiceDate: 'asc' }, include: { createdBy: USER_SELECT } },
  closures: {
    orderBy: { cycleNumber: 'asc' },
    include: CLOSURE_INCLUDE,
  },
  bgEntries:        { orderBy: { addedAt: 'desc' }, include: { addedBy: USER_SELECT } },
  insuranceEntries: { orderBy: { addedAt: 'desc' }, include: { addedBy: USER_SELECT } },
  alarms: {
    where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
    include: {
      acknowledgedBy: USER_SELECT,
      resolvedBy:     USER_SELECT,
      notes: {
        orderBy: { createdAt: 'asc' },
        include: { author: USER_SELECT },
      },
    },
  },
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
    deliveryChallanNumber: null,
    invoiceSentAt: null,
    invoiceSentById: null,
    invoiceSentBy: null,
    dcSentAt: null,
    dcSentById: null,
    dcSentBy: null,
    slaDeadlineAt: null,
    last24hReminderAt: null,
    slaBreachedAt: null,
    invoiceAckReceived: false,
    invoiceAckAt: null,
    dcAckReceived: false,
    dcAckAt: null,
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
  // "Delivered" = all lots dispatched (status COMPLETED) or fully closed.
  const isDelivered = wo.status === 'COMPLETED' || wo.status === 'CLOSED';
  // A WO is only truly DONE — and only counts for on-time delivery — once the
  // FULL payment is in and every lot is settled (status CLOSED). Delivered but
  // not yet fully paid = "awaiting payment" (still active, shown as Pending
  // Accounts). completedAt holds the delivery date, so on-time still measures
  // delivery punctuality vs PDC — it just isn't surfaced until the money lands.
  const isPaidClosed = wo.status === 'CLOSED';
  const awaitingPayment = wo.status === 'COMPLETED';
  const onTime = isPaidClosed && completed && pdc ? completed <= new Date(pdc) : null;
  const daysToPdc = pdc
    ? Math.ceil((new Date(pdc) - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  const overdue = !isDelivered && pdc && new Date() > new Date(pdc);
  // 3-month-to-PDC alert state. Active when within the 90-day window, WO is
  // still live, and EITHER the admin or the assigned unit manager has not yet
  // filed their remark. Both must acknowledge before the alert clears.
  const inAlertWindow = daysToPdc != null && daysToPdc > 0 && daysToPdc <= PDC_ALERT_DAYS;
  const woClosed = ['CLOSED', 'CANCELLED', 'REJECTED'].includes(wo.status);
  const pdc3MonthAdminAckPending = inAlertWindow && !woClosed && !wo.pdc3MonthAckAt;
  const pdc3MonthMgrAckPending = inAlertWindow && !woClosed && !wo.pdc3MonthMgrAckAt;
  const pdc3MonthAlertActive = pdc3MonthAdminAckPending || pdc3MonthMgrAckPending;
  const closures = sanitizeClosuresFor(wo.closures, user);
  return {
    ...wo,
    closures,
    effectivePdcDate: pdc,
    onTime,
    daysToPdc,
    overdue,
    awaitingPayment,
    pdc3MonthAlertActive,
    pdc3MonthAdminAckPending,
    pdc3MonthMgrAckPending,
  };
};

// Aggregate on-time % across a list of WOs. ONLY fully-paid (CLOSED) work
// orders count — a WO is not "completed" until its payment is completely in.
// Delivered-but-unpaid (COMPLETED / Pending Accounts) is excluded.
const computeOnTimeStats = (workOrders) => {
  const completedList = workOrders.filter((w) => w.status === 'CLOSED');
  if (!completedList.length) return { completedCount: 0, onTimeCount: 0, onTimePercent: null };
  const onTimeCount = completedList.filter((w) => w.onTime === true).length;
  return {
    completedCount: completedList.length,
    onTimeCount,
    onTimePercent: Math.round((onTimeCount / completedList.length) * 1000) / 10,
  };
};

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

// Normalise the items[] payload from a create/edit request into clean rows
// ({ lineNo, description, quantity, uom }). Accepts an array of
// { description, quantity, uom }. Throws on an empty/invalid set.
const normalizeItems = (raw) => {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  if (!Array.isArray(list)) return null;
  const rows = [];
  list.forEach((it) => {
    if (!it) return;
    const description = String(it.description ?? '').trim();
    const quantity = Number(it.quantity);
    if (!description || !Number.isFinite(quantity) || quantity <= 0) return;
    rows.push({
      lineNo: rows.length + 1,
      description,
      quantity,
      uom: String(it.uom ?? '').trim() || 'Nos',
    });
  });
  return rows.length ? rows : null;
};

// Aggregate qty across items (back-compat orderQuantity); UOM = first item's.
const itemsAggregate = (rows) => ({
  orderQuantity: rows.reduce((s, r) => s + r.quantity, 0),
  orderUnit: rows[0]?.uom || 'Nos',
});

// Guard: the caller may only touch this closure if they own the relevant stage.
// MANAGER must be assigned to the WO's unit.
const ensureClosureAccess = (wo, user) => {
  if (user.role === 'MANAGER' && wo.assignedUnitId !== user.unitId) {
    return 'Not your unit';
  }
  return null;
};

// Fire-and-forget alarm refresh after a state change. Errors are logged but
// never propagate — the user-facing request has already responded by then.
const refreshAlarms = (woId) => {
  if (!woId) return;
  syncAlarmsForWO(woId).catch((e) => console.error(`alarm sync failed for ${woId}:`, e.message));
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
    // Supply Chain must pick the unit manager up-front — admin can change it
    // when verifying.
    const required = ['supplyOrderNo', 'supplyOrderDate', 'customerName', 'pdcDate', 'assignedUnitId'];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === '') {
        return res.status(400).json({ error: `${f} is required` });
      }
    }

    // Material line items (S.No / Description / Quantity / UOM). At least one is
    // required. Legacy single orderQuantity is still accepted as a fallback.
    let items = normalizeItems(body.items);
    if (!items && body.orderQuantity) {
      items = [{
        lineNo: 1,
        description: String(body.nomenclature || body.supplyOrderDescription || 'Material').trim() || 'Material',
        quantity: Number(body.orderQuantity),
        uom: body.orderUnit || 'Nos',
      }];
    }
    if (!items) {
      return res.status(400).json({ error: 'At least one material line item (description + quantity) is required' });
    }
    const agg = itemsAggregate(items);

    const assignedUnitId = body.assignedUnitId;
    const unit = await prisma.unit.findUnique({ where: { id: assignedUnitId } });
    if (!unit) return res.status(400).json({ error: 'Assigned unit not found' });

    const pdcDate = new Date(body.pdcDate);
    // BG date ALWAYS auto-defaults to PDC + 2 months when not supplied — it is
    // editable (form pre-fills it; SC can overwrite, and it can be changed
    // later via PATCH or a new BG history entry).
    const bgDate = body.bankGuaranteeDate
      ? new Date(body.bankGuaranteeDate)
      : addDays(pdcDate, DEFAULT_BG_OFFSET_DAYS);

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
          orderQuantity: agg.orderQuantity,
          orderUnit: agg.orderUnit,
          items: { create: items },
          pdcDate,
          deliveryClause: body.deliveryClause || null,
          lotsExpected: body.lotsExpected ? Math.max(1, Number(body.lotsExpected)) : null,
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
    refreshAlarms(created.id);
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

    // Replace material line items. Only while no lots have been sent — once a lot
    // exists its per-item rows reference these items, so editing is locked.
    if (body.items !== undefined) {
      const rows = normalizeItems(body.items);
      if (!rows) return res.status(400).json({ error: 'At least one material line item (description + quantity) is required' });
      const lotCount = await prisma.workOrderClosure.count({ where: { workOrderId: req.params.id } });
      if (lotCount > 0) {
        return res.status(400).json({ error: 'Cannot change material items after lots have been sent' });
      }
      const agg = itemsAggregate(rows);
      data.items = { deleteMany: {}, create: rows };
      data.orderQuantity = agg.orderQuantity;
      data.orderUnit = agg.orderUnit;
    }

    if (body.supplyOrderDate) data.supplyOrderDate = new Date(body.supplyOrderDate);
    if (body.pdcDate) data.pdcDate = new Date(body.pdcDate);
    // BG date is auto-derived (PDC + 2 months) but stays editable here.
    if (body.bankGuaranteeDate !== undefined) {
      data.bankGuaranteeDate = body.bankGuaranteeDate ? new Date(body.bankGuaranteeDate) : null;
    }
    if (body.lotsExpected !== undefined) {
      data.lotsExpected = body.lotsExpected ? Math.max(1, Number(body.lotsExpected)) : null;
    }
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
    refreshAlarms(req.params.id);
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
    refreshAlarms(req.params.id);
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
// 3-MONTH PDC ALERT — BOTH admin AND unit manager must acknowledge
//
// When the effective PDC is ≤ 90 days away, a red blinking alert fires on the
// WO. The ADMIN and the assigned unit's MANAGER must EACH file their own
// remark (extension needed / issues / status). The alert keeps blinking until
// both remarks are recorded. Every remark is saved on the WO permanently.
// ════════════════════════════════════════════════════════════════════

router.post(
  '/:id/pdc-alert/acknowledge',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      const { note } = req.body || {};
      if (!note || !String(note).trim()) {
        return res.status(400).json({ error: 'Acknowledgement remark is required' });
      }
      const existing = await prisma.workOrder.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Work order not found' });

      const data = {};
      if (req.user.role === 'ADMIN') {
        if (existing.pdc3MonthAckAt) {
          return res.status(400).json({ error: 'Admin already acknowledged the 3-month PDC alert' });
        }
        data.pdc3MonthAckAt = new Date();
        data.pdc3MonthAckById = req.user.id;
        data.pdc3MonthAckNote = String(note).trim();
      } else {
        // MANAGER — must belong to the assigned unit.
        if (existing.assignedUnitId !== req.user.unitId) {
          return res.status(403).json({ error: 'Not your unit' });
        }
        if (existing.pdc3MonthMgrAckAt) {
          return res.status(400).json({ error: 'Unit manager already acknowledged the 3-month PDC alert' });
        }
        data.pdc3MonthMgrAckAt = new Date();
        data.pdc3MonthMgrAckById = req.user.id;
        data.pdc3MonthMgrAckNote = String(note).trim();
      }

      const updated = await prisma.workOrder.update({
        where: { id: req.params.id },
        data,
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
// PER-LOT CLOSURE WORKFLOW
//
// Each closure cycle is one delivery lot. The final lot is the final closure
// of the work order.
//
// Stages: UNIT_DOCS_PENDING (with QC) → QC_VERIFIED (finance pending) →
//         INVOICE_SENT (both buttons clicked, 48h goods-ack SLA) →
//         DELIVERY_ACKNOWLEDGED (45-day payment countdown, weekly follow-ups) →
//         PAYMENT_RECEIVED (lot CLOSED; final lot auto-closes the WO)
//         (QC can send a lot back to ON_HOLD; the unit re-uploads the lot
//          report and resends it to QC)
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

// Recompute the WO's delivered qty / status from its lots. Called after a lot
// is opened so progress badges and COMPLETED flips stay in sync.
const syncWoFromLots = async (woId) => {
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    include: {
      items: { select: { id: true, quantity: true } },
      closures: { select: { deliveryQty: true, items: { select: { itemId: true, deliveryQty: true } } } },
    },
  });
  if (!wo) return null;
  const covered = wo.closures.reduce((s, c) => s + (c.deliveryQty || 0), 0);
  // Item-aware completion: every line item must be fully delivered across lots.
  // Falls back to the aggregate qty for legacy WOs that have no item rows.
  let fullyDone;
  if (wo.items.length) {
    const deliveredByItem = new Map();
    wo.closures.forEach((c) => (c.items || []).forEach((ci) => {
      deliveredByItem.set(ci.itemId, (deliveredByItem.get(ci.itemId) || 0) + (ci.deliveryQty || 0));
    }));
    fullyDone = wo.items.every((it) => (deliveredByItem.get(it.id) || 0) >= it.quantity);
  } else {
    fullyDone = covered >= wo.orderQuantity;
  }
  return prisma.workOrder.update({
    where: { id: woId },
    data: {
      deliveredQty: covered,
      status: ['CLOSED', 'CANCELLED', 'REJECTED'].includes(wo.status)
        ? wo.status
        : (fullyDone ? 'COMPLETED' : 'IN_PROGRESS'),
      deliveryStatus: fullyDone ? 'DELIVERED' : 'PARTIAL',
      completedAt: fullyDone ? (wo.completedAt || new Date()) : wo.completedAt,
    },
  });
};

// ── POST /api/work-orders/:id/closures — "Work Done" for a lot ──
// One shot: the unit manager fills the lot details AND uploads the single lot
// report PDF. The lot is created already submitted to QC — QC is notified
// immediately. multipart/form-data: file + deliveryQty + deliveryNote + deliveredAt.
router.post(
  '/:id/closures',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  closureDocUpload.single('file'),
  async (req, res) => {
    try {
      const { deliveryNote, deliveredAt } = req.body || {};
      if (!req.file) {
        return res.status(400).json({ error: 'Lot report PDF is required — upload exactly one report for this lot' });
      }
      const wo = await prisma.workOrder.findUnique({
        where: { id: req.params.id },
        include: {
          items: { select: { id: true, lineNo: true, description: true, quantity: true, uom: true } },
          closures: { select: { cycleNumber: true, deliveryQty: true, items: { select: { itemId: true, deliveryQty: true } } } },
        },
      });
      if (!wo) return res.status(404).json({ error: 'Work order not found' });
      const denied = ensureClosureAccess(wo, req.user);
      if (denied) return res.status(403).json({ error: denied });
      if (!['UNIT_ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(wo.status)) {
        return res.status(400).json({
          error: `Cannot open a lot on a WO in status ${wo.status}`,
        });
      }
      if (wo.lotsExpected && wo.closures.length >= wo.lotsExpected) {
        return res.status(400).json({
          error: `All ${wo.lotsExpected} expected lots are already opened`,
        });
      }

      // ── Per-item lot quantities ──
      // Multipart sends items as a JSON string: [{ itemId, deliveryQty }].
      // Each item's running delivered qty (across lots) must not exceed ordered.
      let lotItems = req.body.items;
      if (typeof lotItems === 'string') {
        try { lotItems = JSON.parse(lotItems); } catch { lotItems = null; }
      }

      let qty;          // aggregate lot qty (sum of per-item qty)
      let closureItemsCreate = [];

      if (wo.items.length) {
        // New multi-material WO — require a per-item breakdown.
        if (!Array.isArray(lotItems)) {
          return res.status(400).json({ error: 'items[] with per-material quantities is required' });
        }
        // Already delivered per item across all prior lots.
        const deliveredByItem = new Map();
        wo.closures.forEach((c) => (c.items || []).forEach((ci) => {
          deliveredByItem.set(ci.itemId, (deliveredByItem.get(ci.itemId) || 0) + (ci.deliveryQty || 0));
        }));
        const byId = new Map(wo.items.map((it) => [it.id, it]));
        const rows = [];
        for (const li of lotItems) {
          if (!li || !li.itemId) continue;
          const item = byId.get(li.itemId);
          if (!item) return res.status(400).json({ error: 'Unknown line item in lot' });
          const d = Number(li.deliveryQty);
          if (!Number.isFinite(d) || d <= 0) continue; // skip blank/zero rows
          const prior = deliveredByItem.get(item.id) || 0;
          if (prior + d > item.quantity + 1e-9) {
            return res.status(400).json({
              error: `Lot qty for "${item.description}" exceeds remaining (already ${prior} of ${item.quantity} ${item.uom})`,
            });
          }
          rows.push({ itemId: item.id, deliveryQty: d });
        }
        if (!rows.length) {
          return res.status(400).json({ error: 'Enter a delivery quantity for at least one material' });
        }
        closureItemsCreate = rows;
        qty = rows.reduce((s, r) => s + r.deliveryQty, 0);
      } else {
        // Legacy single-qty WO.
        qty = Number(req.body.deliveryQty);
        if (!Number.isFinite(qty) || qty <= 0) {
          return res.status(400).json({ error: 'deliveryQty must be > 0' });
        }
        const alreadyCovered = wo.closures.reduce((s, c) => s + (c.deliveryQty || 0), 0);
        if (alreadyCovered + qty > wo.orderQuantity) {
          return res.status(400).json({
            error: `Lot qty exceeds remaining WO qty (already covered ${alreadyCovered} of ${wo.orderQuantity})`,
          });
        }
      }

      const nextCycle = (wo.closures.reduce((m, c) => Math.max(m, c.cycleNumber), 0) || 0) + 1;
      const now = new Date();
      const closure = await prisma.workOrderClosure.create({
        data: {
          workOrderId: wo.id,
          cycleNumber: nextCycle,
          stage: 'UNIT_DOCS_PENDING',
          deliveryQty: qty,
          deliveryNote: deliveryNote || null,
          deliveredAt: deliveredAt ? new Date(deliveredAt) : now,
          openedById: req.user.id,
          unitDocsSubmittedAt: now, // lot report attached right here → straight to QC
          unitDocsSubmittedById: req.user.id,
          items: closureItemsCreate.length ? { create: closureItemsCreate } : undefined,
          docs: {
            create: {
              docType: LOT_REPORT_DOC_TYPE,
              fileUrl: publicUrlFor('wo-closure', req.file.filename),
              fileName: req.file.originalname || req.file.filename,
              stage: 'UNIT_DOCS_PENDING',
              uploadedById: req.user.id,
              note: deliveryNote || null,
            },
          },
        },
        include: CLOSURE_INCLUDE,
      });

      // Lot qty counts as delivered work — keep WO progress in sync.
      await syncWoFromLots(wo.id);

      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_QC_PENDING',
          title: `WO ${wo.workOrderNumber} Lot #${nextCycle} — QC verification pending`,
          message: `${req.user.name} marked work done for Lot #${nextCycle} (qty ${qty} ${wo.orderUnit}) and uploaded the lot report. Please verify and write your remark.`,
          targetRole: 'QC',
          sentById: req.user.id,
        },
      });

      res.status(201).json(closure);
      refreshAlarms(wo.id);
    } catch (error) {
      console.error('Open lot (closure) error:', error);
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

// ── POST .../qc-verify — QC verifies the lot report & forwards to FINANCE ──
// Remark is MANDATORY — it is stored on the closure (qcRemark) permanently.
router.post(
  '/:id/closures/:closureId/qc-verify',
  authenticate,
  authorize('QC', 'ADMIN'),
  async (req, res) => {
    try {
      const { note } = req.body || {};
      if (!note || !String(note).trim()) {
        return res.status(400).json({ error: 'QC remark is required — write your verification remark before forwarding' });
      }
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      if (closure.stage !== 'UNIT_DOCS_PENDING' || !closure.unitDocsSubmittedAt) {
        return res.status(400).json({ error: 'Lot is not awaiting QC verification' });
      }
      const certificateNumber = await withDocRetry(() => generateSequentialNumber(prisma, 'WOQC'));
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'QC_VERIFIED',
          qcVerifiedAt: new Date(),
          qcVerifiedById: req.user.id,
          qcCertificateNumber: certificateNumber,
          qcRemark: String(note).trim(),
        },
        include: CLOSURE_INCLUDE,
      });
      // QC approved → straight to Finance (no management approval step).
      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_FINANCE_PENDING',
          title: `WO ${closure.workOrder.workOrderNumber} Lot #${closure.cycleNumber} — Finance action`,
          message: `QC ${req.user.name} approved Lot #${closure.cycleNumber} (certificate ${certificateNumber}). Remark: ${String(note).trim()}. Attach the physical invoice + delivery challan and click "Invoice Sent" and "DC Sent".`,
          targetRole: 'FINANCE',
          sentById: req.user.id,
        },
      });
      res.json(updated);
      refreshAlarms(req.params.id);
    } catch (error) {
      console.error('Closure qc-verify error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../mark-invoice-sent / .../mark-dc-sent — Finance's two buttons ──
// The physical invoice and delivery challan travel WITH the material (no
// upload). Finance clicks each button as it goes out; the optional number is
// recorded. Once BOTH are clicked the lot moves to INVOICE_SENT and the 48h
// goods-ack SLA starts. Idempotent — re-clicking a done button is a no-op.
const buildSentRoute = (which) => async (req, res) => {
  try {
    const closure = await prisma.workOrderClosure.findUnique({
      where: { id: req.params.closureId },
      include: { workOrder: true },
    });
    if (!closure || closure.workOrderId !== req.params.id) {
      return res.status(404).json({ error: 'Closure cycle not found' });
    }
    if (!['QC_VERIFIED', 'MGMT_APPROVED'].includes(closure.stage)) {
      return res.status(400).json({ error: `Lot must be QC-approved before dispatch (currently ${closure.stage})` });
    }

    const now = new Date();
    const data = {};
    if (which === 'invoice') {
      if (closure.invoiceSentAt) return res.json(closure); // already clicked
      const invNo = req.body?.invoiceNumber && String(req.body.invoiceNumber).trim();
      if (invNo) {
        const dup = await prisma.workOrderClosure.findFirst({
          where: { invoiceNumber: invNo, NOT: { id: closure.id } },
          select: { id: true },
        });
        if (dup) return res.status(409).json({ error: `Invoice number ${invNo} is already used on another lot` });
        data.invoiceNumber = invNo;
      }
      data.invoiceSentAt = now;
      data.invoiceSentById = req.user.id;
      data.invoiceDate = req.body?.invoiceDate ? new Date(req.body.invoiceDate) : now;
      if (req.body?.description) data.invoiceDescription = req.body.description;
    } else {
      if (closure.dcSentAt) return res.json(closure); // already clicked
      const dcNo = req.body?.deliveryChallanNumber && String(req.body.deliveryChallanNumber).trim();
      if (dcNo) data.deliveryChallanNumber = dcNo;
      data.dcSentAt = now;
      data.dcSentById = req.user.id;
    }

    // Did this click complete the pair? → start the 48h goods-ack SLA.
    const bothDone = which === 'invoice' ? !!closure.dcSentAt : !!closure.invoiceSentAt;
    if (bothDone) {
      data.stage = 'INVOICE_SENT';
      data.slaDeadlineAt = new Date(now.getTime() + SLA_WINDOW_MS);
      data.last24hReminderAt = null;
      data.slaBreachedAt = null;
    }

    const updated = await prisma.workOrderClosure.update({
      where: { id: closure.id },
      data,
      include: CLOSURE_INCLUDE,
    });

    if (bothDone) {
      await notifyL5Finance(
        `WO ${closure.workOrder.workOrderNumber} Lot #${closure.cycleNumber} — Invoice + DC sent (48h goods-ack SLA started)`,
        `${req.user.name} confirmed both the invoice and delivery challan went out with the material to ${closure.workOrder.customerName}. The signed goods acknowledgement must come back within 48h — deadline ${data.slaDeadlineAt.toLocaleString('en-IN')}.`,
        req.user.id,
      );
    }
    res.json(updated);
    refreshAlarms(req.params.id);
  } catch (error) {
    console.error(`Closure mark-${which}-sent error:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
router.post(
  '/:id/closures/:closureId/mark-invoice-sent',
  authenticate, authorize('FINANCE', 'ADMIN'),
  buildSentRoute('invoice'),
);
router.post(
  '/:id/closures/:closureId/mark-dc-sent',
  authenticate, authorize('FINANCE', 'ADMIN'),
  buildSentRoute('dc'),
);

// ── POST .../delivery-ack — Finance clicks "Goods Ack Received" ──
// Real-world: the driver comes back with the customer-signed receipt. Finance
// clicks this ONE button — the 48h SLA stops and the 45-day payment countdown
// (Accounts' scope) starts.
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
        return res.status(400).json({ error: 'Both "Invoice Sent" and "DC Sent" must be clicked before the goods ack' });
      }
      const now = new Date();
      const paymentDue = new Date(now.getTime() + PAYMENT_WINDOW_MS);
      const updated = await prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          stage: 'DELIVERY_ACKNOWLEDGED',
          invoiceAckReceived: true,
          invoiceAckAt: closure.invoiceAckAt || now,
          dcAckReceived: true,
          dcAckAt: closure.dcAckAt || now,
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
        `WO ${closure.workOrder.workOrderNumber} Lot #${closure.cycleNumber} — Goods ack received (45-day payment window)`,
        `${req.user.name} confirmed the signed goods acknowledgement came back for invoice ${closure.invoiceNumber || '(no number)'} / DC ${closure.deliveryChallanNumber || '(no number)'}. 48h timer stopped. Accounts' 45-day payment countdown starts now — due by ${paymentDue.toLocaleDateString('en-IN')}.`,
        req.user.id,
      );
      res.json(updated);
      refreshAlarms(req.params.id);
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
      if (['INVOICE_SENT', 'DELIVERY_ACKNOWLEDGED', 'PAYMENT_RECEIVED'].includes(closure.stage)) {
        return res.status(400).json({ error: `Lot cannot be put on hold at stage ${closure.stage}` });
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
      refreshAlarms(req.params.id);
    } catch (error) {
      console.error('Closure hold error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../resubmit — unit finished the pending work; uploads a FRESH lot
// report and resends the lot to QC. Clears the open hold(s), wipes the old QC
// verdict, and stamps a new submission. multipart/form-data: file + note.
router.post(
  '/:id/closures/:closureId/resubmit',
  authenticate,
  authorize('MANAGER', 'ADMIN'),
  closureDocUpload.single('file'),
  async (req, res) => {
    try {
      const { note } = req.body || {};
      if (!req.file) {
        return res.status(400).json({ error: 'Upload the corrected lot report PDF to resend this lot to QC' });
      }
      const closure = await prisma.workOrderClosure.findUnique({
        where: { id: req.params.closureId },
        include: { workOrder: true, holdRequests: { where: { resolvedAt: null } } },
      });
      if (!closure || closure.workOrderId !== req.params.id) return res.status(404).json({ error: 'Closure cycle not found' });
      const denied = ensureClosureAccess(closure.workOrder, req.user);
      if (denied) return res.status(403).json({ error: denied });
      if (closure.stage !== 'ON_HOLD') {
        return res.status(400).json({ error: 'Lot is not on hold' });
      }

      const now = new Date();
      const ops = closure.holdRequests.map((h) =>
        prisma.workOrderHoldRequest.update({
          where: { id: h.id },
          data: { resolvedAt: now, resolvedById: req.user.id, resolvedNote: note || 'Lot report re-uploaded and resent to QC' },
        }),
      );
      ops.push(prisma.workOrderClosureDoc.create({
        data: {
          closureId: closure.id,
          docType: LOT_REPORT_DOC_TYPE,
          fileUrl: publicUrlFor('wo-closure', req.file.filename),
          fileName: req.file.originalname || req.file.filename,
          stage: 'UNIT_DOCS_PENDING',
          uploadedById: req.user.id,
          note: note || 'Re-uploaded after hold',
        },
      }));
      ops.push(prisma.workOrderClosure.update({
        where: { id: closure.id },
        data: {
          // Back with QC for a fresh verification of the new report.
          stage: 'UNIT_DOCS_PENDING',
          unitDocsSubmittedAt: now,
          unitDocsSubmittedById: req.user.id,
          qcVerifiedAt: null,
          qcVerifiedById: null,
          qcCertificateUrl: null,
          qcCertificateNumber: null,
          qcRemark: null,
        },
        include: CLOSURE_INCLUDE,
      }));
      const results = await prisma.$transaction(ops);
      const updated = results[results.length - 1];

      await prisma.notification.create({
        data: {
          type: 'WO_CLOSURE_HOLD_RESOLVED',
          title: `WO ${closure.workOrder.workOrderNumber} Lot #${closure.cycleNumber} — resent to QC`,
          message: `${req.user.name} finished the pending work and re-uploaded the lot report. Please re-verify and write your remark.`,
          targetRole: 'QC',
          sentById: req.user.id,
        },
      });
      res.json(updated);
      refreshAlarms(req.params.id);
    } catch (error) {
      console.error('Closure resubmit error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────
// ALARMS — list / sync / append note / acknowledge / resolve
// Each transition stores a remark in WorkOrderAlarmNote so the timeline
// is preserved. ACTIVE/ACKNOWLEDGED → RESOLVED is one-way from the UI;
// the engine may re-create a fresh ACTIVE row if the trigger re-fires.
// ────────────────────────────────────────────────────────────────────

const ALARM_INCLUDE = {
  acknowledgedBy: USER_SELECT,
  resolvedBy:     USER_SELECT,
  notes: {
    orderBy: { createdAt: 'asc' },
    include: { author: USER_SELECT },
  },
};

// GET /api/work-orders/:id/alarms — list (default: active+ack'd; ?includeResolved=1 to see history)
router.get(
  '/:id/alarms',
  authenticate,
  authorize(...WO_VIEW_ROLES),
  async (req, res) => {
    try {
      const includeResolved = req.query.includeResolved === '1' || req.query.includeResolved === 'true';
      const rows = await prisma.workOrderAlarm.findMany({
        where: {
          workOrderId: req.params.id,
          ...(includeResolved ? {} : { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } }),
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        include: ALARM_INCLUDE,
      });
      res.json({ alarms: rows });
    } catch (error) {
      console.error('List alarms error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/work-orders/:id/alarms/sync — recompute alarms for this WO
router.post(
  '/:id/alarms/sync',
  authenticate,
  authorize('ADMIN', 'SUPPLY_CHAIN', 'FINANCE', 'ACCOUNTING'),
  async (req, res) => {
    try {
      const result = await syncAlarmsForWO(req.params.id);
      res.json(result);
    } catch (error) {
      console.error('Sync alarms error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/work-orders/:id/alarms/:alarmId/notes — append a remark
router.post(
  '/:id/alarms/:alarmId/notes',
  authenticate,
  authorize(...WO_VIEW_ROLES),
  async (req, res) => {
    try {
      const { body } = req.body || {};
      if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
      const alarm = await prisma.workOrderAlarm.findUnique({ where: { id: req.params.alarmId } });
      if (!alarm || alarm.workOrderId !== req.params.id) return res.status(404).json({ error: 'Alarm not found' });
      const note = await prisma.workOrderAlarmNote.create({
        data: { alarmId: alarm.id, authorId: req.user.id, body: String(body).trim(), kind: 'COMMENT' },
        include: { author: USER_SELECT },
      });
      res.status(201).json(note);
    } catch (error) {
      console.error('Add alarm note error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/work-orders/:id/alarms/:alarmId/acknowledge — ack with remark
router.post(
  '/:id/alarms/:alarmId/acknowledge',
  authenticate,
  authorize(...WO_VIEW_ROLES),
  async (req, res) => {
    try {
      const { remark } = req.body || {};
      const alarm = await prisma.workOrderAlarm.findUnique({ where: { id: req.params.alarmId } });
      if (!alarm || alarm.workOrderId !== req.params.id) return res.status(404).json({ error: 'Alarm not found' });
      if (alarm.status !== 'ACTIVE') return res.status(400).json({ error: `Alarm is ${alarm.status}` });
      const updated = await prisma.workOrderAlarm.update({
        where: { id: alarm.id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
          acknowledgedById: req.user.id,
          ackRemark: remark || null,
          notes: {
            create: {
              authorId: req.user.id,
              body: remark ? `Acknowledged: ${remark}` : 'Acknowledged.',
              kind: 'ACK',
            },
          },
        },
        include: ALARM_INCLUDE,
      });
      res.json(updated);
    } catch (error) {
      console.error('Acknowledge alarm error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// POST /api/work-orders/:id/alarms/:alarmId/resolve — manual resolve with remark
router.post(
  '/:id/alarms/:alarmId/resolve',
  authenticate,
  authorize(...WO_VIEW_ROLES),
  async (req, res) => {
    try {
      const { remark } = req.body || {};
      const alarm = await prisma.workOrderAlarm.findUnique({ where: { id: req.params.alarmId } });
      if (!alarm || alarm.workOrderId !== req.params.id) return res.status(404).json({ error: 'Alarm not found' });
      if (alarm.status === 'RESOLVED') return res.status(400).json({ error: 'Alarm already resolved' });
      const updated = await prisma.workOrderAlarm.update({
        where: { id: alarm.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedById: req.user.id,
          resolveRemark: remark || null,
          notes: {
            create: {
              authorId: req.user.id,
              body: remark ? `Resolved: ${remark}` : 'Resolved.',
              kind: 'RESOLVE',
            },
          },
        },
        include: ALARM_INCLUDE,
      });
      res.json(updated);
    } catch (error) {
      console.error('Resolve alarm error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ── POST .../payment-received — Accounts closes the lot ──
// Payment can only be logged AFTER the goods ack (stage = DELIVERY_ACKNOWLEDGED),
// since that's when the 45-day clock starts. Setting stage = PAYMENT_RECEIVED
// stops the countdown and the weekly reminder loop. When this was the FINAL
// lot (every lot paid + full qty covered) the whole WO auto-closes.
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
          error: 'Payment can only be logged after the goods acknowledgement',
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
        `WO ${closure.workOrder.workOrderNumber} Lot #${closure.cycleNumber} — Payment received`,
        `${req.user.name} confirmed payment received for invoice ${closure.invoiceNumber || '(no number)'}${note ? `. Note: ${note}` : ''}. Lot closed.`,
        req.user.id,
      );

      // Final-lot check: every lot paid + full qty covered → WO auto-closes.
      const wo = await prisma.workOrder.findUnique({
        where: { id: closure.workOrderId },
        include: { closures: { select: { stage: true, deliveryQty: true } } },
      });
      if (wo && !['CLOSED', 'CANCELLED', 'REJECTED'].includes(wo.status)) {
        const allPaid = wo.closures.every((c) => c.stage === 'PAYMENT_RECEIVED');
        const covered = wo.closures.reduce((s, c) => s + (c.deliveryQty || 0), 0);
        if (allPaid && covered >= wo.orderQuantity) {
          await prisma.workOrder.update({
            where: { id: wo.id },
            data: {
              status: 'CLOSED',
              completedAt: wo.completedAt || new Date(),
              remarks: `${wo.remarks ? wo.remarks + '\n' : ''}Auto-closed: final lot payment received on ${new Date().toLocaleDateString('en-IN')}.`,
            },
          });
          await notifyL5Finance(
            `WO ${wo.workOrderNumber} — CLOSED (final lot paid)`,
            `All lots of WO ${wo.workOrderNumber} (${wo.customerName}) are delivered, acknowledged and paid. The work order is closed.`,
            req.user.id,
          );
        }
      }

      res.json(updated);
      refreshAlarms(req.params.id);
    } catch (error) {
      console.error('Closure payment-received error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

module.exports = router;
