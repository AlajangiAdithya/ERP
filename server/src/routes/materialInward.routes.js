const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  paginate, applyDateFilter, generateSequentialNumber, withDocRetry, OWNER_DEPTS, deptForRole,
  formatDDMMYY, normalizeMaterialType,
} = require('../utils/helpers');
const { qcDocsUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

// ── Role groups ──
// Stores does the actual inward work (create rows, request QC, final inward).
const WRITE_ROLES = ['ADMIN', 'STORE_MANAGER'];
// QC reviews each lot inside the register. INWARD_QC is the inward-only QC
// operator — it shares exactly this one capability (take/finish review) and
// nothing else (no create, no request-QC, no inward-into-stock).
const QC_ROLES = ['ADMIN', 'QC', 'INWARD_QC'];
// Everyone with oversight may read the register (INWARD_QC must read it to review).
const VIEW_ROLES = [
  'ADMIN', 'STORE_MANAGER', 'QC', 'INWARD_QC', 'PURCHASE_OFFICER', 'PLANNING',
  'SAFETY', 'MANAGER', 'SUPPLY_CHAIN', 'ACCOUNTING', 'FINANCE',
];

// The Unit-5 manager is granted the same inward-entry rights as Stores (create
// rows, edit drafts, request/resend QC, inward into stock). Unit 5 may appear as
// code '5', name 'Unit 5', or username 'unit 5' depending on which path created
// the account — match any of them (mirrors the metrology / machinery registers).
const EDIT_UNIT_CODES = ['5', 'UNIT-V', 'UNIT-5'];
const EDIT_UNIT_NAMES = ['unit 5', 'unit-5', 'unit5', 'unit v'];
const isUnit5 = (user) => {
  if (!user) return false;
  const code = (user.unit?.code || '').toString().toUpperCase();
  const name = (user.unit?.name || '').toString().trim().toLowerCase();
  const username = (user.username || '').toString().trim().toLowerCase();
  return EDIT_UNIT_CODES.includes(code)
    || EDIT_UNIT_NAMES.includes(name)
    || EDIT_UNIT_NAMES.includes(username);
};
// Inward-write = Stores roles OR the Unit-5 manager.
const canInwardWrite = (user) => !!user && (WRITE_ROLES.includes(user.role) || isUnit5(user));
const requireInwardWrite = (req, res, next) => {
  if (req.user?.role === 'SUPERADMIN' || canInwardWrite(req.user)) return next();
  return res.status(403).json({ error: 'Insufficient permissions' });
};

const USER_SELECT = { select: { id: true, name: true, role: true } };

// Tools & Fixtures fast-path. Such items may be inwarded straight to the unit,
// bypassing BOTH the QC requirement AND the master-data hold; QC is performed
// later on the already-inwarded lot. Category comes from the linked product
// (falling back to the register row's own materialType for free-text entries).
const isToolsAndFixtures = (product, row) =>
  normalizeMaterialType(product?.category || row?.materialType) === 'Tools & Fixtures';

// Notify QC + the owning unit's manager that a material is held at inward because
// its master data hasn't been added yet (or, on deferred-QC failure, to flag it).
async function notifyMasterDataHold(row, sentById, { title, message }) {
  const base = { type: 'INWARD_MASTER_DATA_HOLD', title, message, sentById };
  const notes = [{ ...base, targetRole: 'QC', targetUserId: null }];
  if (row.issuedToUnitId) {
    const mgr = await prisma.user.findFirst({
      where: { role: 'MANAGER', unitId: row.issuedToUnitId, isActive: true },
      select: { id: true },
    });
    if (mgr) notes.push({ ...base, targetRole: null, targetUserId: mgr.id });
  }
  await prisma.notification.createMany({ data: notes });
}

// POs that can still receive material (anything that isn't fully closed).
const ACTIVE_PO_STATUSES = [
  'CREDIT_PLACED', 'ORDERED', 'PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING',
  'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'PARTIAL',
  'INWARD_DONE', 'COMPLETED',
];

// Collect every PurchaseRequest behind a PO (union POs carry several).
function prsOf(po) {
  const list = [];
  if (po.purchaseRequest) list.push(po.purchaseRequest);
  (po.sourceRequests || []).forEach((s) => { if (s.purchaseRequest) list.push(s.purchaseRequest); });
  // de-dupe by id
  const byId = new Map();
  list.forEach((pr) => byId.set(pr.id, pr));
  return [...byId.values()];
}

// Derive the "issued to" target from a PO's PR(s). A union PO may map to many
// units — we keep the joined human label, and only bind a single owning unit
// when the PO maps to exactly one unit (so unit-stock stays unambiguous).
//
// The indenter — whoever raised the PR — is also resolved. When a PR carries no
// unit (raised by a department/global role: Designs, QC, Lab, Metrology, NDT,
// Safety, Planning), the material is reserved to that indenter's department
// (issuedToDept), mirroring the PO→inward attribution, instead of being left in
// the general pool.
function issuedToFromPo(po) {
  const prs = prsOf(po);
  const prNumbers = prs.map((p) => p.requestNumber).filter(Boolean).join(', ');

  const units = [];
  const seenU = new Set();
  prs.forEach((p) => {
    if (p.unit && !seenU.has(p.unit.id)) { seenU.add(p.unit.id); units.push(p.unit); }
  });

  // Indenter(s): the manager(s) who raised the PR(s) — who the material is for.
  const indenters = [];
  const seenI = new Set();
  prs.forEach((p) => {
    if (p.manager && !seenI.has(p.manager.id)) { seenI.add(p.manager.id); indenters.push(p.manager); }
  });
  const indenterId = indenters.length === 1 ? indenters[0].id : null;
  const indenterName = indenters.map((m) => m.name).filter(Boolean).join(' · ') || null;

  let issuedToUnitId = null;
  let issuedToDept = null;
  let issuedToLabel = '';
  if (units.length === 1) {
    issuedToUnitId = units[0].id;
    issuedToLabel = `${units[0].name} (${units[0].code})`;
  } else if (units.length > 1) {
    // Union across several units — show them all; leave stock in general pool.
    issuedToLabel = units.map((u) => `${u.name} (${u.code})`).join(' · ');
  } else {
    // No unit → raised by a department/global role. Reserve to that department
    // and label by the indenter, matching the PO→inward attribution.
    const raiserRole = indenters[0]?.role || null;
    issuedToDept = deptForRole(raiserRole);
    issuedToLabel = indenterName ? `${indenterName}${raiserRole ? ` (${raiserRole})` : ''}` : '';
  }
  return { prNumbers, issuedToUnitId, issuedToDept, issuedToLabel, indenterId, indenterName };
}

const PO_PICKER_INCLUDE = {
  items: {
    select: {
      id: true, productId: true, productName: true, productUnit: true, quantity: true, receivedQty: true,
      purchaseRequestItemId: true,
      // Union PO lines carry per-PR-item allocations; each points back to the
      // raising unit so we can auto-split the received qty across every unit.
      allocations: {
        select: {
          allocatedQty: true,
          purchaseRequestItem: {
            select: { request: { select: { unit: { select: { id: true, name: true, code: true } }, manager: USER_SELECT } } },
          },
        },
      },
    },
  },
  supplier: { select: { id: true, name: true } },
  purchaseRequest: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } }, manager: USER_SELECT } },
  sourceRequests: {
    select: {
      purchaseRequest: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } }, manager: USER_SELECT } },
    },
  },
};

