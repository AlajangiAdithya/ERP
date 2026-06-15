const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  paginate, applyDateFilter, generateSequentialNumber, withDocRetry, OWNER_DEPTS,
} = require('../utils/helpers');
const { qcDocsUpload, publicUrlFor } = require('../middleware/upload');

const router = express.Router();

// ── Role groups ──
// Stores does the actual inward work (create rows, request QC, final inward).
const WRITE_ROLES = ['ADMIN', 'STORE_MANAGER'];
// QC reviews each lot inside the register.
const QC_ROLES = ['ADMIN', 'QC'];
// Everyone with oversight may read the register.
const VIEW_ROLES = [
  'ADMIN', 'STORE_MANAGER', 'QC', 'PURCHASE_OFFICER', 'PLANNING',
  'SAFETY', 'MANAGER', 'SUPPLY_CHAIN', 'ACCOUNTING', 'FINANCE',
];

const USER_SELECT = { select: { id: true, name: true, role: true } };

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
function issuedToFromPo(po) {
  const prs = prsOf(po);
  const prNumbers = prs.map((p) => p.requestNumber).filter(Boolean).join(', ');
  const units = [];
  const seen = new Set();
  prs.forEach((p) => {
    if (p.unit && !seen.has(p.unit.id)) { seen.add(p.unit.id); units.push(p.unit); }
  });
  let issuedToUnitId = null;
  let issuedToLabel = '';
  if (units.length === 1) {
    issuedToUnitId = units[0].id;
    issuedToLabel = `${units[0].name} (${units[0].code})`;
  } else if (units.length > 1) {
    // Union across several units — show them all; leave stock in general pool.
    issuedToLabel = units.map((u) => `${u.name} (${u.code})`).join(' · ');
  } else {
    // Global requester (no unit) — label by the raising manager / role.
    const mgr = prs.find((p) => p.manager)?.manager;
    issuedToLabel = mgr ? `${mgr.name} (${mgr.role})` : '';
  }
  return { prNumbers, issuedToUnitId, issuedToLabel };
}

const PO_PICKER_INCLUDE = {
  items: { select: { id: true, productId: true, productName: true, productUnit: true, quantity: true, receivedQty: true } },
  supplier: { select: { id: true, name: true } },
  purchaseRequest: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } }, manager: USER_SELECT } },
  sourceRequests: {
    select: {
      purchaseRequest: { select: { id: true, requestNumber: true, unit: { select: { id: true, name: true, code: true } }, manager: USER_SELECT } },
    },
  },
};

