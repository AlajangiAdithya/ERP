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
const { qmsCertUpload, publicUrlFor } = require('../middleware/upload');
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

  // On-time deliveries: completed WOs delivered on/before the effective PDC.
  const completed = workOrders.filter((w) => ['COMPLETED', 'CLOSED'].includes(w.status) && w.completedAt);
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

// ── Purchase KPI: supplier performance per the rating form ──
// Quality Rating (60)  = qty accepted / qty received × 60 (completed inspections)
// Delivery Rating (40) = deliveries on time / total deliveries × 40
// A delivery (= QC lot) is on time when it arrived on/before the earliest
// "required by" date on the PR items behind its PO; lots with no required-by
// date breached no commitment and count as on time.
const supplierPerformanceKpis = async (from, to) => {
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
        suppliesReceived: 0,
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
    row.suppliesReceived += 1;
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
      return { ...r, qualityRating, deliveryRating, totalRating };
    })
    .sort((a, b) => (b.totalRating ?? -1) - (a.totalRating ?? -1));

  return {
    minimumCriteria: 85,
    suppliers: rows,
    belowCriteriaCount: rows.filter((r) => r.totalRating != null && r.totalRating < 85).length,
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
      supplierPerformanceKpis(range.from, range.to),
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
    });
  } catch (error) {
    console.error('KPI-QMS error:', error);
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

module.exports = router;