// Per-line unit allocation. A union PO line splits across every unit that raised
// a PR for the material (weighted by the allocated qty); a non-union line falls
// back to the PO's single PR unit (full line qty). Empty when the PR was raised
// by a department/global role (no unit) — that material stays dept-reserved.
function unitAllocsForPoItem(po, item) {
  const byUnit = new Map();
  (item?.allocations || []).forEach((a) => {
    const u = a.purchaseRequestItem?.request?.unit;
    if (!u) return;
    const cur = byUnit.get(u.id) || { unitId: u.id, unitName: u.name, unitCode: u.code, allocatedQty: 0 };
    cur.allocatedQty += a.allocatedQty || 0;
    byUnit.set(u.id, cur);
  });
  // Non-union (or a union line whose allocations carry no unit): use the PO's
  // PR unit(s). A non-union PO ties to exactly one PR → one unit; the whole line
  // qty is attributed to it.
  if (!byUnit.size) {
    prsOf(po).forEach((p) => {
      if (!p.unit || byUnit.has(p.unit.id)) return;
      byUnit.set(p.unit.id, { unitId: p.unit.id, unitName: p.unit.name, unitCode: p.unit.code, allocatedQty: item?.quantity || 0 });
    });
  }
  return [...byUnit.values()];
}

// Resolve the issued-to snapshot for a single PO line: prNumbers/indenter come
// from the PO, but unit binding is per-line (drives the per-unit stock split).
function issuedToForItem(po, item) {
  const base = issuedToFromPo(po);
  const unitAllocations = unitAllocsForPoItem(po, item);
  let { issuedToUnitId, issuedToDept, issuedToLabel } = base;
  if (unitAllocations.length === 1) {
    issuedToUnitId = unitAllocations[0].unitId;
    issuedToDept = null;
    issuedToLabel = `${unitAllocations[0].unitName} (${unitAllocations[0].unitCode})`;
  } else if (unitAllocations.length > 1) {
    issuedToUnitId = null;
    issuedToDept = null;
    issuedToLabel = unitAllocations.map((u) => `${u.unitName} (${u.unitCode})`).join(' · ');
  }
  // else: no units → keep the department fallback from issuedToFromPo.
  return { ...base, issuedToUnitId, issuedToDept, issuedToLabel, unitAllocations };
}

// Resolve the issued-to target for a direct / cash-purchase entry from what
// Stores picked: a unit (issuedToUnitId), an owner department (issuedToDept),
// or neither (the general / unassigned pool). The human label is derived
// server-side so it always matches the chosen target — no trust in client text.
// Mutates `target` (the create data or a PATCH patch) in place.
async function resolveDirectIssuedTo(target, b) {
  target.issuedToUnitId = null;
  target.issuedToDept = null;
  target.issuedToLabel = null;
  target.unitAllocations = null;
  if (b.issuedToUnitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: b.issuedToUnitId },
      select: { id: true, name: true, code: true },
    });
    if (unit) {
      target.issuedToUnitId = unit.id;
      target.issuedToLabel = `${unit.name} (${unit.code})`;
      return;
    }
  }
  const dept = (b.issuedToDept || '').trim();
  if (dept && OWNER_DEPTS.includes(dept)) {
    target.issuedToDept = dept;
    target.issuedToLabel = dept;
  }
}

// Split an accepted qty across the row's units at inward time. A single bound
// unit takes the whole qty; a multi-unit (union) row splits proportionally to
// each unit's allocated qty (even split if allocations are unweighted). The last
// unit absorbs any rounding remainder so the parts always sum to qty. Returns []
// when the row binds no unit (stock then stays in the general / dept pool).
function splitQtyAcrossUnits(row, qty) {
  if (row.issuedToUnitId) return [{ unitId: row.issuedToUnitId, qty }];
  const allocs = Array.isArray(row.unitAllocations) ? row.unitAllocations.filter((a) => a && a.unitId) : [];
  if (!allocs.length) return [];
  const total = allocs.reduce((s, a) => s + (a.allocatedQty || 0), 0);
  const round3 = (n) => Math.round(n * 1000) / 1000;
  let assigned = 0;
  return allocs.map((a, i) => {
    let q;
    if (i === allocs.length - 1) {
      q = round3(qty - assigned);
    } else {
      q = total > 0 ? round3(qty * ((a.allocatedQty || 0) / total)) : round3(qty / allocs.length);
      assigned += q;
    }
    return { unitId: a.unitId, unitName: a.unitName, qty: q };
  });
}

// Build the auto / locked Inward-Inspection-Request fields (rows 1–11) for a
// register row. Everything here is snapshotted from earlier actions — the PR,
// the PO, the approved quotation and the supplier — so Stores never types it.
// Rows 12–16 (DC / gate pass / receipt date) and the stores remark stay editable.
const fmtDMY = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : ''); // DD/MM/YYYY
async function buildIirAuto(row) {
  const out = {
    ionNoDate: row.ionNo ? `${row.ionNo}  ·  ${fmtDMY(row.qcRequestedAt || new Date())}` : '',
    prNoDate: row.prNumbers || '',          // 01
    materialDesc: row.itemDescription || '', // 02
    qtyAsPerPR: '',                          // 03
    supplierDetails: row.supplierName || '', // 04
    budgetaryQuote: '',                      // 05
    supplierAssessment: '',                  // 06
    poNoDate: '',                            // 07
    qtyOrdered: '',                          // 08
    deliveryRequiredBy: '',                  // 09
    scopeOfWork: '',                         // 10
    invoiceNoDate: '',                       // 11
  };
  // 11 — invoice / cash receipt doc lives on the row itself.
  if (['INVOICE', 'CASH_PURCHASE'].includes(row.docType) && row.docNumber) {
    out.invoiceNoDate = `${row.docNumber} · ${fmtDMY(row.inwardDate)}`;
  }
  if (!row.purchaseOrderId) {
    // Manual PO (not in the system) — surface the typed number as the PO ref.
    if (row.manualPoNumber) out.poNoDate = row.manualPoNumber;
    return out; // direct / cash / manual-PO entry — no PR/PO chain to pull.
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: row.purchaseOrderId },
    select: {
      orderNumber: true, createdAt: true, supplierName: true,
      supplier: { select: { supplierAssessmentPdfUrl: true, assessmentFiscalYear: true } },
      quotation: { select: { quotationNumber: true, totalAmount: true } },
    },
  });
  if (po) {
    out.poNoDate = `${po.orderNumber}${po.createdAt ? ` · ${fmtDMY(po.createdAt)}` : ''}`;
    out.supplierDetails = po.supplierName || out.supplierDetails;
    out.supplierAssessment = po.supplier?.supplierAssessmentPdfUrl
      ? `Attached${po.supplier.assessmentFiscalYear ? ` (FY ${po.supplier.assessmentFiscalYear})` : ''}`
      : 'Not on file';
    out.budgetaryQuote = po.quotation
      ? `${po.quotation.quotationNumber}${po.quotation.totalAmount != null ? ` · ₹${po.quotation.totalAmount}` : ''}`
      : '';
  }

  if (row.purchaseOrderItemId) {
    const poItem = await prisma.purchaseOrderItem.findUnique({
      where: { id: row.purchaseOrderItemId },
      select: {
        quantity: true, productUnit: true, purchaseRequestItemId: true,
        // Union PO lines bind PR items via allocations rather than a direct FK.
        allocations: { select: { purchaseRequestItemId: true } },
      },
    });
    if (poItem) {
      if (poItem.quantity != null) out.qtyOrdered = `${poItem.quantity} ${poItem.productUnit || row.uom || ''}`.trim();
      const prItemIds = [
        poItem.purchaseRequestItemId,
        ...(poItem.allocations || []).map((a) => a.purchaseRequestItemId),
      ].filter(Boolean);
      if (prItemIds.length) {
        const prItems = await prisma.purchaseRequestItem.findMany({
          where: { id: { in: [...new Set(prItemIds)] } },
          select: { requestedQty: true, productUnit: true, requiredByDate: true, scopeOfWork: true },
        });
        if (prItems.length) {
          const totalReq = prItems.reduce((s, p) => s + (p.requestedQty || 0), 0);
          const uom = prItems[0].productUnit || row.uom || '';
          out.qtyAsPerPR = totalReq ? `${totalReq} ${uom}`.trim() : '';
          const dates = prItems.map((p) => p.requiredByDate).filter(Boolean);
          if (dates.length) out.deliveryRequiredBy = fmtDMY(dates.sort((a, b) => new Date(a) - new Date(b))[0]);
          out.scopeOfWork = [...new Set(prItems.map((p) => p.scopeOfWork).filter(Boolean))].join(' · ');
        }
      }
    }
  }
  return out;
}

