// ────────────────────────────────────────────────────────────────
// FIM return-date reminders.
//
// A RETURNABLE FIM is customer property we are holding: it has a probable return
// date on the inward gate-pass line, and it has to physically go back before that
// date. Nothing used to chase it - the countdown only existed on screen, so an
// overdue return was invisible unless somebody opened the register.
//
// This job nudges the people who can actually act:
//   • the assigned unit's managers - they mark the FIM ready to send back;
//   • Stores - they raise the outward gate pass;
//   • Admin - only once it is overdue, so the escalation means something.
//
// A FIM is settled once it has physically gone back (the linked outward gate pass
// carries an actualReturnDate, or has been CLOSED). NON_RETURNABLE FIM never
// enters this job - there is nothing to send back.
//
// Idempotent: ProductBatch.fimReturnReminderAt gates it to one notification per
// batch per day, so re-running the cron inside the window is safe.
// ────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const prisma = require('../config/db');

const DAY_MS = 24 * 60 * 60 * 1000;
// How far ahead of the return date the first nudge goes out.
const WARN_DAYS = 7;
const REMINDER_INTERVAL_MS = DAY_MS;

// Whole days from `now` to `date` - negative once the date has passed.
const daysUntil = (date, now) => {
  const a = new Date(date); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / DAY_MS);
};

// Has this FIM physically gone back to the customer?
const isReturned = (item) => (item?.outwardLinkedItems || []).some(
  (l) => l.gatePass?.actualReturnDate || l.gatePass?.status === 'CLOSED',
);

async function runFimReturnReminders(now = new Date()) {
  const cutoff = new Date(now.getTime() - REMINDER_INTERVAL_MS);
  const horizon = new Date(now.getTime() + WARN_DAYS * DAY_MS);

  const batches = await prisma.productBatch.findMany({
    where: {
      isFim: true,
      OR: [
        { fimReturnReminderAt: null },
        { fimReturnReminderAt: { lt: cutoff } },
      ],
      sourceInwardGatePassItem: {
        itemPassType: 'RETURNABLE',
        probableReturnDate: { not: null, lte: horizon },
      },
    },
    select: {
      id: true,
      quantity: true,
      assignedToUnitId: true,
      product: { select: { name: true } },
      assignedToUnit: { select: { name: true, code: true } },
      sourceInwardGatePass: { select: { fimNumber: true, passNumber: true, customerName: true } },
      sourceInwardGatePassItem: {
        select: {
          probableReturnDate: true,
          description: true,
          outwardLinkedItems: {
            select: { gatePass: { select: { status: true, actualReturnDate: true } } },
          },
        },
      },
    },
  });

  const due = batches.filter((b) => !isReturned(b.sourceInwardGatePassItem));
  if (due.length === 0) return { notified: 0, overdue: 0 };

  // One lookup for every unit that owns a due FIM, rather than one per batch.
  const unitIds = [...new Set(due.map((b) => b.assignedToUnitId).filter(Boolean))];
  const managers = unitIds.length
    ? await prisma.user.findMany({
      where: { role: 'MANAGER', unitId: { in: unitIds }, isActive: true },
      select: { id: true, unitId: true },
    })
    : [];
  const managersByUnit = managers.reduce((acc, m) => {
    (acc[m.unitId] = acc[m.unitId] || []).push(m.id);
    return acc;
  }, {});

  const notes = [];
  let overdueCount = 0;

  for (const b of due) {
    const item = b.sourceInwardGatePassItem;
    const left = daysUntil(item.probableReturnDate, now);
    const overdue = left < 0;
    if (overdue) overdueCount += 1;

    const fimRef = b.sourceInwardGatePass?.fimNumber || b.sourceInwardGatePass?.passNumber || 'FIM';
    const what = b.product?.name || item.description || 'FIM material';
    const customer = b.sourceInwardGatePass?.customerName ? ` (${b.sourceInwardGatePass.customerName})` : '';
    const where = b.assignedToUnit
      ? `${b.assignedToUnit.name}${b.assignedToUnit.code ? ` (${b.assignedToUnit.code})` : ''}`
      : 'stores - not yet assigned to a unit';

    const when = overdue
      ? `was due back ${-left} day${-left === 1 ? '' : 's'} ago`
      : left === 0 ? 'is due back today' : `is due back in ${left} day${left === 1 ? '' : 's'}`;

    const title = overdue
      ? `FIM return OVERDUE: ${what}`
      : `FIM return due: ${what}`;
    const message = `${fimRef}${customer} - ${what} (qty ${b.quantity}) ${when}. It is with ${where}. `
      + 'The unit marks it ready to send back; Stores raises the outward gate pass.';
    const type = overdue ? 'FIM_RETURN_OVERDUE' : 'FIM_RETURN_DUE';

    // The unit holding it - the people who have to release it.
    (managersByUnit[b.assignedToUnitId] || []).forEach((id) => {
      notes.push({ type, title, message, targetUserId: id });
    });
    // Stores always: they raise the outward pass, and an unassigned FIM is theirs.
    notes.push({ type, title, message, targetRole: 'STORE_MANAGER' });
    // Admin only once it has actually slipped.
    if (overdue) notes.push({ type, title, message, targetRole: 'ADMIN' });
  }

  if (notes.length) await prisma.notification.createMany({ data: notes });
  await prisma.productBatch.updateMany({
    where: { id: { in: due.map((b) => b.id) } },
    data: { fimReturnReminderAt: now },
  });

  return { notified: due.length, overdue: overdueCount };
}

function startSchedulers() {
  // Daily at 08:10 - before the shift gets going, after the overnight data settles.
  cron.schedule('10 8 * * *', async () => {
    try {
      const out = await runFimReturnReminders();
      if (out.notified) {
        console.log(`[fimReturns] reminded on ${out.notified} FIM batch(es), ${out.overdue} overdue`);
      }
    } catch (err) {
      console.error('[fimReturns] reminder run failed:', err.message);
    }
  });
}

module.exports = { startSchedulers, runFimReturnReminders, WARN_DAYS };
