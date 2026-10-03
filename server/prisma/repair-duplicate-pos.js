// ────────────────────────────────────────────────────────────────
// One-off repair: duplicate purchase orders from repeated quotation approval.
//
// WHAT WENT WRONG
// Approving a quotation de-selected every OTHER quotation on the same PR, even
// when the two quoted for completely different items (a PR is routinely split
// across suppliers). The de-selected quotation's items fell back to "quotation
// submitted", so the PR looked un-progressed - and whoever was watching it
// approved again. Each re-approval created a FRESH set of purchase orders and
// incremented purchasedQty on every PR item again.
//
// The cause is fixed in routes/quotation.routes.js (coverage-scoped de-selection
// + an idempotency guard). This script cleans up what the bug already produced.
//
// WHAT IT DOES
//   1. Deletes duplicate POs that were never acted on - no payments, no inward
//      rows, nothing paid, still PENDING_ACCOUNTING, and not the keeper of their
//      group. Items/allocations go with them by FK cascade.
//   2. Re-selects quotations that produced POs but ended up isSelected=false.
//   3. Recomputes purchasedQty on every PR item from the surviving POs.
//   4. Recomputes per-item quotation status and each PR's status.
//
// WHAT IT REFUSES TO DO
// If a group has more than one PO carrying real activity (a payment, an inward,
// money paid, or a status past PENDING_ACCOUNTING), it deletes NOTHING in that
// group and prints it for a human to settle. Numbered-but-idle orders are
// likewise left alone unless they are plainly surplus - a PO number that has
// been written into somebody's register is not ours to silently remove.
//
// USAGE  (dry run prints the plan and changes nothing)
//   node prisma/repair-duplicate-pos.js
//   node prisma/repair-duplicate-pos.js --apply
// ────────────────────────────────────────────────────────────────

const prisma = require('../src/config/db');
const { recomputePRItemQuotationStatus, syncPRStatusAfterChange } = require('../src/utils/prClosure');

const APPLY = process.argv.includes('--apply');
const log = (...a) => console.log(...a);

// A PO nobody has touched: safe to remove when it is a surplus copy.
const isIdle = (po) => po.status === 'PENDING_ACCOUNTING'
  && (po.totalPaid || 0) === 0
  && po._payments === 0
  && po._inwards === 0;

// Ranking for "which copy is the real one": activity first, then a PO number,
// then whichever was created first.
const keeperScore = (po) => (
  (po._payments > 0 ? 8 : 0)
  + (po._inwards > 0 ? 4 : 0)
  + ((po.totalPaid || 0) > 0 ? 2 : 0)
  + (po.status !== 'PENDING_ACCOUNTING' ? 1 : 0)
);