// ── GET /api/material-inward/active-pos ───────────────────────────────
// Active POs the stores person can attach an inward row to. Each entry carries
// just enough to auto-fill the register: supplier, PR no(s), items, issued-to.
router.get('/active-pos', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const orders = await prisma.purchaseOrder.findMany({
      where: { status: { in: ACTIVE_PO_STATUSES } },
      include: PO_PICKER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const out = orders.map((po) => {
      const { prNumbers, issuedToUnitId, issuedToDept, issuedToLabel, indenterName } = issuedToFromPo(po);
      return {
        id: po.id,
        orderNumber: po.orderNumber,
        customName: po.customName,
        supplierName: po.supplierName,
        isUnion: po.isUnion,
        prNumbers,
        issuedToUnitId,
        issuedToDept,
        issuedToLabel,
        indenterName,
        items: (po.items || []).map((it) => {
          const ua = unitAllocsForPoItem(po, it);
          return {
            id: it.id,
            productId: it.productId,
            productName: it.productName,
            productUnit: it.productUnit,
            quantity: it.quantity,
            receivedQty: it.receivedQty,
            // Where this specific line is bound for (auto, per-unit).
            unitAllocations: ua,
            issuedToLabel: ua.length
              ? ua.map((u) => `${u.unitName} (${u.unitCode})`).join(' · ')
              : (issuedToDept || issuedToLabel || ''),
          };
        }),
      };
    });
    res.json({ orders: out });
  } catch (err) {
    console.error('active-pos error:', err);
    res.status(500).json({ error: 'Failed to load purchase orders' });
  }
});

// ── GET /api/material-inward ──────────────────────────────────────────
// The register. Rows are enriched with resolved user / unit / product names
// and the MIV number(s) that later drew this batch (matched by batchNo).
router.get('/', authenticate, authorize(...VIEW_ROLES), async (req, res) => {
  try {
    const { status, fromDate, toDate, page, limit } = req.query;
    const { skip, take } = paginate(page, limit);
    const where = {};
    applyDateFilter(where, { fromDate, toDate }, 'inwardDate');
    if (status) where.status = status;
    // Managers only see rows bound for their own unit — except the Unit-5
    // manager, who runs inward entry and needs the full register like Stores.
    if (req.user.role === 'MANAGER' && !isUnit5(req.user)) where.issuedToUnitId = req.user.unitId;

    const [rows, total] = await Promise.all([
      prisma.materialInwardRegister.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.materialInwardRegister.count({ where }),
    ]);

    // ── Enrichment lookups (batched) ──
    const userIds = new Set();
    const unitIds = new Set();
    const productIds = new Set();
    const batchNos = new Set();
    const poIds = new Set();
    const poItemIds = new Set();
    rows.forEach((r) => {
      [r.createdById, r.qcRequestedById, r.qcReviewerId].forEach((id) => id && userIds.add(id));
      if (r.issuedToUnitId) unitIds.add(r.issuedToUnitId);
      if (r.productId) productIds.add(r.productId);
      if (r.batchNo) batchNos.add(r.batchNo);
      if (r.purchaseOrderId) poIds.add(r.purchaseOrderId);
      if (r.purchaseOrderItemId) poItemIds.add(r.purchaseOrderItemId);
    });

    const [users, units, products, mivItems, pos, poItems] = await Promise.all([
      userIds.size ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, role: true } }) : [],
      unitIds.size ? prisma.unit.findMany({ where: { id: { in: [...unitIds] } }, select: { id: true, name: true, code: true } }) : [],
      productIds.size ? prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true, sku: true, materialCode: true, unit: true, category: true, shelfLife: true, storageTemp: true, msdsUrl: true, masterDataComplete: true } }) : [],
      batchNos.size ? prisma.requestItem.findMany({
        where: { materialBatchNo: { in: [...batchNos] } },
        select: {
          materialBatchNo: true, qtyIssued: true, productId: true,
          request: { select: { requestNumber: true, unit: { select: { name: true, code: true } } } },
        },
      }) : [],
      poIds.size ? prisma.purchaseOrder.findMany({
        where: { id: { in: [...poIds] } },
        select: {
          id: true, orderNumber: true, poDocumentUrl: true,
          supplier: { select: { name: true, supplierAssessmentPdfUrl: true, vendorEvaluationPdfUrl: true } },
          purchaseRequest: { select: { id: true, requestNumber: true, materialSpecsPdfUrl: true, items: { select: { specAttachmentUrl: true, specAttachmentName: true, productName: true } } } },
          sourceRequests: { select: { purchaseRequest: { select: { id: true, requestNumber: true, materialSpecsPdfUrl: true, items: { select: { specAttachmentUrl: true, specAttachmentName: true, productName: true } } } } } },
        },
      }) : [],
      poItemIds.size ? prisma.purchaseOrderItem.findMany({ where: { id: { in: [...poItemIds] } }, select: { id: true, quantity: true } }) : [],
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const unitMap = Object.fromEntries(units.map((u) => [u.id, u]));
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));
    const poItemMap = Object.fromEntries(poItems.map((it) => [it.id, it]));

    // Reference documents QC views alongside the invoice: the signed PO PDF,
    // the supplier's assessment / vendor-evaluation forms, and each source PR's
    // material-spec PDFs. The T&C annexure is a static client asset (added there).
    const refDocsMap = {};
    pos.forEach((po) => {
      const docs = [];
      if (po.poDocumentUrl) docs.push({ label: 'Purchase Order (PO) PDF', url: po.poDocumentUrl });
      if (po.supplier?.supplierAssessmentPdfUrl) docs.push({ label: 'Supplier Assessment Form', url: po.supplier.supplierAssessmentPdfUrl });
      if (po.supplier?.vendorEvaluationPdfUrl) docs.push({ label: 'Vendor Evaluation Form', url: po.supplier.vendorEvaluationPdfUrl });
      const prs = [];
      const seen = new Set();
      if (po.purchaseRequest) prs.push(po.purchaseRequest);
      (po.sourceRequests || []).forEach((s) => { if (s.purchaseRequest) prs.push(s.purchaseRequest); });
      prs.forEach((pr) => {
        if (!pr || seen.has(pr.id)) return;
        seen.add(pr.id);
        if (pr.materialSpecsPdfUrl) docs.push({ label: `PR ${pr.requestNumber} — Material Specs`, url: pr.materialSpecsPdfUrl });
        (pr.items || []).forEach((it) => {
          if (it.specAttachmentUrl) docs.push({ label: `PR ${pr.requestNumber} — Spec: ${it.specAttachmentName || it.productName || 'attachment'}`, url: it.specAttachmentUrl });
        });
      });
      refDocsMap[po.id] = docs;
    });
    // batchNo -> [{ mivNo, qty, unit }]
    const mivMap = {};
    mivItems.forEach((mi) => {
      const key = mi.materialBatchNo;
      if (!key) return;
      (mivMap[key] = mivMap[key] || []).push({
        mivNo: mi.request?.requestNumber || null,
        qty: mi.qtyIssued || null,
        unit: mi.request?.unit ? `${mi.request.unit.name} (${mi.request.unit.code})` : null,
      });
    });

    const decorated = rows.map((r) => ({
      ...r,
      createdBy: userMap[r.createdById] || null,
      qcRequestedBy: r.qcRequestedById ? userMap[r.qcRequestedById] || null : null,
      qcReviewer: r.qcReviewerId ? userMap[r.qcReviewerId] || null : null,
      issuedToUnit: r.issuedToUnitId ? unitMap[r.issuedToUnitId] || null : null,
      product: r.productId ? productMap[r.productId] || null : null,
      poNumber: r.purchaseOrderId ? (poMap[r.purchaseOrderId]?.orderNumber || null) : (r.manualPoNumber || null),
      orderedQty: r.purchaseOrderItemId ? (poItemMap[r.purchaseOrderItemId]?.quantity ?? null) : null,
      mivs: r.batchNo ? (mivMap[r.batchNo] || []) : [],
      refDocs: r.purchaseOrderId ? (refDocsMap[r.purchaseOrderId] || []) : [],
      // On hold: a non-Tools&Fixtures material whose master data hasn't been added
      // yet — Stores can't inward it until a unit head / QC completes it.
      masterDataPending: (() => {
        const p = r.productId ? productMap[r.productId] : null;
        if (!p || r.inwardedAt) return false;
        if (isToolsAndFixtures(p, r)) return false;
        return p.masterDataComplete === false;
      })(),
      // Tools & Fixtures inwarded to a unit before QC — QC still pending.
      qcPending: !!(r.inwardedAt && !r.qcResult),
      isToolsAndFixtures: isToolsAndFixtures(r.productId ? productMap[r.productId] : null, r),
    }));

    res.json({ rows: decorated, total });
  } catch (err) {
    console.error('material-inward list error:', err);
    res.status(500).json({ error: 'Failed to load inward register' });
  }
});

