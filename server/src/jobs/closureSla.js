// ────────────────────────────────────────────────────────────────
// Work Order Closure schedulers (per-cycle + per-WO).
//
// Closure cycles live in WorkOrderClosure. Three timers run during the lifecycle:
//   • 48h SLA (stage = INVOICE_SENT) — Finance must get the signed delivery
//     paper back and acknowledge it before this expires.
//   • 45-day payment window (stage = DELIVERY_ACKNOWLEDGED) — Accounts must
//     collect payment before paymentDueAt or the cycle is "delayed".
//   • Weekly follow-up reminder during DELIVERY_ACKNOWLEDGED — admins/accounts
//     contact the customer once a week and log the conversation.
//
// And on the WorkOrder itself:
//   • 3-month PDC alert — fires once when the PDC date is <= 90 days away.
//     Admin acknowledges with a note and the alert stops.
//
// Scheduled jobs:
//   1. run24hReminder()       — hourly. 48h SLA pre-expiry reminder.
//   2. runSlaBreachCheck()    — every 30 min. 48h SLA breach flag.
//   3. runPaymentBreachCheck()— every 30 min. 45-day payment window breach.
//   4. runWeeklyFollowupNotify() — hourly. Tells Accounts to do this week's
//      customer follow-up if the previous one is >= 7 days old.
//   5. runPdcAlertNotify()    — daily. Fires the 3-month PDC alert to admins
//      once per WO when it enters the alert window.
//
// All jobs are idempotent — re-running within the cron window is safe.
// QC and MANAGER are deliberately NOT notified: payment/SLA is finance/admin scope.
// ────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const prisma = require('../config/db');
const { syncAllAlarms } = require('../services/workOrderAlarms');

const L5_USERNAMES = ['sureshbabu', 'rameshbabu', 'madhubabu'];
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const PDC_ALERT_DAYS = 90;
const FINANCE_ROLES = ['FINANCE', 'ACCOUNTING'];

const SYSTEM_USER_ID = null; // notifications without a sender — system-generated

