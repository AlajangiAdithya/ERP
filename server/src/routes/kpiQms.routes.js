// ──────────────────────────────────────────────────────────────
// KPI-QMS dashboard panel
//
// One read endpoint feeds the auto-generated QMS KPIs shown on every
// role's dashboard (view-only):
//   • Marketing  — on-time deliveries + tender vs order (from Work Orders)
//   • Purchase   — supplier performance rating per form 04-SUPPLIER
//                  PERFORMANCE RATING: Quality (60) = accepted/received,
//                  Delivery (40) = on-time/total, Total (100), min 85%
//   • QC         — product rejections (inspections with rejected qty)
//   • Certifications — uploaded documents list
//
// Access model:
//   • View: every authenticated user.
//   • Certifications upload/edit/delete: ONLY Unit-5 users.
//     (SUPERADMIN bypasses every authorize() check globally.)
// ──────────────────────────────────────────────────────────────
const express = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { qmsCertUpload, qmsDocUpload, publicUrlFor } = require('../middleware/upload');
const { getFinancialYear } = require('../utils/helpers');

const router = express.Router();

// Unit 5 may appear as code '5', name 'Unit 5', or username 'unit 5' depending
// on which path created the account — match any of them (mirrors the machinery
// register's Unit-5 detection).
const EDIT_UNIT_CODES = ['5', 'UNIT-V', 'UNIT-5'];
const EDIT_UNIT_NAMES = ['unit 5', 'unit-5', 'unit5', 'unit v'];

const unitCodeOf = (user) => (user?.unit?.code || '').toString().toUpperCase();
const unitNameOf = (user) => (user?.unit?.name || '').toString().trim().toLowerCase();
const usernameOf = (user) => (user?.username || '').toString().trim().toLowerCase();

const isUnit5 = (user) => {
  if (!user) return false;
  if (EDIT_UNIT_CODES.includes(unitCodeOf(user))) return true;
  if (EDIT_UNIT_NAMES.includes(unitNameOf(user))) return true;
  if (EDIT_UNIT_NAMES.includes(usernameOf(user))) return true;
  return false;
};

// Certifications are managed ONLY by Unit-5 (+ SUPERADMIN). Everyone views.
const canManageCerts = (user) => {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;
  return isUnit5(user);
};