// ── POST /api/material-inward ─────────────────────────────────────────
// Create a register row. With a PO it snapshots PR / supplier / item /
// issued-to; without one it's a direct / cash entry.
router.post('/', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const b = req.body || {};
    const docType = ['INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS'].includes(b.docType) ? b.docType : 'INVOICE';

    const data = {
      inwardDate: b.inwardDate ? new Date(b.inwardDate) : new Date(),
      vehicleDetails: b.vehicleDetails?.trim() || null,
      docType,
      docNumber: b.docNumber?.trim() || null,
      documentDate: b.documentDate ? new Date(b.documentDate) : null,
      manufacturingDate: b.manufacturingDate ? new Date(b.manufacturingDate) : null,
      purchaseOrderId: b.purchaseOrderId || null,
      purchaseOrderItemId: b.purchaseOrderItemId || null,
      // Manual PO ref only when no real PO is linked (mutually exclusive).
      manualPoNumber: b.purchaseOrderId ? null : (b.manualPoNumber?.trim() || null),
      supplierName: b.supplierName?.trim() || null,
      prNumbers: b.prNumbers?.trim() || null,
      itemDescription: b.itemDescription?.trim() || null,
      uom: b.uom?.trim() || null,
      materialType: b.materialType?.trim() || null,
      qtyReceived: b.qtyReceived != null && b.qtyReceived !== '' ? Number(b.qtyReceived) : null,
      productId: b.productId || null,
      issuedToUnitId: b.issuedToUnitId || null,
      issuedToDept: b.issuedToDept?.trim() || null,
      issuedToLabel: b.issuedToLabel?.trim() || null,
      purpose: b.purpose?.trim() || null,
      batchNo: b.batchNo?.trim() || null,
      dateOfExpiry: b.dateOfExpiry ? new Date(b.dateOfExpiry) : null,
      createdById: req.user.id,
    };

    // When a PO is linked, (re)derive the trusted snapshot fields server-side.
    if (data.purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({ where: { id: data.purchaseOrderId }, include: PO_PICKER_INCLUDE });
      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      const item = (po.items || []).find((it) => it.id === data.purchaseOrderItemId);
      // Unit binding is per-line (a union line may span several units).
      const { prNumbers, issuedToUnitId, issuedToDept, issuedToLabel, indenterId, indenterName, unitAllocations } = issuedToForItem(po, item);
      data.supplierName = po.supplierName || data.supplierName;
      data.prNumbers = prNumbers || data.prNumbers;
      data.issuedToUnitId = issuedToUnitId;
      data.issuedToDept = issuedToDept;
      data.issuedToLabel = issuedToLabel;
      data.indenterId = indenterId;
      data.indenterName = indenterName;
      data.unitAllocations = unitAllocations;
      if (item) {
        data.itemDescription = item.productName;
        data.uom = item.productUnit;
        data.productId = item.productId || null;
      }
    } else {
      // Direct / cash purchase — Stores chooses where the material is bound
      // (a unit, an owner department, or the general pool). Resolved + labelled
      // server-side so the assignment is trusted, mirroring the PO flow.
      await resolveDirectIssuedTo(data, b);
    }

    if (!data.itemDescription) return res.status(400).json({ error: 'Item description is required' });

    // Lot number — sequential per PO (Lot 1, 2, 3 … N). Each partial receipt
    // against the same PO gets the next lot. Direct/cash entries have no lot.
    if (data.purchaseOrderId) {
      const lotCount = await prisma.materialInwardRegister.count({ where: { purchaseOrderId: data.purchaseOrderId } });
      data.lotNo = lotCount + 1;
    }

    const row = await withDocRetry(async () => {
      const mirNo = await generateSequentialNumber(prisma, 'MIR');
      return prisma.materialInwardRegister.create({ data: { ...data, mirNo } });
    });

    res.status(201).json(row);
  } catch (err) {
    console.error('material-inward create error:', err);
    res.status(500).json({ error: 'Failed to create inward entry' });
  }
});

