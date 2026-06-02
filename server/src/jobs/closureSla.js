// ────────────────────────────────────────────────────────────────
// Work Order Closure — 48h SLA scheduler.
//
// Two scheduled jobs:
//   1. run24hReminder() — hourly. For every WO in CUSTOMER_CONTACTED with an
//      open deadline, if more than 24 hours have passed since the last reminder
//      (or no reminder yet), fire one Notification per L5 user + one to each of
//      FINANCE/QC/ACCOUNTING with the remaining hours.
//   2. runSlaBreachCheck() — every 30 min. For every WO whose slaDeadlineAt has
//      passed while still in CUSTOMER_CONTACTED, mark slaBreachedAt and fire an
//      escalation notification to all L5 users.
//
// Both jobs are idempotent so re-running them within the cron window is safe.
// ────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const prisma = require('../config/db');

const L5_USERNAMES = ['sureshbabu', 'rameshbabu', 'madhubabu'];
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

const SYSTEM_USER_ID = null; // notifications without a sender — system-generated

async function run24hReminder(now = new Date()) {
  const cutoff = new Date(now.getTime() - REMINDER_INTERVAL_MS);
  const candidates = await prisma.workOrder.findMany({
    where: {
      closureStage: 'CUSTOMER_CONTACTED',
      slaDeadlineAt: { gt: now },
      OR: [
        { last24hReminderAt: null },
        { last24hReminderAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true, workOrderNumber: true, customerName: true,
      slaDeadlineAt: true, customerContactedAt: true,
    },
  });

  if (!candidates.length) return { reminded: 0 };

  const l5Users = await prisma.user.findMany({
    where: { username: { in: L5_USERNAMES } },
    select: { id: true },
  });

  let reminded = 0;
  for (const wo of candidates) {
    const hoursLeft = Math.max(0, Math.round((new Date(wo.slaDeadlineAt).getTime() - now.getTime()) / (1000 * 60 * 60)));
    const title = `WO ${wo.workOrderNumber} — ${hoursLeft}h left on SLA`;
    const message = `Customer ${wo.customerName}. SLA window ends ${new Date(wo.slaDeadlineAt).toLocaleString('en-IN')}. Please follow up if not yet cleared.`;
    const rows = [];
    for (const u of l5Users) {
      rows.push({ type: 'WO_CLOSURE_SLA_REMINDER', title, message, targetUserId: u.id, sentById: SYSTEM_USER_ID });
    }
    for (const role of ['FINANCE', 'QC', 'ACCOUNTING']) {
      rows.push({ type: 'WO_CLOSURE_SLA_REMINDER', title, message, targetRole: role, sentById: SYSTEM_USER_ID });
    }
    if (rows.length) await prisma.notification.createMany({ data: rows });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: { last24hReminderAt: now },
    });
    reminded += 1;
  }
  return { reminded };
}

async function runSlaBreachCheck(now = new Date()) {
  const breached = await prisma.workOrder.findMany({
    where: {
      closureStage: 'CUSTOMER_CONTACTED',
      slaDeadlineAt: { lt: now },
      slaBreachedAt: null,
    },
    select: {
      id: true, workOrderNumber: true, customerName: true, slaDeadlineAt: true,
    },
  });
  if (!breached.length) return { breached: 0 };

  const l5Users = await prisma.user.findMany({
    where: { username: { in: L5_USERNAMES } },
    select: { id: true },
  });

  for (const wo of breached) {
    const title = `WO ${wo.workOrderNumber} — SLA BREACHED`;
    const message = `48h SLA expired at ${new Date(wo.slaDeadlineAt).toLocaleString('en-IN')} (customer ${wo.customerName}). Escalation required.`;
    const rows = [];
    for (const u of l5Users) {
      rows.push({ type: 'WO_CLOSURE_SLA_BREACH', title, message, targetUserId: u.id, sentById: SYSTEM_USER_ID });
    }
    for (const role of ['FINANCE', 'ACCOUNTING']) {
      rows.push({ type: 'WO_CLOSURE_SLA_BREACH', title, message, targetRole: role, sentById: SYSTEM_USER_ID });
    }
    if (rows.length) await prisma.notification.createMany({ data: rows });
    await prisma.workOrder.update({
      where: { id: wo.id },
      data: { slaBreachedAt: now },
    });
  }
  return { breached: breached.length };
}

function startSchedulers() {
  // Hourly at minute 5 — leaves room after the breach job at the half-hour.
  cron.schedule('5 * * * *', async () => {
    try {
      const out = await run24hReminder();
      if (out.reminded) console.log(`[closureSla] 24h reminder fired for ${out.reminded} WO(s)`);
    } catch (err) {
      console.error('[closureSla] 24h reminder failed:', err.message);
    }
  });

  // Every 30 minutes.
  cron.schedule('*/30 * * * *', async () => {
    try {
      const out = await runSlaBreachCheck();
      if (out.breached) console.log(`[closureSla] SLA breach flagged on ${out.breached} WO(s)`);
    } catch (err) {
      console.error('[closureSla] SLA breach check failed:', err.message);
    }
  });

  console.log('[closureSla] schedulers started: 24h reminder (hourly) + SLA breach (30 min)');
}

module.exports = { startSchedulers, run24hReminder, runSlaBreachCheck };