async function main() {
  log(`\n=== Duplicate PO repair - ${APPLY ? 'APPLY' : 'DRY RUN (no changes)'} ===\n`);

  // No where-clause on quotationId: the deployed client generates it as a
  // non-nullable String, so a null filter is rejected outright. Filter in JS.
  const allOrders = await prisma.purchaseOrder.findMany({
    select: {
      id: true, orderNumber: true, status: true, totalPaid: true, totalAmount: true,
      createdAt: true, quotationId: true, supplierName: true, purchaseRequestId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const orders = allOrders.filter(o => o.quotationId);

  // Activity counts, in two queries rather than two per order.
  const [inwardRows, paymentRows] = await Promise.all([
    prisma.materialInwardRegister.groupBy({
      by: ['purchaseOrderId'],
      where: { purchaseOrderId: { in: orders.map(o => o.id) } },
      _count: { _all: true },
    }),
    prisma.paymentRequest.groupBy({
      by: ['purchaseOrderId'],
      where: { purchaseOrderId: { in: orders.map(o => o.id) } },
      _count: { _all: true },
    }),
  ]);
  const inwardBy = Object.fromEntries(inwardRows.map(r => [r.purchaseOrderId, r._count._all]));
  const payBy = Object.fromEntries(paymentRows.map(r => [r.purchaseOrderId, r._count._all]));
  orders.forEach((o) => {
    o._inwards = inwardBy[o.id] || 0;
    o._payments = payBy[o.id] || 0;
  });

  // Group by quotation + supplier: one PO per supplier per quotation is correct.
  const groups = new Map();
  for (const o of orders) {
    const key = `${o.quotationId}::${(o.supplierName || '').trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const toDelete = [];
  const needsHuman = [];

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const active = list.filter(o => !isIdle(o));

    if (active.length > 1) {
      needsHuman.push({ key, list });
      continue;
    }
    // Keeper: the active one if there is exactly one, else the best-ranked.
    const keeper = active.length === 1
      ? active[0]
      : [...list].sort((a, b) => keeperScore(b) - keeperScore(a)
        || (b.orderNumber ? 1 : 0) - (a.orderNumber ? 1 : 0)
        || a.createdAt - b.createdAt)[0];

    const surplus = list.filter(o => o.id !== keeper.id && isIdle(o));
    const stubborn = list.filter(o => o.id !== keeper.id && !isIdle(o));
    if (stubborn.length) needsHuman.push({ key, list });

    log(`${keeper.supplierName}  (${list.length} orders)`);
    log(`   KEEP   ${keeper.orderNumber || '(no number)'}  ${keeper.status}  paid=${keeper.totalPaid || 0}  inwards=${keeper._inwards}  payments=${keeper._payments}`);
    surplus.forEach((o) => {
      log(`   DELETE ${o.orderNumber || '(no number)'}  ${o.status}  created ${o.createdAt.toISOString().slice(0, 16)}`);
      toDelete.push(o);
    });
    log('');
  }

  // Quotations whose selection flag was knocked off by the bug.
  const quotationIds = [...new Set(orders.map(o => o.quotationId))];
  const unflagged = await prisma.quotation.findMany({
    where: { id: { in: quotationIds }, isSelected: false, supersededAt: null },
    select: { id: true, quotationNumber: true },
  });

  log(`── Plan ──`);
  log(`  duplicate POs to delete : ${toDelete.length}`);
  log(`  quotations to re-select : ${unflagged.length}  ${unflagged.map(q => q.quotationNumber).join(', ')}`);
  log(`  groups needing a human  : ${needsHuman.length}`);
  needsHuman.forEach(({ list }) => {
    log(`     ${list[0].supplierName}: ${list.map(o => `${o.orderNumber || '(no number)'}/${o.status}${o._inwards ? `+${o._inwards} inward` : ''}${o._payments ? `+${o._payments} payment` : ''}`).join('  |  ')}`);
  });

  if (!APPLY) {
    log('\nDry run - nothing was changed. Re-run with --apply to carry this out.\n');
    return;
  }

  // ── Apply ──
  if (toDelete.length) {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: toDelete.map(o => o.id) } } });
    log(`\nDeleted ${toDelete.length} duplicate purchase order(s).`);
  }
  if (unflagged.length) {
    await prisma.quotation.updateMany({
      where: { id: { in: unflagged.map(q => q.id) } },
      data: { isSelected: true },
    });
    log(`Re-selected ${unflagged.length} quotation(s).`);
  }

  // Rebuild purchasedQty from what actually survives, instead of trusting the
  // increments the duplicate approvals left behind.
  const poItems = await prisma.purchaseOrderItem.findMany({
    select: {
      quantity: true, purchaseRequestItemId: true,
      allocations: { select: { purchaseRequestItemId: true, allocatedQty: true } },
    },
  });
  const purchasedBy = new Map();
  for (const it of poItems) {
    if (it.allocations?.length) {
      for (const a of it.allocations) {
        purchasedBy.set(a.purchaseRequestItemId, (purchasedBy.get(a.purchaseRequestItemId) || 0) + (a.allocatedQty || 0));
      }
    } else if (it.purchaseRequestItemId) {
      purchasedBy.set(it.purchaseRequestItemId, (purchasedBy.get(it.purchaseRequestItemId) || 0) + (it.quantity || 0));
    }
  }

  const prItems = await prisma.purchaseRequestItem.findMany({ select: { id: true, purchasedQty: true, requestId: true } });
  let fixedQty = 0;
  for (const pi of prItems) {
    const should = purchasedBy.get(pi.id) || 0;
    if (Math.abs((pi.purchasedQty || 0) - should) > 0.0001) {
      await prisma.purchaseRequestItem.update({ where: { id: pi.id }, data: { purchasedQty: should } });
      fixedQty += 1;
    }
  }
  log(`Corrected purchasedQty on ${fixedQty} PR item(s).`);

  // Finally re-derive the statuses everything downstream reads.
  const prIds = [...new Set(prItems.map(i => i.requestId))];
  for (const prId of prIds) {
    const ids = prItems.filter(i => i.requestId === prId).map(i => i.id);
    await recomputePRItemQuotationStatus(prisma, ids);
    await syncPRStatusAfterChange(prisma, prId);
  }
  log(`Recomputed item + PR status for ${prIds.length} purchase request(s).\n`);
}

main()
  .catch((e) => { console.error('repair failed:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