// ── POST /api/material-inward/bulk ────────────────────────────────────
// One delivery against a PO usually carries several lines (and a line may arrive
// in batches over time). Stores ticks the received lines + per-line qty/batch and
// this creates one register row per line — each its own MIR, lot, and QC track.
router.post('/bulk', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.purchaseOrderId) return res.status(400).json({ error: 'A purchase order is required' });
    const lines = Array.isArray(b.lines) ? b.lines.filter((l) => l && l.purchaseOrderItemId) : [];
    if (!lines.length) return res.status(400).json({ error: 'Select at least one material line' });

    const po = await prisma.purchaseOrder.findUnique({ where: { id: b.purchaseOrderId }, include: PO_PICKER_INCLUDE });
    if (!po) return res.status(404).json({ error: 'Purchase order not found' });

    const docType = ['INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS'].includes(b.docType) ? b.docType : 'INVOICE';
    const header = {
      inwardDate: b.inwardDate ? new Date(b.inwardDate) : new Date(),
      vehicleDetails: b.vehicleDetails?.trim() || null,
      docType,
      docNumber: b.docNumber?.trim() || null,
      documentDate: b.documentDate ? new Date(b.documentDate) : null,
      purpose: b.purpose?.trim() || null,
    };

    // Lot numbers continue from however many lots this PO already has.
    let lot = await prisma.materialInwardRegister.count({ where: { purchaseOrderId: po.id } });
    const created = [];
    for (const ln of lines) {
      const item = (po.items || []).find((it) => it.id === ln.purchaseOrderItemId);
      if (!item) continue;
      const qty = ln.qtyReceived != null && ln.qtyReceived !== '' ? Number(ln.qtyReceived) : null;
      if (!qty || qty <= 0) return res.status(400).json({ error: `Enter a received quantity for ${item.productName}` });

      const { prNumbers, issuedToUnitId, issuedToDept, issuedToLabel, indenterId, indenterName, unitAllocations } = issuedToForItem(po, item);
      lot += 1;
      const row = await withDocRetry(async () => {
        const mirNo = await generateSequentialNumber(prisma, 'MIR');
        return prisma.materialInwardRegister.create({
          data: {
            ...header,
            purchaseOrderId: po.id,
            purchaseOrderItemId: item.id,
            supplierName: po.supplierName || null,
            prNumbers: prNumbers || null,
            itemDescription: item.productName,
            uom: item.productUnit,
            qtyReceived: qty,
            productId: item.productId || null,
            issuedToUnitId, issuedToDept, issuedToLabel, indenterId, indenterName, unitAllocations,
            batchNo: ln.batchNo?.trim() || null,
            dateOfExpiry: ln.dateOfExpiry ? new Date(ln.dateOfExpiry) : null,
            manufacturingDate: ln.manufacturingDate ? new Date(ln.manufacturingDate) : null,
            lotNo: lot,
            createdById: req.user.id,
            mirNo,
          },
        });
      });
      created.push(row);
    }

    if (!created.length) return res.status(400).json({ error: 'No valid lines to record' });
    res.status(201).json({ rows: created, count: created.length });
  } catch (err) {
    console.error('material-inward bulk create error:', err);
    res.status(500).json({ error: 'Failed to create inward entries' });
  }
});

// ── POST /api/material-inward/cash-bulk ───────────────────────────────
// A cash purchase often brings several items from the same supplier on one
// invoice. Stores enters them together: one shared header (supplier / document /
// assign-to) plus a list of items (each an existing product or a new item, with
// its own qty / batch / dates / type). All items become their own register row —
// each with its own QC track — but share a single MIR number (and a sub-lot index
// when there's more than one).
router.post('/cash-bulk', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const b = req.body || {};
    const rawItems = Array.isArray(b.items) ? b.items : [];
    const items = rawItems.filter((it) => it && (it.productId || (it.itemDescription || '').trim()));
    if (!items.length) return res.status(400).json({ error: 'Add at least one item' });

    // Validate quantities up front so a bad batch never burns a MIR number.
    for (const it of items) {
      const qty = it.qtyReceived != null && it.qtyReceived !== '' ? Number(it.qtyReceived) : null;
      if (!qty || qty <= 0) return res.status(400).json({ error: `Enter a received quantity for ${(it.itemDescription || '').trim() || 'each item'}` });
    }

    // Resolve linked products once → trusted name / UOM / category snapshots.
    const productIds = [...new Set(items.map((it) => it.productId).filter(Boolean))];
    const products = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: true, category: true } })
      : [];
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

    const docType = ['INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS'].includes(b.docType) ? b.docType : 'CASH_PURCHASE';

    // Shared assign-to for the whole cash batch (a unit, an owner department, or
    // the general pool) — resolved + labelled server-side, mirroring the PO flow.
    const issuedTo = {};
    await resolveDirectIssuedTo(issuedTo, b);

    const header = {
      inwardDate: b.inwardDate ? new Date(b.inwardDate) : new Date(),
      vehicleDetails: b.vehicleDetails?.trim() || null,
      docType,
      docNumber: b.docNumber?.trim() || null,
      documentDate: b.documentDate ? new Date(b.documentDate) : null,
      // Existing PO not yet in the system — typed by hand, shared across items.
      manualPoNumber: b.manualPoNumber?.trim() || null,
      supplierName: b.supplierName?.trim() || null,
      purpose: b.purpose?.trim() || null,
      issuedToUnitId: issuedTo.issuedToUnitId,
      issuedToDept: issuedTo.issuedToDept,
      issuedToLabel: issuedTo.issuedToLabel,
    };

    // One MIR number shared across every item in this cash purchase. mirNo is not
    // unique, so there's no constraint to race on — generate it once and reuse it.
    const mirNo = await generateSequentialNumber(prisma, 'MIR');
    const multi = items.length > 1;

    const created = [];
    let lot = 0;
    for (const it of items) {
      lot += 1;
      const prod = it.productId ? productMap[it.productId] : null;
      const itemDescription = (prod?.name || it.itemDescription || '').trim() || null;
      if (!itemDescription) return res.status(400).json({ error: 'Item description is required' });
      const row = await prisma.materialInwardRegister.create({
        data: {
          ...header,
          mirNo,
          // Sub-lot index so several items under one MIR stay distinguishable.
          lotNo: multi ? lot : null,
          itemDescription,
          uom: (prod?.unit || it.uom || '').trim() || null,
          materialType: (it.materialType || prod?.category || '').trim() || null,
          qtyReceived: Number(it.qtyReceived),
          productId: it.productId || null,
          batchNo: (it.batchNo || '').trim() || null,
          dateOfExpiry: it.dateOfExpiry ? new Date(it.dateOfExpiry) : null,
          manufacturingDate: it.manufacturingDate ? new Date(it.manufacturingDate) : null,
          createdById: req.user.id,
        },
      });
      created.push(row);
    }

    res.status(201).json({ rows: created, count: created.length, mirNo });
  } catch (err) {
    console.error('material-inward cash-bulk error:', err);
    res.status(500).json({ error: 'Failed to create inward entries' });
  }
});

