// ────────────────────────────────────────────────────────────────
// Work Order alarm engine.
//
// Given a WO (with closures + extensions + bgEntries), computes the set of
// alarms that SHOULD be ACTIVE right now and upserts them. ACTIVE alarms whose
// trigger is no longer true are auto-resolved (status = RESOLVED, with a
// SYSTEM resolve remark) so the UI stays clean.
//
// Each WorkOrderAlarm row is unique on (workOrderId, closureId, type, status).
// We never duplicate ACTIVE rows of the same kind for the same scope.
// ────────────────────────────────────────────────────────────────

const prisma = require('../config/db');

const DAY_MS = 24 * 60 * 60 * 1000;

const PDC_NEAR_DAYS    = 90;
const QC_PENDING_DAYS  = 7;
const PAY_DUE_SOON_DAYS = 7;
const BG_EXPIRING_DAYS = 30;

const effectivePdc = (wo) => {
  const last = wo.extensions?.length ? wo.extensions[wo.extensions.length - 1] : null;
  return last ? last.newPdcDate : wo.pdcDate;
};

// Build the desired ACTIVE alarm set for one WO. Returns an array of:
//   { closureId|null, type, severity, title, triggerContext }
function computeDesiredAlarms(wo, now = new Date()) {
  const desired = [];
  const woClosed = ['CLOSED', 'CANCELLED', 'REJECTED'].includes(wo.status);
  const woCompleted = ['COMPLETED', 'CLOSED'].includes(wo.status);

  // ── WO-level: PDC near / overdue ──
  const pdc = effectivePdc(wo);
  if (pdc && !woClosed) {
    const daysToPdc = Math.ceil((new Date(pdc).getTime() - now.getTime()) / DAY_MS);
    if (daysToPdc < 0 && !woCompleted) {
      desired.push({
        closureId: null,
        type: 'PDC_OVERDUE',
        severity: 'CRITICAL',
        title: `PDC overdue by ${Math.abs(daysToPdc)} day(s)`,
        triggerContext: `Effective PDC ${new Date(pdc).toISOString().slice(0, 10)} passed without completion.`,
      });
    } else if (daysToPdc >= 0 && daysToPdc <= PDC_NEAR_DAYS && !woCompleted) {
      desired.push({
        closureId: null,
        type: 'PDC_NEAR',
        severity: 'WARNING',
        title: `PDC in ${daysToPdc} day(s)`,
        triggerContext: `Effective PDC ${new Date(pdc).toISOString().slice(0, 10)}.`,
      });
    }
  }

  // ── WO-level: BG expiring ──
  // Use the latest BG entry's validUpto (newest is active).
  const latestBg = wo.bgEntries?.[0];
  if (latestBg?.validUpto && !woClosed) {
    const daysToBgExpiry = Math.ceil((new Date(latestBg.validUpto).getTime() - now.getTime()) / DAY_MS);
    if (daysToBgExpiry >= 0 && daysToBgExpiry <= BG_EXPIRING_DAYS) {
      desired.push({
        closureId: null,
        type: 'BG_EXPIRING',
        severity: 'WARNING',
        title: `Bank Guarantee expires in ${daysToBgExpiry} day(s)`,
        triggerContext: `BG ${latestBg.bgNo} valid upto ${new Date(latestBg.validUpto).toISOString().slice(0, 10)}.`,
      });
    }
  }

  // ── Per-lot alarms ──
  for (const c of wo.closures || []) {
    // Lot stuck at UNIT_DOCS_PENDING for too long (>7 days since opened).
    if (c.stage === 'UNIT_DOCS_PENDING') {
      const opened = new Date(c.deliveredAt || c.createdAt).getTime();
      const days = Math.floor((now.getTime() - opened) / DAY_MS);
      if (days >= QC_PENDING_DAYS) {
        desired.push({
          closureId: c.id,
          type: 'LOT_QC_PENDING',
          severity: 'WARNING',
          title: `Lot #${c.cycleNumber} awaiting QC for ${days} day(s)`,
          triggerContext: `Lot opened ${new Date(opened).toISOString().slice(0, 10)}, still UNIT_DOCS_PENDING.`,
        });
      }
    }

    if (c.stage === 'ON_HOLD') {
      desired.push({
        closureId: c.id,
        type: 'LOT_ON_HOLD',
        severity: 'WARNING',
        title: `Lot #${c.cycleNumber} on hold`,
        triggerContext: `Lot returned for missing items / corrections.`,
      });
    }

    if (c.stage === 'INVOICE_SENT' && c.slaDeadlineAt && now > new Date(c.slaDeadlineAt)) {
      const hoursOver = Math.round((now.getTime() - new Date(c.slaDeadlineAt).getTime()) / (60 * 60 * 1000));
      desired.push({
        closureId: c.id,
        type: 'SLA_BREACH_48H',
        severity: 'CRITICAL',
        title: `Lot #${c.cycleNumber} SLA breached (${hoursOver}h over)`,
        triggerContext: `Invoice ${c.invoiceNumber || ''} sent ${new Date(c.invoiceSentAt).toISOString()}, no signed ack yet.`,
      });
    }

    if (c.stage === 'DELIVERY_ACKNOWLEDGED' && c.paymentDueAt) {
      const daysLeft = Math.ceil((new Date(c.paymentDueAt).getTime() - now.getTime()) / DAY_MS);
      if (daysLeft < 0) {
        desired.push({
          closureId: c.id,
          type: 'PAYMENT_OVERDUE',
          severity: 'CRITICAL',
          title: `Lot #${c.cycleNumber} payment overdue by ${Math.abs(daysLeft)} day(s)`,
          triggerContext: `Invoice ${c.invoiceNumber || ''} — 45-day window expired ${new Date(c.paymentDueAt).toISOString().slice(0, 10)}.`,
        });
      } else if (daysLeft <= PAY_DUE_SOON_DAYS) {
        desired.push({
          closureId: c.id,
          type: 'PAYMENT_DUE_SOON',
          severity: 'INFO',
          title: `Lot #${c.cycleNumber} payment due in ${daysLeft} day(s)`,
          triggerContext: `Invoice ${c.invoiceNumber || ''} — pay window ends ${new Date(c.paymentDueAt).toISOString().slice(0, 10)}.`,
        });
      }
    }
  }

  return desired;
}