// ── GET /api/material-inward/active-pos ───────────────────────────────
// Active POs the stores person can attach an inward row to. Each entry carries
// just enough to auto-fill the register: supplier, PR no(s), items, issued-to.
router.get('/active-pos', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const orders = await prisma.purchaseOrder.findMany({
      where: { status: { in: ACTIVE_PO_STATUSES } },
      include: PO_PICKER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const out = orders.map((po) => {
      const { prNumbers, issuedToUnitId, issuedToLabel } = issuedToFromPo(po);
      return {
        id: po.id,
        orderNumber: po.orderNumber,
        customName: po.customName,
        supplierName: po.supplierName,
        isUnion: po.isUnion,
        prNumbers,
        issuedToUnitId,
        issuedToLabel,
        items: (po.items || []).map((it) => ({
          id: it.id,
          productId: it.productId,
          productName: it.productName,
          productUnit: it.productUnit,
          quantity: it.quantity,
          receivedQty: it.receivedQty,
        })),
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
    // Managers only see rows bound for their own unit.
    if (req.user.role === 'MANAGER') where.issuedToUnitId = req.user.unitId;

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
      productIds.size ? prisma.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true, sku: true, materialCode: true, unit: true } }) : [],
      batchNos.size ? prisma.requestItem.findMany({
        where: { materialBatchNo: { in: [...batchNos] } },
        select: {
          materialBatchNo: true, qtyIssued: true, productId: true,
          request: { select: { requestNumber: true, unit: { select: { name: true, code: true } } } },
        },
      }) : [],
      poIds.size ? prisma.purchaseOrder.findMany({ where: { id: { in: [...poIds] } }, select: { id: true, orderNumber: true } }) : [],
      poItemIds.size ? prisma.purchaseOrderItem.findMany({ where: { id: { in: [...poItemIds] } }, select: { id: true, quantity: true } }) : [],
    ]);

    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
    const unitMap = Object.fromEntries(units.map((u) => [u.id, u]));
    const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
    const poMap = Object.fromEntries(pos.map((p) => [p.id, p]));
    const poItemMap = Object.fromEntries(poItems.map((it) => [it.id, it]));
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
      poNumber: r.purchaseOrderId ? (poMap[r.purchaseOrderId]?.orderNumber || null) : null,
      orderedQty: r.purchaseOrderItemId ? (poItemMap[r.purchaseOrderItemId]?.quantity ?? null) : null,
      mivs: r.batchNo ? (mivMap[r.batchNo] || []) : [],
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
router.post('/', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const b = req.body || {};
    const docType = ['INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS'].includes(b.docType) ? b.docType : 'INVOICE';

    const data = {
      inwardDate: b.inwardDate ? new Date(b.inwardDate) : new Date(),
      vehicleDetails: b.vehicleDetails?.trim() || null,
      docType,
      docNumber: b.docNumber?.trim() || null,
      purchaseOrderId: b.purchaseOrderId || null,
      purchaseOrderItemId: b.purchaseOrderItemId || null,
      supplierName: b.supplierName?.trim() || null,
      prNumbers: b.prNumbers?.trim() || null,
      itemDescription: b.itemDescription?.trim() || null,
      uom: b.uom?.trim() || null,
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
      const { prNumbers, issuedToUnitId, issuedToLabel } = issuedToFromPo(po);
      data.supplierName = po.supplierName || data.supplierName;
      data.prNumbers = prNumbers || data.prNumbers;
      data.issuedToUnitId = issuedToUnitId;
      data.issuedToLabel = issuedToLabel;
      const item = (po.items || []).find((it) => it.id === data.purchaseOrderItemId);
      if (item) {
        data.itemDescription = item.productName;
        data.uom = item.productUnit;
        data.productId = item.productId || null;
      }
    }

    if (!data.itemDescription) return res.status(400).json({ error: 'Item description is required' });

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

// ── PATCH /api/material-inward/:id ────────────────────────────────────
// Edit row fields before QC has been requested (DRAFT only).
router.patch('/:id', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.status !== 'DRAFT') return res.status(400).json({ error: 'Only draft entries can be edited' });

    const b = req.body || {};
    const patch = {};
    if (b.vehicleDetails !== undefined) patch.vehicleDetails = b.vehicleDetails?.trim() || null;
    if (b.docType && ['INVOICE', 'CASH_PURCHASE', 'DELIVERY_CHALLAN', 'GATE_PASS'].includes(b.docType)) patch.docType = b.docType;
    if (b.docNumber !== undefined) patch.docNumber = b.docNumber?.trim() || null;
    if (b.qtyReceived !== undefined) patch.qtyReceived = b.qtyReceived === '' || b.qtyReceived == null ? null : Number(b.qtyReceived);
    if (b.purpose !== undefined) patch.purpose = b.purpose?.trim() || null;
    if (b.batchNo !== undefined) patch.batchNo = b.batchNo?.trim() || null;
    if (b.dateOfExpiry !== undefined) patch.dateOfExpiry = b.dateOfExpiry ? new Date(b.dateOfExpiry) : null;
    if (b.itemDescription !== undefined && !row.purchaseOrderId) patch.itemDescription = b.itemDescription?.trim() || row.itemDescription;
    if (b.uom !== undefined && !row.purchaseOrderId) patch.uom = b.uom?.trim() || null;
    if (b.productId !== undefined && !row.purchaseOrderId) patch.productId = b.productId || null;

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
router.post('/:id/documents', authenticate, authorize(...WRITE_ROLES), qcDocsUpload.array('documents', 10), async (req, res) => {
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
router.delete('/:id/documents/:index', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
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

// ── POST /api/material-inward/:id/request-qc ──────────────────────────
// Stores hands the lot to QC. Captures the document requirement + note.
router.post('/:id/request-qc', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (!['DRAFT', 'QC_REQUESTED'].includes(row.status)) {
      return res.status(400).json({ error: 'QC has already been taken up for this entry' });
    }
    const updated = await prisma.materialInwardRegister.update({
      where: { id: row.id },
      data: {
        status: 'QC_REQUESTED',
        qcRequestedAt: new Date(),
        qcRequestedById: req.user.id,
        qcRequestNote: req.body?.qcRequestNote?.trim() || null,
        qcDocRequirement: req.body?.qcDocRequirement?.trim() || null,
      },
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
    const qcResult = ['PASSED', 'PARTIAL', 'FAILED'].includes(b.qcResult) ? b.qcResult : null;
    if (!qcResult) return res.status(400).json({ error: 'Select a QC result (Passed / Partial / Failed)' });
    if (!b.qcReportRemark?.trim()) return res.status(400).json({ error: 'A report remark is required to finish the review' });

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
        status: 'QC_DONE',
        qcResult,
        qtyAccepted: b.qtyAccepted != null && b.qtyAccepted !== '' ? Number(b.qtyAccepted) : null,
        qtyRejected: b.qtyRejected != null && b.qtyRejected !== '' ? Number(b.qtyRejected) : null,
        qcReportNo: reportNo,
        qcReportRemark: b.qcReportRemark.trim(),
        qcReport,
        qcFinishedAt: new Date(),
      },
    });
    await prisma.notification.create({
      data: {
        type: 'INWARD_QC_DONE',
        title: `QC ${qcResult.toLowerCase()}: ${row.itemDescription || row.mirNo}`,
        message: `${req.user.name} finished QC for inward ${row.mirNo} — ${qcResult}. ${qcResult === 'FAILED' ? 'Material rejected.' : 'Ready to inward into stores.'}`,
        targetRole: 'STORE_MANAGER',
        sentById: req.user.id,
      },
    });
    res.json(updated);
  } catch (err) {
    console.error('finish-review error:', err);
    res.status(500).json({ error: 'Failed to finish review' });
  }
});

// ── POST /api/material-inward/:id/inward ──────────────────────────────
// Final step: Stores accepts the QC-cleared lot into stock. Creates the
// ProductBatch + StockMovement and bumps product / unit / dept stock.
router.post('/:id/inward', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
  try {
    const row = await prisma.materialInwardRegister.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Entry not found' });
    if (row.status !== 'QC_DONE') return res.status(400).json({ error: 'Finish QC before inwarding' });
    if (row.qcResult === 'FAILED') return res.status(400).json({ error: 'QC failed — this material cannot be inwarded' });

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

    const product = await prisma.product.findUnique({ where: { id: row.productId } });
    if (!product) return res.status(404).json({ error: 'Linked product not found' });

    const result = await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id: product.id }, data: { currentStock: { increment: qty } } });

      const movement = await tx.stockMovement.create({
        data: {
          productId: product.id,
          type: 'IN',
          quantity: qty,
          batchNumber: row.batchNo || null,
          referenceType: 'MaterialInwardRegister',
          referenceId: row.id,
          notes: `Inward ${row.mirNo}${row.docNumber ? ` · ${row.docNumber}` : ''}`,
          performedBy: req.user.id,
          unitId: row.issuedToUnitId || null,
        },
      });

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

      if (row.issuedToUnitId) {
        await tx.productUnitStock.upsert({
          where: { productId_unitId: { productId: product.id, unitId: row.issuedToUnitId } },
          update: { quantity: { increment: qty } },
          create: { productId: product.id, unitId: row.issuedToUnitId, quantity: qty },
        });
      }
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
      return { row: updatedRow, movement, batch };
    });

    res.json({ ...result, stocked: true });
  } catch (err) {
    console.error('material-inward inward error:', err);
    res.status(500).json({ error: 'Failed to record inward' });
  }
});

// ── DELETE /api/material-inward/:id ───────────────────────────────────
router.delete('/:id', authenticate, authorize(...WRITE_ROLES), async (req, res) => {
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