// ── PATCH /api/material-inward/:id ────────────────────────────────────
// Edit row fields before QC has been requested (DRAFT only).
router.patch('/:id', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft entries can be edited' });

    const b = req.body || {};
    const patch = {};
    if (b.vehicleDetails !== undefined) patch.vehicleDetails = b.vehicleDetails?.trim() || null;
    if (b.docType && ['INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS'].includes(b.docType)) patch.docType = b.docType;
    if (b.docNumber !== undefined) patch.docNumber = b.docNumber?.trim() || null;
    if (b.documentDate !== undefined) patch.documentDate = b.documentDate ? new Date(b.documentDate) : null;
    if (b.qtyReceived !== undefined) patch.qtyReceived = b.qtyReceived === '' || b.qtyReceived == null ? null : Number(b.qtyReceived);
    if (b.purpose !== undefined) patch.purpose = b.purpose?.trim() || null;
    if (b.batchNo !== undefined) patch.batchNo = b.batchNo?.trim() || null;
    if (b.dateOfExpiry !== undefined) patch.dateOfExpiry = b.dateOfExpiry ? new Date(b.dateOfExpiry) : null;
    if (b.manufacturingDate !== undefined) patch.manufacturingDate = b.manufacturingDate ? new Date(b.manufacturingDate) : null;
    if (b.itemDescription !== undefined && !row.purchaseOrderId) patch.itemDescription = b.itemDescription?.trim() || row.itemDescription;
    if (b.uom !== undefined && !row.purchaseOrderId) patch.uom = b.uom?.trim() || null;
    if (b.materialType !== undefined && !row.purchaseOrderId) patch.materialType = b.materialType?.trim() || null;
    if (b.productId !== undefined && !row.purchaseOrderId) patch.productId = b.productId || null;
    // Manual PO number is editable only on non-system-PO rows (never on real POs).
    if (b.manualPoNumber !== undefined && !row.purchaseOrderId) patch.manualPoNumber = b.manualPoNumber?.trim() || null;
    // Reassignment is only meaningful for direct/cash rows (PO rows derive it
    // from the PR). Re-resolve the unit/dept + label server-side.
    if (!row.purchaseOrderId && (b.issuedToUnitId !== undefined || b.issuedToDept !== undefined)) {
      await resolveDirectIssuedTo(patch, b);
    }

    const updated = await prisma.materialInwardRegister.update({ where: { id: row.id }, data: patch });
    res.json(updated);
  } catch (err) {
    console.error('material-inward patch error:', err);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// ── POST /api/material-inward/:id/documents ───────────────────────────
// Stores uploads supporting documents (invoice / DC / test report / COA …) —
// the same papers that used to be attached at "goods arrived". PDF or image.
router.post('/:id/documents', authenticate, requireInwardWrite, qcDocsUpload.array('documents', 10), async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    // Optional per-file label(s); falls back to a single shared label or filename.
    let labels = req.body?.labels;
    if (typeof labels === 'string') { try { labels = JSON.parse(labels); } catch { labels = null; } }
    const sharedLabel = (req.body?.label || '').trim();

    const existing = Array.isArray(row.documents) ? row.documents : [];
    const added = files.map((file, i) => ({
      label: (Array.isArray(labels) ? labels[i] : null) || sharedLabel || file.originalname || 'Document',
      name: file.originalname || file.filename,
      url: publicUrlFor('qc-docs', file.filename),
      uploadedAt: new Date().toISOString(),
      uploadedById: req.user.id,
    }));

    const updated = await prisma.materialInwardRegister.update({
      where: { id: row.id },
      data: { documents: [...existing, ...added] },
    });
    res.json(updated);
  } catch (err) {
    console.error('material-inward documents error:', err);
    res.status(500).json({ error: 'Failed to upload documents' });
  }
});

// ── DELETE /api/material-inward/:id/documents/:index ──────────────────
router.delete('/:id/documents/:index', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    const docs = Array.isArray(row.documents) ? [...row.documents] : [];
    const idx = parseInt(req.params.index, 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= docs.length) return res.status(400).json({ error: 'Invalid document index' });
    docs.splice(idx, 1);
    const updated = await prisma.materialInwardRegister.update({ where: { id: row.id }, data: { documents: docs } });
    res.json(updated);
  } catch (err) {
    console.error('material-inward document delete error:', err);
    res.status(500).json({ error: 'Failed to remove document' });
  }
});

// Documents Stores can ask QC to verify (also pre-check the QC report checklist).
const DOC_REQUIREMENTS = ['Test Report', 'COC', 'COA', '3rd Party / Customer Clearance'];

// ── GET /api/material-inward/:id/iir-auto ─────────────────────────────
// The auto / locked Inward-Inspection-Request fields (rows 1–11) for the form.
// Stores opens the request form → these come pre-filled and read-only.
router.get('/:id/iir-auto', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    const iir = await buildIirAuto(row);
    res.json({ iir });
  } catch (err) {
    console.error('iir-auto error:', err);
    res.status(500).json({ error: 'Failed to load inspection-request details' });
  }
});

