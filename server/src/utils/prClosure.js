// Per-PR-item quotation status sync + PR closure helpers.
//
// A PR may contain several materials. Each material's quotation lifecycle is
// independent — one can be approved and on a PO while another is still
// waiting on a supplier quote. These helpers compute each item's
// `itemQuotationStatus` from the quotations that reference it, and roll up to
// the overall PR.status so the UI shows accurate per-item badges.
//
// Status priority used when picking the best quotation-state for an item:
//   APPROVED  > SUBMITTED > HELD > AWAITING
// (CANCELLED is set explicitly by force-close and is not derived here.)

// Productnames captured on quotations can differ from the canonical PR-item
// name by stray whitespace / casing. Always normalize for coverage comparisons
// so a single-PR quote's items still match the PR-item they belong to.
const normalizeName = (s) => (s == null ? '' : String(s).trim().toLowerCase());

const PR_ITEM_QUOTATION_STATUS = {
  AWAITING_QUOTATION: 'AWAITING_QUOTATION',
  QUOTATION_SUBMITTED: 'QUOTATION_SUBMITTED',
  QUOTATION_HELD: 'QUOTATION_HELD',
  QUOTATION_APPROVED: 'QUOTATION_APPROVED',
  CANCELLED: 'CANCELLED',
};

const STATUS_RANK = {
  AWAITING_QUOTATION: 0,
  QUOTATION_HELD: 1,
  QUOTATION_SUBMITTED: 2,
  QUOTATION_APPROVED: 3,
};

