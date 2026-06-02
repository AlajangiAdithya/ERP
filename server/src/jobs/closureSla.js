// ────────────────────────────────────────────────────────────────
// Work Order Closure — 48h SLA scheduler (per-cycle).
//
// Closure cycles live in WorkOrderClosure. The SLA window starts when Finance
// sends the invoice (stage = INVOICE_SENT) and ends 48h later. Accounts then
// has to confirm payment received (stage = PAYMENT_RECEIVED), which closes
// the cycle and stops the clock.
//
// Two scheduled jobs:
//   1. run24hReminder() — hourly. For every cycle still in INVOICE_SENT with
//      an open deadline, if more than 24 hours have passed since the last
//      reminder (or no reminder yet), notify L5 + FINANCE + ACCOUNTING with
//      hours remaining.
//   2. runSlaBreachCheck() — every 30 min. For every cycle whose slaDeadlineAt
//      has passed while still in INVOICE_SENT, mark slaBreachedAt and fire an
//      escalation notification to L5 + FINANCE + ACCOUNTING.
//
// Both jobs are idempotent — re-running within the cron window is safe.
// QC and MANAGER are deliberately NOT notified: payment/SLA is finance/admin scope.
// ────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const prisma = require('../config/db');

const L5_USERNAMES = ['sureshbabu', 'rameshbabu', 'madhubabu'];
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
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

function startSchedulers() {
  // Hourly at minute 5 — offset from the breach job at the half-hour.
  cron.schedule('5 * * * *', async () => {
    try {
      const out = await run24hReminder();
      if (out.reminded) console.log(`[closureSla] 24h reminder fired for ${out.reminded} cycle(s)`);
    } catch (err) {
      console.error('[closureSla] 24h reminder failed:', err.message);
    }
  });

  // Every 30 minutes.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const out = await runSlaBreachCheck();
      if (out.breached) console.log(`[closureSla] SLA breach flagged on ${out.breached} cycle(s)`);
    } catch (err) {
      console.error('[closureSla] SLA breach check failed:', err.message);
    }
  });

  console.log('[closureSla] schedulers started: 24h reminder (hourly) + SLA breach (30 min)');
}

module.exports = { startSchedulers, run24hReminder, runSlaBreachCheck };