// ── POST /api/material-inward/:id/request-qc ──────────────────────────
// Stores hands the lot to QC. The ION No. is auto-generated and rows 1–11 are
// re-derived server-side (locked); Stores only supplies rows 12–16, the remark,
// and which documents QC must verify.
router.post('/:id/request-qc', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    // Tools & Fixtures may have been inwarded before QC (deferred). Such a lot is
    // already in stock (inwardedAt set) but still needs its QC — allow requesting it.
    const deferredQcPending = !!(row.inwardedAt && !row.qcResult);
    if (!['DRAFT', 'QC_REQUESTED'].includes(row.status) && !deferredQcPending) {
      return res.status(400).json({ error: 'QC has already been taken up for this entry' });
    }

    const rq = req.body?.qcRequest || {};
    const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    // Locked rows 1–11 are re-derived from the PR/PO chain — never trusted from
    // the client. The ION No. (row 0) is auto-generated below.
    const auto = await buildIirAuto(row);
    // Documents Stores selected for QC to verify (whitelist).
    const docsRequired = Array.isArray(req.body?.docsRequired)
      ? req.body.docsRequired.filter((d) => DOC_REQUIREMENTS.includes(d))
      : [];

    const qcRequest = {
      requestedAt: new Date().toISOString(),
      // Auto / locked (rows 0–11):
      ...auto,
      // Stores-editable (rows 12–16):
      dcNo: str(rq.dcNo),
      gatePassNo: str(rq.gatePassNo),
      gatePassType: str(rq.gatePassType),
      probableReturnDate: str(rq.probableReturnDate),
      materialReceiptDate: str(rq.materialReceiptDate) || fmtDMY(row.inwardDate),
      storesRemark: str(rq.storesRemark),
      // Documents QC must verify → pre-checks the report checklist.
      docsRequired,
    };

    // Generate the ION No. once (kept across re-requests). withDocRetry handles
    // the unique-constraint race on ionNo.
    const updated = await withDocRetry(async () => {
      const ionNo = row.ionNo || await generateSequentialNumber(prisma, 'IION');
      qcRequest.ionNoDate = `${ionNo}  ·  ${fmtDMY(row.qcRequestedAt || new Date())}`;
      return prisma.materialInwardRegister.update({
        where: { id: row.id },
        data: {
          status: 'QC_REQUESTED',
          ionNo,
          qcRequestedAt: new Date(),
          qcRequestedById: req.user.id,
          qcRequestNote: str(req.body?.qcRequestNote) || qcRequest.storesRemark,
          qcDocRequirement: docsRequired.join(', ') || null,
          qcRequest,
        },
      });
    });
    await prisma.notification.create({
      data: {
        type: 'INWARD_QC_REQUEST',
        title: `QC requested: ${row.itemDescription || row.mirNo}`,
        message: `${req.user.name} requested QC for inward ${row.mirNo}${row.docNumber ? ` (${row.docNumber})` : ''}. Open the Inward register to take the review.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('request-qc error:', err);
    res.status(500).json({ error: 'Failed to request QC' });
  }
});

// ── POST /api/material-inward/:id/take-review ─────────────────────────
// QC claims the lot for review.
router.post('/:id/take-review', authenticate, authorize(...QC_ROLES), async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.status !== 'QC_REQUESTED') return res.status(400).json({ error: 'This entry is not awaiting QC review' });
    const updated = await prisma.materialInwardRegister.update({
      where: { id: row.id },
      data: { status: 'QC_IN_REVIEW', qcReviewerId: req.user.id, qcReviewStartedAt: new Date() },
    });
    res.json(updated);
  } catch (err) {
    console.error('take-review error:', err);
    res.status(500).json({ error: 'Failed to take review' });
  }
});

// ── POST /api/material-inward/:id/finish-review ───────────────────────
// QC files the inspection outcome + report remark.
router.post('/:id/finish-review', authenticate, authorize(...QC_ROLES), async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.status !== 'QC_IN_REVIEW') return res.status(400).json({ error: 'Take the review before finishing it' });

    const b = req.body || {};
    // Outcome of the round: pass / partial / fail (rejected) / on-hold (re-inspect).
    const qcResult = ['PASSED', 'PARTIAL', 'FAILED', 'ON_HOLD'].includes(b.qcResult) ? b.qcResult : null;
    if (!qcResult) return res.status(400).json({ error: 'Select a QC result (Passed / Partial / Failed / On Hold)' });
    if (!b.qcReportRemark?.trim()) return res.status(400).json({ error: 'A report remark is required to finish the review' });
    const onHold = qcResult === 'ON_HOLD';
    if (onHold && !b.holdReason?.trim()) return res.status(400).json({ error: 'A hold reason is required to place the lot on hold' });

    // The Inward Inspection No. is owned by QC — required, but auto-issued if QC
    // leaves it blank so every inspected lot always carries one.
    const reportNo = b.qcReportNo?.trim() || await withDocRetry(() => generateSequentialNumber(prisma, 'IR'));

    // The complete inward-inspection report (IIR). Whitelisted so the client
    // can't stuff arbitrary keys; everything is plain text / array.
    const rep = b.qcReport || {};
    const num = (v) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
    const qcReport = {
      reportDate: rep.reportDate || null,
      inspectionLocation: rep.inspectionLocation?.trim?.() || null,
      reportReferenceNo: rep.reportReferenceNo?.trim?.() || null,
      materialDescription: rep.materialDescription?.trim?.() || null,
      materialCategory: rep.materialCategory?.trim?.() || null,
      documentTypes: Array.isArray(rep.documentTypes) ? rep.documentTypes : [],
      dimInspectionSupplier: !!rep.dimInspectionSupplier,
      dimInspectionRaps: !!rep.dimInspectionRaps,
      packingCondition: rep.packingCondition?.trim?.() || null,
      packingDamageNotes: rep.packingDamageNotes?.trim?.() || null,
      dateOfManufacturing: rep.dateOfManufacturing || null,
      tappedHolesCondition: rep.tappedHolesCondition?.trim?.() || null,
      qtyAsPerPR: num(rep.qtyAsPerPR),
      qtyOrdered: num(rep.qtyOrdered),
      rejectionReason: rep.rejectionReason?.trim?.() || null,
    };

    const updated = await prisma.materialInwardRegister.update({
      where: { id: row.id },
      data: {
        // On hold → ON_HOLD (re-inspectable). Otherwise the review is done.
        status: onHold ? 'ON_HOLD' : 'QC_DONE',
        qcResult,
        qtyAccepted: onHold ? null : (b.qtyAccepted != null && b.qtyAccepted !== '' ? Number(b.qtyAccepted) : null),
        qtyRejected: b.qtyRejected != null && b.qtyRejected !== '' ? Number(b.qtyRejected) : null,
        qtyHeld: onHold ? (b.qtyHeld != null && b.qtyHeld !== '' ? Number(b.qtyHeld) : (row.qtyReceived ?? null)) : null,
        qcReportNo: reportNo,
        qcReportRemark: b.qcReportRemark.trim(),
        qcReport,
        holdReason: onHold ? b.holdReason.trim() : null,
        ...(onHold ? { holdCount: { increment: 1 } } : {}),
        qcFinishedAt: new Date(),
      },
    });
    // Deferred QC: a Tools & Fixtures lot inwarded to the unit before QC. The stock
    // is already in place, so the outcome is informational — a failure is flagged
    // (no auto-reversal), not a rejection that blocks inward.
    const deferred = !!row.inwardedAt;
    const resultLabel = qcResult === 'ON_HOLD' ? 'on hold' : qcResult.toLowerCase();
    let message;
    if (onHold) {
      message = `${req.user.name} placed inward ${row.mirNo} on hold — ${b.holdReason.trim()}. Address it and resend to QC.`;
    } else if (deferred) {
      message = qcResult === 'FAILED'
        ? `${req.user.name} finished deferred QC for ${row.mirNo} — FAILED. This Tools & Fixtures lot is already with ${row.issuedToLabel || 'the unit'}; it is flagged QC-failed (stock not auto-removed). Decide on disposition.`
        : `${req.user.name} finished deferred QC for ${row.mirNo} — ${qcResult}. The lot is already in the unit's stock.`;
    } else {
      message = `${req.user.name} finished QC for inward ${row.mirNo} — ${qcResult}. ${qcResult === 'FAILED' ? 'Material rejected.' : 'Ready to inward into stores.'}`;
    }
    await prisma.notification.create({
      data: {
        type: onHold ? 'INWARD_QC_HOLD' : (deferred && qcResult === 'FAILED' ? 'INWARD_TF_QC_FAILED' : 'INWARD_QC_DONE'),
        title: `QC ${resultLabel}: ${row.itemDescription || row.mirNo}`,
        message,
        targetRole: 'STORE_MANAGER',
        sentById: req.user.id,
      },
    });
    // Deferred-QC failure also flags the owning unit's manager directly (no reversal).
    if (deferred && qcResult === 'FAILED' && row.issuedToUnitId) {
      const mgr = await prisma.user.findFirst({ where: { role: 'MANAGER', unitId: row.issuedToUnitId, isActive: true }, select: { id: true } });
      if (mgr) {
        await prisma.notification.create({
          data: {
            type: 'INWARD_TF_QC_FAILED',
            title: `QC failed (post-inward): ${row.itemDescription || row.mirNo}`,
            message: `Deferred QC failed for ${row.mirNo} — ${b.qcReportRemark.trim()}. The stock is already in your unit and is flagged QC-failed. Decide on disposition.`,
            targetUserId: mgr.id,
            sentById: req.user.id,
          },
        }).catch(() => {});
      }
    }
    res.json(updated);
  } catch (err) {
    console.error('finish-review error:', err);
    res.status(500).json({ error: 'Failed to finish review' });
  }
});