function pickHigher(a, b) {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

// Walk every Quotation/QuotationItem that references the given PR item ids
// and compute the best per-item quotation status. Items currently CANCELLED
// are left as-is (force-close is sticky).
async function recomputePRItemQuotationStatus(tx, prItemIds) {
  if (!prItemIds || prItemIds.length === 0) return;

  const items = await tx.purchaseRequestItem.findMany({
    where: { id: { in: prItemIds } },
    select: { id: true, requestId: true, productName: true, itemQuotationStatus: true },
  });

  // Group items by parent PR so we can pull quotations once per PR.
  const byPR = new Map();
  for (const it of items) {
    if (!byPR.has(it.requestId)) byPR.set(it.requestId, []);
    byPR.get(it.requestId).push(it);
  }

  for (const [prId, prItems] of byPR) {
    // All quotations linked to this PR (either single-PR via purchaseRequestId,
    // or union via sourceRequests). isSelected=true means approved.
    const quotations = await tx.quotation.findMany({
      where: {
        // Skip soft-archived quotes (a winning competing quote already pushed
        // these out). They're kept in DB for supplier-price history but must
        // not influence the live per-item status rollup.
        supersededAt: null,
        OR: [
          { purchaseRequestId: prId },
          { sourceRequests: { some: { purchaseRequestId: prId } } },
        ],
      },
      select: {
        id: true,
        isUnion: true,
        isSelected: true,
        heldAt: true,
        items: {
          select: {
            productName: true,
            sourceAllocations: true,
          },
        },
      },
    });

    for (const item of prItems) {
      if (item.itemQuotationStatus === PR_ITEM_QUOTATION_STATUS.CANCELLED) continue;

      let best = PR_ITEM_QUOTATION_STATUS.AWAITING_QUOTATION;
      const itemNameKey = normalizeName(item.productName);

      for (const q of quotations) {
        const covers = q.items.some(qi => {
          if (q.isUnion && Array.isArray(qi.sourceAllocations)) {
            return qi.sourceAllocations.some(s => s.purchaseRequestItemId === item.id);
          }
          // Non-union: match by productName (same convention used at PO creation).
          return normalizeName(qi.productName) === itemNameKey;
        });
        if (!covers) continue;

        let derived;
        if (q.isSelected) derived = PR_ITEM_QUOTATION_STATUS.QUOTATION_APPROVED;
        else if (q.heldAt) derived = PR_ITEM_QUOTATION_STATUS.QUOTATION_HELD;
        else derived = PR_ITEM_QUOTATION_STATUS.QUOTATION_SUBMITTED;

        best = pickHigher(best, derived);
      }

      if (best !== item.itemQuotationStatus) {
        await tx.purchaseRequestItem.update({
          where: { id: item.id },
          data: { itemQuotationStatus: best },
        });
      }
    }
  }
}

// After PO creation (or any state change), reconcile PR.status with the
// aggregate item state. Doesn't downgrade past terminal stages.
async function syncPRStatusAfterChange(tx, prId) {
  const pr = await tx.purchaseRequest.findUnique({
    where: { id: prId },
    include: {
      items: { select: { id: true, itemQuotationStatus: true, itemStatus: true } },
    },
  });
  if (!pr) return;

  // A PR only graduates past APPROVED when the PO has explicitly sent a quote
  // to admin. While quotes exist purely as PO drafts, the PR must stay at
  // APPROVED so it doesn't surface in admin's review queue yet.
  const hasSubmittedQuote = await tx.quotation.findFirst({
    where: {
      submittedToAdminAt: { not: null },
      supersededAt: null,
      OR: [
        { purchaseRequestId: prId },
        { sourceRequests: { some: { purchaseRequestId: prId } } },
      ],
    },
    select: { id: true },
  });

  // PRs that are still pending admin / rejected don't get auto-advanced.
  // PRs that have already moved past quotation review (ORDER_PLACED onwards)
  // must not be downgraded back to IN_PROGRESS / QUOTATION_SUBMITTED — the
  // computed `target` below only knows the quotation-stage statuses and would
  // otherwise wipe progress recorded by PO placement, goods receipt, QC, etc.
  if ([
    'PENDING_QC', 'PENDING_ADMIN', 'REJECTED',
    'ORDER_PLACED', 'GOODS_ARRIVED', 'QC_PASSED', 'INWARD_DONE', 'COMPLETED',
    'CASH_PURCHASE',
  ].includes(pr.status)) return;

  const live = pr.items.filter(i => i.itemQuotationStatus !== 'CANCELLED');
  if (live.length === 0) {
    // Everything cancelled → close PR.
    await tx.purchaseRequest.update({ where: { id: prId }, data: { status: 'COMPLETED' } });
    return;
  }

  const everyApproved = live.every(i => i.itemQuotationStatus === 'QUOTATION_APPROVED');
  const anyHeld = live.some(i => i.itemQuotationStatus === 'QUOTATION_HELD');
  const anySubmitted = live.some(i => i.itemQuotationStatus === 'QUOTATION_SUBMITTED');
  const anyApproved = live.some(i => i.itemQuotationStatus === 'QUOTATION_APPROVED');
  const anyAwaiting = live.some(i => i.itemQuotationStatus === 'AWAITING_QUOTATION');

  // Compute target status without ever downgrading a PR past where it already is.
  // AWAITING takes priority over SUBMITTED/HELD because the PR still needs PO
  // attention — if a sibling item just got pooled into a union, the PR must
  // stay visible in the "needs quotes" list so the PO can quote the rest.
  let target = pr.status;
  if (everyApproved) {
    target = 'QUOTATION_APPROVED';
  } else if (anyAwaiting) {
    // Partially covered: some items already in flight (submitted/held/approved),
    // others still waiting. IN_PROGRESS keeps the PR on the PO's radar — but
    // only if at least one quote has been sent to admin; otherwise the PR is
    // still in PO drafting territory.
    const anyInFlight = anySubmitted || anyHeld || anyApproved;
    target = (anyInFlight && hasSubmittedQuote) ? 'IN_PROGRESS' : 'APPROVED';
  } else if (anyHeld || anySubmitted) {
    // Every item has a quote — but if none of them have been sent to admin yet
    // we stay at APPROVED so admin doesn't see anything until the PO clicks
    // "Send to Admin".
    target = hasSubmittedQuote ? 'QUOTATION_SUBMITTED' : 'APPROVED';
  }

  if (target !== pr.status) {
    await tx.purchaseRequest.update({ where: { id: prId }, data: { status: target } });
  }
}

// Mark a set of PR items as cancelled (used by PO force-close). Then re-sync
// the parent PRs so they close if nothing live remains.
//
// Also deletes any unselected pending quotations that referenced the
// cancelled items: a union quotation whose allocations include a now-cancelled
// item is structurally invalid (its sourceAllocations point at dead rows), and
// a single-PR quotation on a fully-cancelled PR is dead weight. Selected
// (already approved) quotations are left alone — they're the audit trail for
// POs that may still be in flight.
async function cancelLeftoverPRItems(tx, prItemIds, reason) {
  if (!prItemIds || prItemIds.length === 0) return;

  // Capture metadata BEFORE flipping the items so we can find quotations
  // covering them (productName + requestId match for singles).
  const itemsBefore = await tx.purchaseRequestItem.findMany({
    where: { id: { in: prItemIds } },
    select: { id: true, requestId: true, productName: true },
  });
  const cancelledIdSet = new Set(itemsBefore.map(i => i.id));
  const prIds = [...new Set(itemsBefore.map(i => i.requestId))];

  await tx.purchaseRequestItem.updateMany({
    where: { id: { in: prItemIds } },
    data: {
      itemQuotationStatus: 'CANCELLED',
      itemStatus: 'CANCELLED',
    },
  });

  // 1) Unselected union quotations whose sourceAllocations touch a cancelled
  // item — delete entirely (PO can re-pool from surviving lines if needed).
  const unionQuotes = await tx.quotation.findMany({
    where: {
      isUnion: true,
      isSelected: false,
      sourceRequests: { some: { purchaseRequestId: { in: prIds } } },
    },
    select: { id: true, items: { select: { sourceAllocations: true } } },
  });
  const unionsToDelete = [];
  for (const q of unionQuotes) {
    const touchesCancelled = q.items.some(qi =>
      Array.isArray(qi.sourceAllocations) &&
      qi.sourceAllocations.some(s => cancelledIdSet.has(s.purchaseRequestItemId))
    );
    if (touchesCancelled) unionsToDelete.push(q.id);
  }
  if (unionsToDelete.length > 0) {
    await tx.quotation.deleteMany({ where: { id: { in: unionsToDelete } } });
  }

  // 2) Unselected single-PR quotations on PRs that now have no live items
  // (productName match isn't reliable enough to prune item-by-item, so we
  // only clear singles when the whole PR went dark).
  const liveCounts = await tx.purchaseRequestItem.groupBy({
    by: ['requestId'],
    where: { requestId: { in: prIds }, itemQuotationStatus: { not: 'CANCELLED' } },
    _count: { _all: true },
  });
  const deadPRIds = prIds.filter(id => !liveCounts.some(c => c.requestId === id && c._count._all > 0));
  if (deadPRIds.length > 0) {
    await tx.quotation.deleteMany({
      where: {
        isUnion: false,
        isSelected: false,
        purchaseRequestId: { in: deadPRIds },
      },
    });
  }

  for (const prId of prIds) {
    await syncPRStatusAfterChange(tx, prId);
  }

  // Reason is intentionally written by the caller into auditLog/closeReason —
  // we don't persist it on the PR item itself to keep the schema tight.
  return { affectedPRIds: prIds, reason: reason || null };
}

// Build a coverage summary used by the PR detail UI ("4 of 5 materials covered").
function buildCoverageSummary(items) {
  const summary = {
    total: items.length,
    awaiting: 0,
    submitted: 0,
    held: 0,
    approved: 0,
    cancelled: 0,
  };
  for (const it of items) {
    switch (it.itemQuotationStatus) {
      case 'QUOTATION_SUBMITTED': summary.submitted += 1; break;
      case 'QUOTATION_HELD': summary.held += 1; break;
      case 'QUOTATION_APPROVED': summary.approved += 1; break;
      case 'CANCELLED': summary.cancelled += 1; break;
      default: summary.awaiting += 1;
    }
  }
  return summary;
}

module.exports = {
  PR_ITEM_QUOTATION_STATUS,
  recomputePRItemQuotationStatus,
  syncPRStatusAfterChange,
  cancelLeftoverPRItems,
  buildCoverageSummary,
};
