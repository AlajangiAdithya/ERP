// ────────────────────────────────────────────────────────────────
// Offsite MIV chaser.
//
// An offsite MIV (ANSP, CPDC, Adibatla, RCI …) is NOT issued from store stock -
// an Admin approves it, then Stores dispatches it on a gate pass. The admin is
// notified once, when it is raised. If that notification is missed the MIV simply
// sits at PENDING: Stores cannot act on it (by design), the requester sees no
// movement, and nothing in the system ever mentions it again.
//
// That is exactly how RAPS/MIV/26-27/242 sat untouched for 27 days.
//
// This job re-raises anything still waiting:
//   • PENDING  → the admins, who owe the approval decision;
//   • APPROVED / PARTIAL with qty still owing → Stores, who owe the dispatch.
//
// Idempotency without a schema change: a MIV is skipped if a reminder of the same
// type already went out for it in the last 20 hours. The request number is carried
// in the notification title, which is what the lookup matches on.
// ────────────────────────────────────────────────────────────────

const cron = require('node-cron');
const prisma = require('../config/db');

const DAY_MS = 24 * 60 * 60 * 1000;
// Grace period before the first nudge - a MIV raised this morning is not "stuck".
const QUIET_HOURS = 48;
const REPEAT_WINDOW_MS = 20 * 60 * 60 * 1000;

const TYPE_PENDING = 'OFFSITE_MIV_PENDING';
const TYPE_DISPATCH = 'OFFSITE_MIV_DISPATCH_DUE';

const ageInDays = (from, now) => Math.max(0, Math.floor((now - new Date(from)) / DAY_MS));

async function runOffsiteMivReminders(now = new Date()) {
  const cutoff = new Date(now.getTime() - QUIET_HOURS * 60 * 60 * 1000);

  const stuck = await prisma.productRequest.findMany({
    where: {
      unit: { isOffsite: true },
      status: { in: ['PENDING', 'APPROVED', 'PARTIAL'] },
      createdAt: { lt: cutoff },
    },
    select: {
      id: true, requestNumber: true, status: true, createdAt: true,
      unit: { select: { name: true, code: true } },
      manager: { select: { id: true, name: true } },
      items: { select: { quantity: true, approvedQty: true, dispatchedQty: true } },
    },
  });
  if (stuck.length === 0) return { reminded: 0 };

  // What already went out recently, so a daily run doesn't nag twice.
  const recent = await prisma.notification.findMany({
    where: {
      type: { in: [TYPE_PENDING, TYPE_DISPATCH] },
      createdAt: { gt: new Date(now.getTime() - REPEAT_WINDOW_MS) },
    },
    select: { title: true },
  });
  const alreadyNudged = (requestNumber) => recent.some((n) => (n.title || '').includes(requestNumber));

  const notes = [];
  for (const r of stuck) {
    if (alreadyNudged(r.requestNumber)) continue;

    const days = ageInDays(r.createdAt, now);
    const where = r.unit?.name || 'an offsite unit';
    const raisedBy = r.manager?.name ? ` raised by ${r.manager.name}` : '';

    if (r.status === 'PENDING') {
      notes.push({
        type: TYPE_PENDING,
        title: `Offsite MIV awaiting your approval: ${r.requestNumber}`,
        message: `${r.requestNumber} for ${where}${raisedBy} has been waiting ${days} day${days === 1 ? '' : 's'} for admin approval. Stores cannot issue an offsite MIV - it needs your approval before it can be dispatched on a gate pass.`,
        targetRole: 'ADMIN',
      });
    } else {
      // Approved but not fully out of the door.
      const owing = r.items.reduce((t, i) => t + Math.max(0, (i.approvedQty ?? i.quantity) - (i.dispatchedQty || 0)), 0);
      if (owing <= 0.001) continue;
      notes.push({
        type: TYPE_DISPATCH,
        title: `Offsite MIV awaiting dispatch: ${r.requestNumber}`,
        message: `${r.requestNumber} for ${where} was approved ${days} day${days === 1 ? '' : 's'} ago and still has quantity to go out. Build its gate pass from the Offsite Dispatch tab (lines with no stock can wait - dispatch what is available and the MIV stays partial).`,
        targetRole: 'STORE_MANAGER',
      });
    }
  }

  if (notes.length) await prisma.notification.createMany({ data: notes });
  return { reminded: notes.length };
}

function startSchedulers() {
  // Daily at 08:20 - just after the FIM return chaser, before the day gets going.
  cron.schedule('20 8 * * *', async () => {
    try {
      const out = await runOffsiteMivReminders();
      if (out.reminded) console.log(`[offsiteMiv] nudged ${out.reminded} stuck offsite MIV(s)`);
    } catch (err) {
      console.error('[offsiteMiv] reminder run failed:', err.message);
    }
  });
}

module.exports = { startSchedulers, runOffsiteMivReminders, QUIET_HOURS };