// ── POST /api/material-inward/:id/resend-qc ───────────────────────────
// Re-inspection. A held lot (or a finished review that failed / was partial) can
// be sent back to QC once the issue is addressed. The completed round is archived
// into qcHistory, then the row resets to QC_REQUESTED for a fresh round.
router.post('/:id/resend-qc', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    const canResend = row.status === 'ON_HOLD'
      || (row.status === 'QC_DONE' && ['FAILED', 'PARTIAL'].includes(row.qcResult));
    if (!canResend) {
      return res.status(400).json({ error: 'Only held lots or failed/partial reviews can be resent to QC' });
    }

    // Archive the round that just finished so re-inspections keep full history.
    const history = Array.isArray(row.qcHistory) ? [...row.qcHistory] : [];
    history.push({
      round: row.qcRound || 1,
      result: row.qcResult || null,
      reportNo: row.qcReportNo || null,
      remark: row.qcReportRemark || null,
      holdReason: row.holdReason || null,
      qtyAccepted: row.qtyAccepted ?? null,
      qtyRejected: row.qtyRejected ?? null,
      qtyHeld: row.qtyHeld ?? null,
      reviewerId: row.qcReviewerId || null,
      finishedAt: row.qcFinishedAt ? row.qcFinishedAt.toISOString() : null,
      report: row.qcReport || null,
      resentAt: new Date().toISOString(),
      resentById: req.user.id,
    });

    const note = req.body?.note?.trim() || null;
    const updated = await prisma.materialInwardRegister.update({
      where: { id: row.id },
      data: {
        status: 'QC_REQUESTED',
        qcRound: (row.qcRound || 1) + 1,
        qcHistory: history,
        qcRequestedAt: new Date(),
        qcRequestedById: req.user.id,
        qcRequestNote: note || row.qcRequestNote,
        // Reset the current-round review fields so QC files a fresh outcome.
        qcReviewerId: null,
        qcReviewStartedAt: null,
        qcResult: null,
        qtyAccepted: null,
        qtyRejected: null,
        qtyHeld: null,
        qcReportNo: null,
        qcReportRemark: null,
        qcReport: null,
        qcFinishedAt: null,
        holdReason: null,
      },
    });
    await prisma.notification.create({
      data: {
        type: 'INWARD_QC_REQUEST',
        title: `Re-inspection: ${row.itemDescription || row.mirNo}`,
        message: `${req.user.name} resent inward ${row.mirNo} to QC for re-inspection${note ? ` — ${note}` : ''}.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('resend-qc error:', err);
    res.status(500).json({ error: 'Failed to resend to QC' });
  }
});

// ── POST /api/material-inward/:id/inward ──────────────────────────────
// Final step: Stores accepts the QC-cleared lot into stock. Creates the
// ProductBatch + StockMovement and bumps product / unit / dept stock.
router.post('/:id/inward', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.inwardedAt) return res.status(400).json({ error: 'This entry has already been inwarded' });

    // Linked product (if any) drives the Tools & Fixtures fast-path + master-data gate.
    const product = row.productId ? await prisma.product.findUnique({ where: { id: row.productId } }) : null;
    const isTF = isToolsAndFixtures(product, row);

    if (!isTF) {
      // Normal flow: QC must be finished + passed, and the master data must have
      // been added, before any stock is created.
      if (row.status !== 'QC_DONE') return res.status(400).json({ error: 'Finish QC before inwarding' });
      if (row.qcResult === 'FAILED') return res.status(400).json({ error: 'QC failed — this material cannot be inwarded' });
      if (product && product.masterDataComplete === false) {
        await notifyMasterDataHold(row, req.user.id, {
          title: `Master data needed: ${row.itemDescription || row.mirNo}`,
          message: `${req.user.name} tried to inward ${row.mirNo} but "${product.name}" has no master data yet. Add its master data (specs / shelf life) on the Master Data screen so Stores can inward it.`,
        });
        return res.status(400).json({ error: "On hold: master data not added yet — a unit head or QC must add this material's master data before it can be inwarded." });
      }
    }
    // Tools & Fixtures: inward allowed from any pre-inward status; QC + master data
    // are deferred and handled later on the already-inwarded lot.

    // Inward the QC-accepted qty when QC set one, else the received qty.
    const qty = row.qtyAccepted != null ? row.qtyAccepted : (row.qtyReceived || 0);
    if (!row.productId) {
      // No resolved product — mark the register row inwarded without touching
      // stock (rare: free-text direct entry with no product picked).
      const marked = await prisma.materialInwardRegister.update({
        where: { id: row.id }, data: { status: 'INWARDED', inwardedAt: new Date() },
      });
      return res.json({ row: marked, stocked: false });
    }
    if (!qty || qty <= 0) return res.status(400).json({ error: 'Accepted quantity must be greater than zero' });
    if (!product) return res.status(404).json({ error: 'Linked product not found' });

    // Auto-split the accepted qty across every unit that raised a PR for this
    // line (union POs); a single-unit row keeps it whole; a dept/unbound row
    // leaves it in the general pool.
    const unitSplit = splitQtyAcrossUnits(row, qty).filter((s) => s.qty > 0);

    const result = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { currentStock: { increment: qty } } });

      const baseNote = `Inward ${row.mirNo}${row.docNumber ? ` · ${row.docNumber}` : ''}`;
      const movements = [];
      if (unitSplit.length) {
        // One IN movement per receiving unit so each unit's ledger is exact.
        for (const s of unitSplit) {
          movements.push(await tx.stockMovement.create({
            data: {
              productId: product.id,
              type: 'IN',
              quantity: s.qty,
              batchNumber: row.batchNo || null,
              referenceType: 'MaterialInwardRegister',
              referenceId: row.id,
              notes: unitSplit.length > 1 ? `${baseNote} → ${s.unitName || 'unit'}` : baseNote,
              performedBy: req.user.id,
              unitId: s.unitId,
            },
          }));
          await tx.productUnitStock.upsert({
            where: { productId_unitId: { productId: product.id, unitId: s.unitId } },
            update: { quantity: { increment: s.qty } },
            create: { productId: product.id, unitId: s.unitId, quantity: s.qty },
          });
        }
      } else {
        // No bound unit — single movement into the general / dept pool.
        movements.push(await tx.stockMovement.create({
          data: {
            productId: product.id,
            type: 'IN',
            quantity: qty,
            batchNumber: row.batchNo || null,
            referenceType: 'MaterialInwardRegister',
            referenceId: row.id,
            notes: baseNote,
            performedBy: req.user.id,
            unitId: null,
          },
        }));
      }

      const batch = await tx.productBatch.create({
        data: {
          productId: product.id,
          batchNo: row.batchNo || null,
          quantity: qty,
          remaining: qty,
          referenceType: 'MaterialInwardRegister',
          referenceId: row.id,
          notes: row.purpose || null,
          createdById: req.user.id,
          supplierName: row.supplierName || null,
          assignedDept: row.issuedToDept || null,
          dateOfExpiry: row.dateOfExpiry || null,
        },
      });

      const reservedDept = OWNER_DEPTS.includes((row.issuedToDept || '').trim()) ? row.issuedToDept.trim() : null;
      if (reservedDept) {
        await tx.productDeptStock.upsert({
          where: { productId_dept: { productId: product.id, dept: reservedDept } },
          update: { quantity: { increment: qty } },
          create: { productId: product.id, dept: reservedDept, quantity: qty },
        });
      }

      // Stamp the PO + advance its item receivedQty (informational; PO status
      // is left to the existing PO flow).
      if (row.purchaseOrderId) {
        await tx.purchaseOrder.update({
          where: { id: row.purchaseOrderId },
          data: { goodsArrived: true, goodsArrivedAt: new Date(), inwardedAt: new Date(), mirNo: row.mirNo },
        }).catch(() => {});
        if (row.purchaseOrderItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: row.purchaseOrderItemId },
            data: { receivedQty: { increment: qty } },
          }).catch(() => {});
        }
      }

      const updatedRow = await tx.materialInwardRegister.update({
        where: { id: row.id },
        data: { status: 'INWARDED', inwardedAt: new Date(), batchId: batch.id },
      });
      return { row: updatedRow, movements, batch };
    });

    // Tools & Fixtures inwarded straight to the unit before QC — flag QC to do the
    // (deferred) inspection on the lot that's already in stock.
    if (isTF) {
      await prisma.notification.create({
        data: {
          type: 'INWARD_TF_QC_PENDING',
          title: `T&F inwarded — QC pending: ${row.itemDescription || row.mirNo}`,
          message: `${req.user.name} inwarded Tools & Fixtures ${row.mirNo}${row.issuedToLabel ? ` to ${row.issuedToLabel}` : ''} directly to the unit. QC is still pending — review the lot when ready.`,
          targetRole: 'QC',
          sentById: req.user.id,
        },
      }).catch(() => {});
    }

    res.json({ ...result, stocked: true, qcDeferred: isTF });
  } catch (err) {
    console.error('material-inward inward error:', err);
    res.status(500).json({ error: 'Failed to record inward' });
  }
});

// ── DELETE /api/material-inward/:id ───────────────────────────────────
router.delete('/:id', authenticate, requireInwardWrite, async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.status === 'INWARDED') return res.status(400).json({ error: 'Inwarded entries cannot be deleted' });
    await prisma.materialInwardRegister.delete({ where: { id: row.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('material-inward delete error:', err);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

module.exports = router;
