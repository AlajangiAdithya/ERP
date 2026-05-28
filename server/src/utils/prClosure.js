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

      for (const q of quotations) {
        const covers = q.items.some(qi => {
          if (q.isUnion && Array.isArray(qi.sourceAllocations)) {
            return qi.sourceAllocations.some(s => s.purchaseRequestItemId === item.id);
          }
          // Non-union: match by productName (same convention used at PO creation).
          return qi.productName === item.productName;
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

  // PRs that are still pending admin / rejected don't get auto-advanced.
  if (['PENDING_ADMIN', 'REJECTED'].includes(pr.status)) return;

  const live = pr.items.filter(i => i.itemQuotationStatus !== 'CANCELLED');
  if (live.length === 0) {
    // Everything cancelled → close PR.
    await tx.purchaseRequest.update({ where: { id: prId }, data: { status: 'COMPLETED' } });
    return;
  }

  const everyApproved = live.every(i => i.itemQuotationStatus === 'QUOTATION_APPROVED');
  const anyHeld = live.some(i => i.itemQuotationStatus === 'QUOTATION_HELD');
  const anySubmitted = live.some(i => i.itemQuotationStatus === 'QUOTATION_SUBMITTED');
  const anyAwaiting = live.some(i => i.itemQuotationStatus === 'AWAITING_QUOTATION');

  // Compute target status without ever downgrading a PR past where it already is.
  let target = pr.status;
  if (everyApproved) {
    target = 'QUOTATION_APPROVED';
  } else if (anyHeld || anySubmitted) {
    target = 'QUOTATION_SUBMITTED';
  } else if (anyAwaiting) {
    // Some items still need quotations but others may already be approved/ordered.
    // Use IN_PROGRESS to signal "partially covered, work in flight".
    const anyApproved = live.some(i => i.itemQuotationStatus === 'QUOTATION_APPROVED');
    target = anyApproved ? 'IN_PROGRESS' : 'APPROVED';
  }

  if (target !== pr.status) {
    await tx.purchaseRequest.update({ where: { id: prId }, data: { status: target } });
  }
}

// Mark a set of PR items as cancelled (used by PO force-close). Then re-sync
// the parent PRs so they close if nothing live remains.
async function cancelLeftoverPRItems(tx, prItemIds, reason) {
  if (!prItemIds || prItemIds.length === 0) return;

  await tx.purchaseRequestItem.updateMany({
    where: { id: { in: prItemIds } },
    data: {
      itemQuotationStatus: 'CANCELLED',
      itemStatus: 'CANCELLED',
    },
  });

  const items = await tx.purchaseRequestItem.findMany({
    where: { id: { in: prItemIds } },
    select: { requestId: true },
  });
  const prIds = [...new Set(items.map(i => i.requestId))];
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