const requireCertWrite = (req, res, next) => {
  if (!canManageCerts(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// Supplier performance rating (form 04) is editable ONLY by Unit-5 and
// Purchase (+ SUPERADMIN). Everyone views.
const canEditSupplierPerf = (user) => {
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role === 'PURCHASE_OFFICER') return true;
  return isUnit5(user);
};

const requireSupplierPerfWrite = (req, res, next) => {
  if (!canEditSupplierPerf(req.user)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const toDate = (v) => (v ? new Date(v) : null);
const trimOrNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

// "25-26" → [2025-04-01, 2026-04-01) — Indian FY, mirrors getFinancialYear.
const fyRange = (fy) => {
  const startYY = parseInt(String(fy).split('-')[0], 10);
  if (isNaN(startYY)) return null;
  const startYear = 2000 + startYY;
  return {
    from: new Date(startYear, 3, 1), // Apr 1
    to: new Date(startYear + 1, 3, 1), // next Apr 1 (exclusive)
  };
};

// FY labels from the earliest data point up to the current FY (newest first).
const listFys = (earliest) => {
  const current = getFinancialYear();
  const currentStart = 2000 + parseInt(current.split('-')[0], 10);
  let firstStart = currentStart;
  if (earliest) {
    const fy = getFinancialYear(new Date(earliest));
    firstStart = Math.min(currentStart, 2000 + parseInt(fy.split('-')[0], 10));
  }
  const out = [];
  for (let y = currentStart; y >= firstStart; y--) {
    out.push(`${String(y).slice(-2)}-${String(y + 1).slice(-2)}`);
  }
  return out;
};

// Effective PDC = latest extension if any, else original pdcDate (same rule as
// the Work Order register).
const effectivePdc = (wo) => {
  const last = wo.extensions?.length ? wo.extensions[wo.extensions.length - 1] : null;
  return last ? last.newPdcDate : wo.pdcDate;
};

// ── Marketing KPIs (Work Orders whose supply order falls inside the FY) ──
const marketingKpis = async (from, to) => {
  const workOrders = await prisma.workOrder.findMany({
    where: { supplyOrderDate: { gte: from, lt: to } },
    select: {
      id: true,
      status: true,
      pdcDate: true,
      completedAt: true,
      extensions: { orderBy: { extensionNo: 'asc' }, select: { newPdcDate: true } },
    },
  });

  // Tender vs Order: every customer supply order logged counts as a tender
  // enquiry; it becomes a confirmed order once it survives admin acceptance.
  const tenders = workOrders.length;
  const declined = workOrders.filter((w) => ['REJECTED', 'CANCELLED'].includes(w.status)).length;
  const pending = workOrders.filter((w) => w.status === 'PENDING_ADMIN').length;
  const orders = tenders - declined - pending;

  // On-time deliveries: a WO only counts once its payment is fully received
  // (status CLOSED). completedAt holds the delivery date, so on-time still
  // measures delivery vs PDC — delivered-but-unpaid WOs are not counted yet.
  const completed = workOrders.filter((w) => w.status === 'CLOSED' && w.completedAt);
  const onTimeCount = completed.filter((w) => {
    const pdc = effectivePdc(w);
    return pdc && new Date(w.completedAt) <= new Date(pdc);
  }).length;

  return {
    tenderVsOrder: {
      tenders,
      orders,
      pending,
      declined,
      conversionPercent: tenders > 0 ? round1((orders / tenders) * 100) : null,
    },
    onTimeDelivery: {
      completedCount: completed.length,
      onTimeCount,
      lateCount: completed.length - onTimeCount,
      onTimePercent: completed.length > 0 ? round1((onTimeCount / completed.length) * 100) : null,
    },
  };
};

// ── Purchase KPI: supplier performance per form 04 — SUPPLIER PERFORMANCE RATING ──
// Form columns: Item Description | Supplier Name | No. of Supplies received |
// Qty. Accepted | Quality Rating (60) | Total deliveries received | On time |
// Beyond time | Delivery Rating (40) | TOTAL RATING (100). Min criteria: 85%.
//
// If Unit-5/Purchase has saved a manual rating for the FY (stored in the
// existing SupplierPerformanceRating tables shared with the Approved Supplier
// List), that is shown. Otherwise rows are auto-computed from QC inward
// inspections:
//   Quality Rating (60)  = qty accepted / qty received × 60 (graded inspections)
//   Delivery Rating (40) = deliveries on time / total deliveries × 40
// A delivery (= QC lot) is on time when it arrived on/before the earliest
// "required by" date on the PR items behind its PO; lots with no required-by
// date breached no commitment and count as on time.
const rowsBelow = (rows, min) => rows.filter((r) => r.totalRating != null && r.totalRating < min).length;

const supplierPerformanceKpis = async (fy, from, to) => {
  const saved = await prisma.supplierPerformanceRating.findUnique({
    where: { financialYear: fy },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
  if (saved) {
    const suppliers = saved.items.map((it) => ({
      supplierId: it.supplierId,
      supplierName: it.supplierName,
      itemDescription: it.itemDescription,
      suppliesReceived: it.suppliesReceived,
      qtyAccepted: it.qtyAccepted,
      qualityRating: it.qualityRating,
      totalDeliveries: it.totalDeliveries,
      deliveriesOnTime: it.deliveriesOnTime,
      deliveriesLate: it.deliveriesLate,
      deliveryRating: it.deliveryRating,
      totalRating: it.totalRating,
    }));
    return {
      source: 'manual',
      minimumCriteria: saved.minimumCriteria,
      periodFrom: saved.periodFrom,
      periodTo: saved.periodTo,
      preparedDate: saved.preparedDate,
      preparedByName: saved.preparedByName,
      remarks: saved.remarks,
      suppliers,
      belowCriteriaCount: rowsBelow(suppliers, saved.minimumCriteria),
    };
  }
  return supplierPerformanceAuto(from, to);
};

const supplierPerformanceAuto = async (from, to) => {
  const inspections = await prisma.qCInspection.findMany({
    where: {
      createdAt: { gte: from, lt: to },
      purchaseOrder: { isNot: null },
    },
    select: {
      id: true,
      result: true,
      createdAt: true,
      materialReceiptDate: true,
      qtyReceived: true,
      qtyAccepted: true,
      arrivedQty: true,
      purchaseOrder: {
        select: {
          id: true,
          supplierId: true,
          supplierName: true,
          purchaseRequest: { select: { items: { select: { requiredByDate: true } } } },
          sourceRequests: {
            select: { purchaseRequest: { select: { items: { select: { requiredByDate: true } } } } },
          },
        },
      },
    },
  });

  // Earliest required-by per PO (direct PR items + union-PO source PR items).
  const poDueDate = new Map();
  const dueDateFor = (po) => {
    if (poDueDate.has(po.id)) return poDueDate.get(po.id);
    const dates = [];
    for (const it of po.purchaseRequest?.items || []) {
      if (it.requiredByDate) dates.push(new Date(it.requiredByDate));
    }
    for (const src of po.sourceRequests || []) {
      for (const it of src.purchaseRequest?.items || []) {
        if (it.requiredByDate) dates.push(new Date(it.requiredByDate));
      }
    }
    const due = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
    poDueDate.set(po.id, due);
    return due;
  };

  const bySupplier = new Map();
  for (const insp of inspections) {
    const po = insp.purchaseOrder;
    const key = po.supplierId || `name:${po.supplierName}`;
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        supplierId: po.supplierId || null,
        supplierName: po.supplierName,
        qtyReceived: 0,
        qtyAccepted: 0,
        gradedLots: 0, // completed inspections feeding the quality rating
        totalDeliveries: 0,
        deliveriesOnTime: 0,
        deliveriesLate: 0,
      });
    }
    const row = bySupplier.get(key);

    // Delivery: every lot physically received in the FY counts.
    row.totalDeliveries += 1;
    const received = toDate(insp.materialReceiptDate) || new Date(insp.createdAt);
    const due = dueDateFor(po);
    if (!due || received <= new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59)) {
      row.deliveriesOnTime += 1;
    } else {
      row.deliveriesLate += 1;
    }

    // Quality: only inspections QC has actually graded.
    if (insp.result !== 'PENDING') {
      const rec = insp.qtyReceived != null ? insp.qtyReceived : insp.arrivedQty;
      if (rec != null && rec > 0) {
        row.gradedLots += 1;
        row.qtyReceived += rec;
        row.qtyAccepted += insp.qtyAccepted || 0;
      }
    }
  }

  const rows = [...bySupplier.values()]
    .map((r) => {
      const qualityRating = r.qtyReceived > 0 ? round2((r.qtyAccepted / r.qtyReceived) * 60) : null;
      const deliveryRating = r.totalDeliveries > 0 ? round2((r.deliveriesOnTime / r.totalDeliveries) * 40) : null;
      const totalRating = qualityRating != null && deliveryRating != null
        ? round2(qualityRating + deliveryRating)
        : null;
      return {
        supplierId: r.supplierId,
        supplierName: r.supplierName,
        itemDescription: null,
        // Form column "No. of Supplies received" = quantity received.
        suppliesReceived: r.qtyReceived,
        qtyAccepted: r.qtyAccepted,
        qualityRating,
        totalDeliveries: r.totalDeliveries,
        deliveriesOnTime: r.deliveriesOnTime,
        deliveriesLate: r.deliveriesLate,
        deliveryRating,
        totalRating,
      };
    })
    .sort((a, b) => (b.totalRating ?? -1) - (a.totalRating ?? -1));

  return {
    source: 'auto',
    minimumCriteria: 85,
    periodFrom: null,
    periodTo: null,
    preparedDate: null,
    preparedByName: null,
    remarks: null,
    suppliers: rows,
    belowCriteriaCount: rowsBelow(rows, 85),
  };
};

// ── QC KPI: product rejections ──
const qcRejectionKpis = async (from, to) => {
  const inspections = await prisma.qCInspection.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: {
      id: true,
      inspectionNumber: true,
      result: true,
      createdAt: true,
      inspectedAt: true,
      materialDescription: true,
      qtyReceived: true,
      qtyAccepted: true,
      qtyRejected: true,
      rejectionReason: true,
      purchaseOrder: { select: { orderNumber: true, supplierName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const graded = inspections.filter((i) => i.result !== 'PENDING');
  const totalQtyReceived = graded.reduce((s, i) => s + (i.qtyReceived || 0), 0);
  const totalQtyRejected = graded.reduce((s, i) => s + (i.qtyRejected || 0), 0);
  const rejections = inspections.filter(
    (i) => (i.qtyRejected || 0) > 0 || ['FAILED', 'PARTIAL'].includes(i.result),
  );

  return {
    totalInspections: inspections.length,
    gradedInspections: graded.length,
    rejectionCount: rejections.length,
    totalQtyReceived,
    totalQtyRejected,
    rejectionRatePercent: totalQtyReceived > 0 ? round1((totalQtyRejected / totalQtyReceived) * 100) : null,
    rows: rejections.slice(0, 50).map((i) => ({
      id: i.id,
      inspectionNumber: i.inspectionNumber,
      date: i.inspectedAt || i.createdAt,
      materialDescription: i.materialDescription,
      orderNumber: i.purchaseOrder?.orderNumber || null,
      supplierName: i.purchaseOrder?.supplierName || null,
      qtyReceived: i.qtyReceived,
      qtyAccepted: i.qtyAccepted,
      qtyRejected: i.qtyRejected,
      rejectionReason: i.rejectionReason,
      result: i.result,
    })),
  };
};

// GET /api/kpi-qms?fy=25-26 — the whole panel in one shot. Everyone views.
router.get('/', authenticate, async (req, res) => {
  try {
    const currentFy = getFinancialYear();
    const fy = trimOrNull(req.query.fy) || currentFy;
    const range = fyRange(fy);
    if (!range) return res.status(400).json({ error: 'Invalid financial year' });

    const [earliestWo, earliestInsp] = await Promise.all([
      prisma.workOrder.findFirst({ orderBy: { supplyOrderDate: 'asc' }, select: { supplyOrderDate: true } }),
      prisma.qCInspection.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    const earliest = [earliestWo?.supplyOrderDate, earliestInsp?.createdAt]
      .filter(Boolean)
      .sort((a, b) => new Date(a) - new Date(b))[0];

    const [marketing, supplierPerformance, qcRejections, certifications] = await Promise.all([
      marketingKpis(range.from, range.to),
      supplierPerformanceKpis(fy, range.from, range.to),
      qcRejectionKpis(range.from, range.to),
      prisma.qmsCertification.findMany({
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { name: true } } },
      }),
    ]);

    res.json({
      fy,
      currentFy,
      availableFys: listFys(earliest),
      marketing,
      supplierPerformance,
      qcRejections,
      certifications,
      canManageCertifications: canManageCerts(req.user),
      canEditSupplierPerformance: canEditSupplierPerf(req.user),
    });
  } catch (error) {
    console.error('KPI-QMS error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Mirror of supplier.routes.js: push the new score into each supplier's latest
// re-eval row for the same FY so the Approved Supplier List column updates too.
async function syncRatingToReEvals(tx, fy, items) {
  for (const it of items) {
    if (!it.supplierId) continue;
    const latest = await tx.supplierReEvaluation.findFirst({
      where: { supplierId: it.supplierId, financialYear: fy },
      orderBy: { evaluationDate: 'desc' },
    });
    if (latest) {
      await tx.supplierReEvaluation.update({
        where: { id: latest.id },
        data: { performanceRating: it.totalRating },
      });
    }
  }
}

const clamp = (v, max) => Math.min(max, Math.max(0, Number(v) || 0));

// PUT /api/kpi-qms/supplier-performance — Unit-5 + Purchase only. Upserts the
// FY's rating (same tables as the Approved Supplier List's rating form).
router.put('/supplier-performance', authenticate, requireSupplierPerfWrite, async (req, res) => {
  try {
    const fy = trimOrNull(req.body.fy);
    if (!fy || !fyRange(fy)) return res.status(400).json({ error: 'Invalid financial year' });

    const itemsIn = Array.isArray(req.body.items) ? req.body.items : [];
    const items = itemsIn
      .map((it) => {
        const qualityRating = clamp(it.qualityRating, 60);
        const deliveryRating = clamp(it.deliveryRating, 40);
        return {
          supplierId: trimOrNull(it.supplierId),
          supplierName: trimOrNull(it.supplierName) || '',
          itemDescription: trimOrNull(it.itemDescription) || '-',
          suppliesReceived: Math.round(clamp(it.suppliesReceived, Number.MAX_SAFE_INTEGER)),
          qtyAccepted: Math.round(clamp(it.qtyAccepted, Number.MAX_SAFE_INTEGER)),
          qualityRating,
          totalDeliveries: Math.round(clamp(it.totalDeliveries, Number.MAX_SAFE_INTEGER)),
          deliveriesOnTime: Math.round(clamp(it.deliveriesOnTime, Number.MAX_SAFE_INTEGER)),
          deliveriesLate: Math.round(clamp(it.deliveriesLate, Number.MAX_SAFE_INTEGER)),
          deliveryRating,
          totalRating: round2(qualityRating + deliveryRating),
        };
      })
      .filter((it) => it.supplierName);
    if (!items.length) return res.status(400).json({ error: 'At least one supplier row is required' });

    // Link rows to supplier records by exact name when no id was sent.
    const unlinkedNames = [...new Set(items.filter((i) => !i.supplierId).map((i) => i.supplierName))];
    if (unlinkedNames.length) {
      const found = await prisma.supplier.findMany({
        where: { name: { in: unlinkedNames } },
        select: { id: true, name: true },
      });
      const byName = new Map(found.map((s) => [s.name, s.id]));
      for (const it of items) {
        if (!it.supplierId) it.supplierId = byName.get(it.supplierName) || null;
      }
    }

    const overallRating = round2(items.reduce((s, it) => s + it.totalRating, 0) / items.length);
    const headerData = {
      financialYear: fy,
      periodFrom: toDate(req.body.periodFrom),
      periodTo: toDate(req.body.periodTo),
      preparedDate: toDate(req.body.preparedDate) || new Date(),
      preparedByName: req.user.name,
      preparedByUserId: req.user.id,
      minimumCriteria: 85,
      overallRating,
      remarks: trimOrNull(req.body.remarks),
    };

    const saved = await prisma.$transaction(async (tx) => {
      const existing = await tx.supplierPerformanceRating.findUnique({ where: { financialYear: fy } });
      let header;
      if (existing) {
        header = await tx.supplierPerformanceRating.update({ where: { id: existing.id }, data: headerData });
        await tx.supplierPerformanceRatingItem.deleteMany({ where: { ratingId: header.id } });
      } else {
        header = await tx.supplierPerformanceRating.create({ data: headerData });
      }
      await tx.supplierPerformanceRatingItem.createMany({
        data: items.map((it) => ({ ...it, ratingId: header.id })),
      });
      await syncRatingToReEvals(tx, fy, items);
      return tx.supplierPerformanceRating.findUnique({
        where: { id: header.id },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPSERT',
        entity: 'Supplier.PerformanceRating',
        entityId: saved.id,
        details: { fiscalYear: fy, overallRating: saved.overallRating, items: saved.items.length, via: 'KPI-QMS' },
        ipAddress: req.ip,
      },
    });

    res.json(saved);
  } catch (error) {
    console.error('Save supplier performance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/kpi-qms/supplier-performance/:fy — Unit-5 + Purchase only.
// Removes the manual rating so the panel falls back to auto-computed values.
router.delete('/supplier-performance/:fy', authenticate, requireSupplierPerfWrite, async (req, res) => {
  try {
    const existing = await prisma.supplierPerformanceRating.findUnique({ where: { financialYear: req.params.fy } });
    if (!existing) return res.status(404).json({ error: 'No manual rating recorded for that FY' });

    await prisma.supplierPerformanceRating.delete({ where: { id: existing.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETE',
        entity: 'Supplier.PerformanceRating',
        entityId: existing.id,
        details: { fiscalYear: req.params.fy, via: 'KPI-QMS' },
        ipAddress: req.ip,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete supplier performance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── QMS document library (SOPs + Work Instructions) ──
const DOC_CATEGORIES = ['SOP', 'WORK_INSTRUCTION'];

// GET /api/kpi-qms/documents?category=SOP — everyone views.
router.get('/documents', authenticate, async (req, res) => {
  try {
    const category = trimOrNull(req.query.category);
    if (category && !DOC_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    const documents = await prisma.qmsDocument.findMany({
      where: category ? { category } : {},
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { name: true } } },
    });
    res.json({ documents, canManage: canManageCerts(req.user) });
  } catch (error) {
    console.error('List QMS documents error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi-qms/documents — Unit-5 only. Multipart: file + fields.
router.post('/documents', authenticate, requireCertWrite, qmsDocUpload.single('file'), async (req, res) => {
  try {
    const title = trimOrNull(req.body.title);
    const category = trimOrNull(req.body.category);
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!DOC_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });

    const doc = await prisma.qmsDocument.create({
      data: {
        category,
        title,
        docNo: trimOrNull(req.body.docNo),
        revision: trimOrNull(req.body.revision),
        notes: trimOrNull(req.body.notes),
        fileUrl: req.file ? publicUrlFor('qms-docs', req.file.filename) : null,
        fileName: req.file ? req.file.originalname : null,
        uploadedById: req.user.id,
      },
      include: { uploadedBy: { select: { name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id, action: 'CREATE', entity: 'QmsDocument', entityId: doc.id,
        details: { category, title }, ipAddress: req.ip,
      },
    });
    res.status(201).json(doc);
  } catch (error) {
    console.error('Create QMS document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi-qms/documents/:id — Unit-5 only. Optionally replaces the file.
router.put('/documents/:id', authenticate, requireCertWrite, qmsDocUpload.single('file'), async (req, res) => {
  try {
    const existing = await prisma.qmsDocument.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Document not found' });

    const data = {};
    if (req.body.title !== undefined) {
      const title = trimOrNull(req.body.title);
      if (!title) return res.status(400).json({ error: 'Title is required' });
      data.title = title;
    }
    if (req.body.docNo !== undefined) data.docNo = trimOrNull(req.body.docNo);
    if (req.body.revision !== undefined) data.revision = trimOrNull(req.body.revision);
    if (req.body.notes !== undefined) data.notes = trimOrNull(req.body.notes);
    if (req.file) {
      data.fileUrl = publicUrlFor('qms-docs', req.file.filename);
      data.fileName = req.file.originalname;
    }

    const doc = await prisma.qmsDocument.update({
      where: { id: existing.id },
      data,
      include: { uploadedBy: { select: { name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id, action: 'UPDATE', entity: 'QmsDocument', entityId: doc.id,
        details: { title: doc.title }, ipAddress: req.ip,
      },
    });
    res.json(doc);
  } catch (error) {
    console.error('Update QMS document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/kpi-qms/documents/:id — Unit-5 only.
router.delete('/documents/:id', authenticate, requireCertWrite, async (req, res) => {
  try {
    const existing = await prisma.qmsDocument.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Document not found' });

    await prisma.qmsDocument.delete({ where: { id: existing.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id, action: 'DELETE', entity: 'QmsDocument', entityId: existing.id,
        details: { title: existing.title }, ipAddress: req.ip,
      },
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete QMS document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/kpi-qms/certifications — Unit-5 only. Multipart: file + fields.
router.post('/certifications', authenticate, requireCertWrite, qmsCertUpload.single('file'), async (req, res) => {
  try {
    const title = trimOrNull(req.body.title);
    if (!title) return res.status(400).json({ error: 'Title is required' });

    const cert = await prisma.qmsCertification.create({
      data: {
        title,
        certificateNo: trimOrNull(req.body.certificateNo),
        issuedBy: trimOrNull(req.body.issuedBy),
        validFrom: toDate(req.body.validFrom),
        validTill: toDate(req.body.validTill),
        notes: trimOrNull(req.body.notes),
        fileUrl: req.file ? publicUrlFor('qms-certs', req.file.filename) : null,
        fileName: req.file ? req.file.originalname : null,
        uploadedById: req.user.id,
      },
      include: { uploadedBy: { select: { name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATE',
        entity: 'QmsCertification',
        entityId: cert.id,
        details: { title: cert.title, certificateNo: cert.certificateNo },
        ipAddress: req.ip,
      },
    });

    res.status(201).json(cert);
  } catch (error) {
    console.error('Create certification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/kpi-qms/certifications/:id — Unit-5 only. Optionally replaces the file.
router.put('/certifications/:id', authenticate, requireCertWrite, qmsCertUpload.single('file'), async (req, res) => {
  try {
    const existing = await prisma.qmsCertification.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Certification not found' });

    const data = {};
    if (req.body.title !== undefined) {
      const title = trimOrNull(req.body.title);
      if (!title) return res.status(400).json({ error: 'Title is required' });
      data.title = title;
    }
    if (req.body.certificateNo !== undefined) data.certificateNo = trimOrNull(req.body.certificateNo);
    if (req.body.issuedBy !== undefined) data.issuedBy = trimOrNull(req.body.issuedBy);
    if (req.body.validFrom !== undefined) data.validFrom = toDate(req.body.validFrom);
    if (req.body.validTill !== undefined) data.validTill = toDate(req.body.validTill);
    if (req.body.notes !== undefined) data.notes = trimOrNull(req.body.notes);
    if (req.file) {
      data.fileUrl = publicUrlFor('qms-certs', req.file.filename);
      data.fileName = req.file.originalname;
    }

    const cert = await prisma.qmsCertification.update({
      where: { id: existing.id },
      data,
      include: { uploadedBy: { select: { name: true } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE',
        entity: 'QmsCertification',
        entityId: cert.id,
        details: { title: cert.title },
        ipAddress: req.ip,
      },
    });

    res.json(cert);
  } catch (error) {
    console.error('Update certification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/kpi-qms/certifications/:id — Unit-5 only.
router.delete('/certifications/:id', authenticate, requireCertWrite, async (req, res) => {
  try {
    const existing = await prisma.qmsCertification.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Certification not found' });

    await prisma.qmsCertification.delete({ where: { id: existing.id } });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'DELETE',
        entity: 'QmsCertification',
        entityId: existing.id,
        details: { title: existing.title },
        ipAddress: req.ip,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete certification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/kpi-qms/sla-metrics — Approval & conversion SLA KPIs ──────────
// Computes on-time vs delayed counts for:
//   1. WO Admin approval     (48h from WO createdAt to adminAcceptedAt)
//   2. WO Unit approval      (48h from adminAcceptedAt to unitAcceptedAt)
//   3. PR Admin approval     (48h from PR createdAt (or qcApprovedAt) to adminApprovedAt)
//   4. PR → PO conversion    (4 days from PR adminApprovedAt to PO createdAt)
// Score = (onTime / total) * 100, overall = avg of all four scores.
router.get('/sla-metrics', authenticate, async (req, res) => {
  try {
    const range = req.query.fy ? fyRange(req.query.fy) : null;
    const dateFilter = range ? { gte: range.from, lt: range.to } : undefined;

    const SLA_48H = 48 * 60 * 60 * 1000;
    const SLA_4D  =  4 * 24 * 60 * 60 * 1000;

    const score = (onTime, total) => total > 0 ? round1((onTime / total) * 100) : null;
    const daysLate = (ms) => Math.round((ms / (24 * 60 * 60 * 1000)) * 10) / 10;

    // 1. WO Admin approval
    const wosWithAdminAccept = await prisma.workOrder.findMany({
      where: {
        adminAcceptedAt: { not: null },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { workOrderNumber: true, createdAt: true, adminAcceptedAt: true, adminDelayRemark: true },
    });
    const woAdminTotal  = wosWithAdminAccept.length;
    const woAdminDelayedList = [];
    const woAdminOnTime = wosWithAdminAccept.filter(w => {
      const gap = new Date(w.adminAcceptedAt) - new Date(w.createdAt);
      if (gap > SLA_48H) {
        woAdminDelayedList.push({ ref: w.workOrderNumber, daysLate: daysLate(gap - SLA_48H), remark: w.adminDelayRemark || null });
        return false;
      }
      return true;
    }).length;

    // 2. WO Unit approval
    const wosWithUnitAccept = await prisma.workOrder.findMany({
      where: {
        unitAcceptedAt: { not: null },
        adminAcceptedAt: { not: null },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { workOrderNumber: true, adminAcceptedAt: true, unitAcceptedAt: true, unitDelayRemark: true },
    });
    const woUnitTotal  = wosWithUnitAccept.length;
    const woUnitDelayedList = [];
    const woUnitOnTime = wosWithUnitAccept.filter(w => {
      const gap = new Date(w.unitAcceptedAt) - new Date(w.adminAcceptedAt);
      if (gap > SLA_48H) {
        woUnitDelayedList.push({ ref: w.workOrderNumber, daysLate: daysLate(gap - SLA_48H), remark: w.unitDelayRemark || null });
        return false;
      }
      return true;
    }).length;

    // 3. PR Admin approval
    const prsApproved = await prisma.purchaseRequest.findMany({
      where: {
        adminApprovedAt: { not: null },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: { requestNumber: true, createdAt: true, qcApprovedAt: true, adminApprovedAt: true, adminDelayRemark: true },
    });
    const prAdminTotal  = prsApproved.length;
    const prAdminDelayedList = [];
    const prAdminOnTime = prsApproved.filter(p => {
      const start = p.qcApprovedAt ? new Date(p.qcApprovedAt) : new Date(p.createdAt);
      const gap = new Date(p.adminApprovedAt) - start;
      if (gap > SLA_48H) {
        prAdminDelayedList.push({ ref: p.requestNumber, daysLate: daysLate(gap - SLA_48H), remark: p.adminDelayRemark || null });
        return false;
      }
      return true;
    }).length;

    // 4. PR → PO conversion (4 days from PR adminApprovedAt to PO createdAt)
    const posWithPR = await prisma.purchaseOrder.findMany({
      where: {
        purchaseRequest: { adminApprovedAt: { not: null } },
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: {
        orderNumber: true, createdAt: true, poCreationDelayRemark: true,
        purchaseRequest: { select: { adminApprovedAt: true } },
      },
    });
    // Also include union POs via sourceRequests (use earliest adminApprovedAt among source PRs)
    const unionPos = await prisma.purchaseOrder.findMany({
      where: {
        isUnion: true,
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      select: {
        orderNumber: true, createdAt: true, poCreationDelayRemark: true,
        sourceRequests: { select: { purchaseRequest: { select: { adminApprovedAt: true } } } },
      },
    });

    const poEntries = [
      ...posWithPR
        .filter(p => p.purchaseRequest?.adminApprovedAt)
        .map(p => ({ ref: p.orderNumber, remark: p.poCreationDelayRemark, poCreatedAt: p.createdAt, prApprovedAt: p.purchaseRequest.adminApprovedAt })),
      ...unionPos.map(p => {
        const dates = p.sourceRequests
          .map(s => s.purchaseRequest?.adminApprovedAt)
          .filter(Boolean)
          .map(d => new Date(d));
        return dates.length ? { ref: p.orderNumber, remark: p.poCreationDelayRemark, poCreatedAt: p.createdAt, prApprovedAt: new Date(Math.min(...dates)) } : null;
      }).filter(Boolean),
    ];

    const poConvTotal  = poEntries.length;
    const poConvDelayedList = [];
    const poConvOnTime = poEntries.filter(e => {
      const gap = new Date(e.poCreatedAt) - new Date(e.prApprovedAt);
      if (gap > SLA_4D) {
        poConvDelayedList.push({ ref: e.ref, daysLate: daysLate(gap - SLA_4D), remark: e.remark || null });
        return false;
      }
      return true;
    }).length;

    const scores = [
      score(woAdminOnTime, woAdminTotal),
      score(woUnitOnTime, woUnitTotal),
      score(prAdminOnTime, prAdminTotal),
      score(poConvOnTime, poConvTotal),
    ];
    const validScores = scores.filter(s => s !== null);
    const overallScore = validScores.length > 0
      ? round1(validScores.reduce((a, b) => a + b, 0) / validScores.length)
      : null;

    res.json({
      fy: req.query.fy || null,
      woAdminApproval:  { total: woAdminTotal,  onTime: woAdminOnTime,  delayed: woAdminTotal - woAdminOnTime,  score: score(woAdminOnTime, woAdminTotal),  slaDays: 2, delayedItems: woAdminDelayedList },
      woUnitApproval:   { total: woUnitTotal,   onTime: woUnitOnTime,   delayed: woUnitTotal - woUnitOnTime,   score: score(woUnitOnTime, woUnitTotal),   slaDays: 2, delayedItems: woUnitDelayedList },
      prAdminApproval:  { total: prAdminTotal,  onTime: prAdminOnTime,  delayed: prAdminTotal - prAdminOnTime,  score: score(prAdminOnTime, prAdminTotal),  slaDays: 2, delayedItems: prAdminDelayedList },
      poConversion:     { total: poConvTotal,   onTime: poConvOnTime,   delayed: poConvTotal - poConvOnTime,   score: score(poConvOnTime, poConvTotal),   slaDays: 4, delayedItems: poConvDelayedList },
      overallScore,
    });
  } catch (error) {
    console.error('SLA metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