const fetchL5Ids = async () => {
  const rows = await prisma.user.findMany({
    where: { username: { in: L5_USERNAMES } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
};

async function run24hReminder(now = new Date()) {
  const cutoff = new Date(now.getTime() - REMINDER_INTERVAL_MS);
  const candidates = await prisma.workOrderClosure.findMany({
    where: {
      stage: 'INVOICE_SENT',
      slaDeadlineAt: { gt: now },
      OR: [
        { last24hReminderAt: null },
        { last24hReminderAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      cycleNumber: true,
      slaDeadlineAt: true,
      invoiceSentAt: true,
      invoiceNumber: true,
      workOrder: { select: { workOrderNumber: true, customerName: true } },
    },
  });

  if (!candidates.length) return { reminded: 0 };

  const l5Ids = await fetchL5Ids();

  let reminded = 0;
  for (const c of candidates) {
    const hoursLeft = Math.max(
      0,
      Math.round((new Date(c.slaDeadlineAt).getTime() - now.getTime()) / (1000 * 60 * 60)),
    );
    const title = `WO ${c.workOrder.workOrderNumber} cycle #${c.cycleNumber} — ${hoursLeft}h left on SLA`;
    const message = `Invoice ${c.invoiceNumber || '(no number)'} to ${c.workOrder.customerName}. SLA window ends ${new Date(c.slaDeadlineAt).toLocaleString('en-IN')}. Please follow up if not yet cleared.`;
    const rows = [];
    for (const userId of l5Ids) {
      rows.push({ type: 'WO_CLOSURE_SLA_REMINDER', title, message, targetUserId: userId, sentById: SYSTEM_USER_ID });
    }
    for (const role of FINANCE_ROLES) {
      rows.push({ type: 'WO_CLOSURE_SLA_REMINDER', title, message, targetRole: role, sentById: SYSTEM_USER_ID });
    }
    if (rows.length) await prisma.notification.createMany({ data: rows });
    await prisma.workOrderClosure.update({
      where: { id: c.id },
      data: { last24hReminderAt: now },
    });
    reminded += 1;
  }
  return { reminded };
}

async function runSlaBreachCheck(now = new Date()) {
  const breached = await prisma.workOrderClosure.findMany({
    where: {
      stage: 'INVOICE_SENT',
      slaDeadlineAt: { lt: now },
      slaBreachedAt: null,
    },
    select: {
      id: true,
      cycleNumber: true,
      slaDeadlineAt: true,
      invoiceNumber: true,
      workOrder: { select: { workOrderNumber: true, customerName: true } },
    },
  });
  if (!breached.length) return { breached: 0 };

  const l5Ids = await fetchL5Ids();

  for (const c of breached) {
    const title = `WO ${c.workOrder.workOrderNumber} cycle #${c.cycleNumber} — SLA BREACHED`;
    const message = `48h SLA expired at ${new Date(c.slaDeadlineAt).toLocaleString('en-IN')} (invoice ${c.invoiceNumber || '(no number)'}, customer ${c.workOrder.customerName}). Escalation required.`;
    const rows = [];
    for (const userId of l5Ids) {
      rows.push({ type: 'WO_CLOSURE_SLA_BREACH', title, message, targetUserId: userId, sentById: SYSTEM_USER_ID });
    }
    for (const role of FINANCE_ROLES) {
      rows.push({ type: 'WO_CLOSURE_SLA_BREACH', title, message, targetRole: role, sentById: SYSTEM_USER_ID });
    }
    if (rows.length) await prisma.notification.createMany({ data: rows });
    await prisma.workOrderClosure.update({
      where: { id: c.id },
      data: { slaBreachedAt: now },
    });
  }
  return { breached: breached.length };
}

// 45-day payment window — flag delayed once when due date passes.
async function runPaymentBreachCheck(now = new Date()) {
  const delayed = await prisma.workOrderClosure.findMany({
    where: {
      stage: 'DELIVERY_ACKNOWLEDGED',
      paymentDueAt: { lt: now },
      paymentDelayedAt: null,
    },
    select: {
      id: true,
      cycleNumber: true,
      paymentDueAt: true,
      invoiceNumber: true,
      workOrder: { select: { workOrderNumber: true, customerName: true } },
    },
  });
  if (!delayed.length) return { delayed: 0 };

  const l5Ids = await fetchL5Ids();

  for (const c of delayed) {
    const title = `WO ${c.workOrder.workOrderNumber} cycle #${c.cycleNumber} — Payment DELAYED (45d window expired)`;
    const message = `45-day payment window expired on ${new Date(c.paymentDueAt).toLocaleString('en-IN')} for invoice ${c.invoiceNumber || '(no number)'}, customer ${c.workOrder.customerName}. Escalate collection.`;
    const rows = [];
    for (const userId of l5Ids) {
      rows.push({ type: 'WO_CLOSURE_PAYMENT_DELAYED', title, message, targetUserId: userId, sentById: SYSTEM_USER_ID });
    }
    for (const role of FINANCE_ROLES) {
      rows.push({ type: 'WO_CLOSURE_PAYMENT_DELAYED', title, message, targetRole: role, sentById: SYSTEM_USER_ID });
    }
    rows.push({ type: 'WO_CLOSURE_PAYMENT_DELAYED', title, message, targetRole: 'ADMIN', sentById: SYSTEM_USER_ID });
    if (rows.length) await prisma.notification.createMany({ data: rows });
    await prisma.workOrderClosure.update({
      where: { id: c.id },
      data: { paymentDelayedAt: now },
    });
  }
  return { delayed: delayed.length };
}

// Weekly customer-contact reminder during the 45-day window.
// Fires when no follow-up has happened in the past 7 days (either
// lastWeeklyReminderAt is null/old, or the cycle just entered the stage).
async function runWeeklyFollowupNotify(now = new Date()) {
  const cutoff = new Date(now.getTime() - WEEKLY_INTERVAL_MS);
  const candidates = await prisma.workOrderClosure.findMany({
    where: {
      stage: 'DELIVERY_ACKNOWLEDGED',
      OR: [
        { lastWeeklyReminderAt: null, deliveryAckAt: { lt: cutoff } },
        { lastWeeklyReminderAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      cycleNumber: true,
      paymentDueAt: true,
      invoiceNumber: true,
      workOrder: { select: { workOrderNumber: true, customerName: true } },
    },
  });
  if (!candidates.length) return { notified: 0 };

  for (const c of candidates) {
    const daysLeft = c.paymentDueAt
      ? Math.ceil((new Date(c.paymentDueAt).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const title = `WO ${c.workOrder.workOrderNumber} cycle #${c.cycleNumber} — Weekly customer follow-up due`;
    const tail = daysLeft != null
      ? (daysLeft >= 0 ? `${daysLeft} day(s) left in 45-day window.` : `Payment window expired ${Math.abs(daysLeft)} day(s) ago.`)
      : '';
    const message = `Contact ${c.workOrder.customerName} about invoice ${c.invoiceNumber || '(no number)'} and log the response. ${tail}`.trim();
    const rows = [
      { type: 'WO_CLOSURE_WEEKLY_FOLLOWUP', title, message, targetRole: 'ACCOUNTING', sentById: SYSTEM_USER_ID },
      { type: 'WO_CLOSURE_WEEKLY_FOLLOWUP', title, message, targetRole: 'ADMIN', sentById: SYSTEM_USER_ID },
    ];
    await prisma.notification.createMany({ data: rows });
    await prisma.workOrderClosure.update({
      where: { id: c.id },
      data: { lastWeeklyReminderAt: now },
    });
  }
  return { notified: candidates.length };
}

// 3-month PDC alert — fires once per WO when PDC date enters the alert window.
// Admin clears it via the acknowledgement endpoint (pdc3MonthAckAt set).
async function runPdcAlertNotify(now = new Date()) {
  const alertCutoff = new Date(now.getTime() + PDC_ALERT_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.workOrder.findMany({
    where: {
      pdcDate: { not: null, gt: now, lte: alertCutoff },
      pdc3MonthAckAt: null,
      status: { notIn: ['CLOSED', 'CANCELLED', 'REJECTED'] },
    },
    select: {
      id: true,
      workOrderNumber: true,
      customerName: true,
      pdcDate: true,
      pdc3MonthAlertNotifiedAt: true,
    },
  });
  if (!candidates.length) return { alerted: 0 };

  let alerted = 0;
  for (const wo of candidates) {
    if (wo.pdc3MonthAlertNotifiedAt) continue; // one-shot
    const daysLeft = Math.ceil((new Date(wo.pdcDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const title = `WO ${wo.workOrderNumber} — PDC due in ${daysLeft} day(s)`;
    const message = `PDC for ${wo.customerName} expires on ${new Date(wo.pdcDate).toLocaleDateString('en-IN')}. Acknowledge from the Work Order to stop the alert.`;
    const rows = [
      { type: 'WO_PDC_3MONTH_ALERT', title, message, targetRole: 'ADMIN', sentById: SYSTEM_USER_ID },
    ];
    await prisma.notification.createMany({ data: rows });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: { pdc3MonthAlertNotifiedAt: now },
    });
    alerted += 1;
  }
  return { alerted };
}

function startSchedulers() {
  // Hourly at minute 5 — 48h SLA reminder.
  cron.schedule('5 * * * *', async () => {
    try {
      const out = await run24hReminder();
      if (out.reminded) console.log(`[closureSla] 24h reminder fired for ${out.reminded} cycle(s)`);
    } catch (err) {
      console.error('[closureSla] 24h reminder failed:', err.message);
    }
  });

  // Every 30 minutes — 48h SLA breach.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const out = await runSlaBreachCheck();
      if (out.breached) console.log(`[closureSla] SLA breach flagged on ${out.breached} cycle(s)`);
    } catch (err) {
      console.error('[closureSla] SLA breach check failed:', err.message);
    }
  });

  // Every 30 minutes at :15 — 45-day payment breach.
  cron.schedule('15,45 * * * *', async () => {
    try {
      const out = await runPaymentBreachCheck();
      if (out.delayed) console.log(`[closureSla] payment delayed flagged on ${out.delayed} cycle(s)`);
    } catch (err) {
      console.error('[closureSla] payment breach check failed:', err.message);
    }
  });

  // Hourly at minute 20 — weekly follow-up nudge.
  cron.schedule('20 * * * *', async () => {
    try {
      const out = await runWeeklyFollowupNotify();
      if (out.notified) console.log(`[closureSla] weekly follow-up notified on ${out.notified} cycle(s)`);
    } catch (err) {
      console.error('[closureSla] weekly follow-up notify failed:', err.message);
    }
  });

  // Daily at 09:10 IST-ish — 3-month PDC alert.
  cron.schedule('10 9 * * *', async () => {
    try {
      const out = await runPdcAlertNotify();
      if (out.alerted) console.log(`[closureSla] PDC 3-month alert fired for ${out.alerted} WO(s)`);
    } catch (err) {
      console.error('[closureSla] PDC alert notify failed:', err.message);
    }
  });

  // Every 10 minutes — recompute WO alarms across all live WOs.
  cron.schedule('*/10 * * * *', async () => {
    try {
      const out = await syncAllAlarms();
      if (out.created || out.resolved) {
        console.log(`[closureSla] alarms: +${out.created} new, -${out.resolved} resolved across ${out.processed} WO(s)`);
      }
    } catch (err) {
      console.error('[closureSla] alarm sync failed:', err.message);
    }
  });

  console.log('[closureSla] schedulers started: 48h SLA + 45d payment + weekly follow-up + PDC alert + alarms');
}

module.exports = {
  startSchedulers,
  run24hReminder,
  runSlaBreachCheck,
  runPaymentBreachCheck,
  runWeeklyFollowupNotify,
  runPdcAlertNotify,
};