// Sync alarms for a single WO. Inserts any missing ACTIVE alarms, and
// auto-resolves ACTIVE/ACKNOWLEDGED rows that no longer apply.
async function syncAlarmsForWO(workOrderId, now = new Date()) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      extensions: { orderBy: { extensionNo: 'asc' } },
      closures:   { orderBy: { cycleNumber: 'asc' } },
      bgEntries:  { orderBy: { addedAt: 'desc' } },
      alarms:     { where: { status: { in: ['ACTIVE', 'ACKNOWLEDGED'] } } },
    },
  });
  if (!wo) return { created: 0, resolved: 0 };

  const desired = computeDesiredAlarms(wo, now);
  const desiredKey = (a) => `${a.closureId || ''}::${a.type}`;
  const desiredSet = new Set(desired.map(desiredKey));

  let created = 0;
  let resolved = 0;

  for (const want of desired) {
    const match = wo.alarms.find(
      (a) => a.type === want.type && (a.closureId || null) === (want.closureId || null),
    );
    if (match) continue;
    // Try to insert; the unique index prevents duplicates if another run races.
    try {
      await prisma.workOrderAlarm.create({
        data: {
          workOrderId: wo.id,
          closureId: want.closureId,
          type: want.type,
          severity: want.severity,
          title: want.title,
          triggerContext: want.triggerContext || null,
          status: 'ACTIVE',
        },
      });
      created += 1;
    } catch (err) {
      if (err?.code !== 'P2002') throw err; // ignore unique-violation
    }
  }

  for (const existing of wo.alarms) {
    const key = `${existing.closureId || ''}::${existing.type}`;
    if (!desiredSet.has(key)) {
      await prisma.workOrderAlarm.update({
        where: { id: existing.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: now,
          resolveRemark: '(auto-resolved: trigger no longer applies)',
          notes: {
            create: {
              authorId: existing.acknowledgedById || existing.resolvedById || (await getSystemUserId()),
              body: 'Auto-resolved by system — trigger no longer applies.',
              kind: 'SYSTEM',
            },
          },
        },
      });
      resolved += 1;
    }
  }

  return { created, resolved };
}

// Resolve a system user we can credit auto-resolutions to. Falls back to the
// first ADMIN. Cached for the process lifetime.
let _systemUserIdCache = null;
async function getSystemUserId() {
  if (_systemUserIdCache) return _systemUserIdCache;
  const admin = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  _systemUserIdCache = admin?.id || null;
  return _systemUserIdCache;
}

// Sync alarms across all live WOs (cron target).
async function syncAllAlarms(now = new Date()) {
  const wos = await prisma.workOrder.findMany({
    where: { status: { notIn: ['CLOSED', 'CANCELLED', 'REJECTED'] } },
    select: { id: true },
  });
  let created = 0;
  let resolved = 0;
  for (const wo of wos) {
    const r = await syncAlarmsForWO(wo.id, now);
    created += r.created;
    resolved += r.resolved;
  }
  return { processed: wos.length, created, resolved };
}

module.exports = {
  computeDesiredAlarms,
  syncAlarmsForWO,
  syncAllAlarms,
};
