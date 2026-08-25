const express = require('express');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { authorize, authorizePoNumberEdit, authorizePoNumberAssign } = require('../middleware/rbac');
const { poDocumentUpload, goodsArrivedUpload, publicUrlFor, UPLOAD_ROOT } = require('../middleware/upload');
const {
  generateSequentialNumber, generateMirNumber, generateProductSku,
  normalizeMaterialType, paginate, applyDateFilter, isUniqueViolation,
  DEPT_BY_ROLE, computeTax, parsePoNumber, buildPoNumber,
  getFinancialYear, isValidFinancialYear, nextPoCountForFy,
} = require('../utils/helpers');
const { cancelLeftoverPRItems } = require('../utils/prClosure');
const { validateReason } = require('../utils/reasonValidation');
const {
  EXPORT_ROW_CAP, addInfoSheet, addSheet, createWorkbook, dateCell,
  exportFileName, num, sendWorkbook, titleCase, yesNo,
} = require('../utils/excel');

// Wraps multer so we can return a clean 400 on malformed/oversize uploads.
function acceptPoDocument(req, res, next) {
  poDocumentUpload.single('poDocument')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'PO document upload failed' });
    next();
  });
}

// Invoice PDF (required) and optional supplier lot report PDF accompanying a
// "mark goods arrived" lot. Both are routed to their own /uploads subdirs by
// the goodsArrivedUpload storage. The route saves the resulting URLs onto the
// QCInspection so QC can open both documents inline.
function acceptGoodsArrived(req, res, next) {
  goodsArrivedUpload.fields([
    { name: 'invoiceFile', maxCount: 1 },
    { name: 'lotReportFile', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Document upload failed' });
    next();
  });
}

// Unlink the file referenced by a /uploads/... URL. Best-effort: missing files don't throw.
function unlinkPublicFile(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/uploads/')) return;
  const relative = publicUrl.replace(/^\/uploads\//, '');
  const target = path.join(UPLOAD_ROOT, relative);
  // Block traversal — only delete files inside UPLOAD_ROOT.
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT))) return;
  fs.promises.unlink(resolved).catch(() => {});
}

const router = express.Router();

// Departments allowed to see the PR → PO → QC → Inward chain.
// Maps to: Unit Managers, Quality, Designs, R&D, Purchase, Stores, Accounts, Planning (+ ADMIN).
// LAB / METROLOGY / NDT included so they can track POs born from their own PRs
// (they raise PRs and are own-scoped below, mirroring the PR list).
// ACCOUNTING + FINANCE are admin-level read-only observers (no status scoping
// below applies to them, so they see every PO like ADMIN).
const CHAIN_ROLES = ['ADMIN', 'MANAGER', 'QC', 'INWARD_QC', 'DESIGNS', 'RND', 'PURCHASE_OFFICER', 'STORE_MANAGER', 'ACCOUNTING', 'FINANCE', 'PLANNING', 'SAFETY', 'LAB', 'METROLOGY', 'NDT'];

// Requester roles that may reach the PO chain but must only see POs tied to their
// OWN purchase requests — same own-only model as the PR list. Unit managers see
// their unit's PRs; the non-unit requester depts (Designs, R&D, Safety, Lab,
// Metrology, NDT) see only PRs they personally raised. ADMIN / PURCHASE_OFFICER /
// ACCOUNTING / PLANNING keep full chain visibility; QC + STORE_MANAGER are
// status-scoped to their work queues below.
const OWN_SCOPED_PO_ROLES = ['MANAGER', 'LAB', 'METROLOGY', 'NDT', 'INWARD_QC', 'DESIGNS', 'RND', 'SAFETY'];

// DEPT_BY_ROLE (role → owning department label) is imported from utils/helpers so
// inward, MIV issue, and inventory transfers all share one source of truth. When a
// non-unit PR is inwarded we both stamp ProductBatch.assignedDept (lot provenance)
// and reserve the qty in ProductDeptStock so only that department can issue it.

// An approved quotation creates its purchase orders WITHOUT a number — Purchase
// type RAPS/PO/<FY>/<n> in by hand (PATCH /:id/assign-number). Until they do, the
// row is a draft: it shows on the PO page so Purchase can see what is waiting,
// but nothing may act on it. The number is what the supplier, the batch labels,
// the payment requests and every downstream document are keyed to, so letting an
// order move without one would leave records that can never be reconciled.
const NEEDS_NUMBER_ERROR = 'Fill in the PO number before this order can proceed.';

const isUnnumbered = (order) => !order || !order.orderNumber;

const ORDER_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  creditPlacedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  numberAssignedBy: { select: { id: true, name: true } },
  quotation: {
    select: {
      id: true, quotationNumber: true, supplierName: true, supplierContact: true,
      supplierAddress: true, totalAmount: true, isUnion: true, createdAt: true,
    },
  },
  purchaseRequest: {
    select: {
      id: true, requestNumber: true, status: true, managerId: true, createdAt: true,
      adminApprovedAt: true,
      manager: { select: { id: true, name: true, role: true } },
      unit: { select: { id: true, name: true, code: true } },
      noteAttachments: { select: { id: true, url: true, name: true, mimeType: true } },
      items: {
        select: {
          id: true, productName: true, productUnit: true, requestedQty: true,
          materialType: true,
          materialSpecification: true, specAttachmentUrl: true, specAttachmentName: true,
          attachments: { select: { id: true, url: true, name: true, mimeType: true } },
          drawingNo: true, qapNo: true, itemRemarks: true,
        },
      },
    },
  },
  sourceRequests: {
    include: {
      purchaseRequest: {
        select: {
          id: true, requestNumber: true, status: true, managerId: true,
          adminApprovedAt: true,
          manager: { select: { id: true, name: true, role: true } },
          unit: { select: { id: true, name: true, code: true } },
          noteAttachments: { select: { id: true, url: true, name: true, mimeType: true } },
          items: {
            select: {
              id: true, productName: true, productUnit: true, requestedQty: true,
              materialType: true,
              materialSpecification: true, specAttachmentUrl: true, specAttachmentName: true,
              attachments: { select: { id: true, url: true, name: true, mimeType: true } },
              drawingNo: true, qapNo: true, itemRemarks: true,
            },
          },
        },
      },
    },
  },
  items: {
    include: {
      allocations: {
        include: {
          purchaseRequestItem: {
            select: {
              id: true, productId: true, productName: true, productUnit: true, requestedQty: true,
              materialSpecification: true, drawingNo: true, qapNo: true, itemRemarks: true,
              request: {
                select: {
                  id: true, requestNumber: true,
                  unit: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
        },
      },
    },
  },
  paymentRequests: {
    include: { createdBy: { select: { id: true, name: true } }, processedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  },
  qcInspections: {
    include: {
      inspectedBy: { select: { id: true, name: true } },
      requestCreatedBy: { select: { id: true, name: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  },
  // TEMPORARY-feature trail (PO re-numbering). The panel it feeds is permanent —
  // it only renders when a PO has actually been renumbered, so it costs nothing
  // once the edit button is gone. See PATCH /:id/order-number at the bottom.
  numberHistory: { orderBy: { createdAt: 'desc' }, take: 50 },
};

// Role-based status visibility (intersected with the tab/status filter).
// Stores own "mark goods arrived", so they must see every status an order can
// be in once it has been placed — including CREDIT_PLACED (credit orders sit
// here until goods arrive, with no payment step in between).
const STORE_MANAGER_STATUSES = ['ORDERED', 'PLACED', 'CREDIT_PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'QC_PASSED', 'QC_FAILED', 'PARTIAL', 'INWARD_DONE', 'COMPLETED', 'CLOSED'];
const QC_STATUSES = ['GOODS_ARRIVED', 'QC_PENDING'];

// Visibility + filter clause for the PO list. Shared by the paged list endpoint
// and the Excel export so an export can never widen what a role is allowed to
// see, and can never disagree with the list the user is looking at.
function buildPoListWhere(user, { status, fromDate, toDate, awaitingNumber }) {
  const where = {};
  applyDateFilter(where, { fromDate, toDate });

  // The Purchase team's "Awaiting PO number" tab: drafts created by an approved
  // quotation that nobody has typed a number into yet. Not a status, so it is a
  // filter of its own rather than another entry in the tab list.
  if (awaitingNumber === 'true' || awaitingNumber === '1' || awaitingNumber === true) {
    where.orderNumber = null;
  }

  if (user.role === 'QC') {
    where.status = { in: QC_STATUSES };
  } else if (user.role === 'STORE_MANAGER') {
    // Stores need to anticipate incoming material, act on QC_PASSED, and review history.
    // Union POs follow the same status flow so this also exposes them.
    where.status = { in: STORE_MANAGER_STATUSES };
  } else if (OWN_SCOPED_PO_ROLES.includes(user.role)) {
    // Requester depts only see POs originating from their own purchase requests
    // (direct link or via the multi-PR sourceRequests pivot).
    where.OR = [
      { purchaseRequest: { managerId: user.id } },
      { sourceRequests: { some: { purchaseRequest: { managerId: user.id } } } },
    ];
  }

  // Apply explicit status filter from tabs, intersected with role permissions
  if (status) {
    if (user.role === 'QC') {
      where.status = QC_STATUSES.includes(status) ? status : { in: [] };
    } else if (user.role === 'STORE_MANAGER') {
      where.status = STORE_MANAGER_STATUSES.includes(status) ? status : { in: [] };
    } else {
      where.status = status;
    }
  }

  return where;
}

// GET /api/purchase-orders — role-filtered list
router.get('/', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { status, page, limit, fromDate, toDate, awaitingNumber } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = buildPoListWhere(req.user, { status, fromDate, toDate, awaitingNumber });

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    res.json({ orders, total, page: Math.ceil(skip / take) + 1, totalPages: Math.ceil(total / take) });
  } catch (error) {
    console.error('Get purchase orders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Excel export ───
// Human-readable status labels, kept in step with the client's statusLabel() so
// the spreadsheet reads the same as the screen it was exported from.
const PO_STATUS_LABEL = {
  PENDING_ACCOUNTING: 'Awaiting Accounting',
  CREDIT_PLACED: 'On Credit · Payment Pending',
  ORDERED: 'Ordered',
  PLACED: 'Order Placed',
  ADVANCE_PAID: 'Advance Paid',
  PAYMENT_PENDING: 'Payment Pending',
  PAID: 'Fully Paid',
  GOODS_ARRIVED: 'Goods Arrived',
  QC_PENDING: 'QC Pending',
  QC_PASSED: 'QC Passed',
  QC_FAILED: 'QC Failed',
  PARTIAL: 'Partially Received',
  INWARD_DONE: 'Inward Done',
  COMPLETED: 'Completed',
  CLOSED: 'Closed',
};
const poStatusLabel = (s) => PO_STATUS_LABEL[s] || titleCase(s);

const PO_ITEM_STATUS_LABEL = {
  WAITING: 'Waiting',
  ORDERED: 'Ordered',
  ON_THE_WAY: 'On the Way',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

const sumBy = (list, pick) => list.reduce((t, x) => t + (Number(pick(x)) || 0), 0);
const joinUnique = (list) => Array.from(new Set(list.filter(Boolean))).join(', ');

// Every PR behind an order: the direct link for a normal PO, the sourceRequests
// pivot for a union PO pooling several PRs into one supplier order.
const sourcePrsOf = (order) => {
  const list = order.isUnion
    ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
    : [order.purchaseRequest];
  return list.filter(Boolean);
};

// GET /api/purchase-orders/export — the current PO list as a formatted .xlsx.
// Same `status` / `fromDate` / `toDate` filters and the same visibility clause as
// the list endpoint, unpaged. Two sheets: one row per order, and one row per
// ordered material line for supplier / material level analysis.
// Must stay ABOVE `GET /:id` or that route swallows "export".
router.get('/export', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const { status, fromDate, toDate, awaitingNumber } = req.query;
    const where = buildPoListWhere(req.user, { status, fromDate, toDate, awaitingNumber });

    const [total, orders] = await Promise.all([
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.findMany({
        where,
        include: {
          createdBy: { select: { name: true } },
          closedBy: { select: { name: true } },
          creditPlacedBy: { select: { name: true } },
          quotation: { select: { quotationNumber: true, supplierContact: true } },
          supplier: { select: { name: true, gstNumber: true } },
          purchaseRequest: {
            select: {
              requestNumber: true, createdAt: true, adminApprovedAt: true,
              manager: { select: { name: true } },
              unit: { select: { name: true, code: true } },
            },
          },
          sourceRequests: {
            select: {
              purchaseRequest: {
                select: {
                  requestNumber: true, createdAt: true, adminApprovedAt: true,
                  manager: { select: { name: true } },
                  unit: { select: { name: true, code: true } },
                },
              },
            },
          },
          items: {
            include: {
              product: { select: { sku: true, category: true } },
              allocations: {
                select: {
                  allocatedQty: true, receivedQty: true,
                  purchaseRequestItem: {
                    select: { request: { select: { requestNumber: true, unit: { select: { code: true } } } } },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_ROW_CAP,
      }),
    ]);

    const orderRows = [];
    const itemRows = [];

    for (const o of orders) {
      const items = o.items || [];
      const prs = sourcePrsOf(o);
      const prNumbers = joinUnique(prs.map((p) => p.requestNumber));
      const unitLabel = joinUnique(prs.map((p) => p.unit?.code)) || 'Central / Non-unit';
      const orderedQty = sumBy(items, (i) => i.quantity);
      const receivedQty = sumBy(items, (i) => i.receivedQty);
      const balance = (Number(o.totalAmount) || 0) - (Number(o.totalPaid) || 0);

      orderRows.push({
        // Numbers are typed in by Purchase, so a draft still has none.
        orderNumber: o.orderNumber || '(number pending)',
        customName: o.customName || '',
        status: poStatusLabel(o.status),
        isUnion: yesNo(o.isUnion),
        prNumbers,
        unit: unitLabel,
        indentedBy: joinUnique(prs.map((p) => p.manager?.name)),
        supplier: o.supplierName || o.supplier?.name || '',
        supplierGst: o.supplier?.gstNumber || '',
        supplierContact: o.quotation?.supplierContact || '',
        quotationNumber: o.quotation?.quotationNumber || '',
        totalAmount: num(o.totalAmount),
        advancePaid: num(o.advancePaid),
        totalPaid: num(o.totalPaid),
        balance: num(balance),
        isCredit: yesNo(o.isCreditOrder),
        lineCount: items.length,
        orderedQty: num(orderedQty),
        receivedQty: num(receivedQty),
        pendingQty: num(Math.max(0, orderedQty - receivedQty)),
        createdAt: dateCell(o.createdAt),
        createdBy: o.createdBy?.name || '',
        creditPlacedAt: dateCell(o.creditPlacedAt),
        goodsArrivedAt: dateCell(o.goodsArrivedAt),
        mirNo: o.mirNo || '',
        inwardedAt: dateCell(o.inwardedAt),
        closedAt: dateCell(o.closedAt),
        closedBy: o.closedBy?.name || '',
        forceClosed: o.closedAt ? yesNo(o.forceClosed) : '',
        closeReason: o.closeReason || '',
        poDocument: o.poDocumentUrl ? 'Uploaded' : 'Not uploaded',
        delayRemark: o.poCreationDelayRemark || o.delayNote || '',
      });

      items.forEach((i, idx) => {
        // A union PO line is split across the PRs it fills — name them on the row
        // so material can be traced back to the indent that asked for it.
        const linePrs = joinUnique((i.allocations || []).map((a) => a.purchaseRequestItem?.request?.requestNumber));
        itemRows.push({
          orderNumber: o.orderNumber || '(number pending)',
          poStatus: poStatusLabel(o.status),
          supplier: o.supplierName || o.supplier?.name || '',
          prNumbers: linePrs || prNumbers,
          unit: joinUnique((i.allocations || []).map((a) => a.purchaseRequestItem?.request?.unit?.code)) || unitLabel,
          createdAt: dateCell(o.createdAt),
          sr: idx + 1,
          material: i.productName,
          sku: i.product?.sku || '',
          category: i.product?.category || '',
          uom: i.productUnit || '',
          quantity: num(i.quantity),
          unitPrice: num(i.unitPrice),
          totalPrice: num(i.totalPrice),
          receivedQty: num(i.receivedQty),
          pendingQty: num(Math.max(0, (Number(i.quantity) || 0) - (Number(i.receivedQty) || 0))),
          itemStatus: PO_ITEM_STATUS_LABEL[i.itemStatus] || titleCase(i.itemStatus),
          statusUpdatedAt: dateCell(i.statusUpdatedAt),
        });
      });
    }

    const wb = createWorkbook();
    addInfoSheet(wb, {
      title: 'Purchase Orders',
      user: req.user,
      filters: [
        { label: 'Status', value: status ? poStatusLabel(status) : 'All' },
        { label: 'From Date', value: fromDate || 'Beginning' },
        { label: 'To Date', value: toDate || 'Today' },
      ],
      counts: [
        { label: 'Purchase Orders', value: orderRows.length },
        { label: 'Order Lines', value: itemRows.length },
        { label: 'Matching Records', value: total },
        { label: 'Total Order Value', value: sumBy(orderRows, (r) => r.totalAmount), fmt: 'money' },
        { label: 'Total Paid', value: sumBy(orderRows, (r) => r.totalPaid), fmt: 'money' },
      ],
      truncated: total > orders.length,
    });

    addSheet(wb, {
      name: 'Purchase Orders',
      rows: orderRows,
      columns: [
        { header: 'PO No.', key: 'orderNumber' },
        { header: 'Order Name', key: 'customName', wrap: true },
        { header: 'Status', key: 'status' },
        { header: 'Union PO', key: 'isUnion', align: 'center' },
        { header: 'PR No.', key: 'prNumbers' },
        { header: 'Unit', key: 'unit' },
        { header: 'Indented By', key: 'indentedBy' },
        { header: 'Supplier', key: 'supplier' },
        { header: 'Supplier GST', key: 'supplierGst' },
        { header: 'Supplier Contact', key: 'supplierContact' },
        { header: 'Quotation No.', key: 'quotationNumber' },
        { header: 'Order Value', key: 'totalAmount', fmt: 'money', align: 'right' },
        { header: 'Advance Paid', key: 'advancePaid', fmt: 'money', align: 'right' },
        { header: 'Total Paid', key: 'totalPaid', fmt: 'money', align: 'right' },
        { header: 'Balance Due', key: 'balance', fmt: 'money', align: 'right' },
        { header: 'Credit Order', key: 'isCredit', align: 'center' },
        { header: 'Lines', key: 'lineCount', fmt: 'int', align: 'right' },
        { header: 'Ordered Qty', key: 'orderedQty', fmt: 'qty', align: 'right' },
        { header: 'Received Qty', key: 'receivedQty', fmt: 'qty', align: 'right' },
        { header: 'Pending Qty', key: 'pendingQty', fmt: 'qty', align: 'right' },
        { header: 'Placed On', key: 'createdAt', fmt: 'dateTime' },
        { header: 'Placed By', key: 'createdBy' },
        { header: 'Credit Placed On', key: 'creditPlacedAt', fmt: 'dateTime' },
        { header: 'Goods Arrived On', key: 'goodsArrivedAt', fmt: 'dateTime' },
        { header: 'MIR No.', key: 'mirNo' },
        { header: 'Inwarded On', key: 'inwardedAt', fmt: 'dateTime' },
        { header: 'Closed On', key: 'closedAt', fmt: 'dateTime' },
        { header: 'Closed By', key: 'closedBy' },
        { header: 'Force Closed', key: 'forceClosed', align: 'center' },
        { header: 'Close Reason', key: 'closeReason', wrap: true },
        { header: 'PO Document', key: 'poDocument' },
        { header: 'Delay Remark', key: 'delayRemark', wrap: true },
      ],
    });

    addSheet(wb, {
      name: 'PO Order Lines',
      rows: itemRows,
      columns: [
        { header: 'PO No.', key: 'orderNumber' },
        { header: 'PO Status', key: 'poStatus' },
        { header: 'Supplier', key: 'supplier' },
        { header: 'PR No.', key: 'prNumbers' },
        { header: 'Unit', key: 'unit' },
        { header: 'Placed On', key: 'createdAt', fmt: 'dateTime' },
        { header: 'Sr.', key: 'sr', fmt: 'int', align: 'right' },
        { header: 'Material Description', key: 'material', wrap: true },
        { header: 'SKU', key: 'sku' },
        { header: 'Material Category', key: 'category' },
        { header: 'UOM', key: 'uom', align: 'center' },
        { header: 'Ordered Qty', key: 'quantity', fmt: 'qty', align: 'right' },
        { header: 'Unit Price', key: 'unitPrice', fmt: 'money', align: 'right' },
        { header: 'Line Value', key: 'totalPrice', fmt: 'money', align: 'right' },
        { header: 'Received Qty', key: 'receivedQty', fmt: 'qty', align: 'right' },
        { header: 'Pending Qty', key: 'pendingQty', fmt: 'qty', align: 'right' },
        { header: 'Line Status', key: 'itemStatus' },
        { header: 'Status Updated On', key: 'statusUpdatedAt', fmt: 'dateTime' },
      ],
    });

    await sendWorkbook(res, wb, exportFileName('Purchase_Orders'));
  } catch (error) {
    console.error('Export purchase orders error:', error);
    // The response may already be streaming XLSX bytes by the time this fires —
    // sending JSON then would corrupt the download, so only answer if untouched.
    if (!res.headersSent) res.status(500).json({ error: 'Failed to generate Excel export' });
    else res.end();
  }
});

// GET /api/purchase-orders/dashboard — PO dashboard stats
router.get('/dashboard', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const [groups, orders, awaitingNumber] = await Promise.all([
      prisma.purchaseOrder.groupBy({
        by: ['status'],
        _count: true,
      }),
      prisma.purchaseOrder.findMany({
        where: { status: { not: 'COMPLETED' } },
        select: { totalAmount: true, totalPaid: true, advancePaid: true },
      }),
      // Drafts still waiting for Purchase to type their number in. This is the
      // Purchase team's first queue of the day, so it gets its own tile.
      prisma.purchaseOrder.count({ where: { orderNumber: null } }),
    ]);

    const counts = {};
    let total = 0;
    for (const g of groups) {
      counts[g.status] = g._count;
      total += g._count;
    }

    const totalOrderValue = orders.reduce((s, o) => s + o.totalAmount, 0);
    const totalPaidAmount = orders.reduce((s, o) => s + o.totalPaid, 0);
    const totalAdvancePaid = orders.reduce((s, o) => s + o.advancePaid, 0);

    res.json({
      statusCounts: {
        pendingAccounting: counts['PENDING_ACCOUNTING'] || 0,
        creditPlaced: counts['CREDIT_PLACED'] || 0,
        ordered: counts['ORDERED'] || 0,
        placed: counts['PLACED'] || 0,
        advancePaid: counts['ADVANCE_PAID'] || 0,
        paymentPending: counts['PAYMENT_PENDING'] || 0,
        paid: counts['PAID'] || 0,
        goodsArrived: counts['GOODS_ARRIVED'] || 0,
        qcPending: counts['QC_PENDING'] || 0,
        qcPassed: counts['QC_PASSED'] || 0,
        qcFailed: counts['QC_FAILED'] || 0,
        partial: counts['PARTIAL'] || 0,
        inwardDone: counts['INWARD_DONE'] || 0,
        completed: counts['COMPLETED'] || 0,
      },
      paymentSummary: { totalOrderValue, totalPaidAmount, totalAdvancePaid, pendingPayment: totalOrderValue - totalPaidAmount },
      awaitingNumber,
      total,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/po-dashboard-feed — actionable lists for the PO dashboard
// Replaces the old "Active Purchase Assignments" tile which incorrectly merged
// purchasedQty (set via record-purchase) with receivedQty (set via inward).
// This feed returns four distinct buckets, each computed from authoritative
// fields so partial deliveries are never shown as fully delivered.
router.get('/po-dashboard-feed', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [partialOrders, awaitingQc, pendingPrs, openOrders] = await Promise.all([
      // Partially received: status PARTIAL is the canonical marker (set whenever
      // a lot arrives but the PO still has open quantity remaining).
      prisma.purchaseOrder.findMany({
        where: { status: 'PARTIAL' },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true, status: true,
          items: { select: { id: true, productName: true, productUnit: true, quantity: true, receivedQty: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // Awaiting QC inspection
      prisma.purchaseOrder.findMany({
        where: { status: { in: ['GOODS_ARRIVED', 'QC_PENDING'] } },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true,
          goodsArrivedAt: true,
        },
        orderBy: { goodsArrivedAt: 'desc' },
        take: 10,
      }),
      // PRs approved but no quotations entered yet — the PO needs to source quotes.
      prisma.purchaseRequest.findMany({
        where: {
          status: 'APPROVED',
          quotations: { none: {} },
          quotationSources: { none: {} },
        },
        select: {
          id: true, requestNumber: true, createdAt: true,
          manager: { select: { name: true } },
          unit: { select: { name: true, code: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      }),
      // Open POs we'll filter for overdue (PR items.requiredByDate in the past)
      prisma.purchaseOrder.findMany({
        where: { status: { in: ['PENDING_ACCOUNTING', 'CREDIT_PLACED', 'ORDERED', 'PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED', 'QC_PENDING', 'PARTIAL'] } },
        select: {
          id: true, orderNumber: true, customName: true, supplierName: true, status: true,
          purchaseRequest: { select: { items: { select: { requiredByDate: true } } } },
          sourceRequests: {
            select: {
              purchaseRequest: { select: { items: { select: { requiredByDate: true } } } },
            },
          },
        },
      }),
    ]);

    const partiallyReceived = partialOrders.map(o => {
      const totalOrdered = o.items.reduce((s, i) => s + (i.quantity || 0), 0);
      const totalReceived = o.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        customName: o.customName,
        supplierName: o.supplierName,
        status: o.status,
        totalOrdered, totalReceived,
        items: o.items
          .filter(i => (i.receivedQty || 0) < (i.quantity || 0))
          .map(i => ({
            productName: i.productName, productUnit: i.productUnit,
            quantity: i.quantity, receivedQty: i.receivedQty || 0,
            pending: (i.quantity || 0) - (i.receivedQty || 0),
          })),
      };
    });

    const overdue = openOrders
      .map(o => {
        const dates = [
          ...(o.purchaseRequest?.items || []).map(i => i.requiredByDate),
          ...(o.sourceRequests || []).flatMap(s => (s.purchaseRequest?.items || []).map(i => i.requiredByDate)),
        ].filter(Boolean).map(d => new Date(d));
        if (dates.length === 0) return null;
        const earliest = dates.reduce((a, b) => (a < b ? a : b));
        if (earliest >= today) return null;
        const daysOverdue = Math.floor((today - earliest) / (1000 * 60 * 60 * 24));
        return {
          id: o.id, orderNumber: o.orderNumber, customName: o.customName,
          supplierName: o.supplierName, status: o.status,
          requiredByDate: earliest, daysOverdue,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, 10);

    res.json({
      partiallyReceived,
      awaitingQc,
      pendingQuotations: pendingPrs.map(pr => ({
        id: pr.id, requestNumber: pr.requestNumber,
        managerName: pr.manager?.name, unit: pr.unit,
        itemCount: pr._count?.items || 0, createdAt: pr.createdAt,
      })),
      overdue,
    });
  } catch (error) {
    console.error('PO dashboard feed error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/next-number?fy=26-27
//
// Feeds the "fill in the PO number" form with the current financial year and the
// next unused count in it. Purely a convenience — Purchase are typing the number
// off their own register and may enter anything; the unique index on
// orderNumber is what actually stops a duplicate.
//
// Declared before /:id so the literal path isn't swallowed by the id param.
router.get('/next-number', authenticate, authorizePoNumberAssign, async (req, res) => {
  try {
    const fy = (req.query.fy || '').toString().trim() || getFinancialYear();
    if (!isValidFinancialYear(fy)) {
      return res.status(400).json({ error: 'Financial year must be two consecutive years, e.g. 26-27.' });
    }
    const count = await nextPoCountForFy(prisma, fy);
    res.json({ fy, count, prefix: `RAPS/PO/${fy}/`, suggestion: buildPoNumber(fy, count) });
  } catch (error) {
    console.error('Next PO number error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', authenticate, authorize(...CHAIN_ROLES), async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: ORDER_INCLUDE,
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    // Requester depts can only view POs tied to their own purchase requests
    if (OWN_SCOPED_PO_ROLES.includes(req.user.role)) {
      const ownsPrimary = order.purchaseRequest?.managerId === req.user.id;
      const ownsSource = (order.sourceRequests || []).some(
        (s) => s.purchaseRequest?.managerId === req.user.id
      );
      if (!ownsPrimary && !ownsSource) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    res.json(order);
  } catch (error) {
    console.error('Get purchase order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Inward Inspection Request (IIR) fields — purchase officer fills these when
// marking goods arrived. They feed straight into the QCInspection record so
// the QC team sees the full RAPS/IIR Rev 01 form (page 1) on arrival.
//
// `items` is the per-PO-item arrived qty for THIS lot. PO Officer enters how
// much of each ordered item physically reached stores with this delivery.
// e.g. ordered 1000 kg, this lot 400 kg → items: [{poItemId, arrivedQty: 400}].
const goodsArrivedItemSchema = z.object({
  poItemId: z.string().min(1, 'poItemId is required'),
  arrivedQty: z.preprocess(
    (v) => (typeof v === 'string' ? parseFloat(v) : v),
    z.number().positive('arrivedQty must be > 0'),
  ),
});

const goodsArrivedSchema = z.object({
  // Purchase Officer sets the batch number ONCE here. Locked thereafter — QC, Inward,
  // ProductBatch all read from QCInspection.batchNo. The MIV, FIFO list, stock movements
  // all carry this same identifier.
  batchNumber: z.string().trim().min(1, 'Batch number is required').max(64, 'Batch number too long'),
  invoiceNo: z.string().min(1, 'Invoice no. is required'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  dcNo: z.string().optional().nullable(),
  gatePassNo: z.string().optional().nullable(),
  gatePassType: z.string().optional().nullable(),
  probableDateOfReturn: z.string().optional().nullable(),
  materialReceiptDate: z.string().min(1, 'Material receipt date is required'),
  // Inspection scope ticked by Purchase Officer on the IIR form
  materialCategory: z.string().optional().nullable(),
  documentTypes: z.object({
    testReport: z.boolean().optional(),
    coc: z.boolean().optional(),
    coa: z.boolean().optional(),
    thirdParty: z.boolean().optional(),
    dimInspAtSupplier: z.boolean().optional(),
    dimInspAtRapsInward: z.boolean().optional(),
  }).partial().optional(),
  items: z.array(goodsArrivedItemSchema).min(1, 'At least one item with arrived qty is required'),
});

// PUT /api/purchase-orders/:id/place-on-credit — PO Officer places the order on word-of-trust.
// Order moves forward exactly like a paid order (items → ORDERED, source PRs → ORDER_PLACED)
// but no payment is required yet. The Payment Request is raised later and processed by Accounting;
// when that payment is marked PAID the PO transitions to PAID just like the normal flow.
const placeOnCreditSchema = z.object({
  creditNote: z.string().trim().max(500, 'Credit note too long (max 500 chars)').optional().nullable(),
});

router.put('/:id/place-on-credit', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { creditNote } = placeOnCreditSchema.parse(req.body || {});

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { allocations: true } },
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (isUnnumbered(order)) return res.status(400).json({ error: NEEDS_NUMBER_ERROR });
    if (order.status !== 'PENDING_ACCOUNTING') {
      return res.status(400).json({
        error: `Cannot place on credit — order status is ${order.status}. Only orders awaiting accounting can be placed on credit.`,
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: 'CREDIT_PLACED',
          isCreditOrder: true,
          creditPlacedAt: new Date(),
          creditPlacedById: req.user.id,
          creditNote: creditNote || null,
        },
        include: ORDER_INCLUDE,
      });

      for (const item of order.items) {
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { itemStatus: 'ORDERED', statusUpdatedAt: new Date(), statusUpdatedBy: req.user.id },
        });
        if (order.isUnion) {
          const prItemIds = (item.allocations || []).map((a) => a.purchaseRequestItemId);
          if (prItemIds.length) {
            await tx.purchaseRequestItem.updateMany({
              where: { id: { in: prItemIds } },
              data: { itemStatus: 'ORDERED' },
            });
          }
        } else if (item.purchaseRequestItemId) {
          await tx.purchaseRequestItem.update({
            where: { id: item.purchaseRequestItemId },
            data: { itemStatus: 'ORDERED' },
          });
        }
      }

      const sourcePRIds = order.isUnion
        ? (order.sourceRequests || []).map((s) => s.purchaseRequest.id)
        : (order.purchaseRequest ? [order.purchaseRequest.id] : []);

      if (sourcePRIds.length) {
        await tx.purchaseRequest.updateMany({
          where: { id: { in: sourcePRIds } },
          data: { status: 'ORDER_PLACED' },
        });
      }

      return updatedOrder;
    });

    // FYI to Accounting — payment is still pending and will be raised separately.
    await prisma.notification.create({
      data: {
        type: 'ORDER_PLACED_ON_CREDIT',
        title: `Credit Order Placed: ${order.customName}`,
        message: `Order "${order.customName}" (${order.orderNumber}) for ₹${order.totalAmount.toLocaleString('en-IN')} with ${order.supplierName} has been placed on credit. Payment request will follow.`,
        targetRole: 'ACCOUNTING',
        sentById: req.user.id,
      },
    });

    await prisma.notification.create({
      data: {
        type: 'ORDER_PLACED_ON_CREDIT',
        title: `Credit Order Placed: ${order.customName}`,
        message: `Order "${order.customName}" (${order.orderNumber}) was placed on credit. Payment processing will follow.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    const recipients = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest).filter((pr) => pr?.managerId)
      : (order.purchaseRequest?.managerId ? [order.purchaseRequest] : []);

    for (const pr of recipients) {
      await prisma.notification.create({
        data: {
          type: 'ORDER_PLACED',
          title: `Order Placed: ${pr.requestNumber}`,
          message: `Your order "${order.customName}" (${pr.requestNumber}) has been placed on credit with ${order.supplierName} and is now being processed.`,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ORDER_PLACED_ON_CREDIT',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          customName: order.customName,
          supplierName: order.supplierName,
          totalAmount: order.totalAmount,
          creditNote: creditNote || null,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
    console.error('Place on credit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/goods-arrived — Stores marks a lot as arrived.
// Accepts multipart/form-data so the invoice PDF can be uploaded alongside
// the IIR page-1 fields. `items` is a JSON-stringified array of per-PO-item
// arrived quantities for THIS lot (partial delivery).
router.put('/:id/goods-arrived', authenticate, authorize('STORE_MANAGER', 'ADMIN'), acceptGoodsArrived, async (req, res) => {
  const invoiceFile = req.files?.invoiceFile?.[0] || null;
  const lotReportFile = req.files?.lotReportFile?.[0] || null;
  const cleanupUploads = () => {
    if (invoiceFile) unlinkPublicFile(publicUrlFor('invoices', invoiceFile.filename));
    if (lotReportFile) unlinkPublicFile(publicUrlFor('lot-reports', lotReportFile.filename));
  };
  try {
    // Multer parsed form fields land as strings; rehydrate the structured pieces.
    const body = { ...req.body };
    if (typeof body.items === 'string') {
      try { body.items = JSON.parse(body.items); }
      catch { cleanupUploads(); return res.status(400).json({ error: 'items must be valid JSON' }); }
    }
    if (typeof body.documentTypes === 'string') {
      try { body.documentTypes = JSON.parse(body.documentTypes); }
      catch { cleanupUploads(); return res.status(400).json({ error: 'documentTypes must be valid JSON' }); }
    }

    const iir = goodsArrivedSchema.parse(body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        qcInspections: { select: { id: true, lotNumber: true, batchNo: true } },
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
      },
    });

    if (!order) {
      cleanupUploads();
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    // Unreachable in practice (an order can't be placed unnumbered, so goods
    // can't arrive against one) — but the lot's batch number is derived from the
    // PO number, so refuse rather than mint a batch called "null-B1".
    if (isUnnumbered(order)) {
      cleanupUploads();
      return res.status(400).json({ error: NEEDS_NUMBER_ERROR });
    }

    const allowedStatuses = ['ORDERED', 'CREDIT_PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'PARTIAL'];
    if (!allowedStatuses.includes(order.status)) {
      cleanupUploads();
      return res.status(400).json({
        error: order.status === 'GOODS_ARRIVED' || order.status === 'QC_PENDING' || order.status === 'QC_PASSED'
          ? 'A delivery batch is already being processed (QC / inward). Complete that first.'
          : `Cannot mark goods arrived when order status is ${order.status}`,
      });
    }

    // Validate each lot item exists on this PO and the cumulative arrived qty
    // (received so far + this lot) does not exceed the ordered quantity.
    const itemById = new Map(order.items.map((i) => [i.id, i]));
    for (const li of iir.items) {
      const poItem = itemById.get(li.poItemId);
      if (!poItem) {
        cleanupUploads();
        return res.status(400).json({ error: `Item ${li.poItemId} is not on this purchase order` });
      }
      const alreadyReceived = poItem.receivedQty || 0;
      if (alreadyReceived + li.arrivedQty > poItem.quantity + 0.0001) {
        cleanupUploads();
        const remaining = Math.max(0, poItem.quantity - alreadyReceived);
        return res.status(400).json({
          error: `Lot qty exceeds remaining for "${poItem.productName}": ` +
            `${alreadyReceived} of ${poItem.quantity} ${poItem.productUnit} already received, ` +
            `only ${remaining} left to arrive.`,
        });
      }
    }

    // Batch number must be unique across all lots on this PO so the FIFO/audit
    // trail can't be confused by two different lots sharing the same identifier.
    const incomingBatchNo = iir.batchNumber.trim();
    const duplicate = (order.qcInspections || []).find(
      (q) => (q.batchNo || '').trim().toLowerCase() === incomingBatchNo.toLowerCase(),
    );
    if (duplicate) {
      cleanupUploads();
      return res.status(400).json({
        error: `Batch number "${incomingBatchNo}" was already used on Lot ${duplicate.lotNumber || '?'} of this PO. Use a different batch number.`,
      });
    }

    const totalOrdered = order.items.reduce((s, i) => s + i.quantity, 0);
    const totalReceivedBefore = order.items.reduce((s, i) => s + (i.receivedQty || 0), 0);
    const lotArrivedQty = iir.items.reduce((s, i) => s + i.arrivedQty, 0);
    const isFollowupLot = totalReceivedBefore > 0;
    const lotNumber = (order.qcInspections?.length || 0) + 1;
    const invoiceFileUrl = invoiceFile ? publicUrlFor('invoices', invoiceFile.filename) : null;
    const lotReportFileUrl = lotReportFile ? publicUrlFor('lot-reports', lotReportFile.filename) : null;

    const sourcePRs = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);
    const sourcePRIds = sourcePRs.map((p) => p.id);

    // Auto-create the inspection request (IIR page 1) so QC sees a populated
    // form directly. The PO supplies invoice / DC / gate pass / receipt details.
    const inspectionNumber = await generateSequentialNumber(prisma, 'QC');

    const { updated, inspection } = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.purchaseOrder.update({
        where: { id: req.params.id },
        data: {
          goodsArrived: true,
          goodsArrivedAt: new Date(),
          status: 'QC_PENDING',
        },
        include: ORDER_INCLUDE,
      });

      if (sourcePRIds.length) {
        await tx.purchaseRequest.updateMany({
          where: { id: { in: sourcePRIds } },
          data: { status: 'GOODS_ARRIVED' },
        });
      }

      const createdInspection = await tx.qCInspection.create({
        data: {
          inspectionNumber,
          purchaseOrderId: order.id,
          requestCreatedById: req.user.id,
          invoiceNo: iir.invoiceNo,
          invoiceDate: new Date(iir.invoiceDate),
          dcNo: iir.dcNo || null,
          gatePassNo: iir.gatePassNo || null,
          gatePassType: iir.gatePassType || null,
          probableDateOfReturn: iir.probableDateOfReturn ? new Date(iir.probableDateOfReturn) : null,
          materialReceiptDate: new Date(iir.materialReceiptDate),
          qtyOrdered: totalOrdered,
          qtyReceived: lotArrivedQty, // pre-fill so QC sees what arrived in this lot
          materialCategory: iir.materialCategory || null,
          documentTypes: iir.documentTypes || null,
          lotNumber,
          arrivedQty: lotArrivedQty,
          invoiceFileUrl,
          lotReportFileUrl,
          // Locked-in batch number set by Purchase Officer. Used as ProductBatch.batchNo
          // at inward and shown read-only on QC + Inward forms.
          batchNo: incomingBatchNo,
          items: {
            create: iir.items.map((li) => ({
              purchaseOrderItemId: li.poItemId,
              arrivedQty: li.arrivedQty,
            })),
          },
        },
        include: { items: true },
      });

      return { updated: updatedOrder, inspection: createdInspection };
    });

    const deliveryNote = isFollowupLot
      ? `Lot ${lotNumber} arrived for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName}. ${lotArrivedQty} unit(s) in this lot; ${totalReceivedBefore} previously received of ${totalOrdered} ordered. Please inspect.`
      : `Lot ${lotNumber} (${lotArrivedQty} of ${totalOrdered} units) for order "${order.customName}" (${order.orderNumber}) from ${order.supplierName} has arrived. Please proceed with quality inspection.`;

    await prisma.notification.create({
      data: {
        type: 'INSPECTION_REQUEST',
        title: `Inspection Request ${inspection.inspectionNumber} (Lot ${lotNumber}): ${order.customName}`,
        message: `${deliveryNote} Inspection request ${inspection.inspectionNumber} has been auto-created — please fill the report.`,
        targetRole: 'QC',
        sentById: req.user.id,
      },
    });

    for (const pr of sourcePRs) {
      if (!pr.managerId) continue;
      await prisma.notification.create({
        data: {
          type: 'GOODS_ARRIVED',
          title: `${isFollowupLot ? 'More ' : ''}Goods Arrived (Lot ${lotNumber}): Your PR ${pr.requestNumber}`,
          message: order.isUnion
            ? `Lot ${lotNumber} for Union PO "${order.customName}" (${order.orderNumber}) — your PR ${pr.requestNumber} — has arrived (${lotArrivedQty} unit(s)) and is being inspected.`
            : (isFollowupLot
              ? `Lot ${lotNumber} for "${order.customName}" (${pr.requestNumber}) has arrived: ${lotArrivedQty} unit(s) in this lot, ${totalReceivedBefore} of ${totalOrdered} previously received.`
              : `Lot ${lotNumber} (${lotArrivedQty} of ${totalOrdered}) for your purchase request "${order.customName}" (${pr.requestNumber}) has arrived and is being inspected.`),
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'GOODS_ARRIVED',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber, customName: order.customName,
          lotNumber, lotArrivedQty, batchNumber: incomingBatchNo,
          isFollowupLot, totalReceivedBefore, totalOrdered,
          invoiceFileUrl,
          lotReportFileUrl,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    cleanupUploads();
    if (error?.name === 'ZodError') {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
    console.error('Goods arrived error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/inward — Store Manager does inward entry
router.put('/:id/inward', authenticate, authorize('STORE_MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { items } = req.body; // [{ id, receivedQty, batchNumber? }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items with received quantities are required' });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            allocations: {
              include: {
                purchaseRequestItem: {
                  select: {
                    id: true, productId: true, productName: true, productUnit: true, materialType: true,
                    request: {
                      // createdAt is required for FIFO ordering across source PRs on partial inward.
                      // manager.role lets us attribute non-unit PRs to a department at inward.
                      select: {
                        id: true, requestNumber: true, createdAt: true,
                        unit: { select: { id: true, name: true, code: true } },
                        manager: { select: { role: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        purchaseRequest: {
          select: {
            id: true, requestNumber: true, managerId: true, unitId: true,
            manager: { select: { id: true, name: true, role: true } },
            items: { select: { id: true, productId: true, productName: true, productUnit: true, materialType: true } },
          },
        },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true, unitId: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (order.status !== 'QC_PASSED') {
      return res.status(400).json({ error: 'Inward entry can only be done after QC approval' });
    }

    // Master-data hold (mirrors the Material Inward Register gate): a non-Tools &
    // Fixtures material must have its master data added by a unit head / QC before
    // its stock can be created on this path too. Tools & Fixtures are exempt.
    const inwardItemIds = items.map((i) => i.id);
    const involvedProductIds = [...new Set(
      order.items.filter((i) => inwardItemIds.includes(i.id)).map((i) => i.productId).filter(Boolean),
    )];
    if (involvedProductIds.length) {
      const prods = await prisma.product.findMany({
        where: { id: { in: involvedProductIds } },
        select: { id: true, name: true, category: true, masterDataComplete: true },
      });
      const held = prods.find((p) => p.masterDataComplete === false && normalizeMaterialType(p.category) !== 'Tools & Fixtures');
      if (held) {
        return res.status(400).json({
          error: `On hold: master data not added yet for "${held.name}" — a unit head or QC must add its master data (specs / shelf life) on the Master Data screen before it can be inwarded.`,
        });
      }
    }

    // Find the lot being inwarded: the most recent QC inspection on this PO
    // whose result was finalised (PASSED/PARTIAL). Each "mark goods arrived"
    // creates exactly one inspection, and the workflow guarantees only one
    // active lot reaches QC_PASSED at a time.
    const activeInspection = await prisma.qCInspection.findFirst({
      where: { purchaseOrderId: req.params.id, result: { in: ['PASSED', 'PARTIAL'] } },
      orderBy: { lotNumber: 'desc' },
      select: { id: true, lotNumber: true, invoiceNo: true, qtyAccepted: true, batchNo: true },
    });
    const lotTag = activeInspection?.lotNumber ? ` — Lot ${activeInspection.lotNumber}` : '';
    // Locked batch number: set by Purchase Officer at goods-arrived, never editable downstream.
    // Every ProductBatch row created for this inward gets stamped with this exact identifier.
    const lockedBatchNo = activeInspection?.batchNo || null;

    // Inward qty is locked to whatever QC finalised on the inspection report.
    // Stores Incharge cannot reduce / inflate it — the submitted total must
    // equal QCInspection.qtyAccepted (within float tolerance).
    if (activeInspection?.qtyAccepted != null) {
      const submittedTotal = items.reduce((s, it) => s + (parseFloat(it.receivedQty) || 0), 0);
      if (Math.abs(submittedTotal - activeInspection.qtyAccepted) > 0.01) {
        return res.status(400).json({
          error: `Inward qty (${submittedTotal}) does not match QC-accepted qty (${activeInspection.qtyAccepted}). The inward total is locked to whatever QC finalised — Stores Incharge cannot alter it.`,
        });
      }
    }

    // Auto-generate MIR number (daily reset) on first inward only
    const mirNo = order.mirNo || (await generateMirNumber(prisma));

    const sourcePRs = order.isUnion
      ? (order.sourceRequests || []).map((s) => s.purchaseRequest)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);
    const sourcePRIds = sourcePRs.map((p) => p.id);

    // P2034 = Prisma transaction conflict/deadlock. Retry up to 3 times with
    // exponential backoff + jitter; other errors propagate as before.
    const withInwardRetry = async (fn, attempt = 0) => {
      try { return await fn(); }
      catch (err) {
        if (err?.code === 'P2034' && attempt < 3) {
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt) + Math.random() * 50));
          return withInwardRetry(fn, attempt + 1);
        }
        throw err;
      }
    };
    const updated = await withInwardRetry(() => prisma.$transaction(async (tx) => {
      for (const item of items) {
        const orderItem = order.items.find(i => i.id === item.id);
        if (!orderItem) continue;

        const receivedQty = parseFloat(item.receivedQty) || 0;
        if (receivedQty <= 0) continue;

        // Increment aggregate receivedQty on the PO item (works for both union and non-union)
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: receivedQty } },
        });

        const isUnionItem = orderItem.allocations && orderItem.allocations.length > 0;

        // Build per-allocation share list. For union items, allocate FIFO by source-PR
        // creation date: the PR that was raised earliest gets filled first, then the
        // next, and so on. This is the contract requested by the user — partial lots
        // honour the queue of requesters rather than splitting pro-rata.
        // For non-union items, this is a single synthetic share covering the original
        // purchaseRequestItemId path.
        let shares;
        if (isUnionItem) {
          const sortedAllocations = [...orderItem.allocations].sort((a, b) => {
            const aDate = a.purchaseRequestItem?.request?.createdAt
              ? new Date(a.purchaseRequestItem.request.createdAt).getTime()
              : 0;
            const bDate = b.purchaseRequestItem?.request?.createdAt
              ? new Date(b.purchaseRequestItem.request.createdAt).getTime()
              : 0;
            if (aDate !== bDate) return aDate - bDate;
            // Tie-breaker: earlier allocation (lower createdAt on the allocation row)
            return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
          });

          // Use integer micro-units (×1000) so partial qty across many allocations
          // doesn't drift (e.g. 0.1 + 0.2 ≠ 0.30000000000000004). Convert to floats
          // only at the end when we write each share.
          const toMicro = (n) => Math.round((Number(n) || 0) * 1000);
          const fromMicro = (m) => Math.round(m) / 1000;
          const EPS_MICRO = 1; // 0.001

          let remainingMicro = toMicro(receivedQty);
          const rawShares = [];
          for (const alloc of sortedAllocations) {
            if (remainingMicro <= EPS_MICRO) break;
            const owedMicro = Math.max(0, toMicro(alloc.allocatedQty) - toMicro(alloc.receivedQty || 0));
            if (owedMicro <= 0) continue;
            const giveMicro = Math.min(owedMicro, remainingMicro);
            rawShares.push({ allocation: alloc, share: fromMicro(giveMicro) });
            remainingMicro -= giveMicro;
          }
          // Over-shipment (lot brought more than total still owed): dump the surplus
          // on the last unfilled allocation so the books balance. If every allocation
          // is already full, attribute it to the most recent (last) one.
          if (remainingMicro > EPS_MICRO) {
            if (rawShares.length > 0) {
              const last = rawShares[rawShares.length - 1];
              last.share = fromMicro(toMicro(last.share) + remainingMicro);
            } else if (sortedAllocations.length > 0) {
              rawShares.push({ allocation: sortedAllocations[sortedAllocations.length - 1], share: fromMicro(remainingMicro) });
            }
          }
          shares = rawShares;
        } else {
          shares = [{ allocation: null, share: receivedQty }];
        }

        // Resolve / create the product (shared across allocations — products are global).
        // Carry the PR item's materialType through so NRE products inherit their category
        // and existing products get their category synced on inward.
        let productId = null;
        let prMaterialType = null;
        if (isUnionItem) {
          const firstPrItem = orderItem.allocations[0]?.purchaseRequestItem;
          if (firstPrItem?.productId) productId = firstPrItem.productId;
          prMaterialType = normalizeMaterialType(firstPrItem?.materialType);
        } else if (orderItem.purchaseRequestItemId) {
          const prItem = order.purchaseRequest?.items.find(i => i.id === orderItem.purchaseRequestItemId);
          if (prItem?.productId) productId = prItem.productId;
          prMaterialType = normalizeMaterialType(prItem?.materialType);
        }

        if (!productId) {
          const existing = await tx.product.findFirst({
            where: { name: { equals: orderItem.productName, mode: 'insensitive' }, isActive: true },
          });
          if (existing) productId = existing.id;
        }

        if (!productId) {
          // Defensive: PR now creates NRE products itself, but if a legacy PR or
          // direct PO lands here we still generate a category-prefixed SKU.
          const sku = await generateProductSku(tx, prMaterialType);
          const newProduct = await tx.product.create({
            data: {
              name: orderItem.productName,
              sku,
              unit: orderItem.productUnit || 'pcs',
              category: prMaterialType,
              currentStock: 0,
              isActive: true,
            },
          });
          productId = newProduct.id;

          if (isUnionItem) {
            const prItemIds = orderItem.allocations
              .map((a) => a.purchaseRequestItem?.id)
              .filter(Boolean);
            if (prItemIds.length) {
              await tx.purchaseRequestItem.updateMany({
                where: { id: { in: prItemIds } },
                data: { productId },
              });
            }
          } else if (orderItem.purchaseRequestItemId) {
            await tx.purchaseRequestItem.update({
              where: { id: orderItem.purchaseRequestItemId },
              data: { productId },
            });
          }
        }

        // Sync category from PR materialType if missing or different.
        // Existing category takes precedence only if it matches the PR type.
        const existingProduct = await tx.product.findUnique({
          where: { id: productId }, select: { category: true },
        });
        if (existingProduct && existingProduct.category !== prMaterialType) {
          await tx.product.update({
            where: { id: productId },
            data: { category: prMaterialType },
          });
        }

        // One Product stock update for the aggregate received qty
        await tx.product.update({
          where: { id: productId },
          data: { currentStock: { increment: receivedQty } },
        });

        // One stock movement + batch per share so the audit trail attributes each unit's slice.
        // Also increment per-unit stock (Phase 6) using the owning PR's unitId so material is
        // indented only to the requesting unit.
        for (const { allocation, share } of shares) {
          if (share <= 0) continue;
          // The Prisma relation on PurchaseRequestItem is `request` (not `purchaseRequest`);
          // using the wrong name left union POs with no unit/department attribution.
          const prRef = allocation?.purchaseRequestItem?.request;
          const unitTag = prRef?.unit?.code ? ` [${prRef.unit.code}]` : '';
          const prTag = prRef?.requestNumber ? ` — ${prRef.requestNumber}` : '';

          // Owning unit for this slice: union → from allocation's PR; single → from PO's PR
          const owningUnitId = allocation
            ? prRef?.unit?.id || null
            : order.purchaseRequest?.unitId || null;

          // No owning unit → this PR was raised by a non-unit department (QC, Designs,
          // Safety, Lab, Metrology, NDT, Planning, Stores). Attribute the batch to that
          // department so the product list shows "owned by <Dept>" instead of "Unassigned".
          const raiserRole = allocation
            ? prRef?.manager?.role
            : order.purchaseRequest?.manager?.role;
          const assignedDept = owningUnitId ? null : (DEPT_BY_ROLE[raiserRole] || null);

          const movement = await tx.stockMovement.create({
            data: {
              productId,
              type: 'IN',
              quantity: share,
              referenceType: 'PurchaseOrder',
              referenceId: order.id,
              notes: `PO ${order.orderNumber} — ${order.supplierName}${prTag}${unitTag} (MIR ${mirNo})`,
              performedBy: req.user.id,
              unitId: owningUnitId,
            },
          });

          await tx.productBatch.create({
            data: {
              productId,
              receivedDate: new Date(),
              quantity: share,
              remaining: share,
              // Locked batch number from the QC inspection — same identifier across PO,
              // QC, Inward, MIV, FIFO. Client-supplied batch numbers are intentionally
              // ignored here so no one downstream can change the lot's identity.
              batchNo: lockedBatchNo,
              referenceType: 'PurchaseOrder',
              referenceId: movement.id,
              notes: `PO ${order.orderNumber}${lotTag} — ${orderItem.productName}${prTag}${unitTag} (MIR ${mirNo})`,
              createdById: req.user.id,
              sourceQcInspectionId: activeInspection?.id || null,
              // Department ownership for non-unit PRs (null when indented to a unit).
              assignedDept,
            },
          });

          if (allocation) {
            await tx.purchaseOrderItemAllocation.update({
              where: { id: allocation.id },
              data: { receivedQty: { increment: share } },
            });
          }

          // Phase 6: per-unit stock update
          if (owningUnitId) {
            await tx.productUnitStock.upsert({
              where: { productId_unitId: { productId, unitId: owningUnitId } },
              update: { quantity: { increment: share } },
              create: { productId, unitId: owningUnitId, quantity: share },
            });
          }

          // Department reservation: when this share belongs to a non-unit department,
          // reserve the qty in ProductDeptStock so only that department can issue it.
          if (assignedDept) {
            await tx.productDeptStock.upsert({
              where: { productId_dept: { productId, dept: assignedDept } },
              update: { quantity: { increment: share } },
              create: { productId, dept: assignedDept, quantity: share },
            });
          }
        }
      }

      // PO closes only when every line is fully received. Partial inwards keep
      // the PO open (status PARTIAL) so the next batch can still be inwarded.
      const refreshedItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: req.params.id },
      });
      const allFullyReceived = refreshedItems.every(i => i.receivedQty >= i.quantity);

      let result;
      if (allFullyReceived) {
        result = await tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: 'INWARD_DONE', mirNo, inwardedAt: new Date() },
          include: ORDER_INCLUDE,
        });
        if (sourcePRIds.length) {
          // Close a source PR only when every PO referencing it is fully received.
          // A PR may have spawned multiple POs (one per product) — wait for all.
          for (const prId of sourcePRIds) {
            const siblingOrders = await tx.purchaseOrder.findMany({
              where: {
                OR: [
                  { purchaseRequestId: prId },
                  { sourceRequests: { some: { purchaseRequestId: prId } } },
                ],
              },
              include: { items: true },
            });
            const everyOrderDone = siblingOrders.every(o =>
              o.id === req.params.id
                ? true
                : o.items.every(i => i.receivedQty >= i.quantity)
            );
            if (everyOrderDone) {
              await tx.purchaseRequest.update({
                where: { id: prId },
                data: { status: 'INWARD_DONE' },
              });
            }
          }
        }
      } else {
        // Partial delivery: keep PO open as PARTIAL with goodsArrived cleared
        // so the next batch can be marked arrived. MIR persists across batches.
        result = await tx.purchaseOrder.update({
          where: { id: req.params.id },
          data: { status: 'PARTIAL', goodsArrived: false, mirNo },
          include: ORDER_INCLUDE,
        });
      }

      return { result, allFullyReceived, refreshedItems };
    }));

    const { result: updatedOrder, allFullyReceived, refreshedItems } = updated;
    const totalReceived = refreshedItems.reduce((s, i) => s + i.receivedQty, 0);
    const totalOrdered = refreshedItems.reduce((s, i) => s + i.quantity, 0);

    for (const pr of sourcePRs) {
      if (!pr.managerId) continue;
      const inwardMsg = allFullyReceived
        ? (order.isUnion
          ? `All items for Union PO "${order.customName}" (${order.orderNumber}) — your PR ${pr.requestNumber} — have been received and entered into stores. Please send MIV to collect your items.`
          : `All items for order "${order.customName}" (${pr.requestNumber}) have been received and entered into stores. Please send MIV to collect your items.`)
        : (order.isUnion
          ? `Partial delivery for Union PO "${order.customName}" (${order.orderNumber}): ${totalReceived} of ${totalOrdered} items received. Your PR ${pr.requestNumber} share has been incremented pro-rata. Remaining items will follow.`
          : `Partial delivery: ${totalReceived} of ${totalOrdered} items for order "${order.customName}" (${pr.requestNumber}) have been received. Remaining items will follow.`);
      await prisma.notification.create({
        data: {
          type: 'INWARD_COMPLETE',
          title: `${allFullyReceived ? 'All ' : 'Partial '}Items Received: ${order.customName}`,
          message: inwardMsg,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }

    if (!allFullyReceived) {
      await prisma.notification.create({
        data: {
          type: 'PARTIAL_DELIVERY',
          title: `Partial Delivery: ${order.customName}`,
          message: `${totalReceived} of ${totalOrdered} items received for "${order.customName}" (${order.orderNumber}). Order remains open as PARTIAL — mark goods arrived again when the next batch reaches stores.`,
          targetRole: 'PURCHASE_OFFICER',
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'INWARD_ENTRY',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          customName: order.customName,
          itemsReceived: items.length,
          allFullyReceived,
          totalReceived,
          totalOrdered,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updatedOrder);
  } catch (error) {
    console.error('Inward entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/place-order — PO places the approved order by sending a payment request to accounting
const placeOrderSchema = z.object({
  paymentType: z.enum(['ADVANCE', 'PARTIAL', 'FINAL']),
  // Taxable (basic) value; `taxPercent` is added on top for the payable figure.
  amount: z.number().positive(),
  taxPercent: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
  delayNote: z.string().optional(),
});

router.post('/:id/place-order', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const data = placeOrderSchema.parse(req.body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: true,
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (isUnnumbered(order)) return res.status(400).json({ error: NEEDS_NUMBER_ERROR });
    if (order.status !== 'PENDING_ACCOUNTING') {
      return res.status(400).json({ error: 'Order can only be placed when it is pending accounting approval' });
    }

    const outstanding = order.totalAmount - order.totalPaid;
    if (data.amount > outstanding + 0.01) {
      return res.status(400).json({ error: `Requested amount exceeds outstanding balance (₹${outstanding.toLocaleString('en-IN')})` });
    }

    // 48-hour placement SLA — measured from when the PO became "awaiting placement"
    // (createdAt). Past 48h, the Purchase Officer MUST record why it was delayed.
    const SLA_48H = 48 * 60 * 60 * 1000;
    const placementLate = order.createdAt && (Date.now() - new Date(order.createdAt).getTime()) > SLA_48H;
    if (placementLate && !data.delayNote?.trim()) {
      return res.status(400).json({ error: 'This order is past the 48-hour placement SLA. Please provide a delay remark explaining why.' });
    }
    if (data.delayNote?.trim()) {
      const check = validateReason(data.delayNote, { fieldLabel: 'delay remark' });
      if (!check.ok) return res.status(400).json({ error: check.error });
    }

    const tax = computeTax(data.amount, data.taxPercent);

    const paymentNumber = await generateSequentialNumber(prisma, 'PAY');
    const paymentRequest = await prisma.paymentRequest.create({
      data: {
        paymentNumber,
        purchaseOrderId: order.id,
        amount: data.amount,
        taxPercent: tax.taxPercent,
        taxAmount: tax.taxAmount,
        payableAmount: tax.payableAmount,
        paymentType: data.paymentType,
        notes: data.notes || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });

    // Persist the delay remark on the order (already validated against the SLA above).
    if (data.delayNote?.trim()) {
      await prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { delayNote: data.delayNote.trim() },
      });
    }

    await prisma.notification.create({
      data: {
        type: 'PAYMENT_REQUEST',
        title: `Payment Request: ${order.customName}`,
        message: `New ${data.paymentType.toLowerCase()} payment request of ₹${tax.payableAmount.toLocaleString('en-IN')}${tax.taxPercent ? ` (basic ₹${data.amount.toLocaleString('en-IN')} + ${tax.taxPercent}% tax ₹${tax.taxAmount.toLocaleString('en-IN')})` : ''} for order "${order.customName}" (${order.orderNumber}). Supplier: ${order.supplierName}. Please approve to send to Accounting.`,
        targetRole: 'ADMIN',
        sentById: req.user.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'PLACE_ORDER',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          customName: order.customName,
          paymentNumber,
          paymentType: data.paymentType,
          amount: data.amount,
          taxPercent: tax.taxPercent,
          taxAmount: tax.taxAmount,
          payableAmount: tax.payableAmount,
        },
        ipAddress: req.ip,
      },
    });

    res.status(201).json({ message: 'Order placed. Awaiting accounting approval.', paymentRequest });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Place order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/items/:itemId/status — PO updates per-item procurement status
const itemStatusSchema = z.object({
  itemStatus: z.enum(['WAITING', 'ORDERED', 'ON_THE_WAY', 'RECEIVED', 'CANCELLED']),
});

router.put('/:id/items/:itemId/status', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { itemStatus } = itemStatusSchema.parse(req.body);

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: { include: { allocations: true } },
        purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, requestNumber: true, managerId: true } } },
        },
      },
    });

    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    const item = order.items.find((i) => i.id === req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found on this order' });

    if (!['ORDERED', 'PLACED', 'ADVANCE_PAID', 'PAYMENT_PENDING', 'PAID', 'GOODS_ARRIVED'].includes(order.status)) {
      return res.status(400).json({ error: 'Item status can only be updated on active orders' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: {
          itemStatus,
          statusUpdatedAt: new Date(),
          statusUpdatedBy: req.user.id,
        },
      });
      if (item.allocations && item.allocations.length > 0) {
        const prItemIds = item.allocations.map((a) => a.purchaseRequestItemId);
        await tx.purchaseRequestItem.updateMany({
          where: { id: { in: prItemIds } },
          data: { itemStatus },
        });
      } else if (item.purchaseRequestItemId) {
        await tx.purchaseRequestItem.update({
          where: { id: item.purchaseRequestItemId },
          data: { itemStatus },
        });
      }
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'UPDATE_ITEM_STATUS',
        entity: 'PurchaseOrderItem',
        entityId: item.id,
        details: {
          orderNumber: order.orderNumber,
          productName: item.productName,
          previousStatus: item.itemStatus,
          newStatus: itemStatus,
        },
        ipAddress: req.ip,
      },
    });

    if (itemStatus === 'ON_THE_WAY' || itemStatus === 'RECEIVED') {
      const recipients = order.isUnion
        ? (order.sourceRequests || []).map((s) => s.purchaseRequest).filter((p) => p?.managerId)
        : (order.purchaseRequest?.managerId ? [order.purchaseRequest] : []);
      for (const pr of recipients) {
        await prisma.notification.create({
          data: {
            type: 'ITEM_STATUS_UPDATE',
            title: `${item.productName} is ${itemStatus === 'ON_THE_WAY' ? 'on the way' : 'received'}`,
            message: `Item "${item.productName}" on order "${order.customName}" (${pr.requestNumber}) is now ${itemStatus.replace('_', ' ').toLowerCase()}.`,
            targetUserId: pr.managerId,
            sentById: req.user.id,
          },
        });
      }
    }

    const refreshed = await prisma.purchaseOrder.findUnique({
      where: { id: order.id },
      include: ORDER_INCLUDE,
    });
    res.json(refreshed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Update item status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/po-document — PO uploads the signed PO PDF.
// Replaces any previously-uploaded copy and deletes the old file from disk.
router.post('/:id/po-document', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), acceptPoDocument, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PO PDF is required' });

    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) {
      unlinkPublicFile(publicUrlFor('po-docs', req.file.filename));
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    // The signed PDF carries the PO number on its face, so there is nothing
    // sensible to upload before the number exists.
    if (isUnnumbered(order)) {
      unlinkPublicFile(publicUrlFor('po-docs', req.file.filename));
      return res.status(400).json({ error: NEEDS_NUMBER_ERROR });
    }

    const newUrl = publicUrlFor('po-docs', req.file.filename);

    // If a PO PDF already existed, remove the old file before overwriting the DB pointer.
    if (order.poDocumentUrl) unlinkPublicFile(order.poDocumentUrl);

    const updated = await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { poDocumentUrl: newUrl },
      include: ORDER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: order.poDocumentUrl ? 'PO_DOC_REPLACED' : 'PO_DOC_UPLOADED',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: { orderNumber: order.orderNumber, filename: req.file.originalname },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Upload PO document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/purchase-orders/:id/po-document — PO removes the uploaded PDF entirely.
router.delete('/:id/po-document', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });
    if (!order.poDocumentUrl) return res.status(400).json({ error: 'No PO document uploaded' });

    unlinkPublicFile(order.poDocumentUrl);

    const updated = await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: { poDocumentUrl: null },
      include: ORDER_INCLUDE,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'PO_DOC_DELETED',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: { orderNumber: order.orderNumber },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Delete PO document error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/purchase-orders/:id/close — Purchase Officer manually closes a PO.
//
// Two outcomes:
//   1. Clean close: every item fully received AND fully paid → status COMPLETED.
//   2. Force close (body.force=true): unreceived qty / unpaid balance is OK;
//      leftover PR items get cancelled and the PO is marked CLOSED + forceClosed.
//
// If the PO is incomplete and `force` is not set, returns 409 with the pending
// summary so the client can render a confirmation dialog ("X kg short, ₹Y unpaid
// — close anyway?").
const closeSchema = z.object({
  force: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

router.post('/:id/close', authenticate, authorize('PURCHASE_OFFICER', 'ADMIN'), async (req, res) => {
  try {
    const { force, reason } = closeSchema.parse(req.body || {});

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: { allocations: { select: { purchaseRequestItemId: true, allocatedQty: true, receivedQty: true } } },
        },
        paymentRequests: { select: { status: true, amount: true } },
        purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } },
        sourceRequests: {
          include: { purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    if (['COMPLETED', 'CLOSED'].includes(order.status)) {
      return res.status(400).json({ error: 'Purchase order is already closed' });
    }

    // Compute what's still pending.
    const pendingItems = order.items
      .filter(i => i.receivedQty < i.quantity)
      .map(i => ({
        purchaseOrderItemId: i.id,
        productName: i.productName,
        productUnit: i.productUnit,
        ordered: i.quantity,
        received: i.receivedQty,
        shortQty: Number((i.quantity - i.receivedQty).toFixed(3)),
      }));
    const paymentRemaining = Number((order.totalAmount - order.totalPaid).toFixed(2));
    const hasOpenPayment = order.paymentRequests.some(p => p.status === 'PENDING' || p.status === 'APPROVED');

    const isComplete = pendingItems.length === 0 && paymentRemaining <= 0.01 && !hasOpenPayment;

    if (!isComplete && !force) {
      return res.status(409).json({
        error: 'Purchase order is not complete',
        pendingItems,
        paymentRemaining: paymentRemaining > 0.01 ? paymentRemaining : 0,
        openPaymentRequests: hasOpenPayment,
      });
    }

    // Linked PR ids (for force-close cancellation + notifications).
    const linkedPRs = order.isUnion
      ? order.sourceRequests.map(s => s.purchaseRequest).filter(Boolean)
      : (order.purchaseRequest ? [order.purchaseRequest] : []);

    // PR-item ids whose ordered qty is still short on this PO. These get
    // cancelled on force-close so the PR can close out without waiting forever.
    const leftoverPRItemIds = [];
    if (!isComplete && force) {
      for (const poItem of order.items) {
        if (poItem.receivedQty >= poItem.quantity) continue;
        if (order.isUnion && poItem.allocations?.length) {
          for (const a of poItem.allocations) {
            if (a.receivedQty < a.allocatedQty) leftoverPRItemIds.push(a.purchaseRequestItemId);
          }
        } else if (poItem.purchaseRequestItemId) {
          leftoverPRItemIds.push(poItem.purchaseRequestItemId);
        }
      }
    }

    const finalStatus = isComplete ? 'COMPLETED' : 'CLOSED';

    const updated = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          status: finalStatus,
          closedAt: new Date(),
          closedById: req.user.id,
          closeReason: reason || (isComplete ? 'Clean close — fully received and paid' : 'Force closed with pending items/payment'),
          forceClosed: !isComplete,
        },
        include: ORDER_INCLUDE,
      });

      if (!isComplete && leftoverPRItemIds.length > 0) {
        await cancelLeftoverPRItems(tx, [...new Set(leftoverPRItemIds)], reason || 'PO force-closed');
      }

      return po;
    });

    // Notifications — managers (for each source PR), store manager team, and admins.
    const closeKindLabel = isComplete ? 'closed (fully received & paid)' : 'force-closed';
    for (const pr of linkedPRs) {
      if (!pr.managerId) continue;
      await prisma.notification.create({
        data: {
          type: isComplete ? 'PO_CLOSED' : 'PO_FORCE_CLOSED',
          title: `Purchase order ${order.orderNumber} ${closeKindLabel}`,
          message: isComplete
            ? `PO "${order.customName}" (${order.orderNumber}) on your PR ${pr.requestNumber} has been closed cleanly.`
            : `PO "${order.customName}" (${order.orderNumber}) on your PR ${pr.requestNumber} was force-closed. Any remaining qty on the PR has been cancelled.${reason ? ' Reason: ' + reason : ''}`,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      });
    }
    await prisma.notification.create({
      data: {
        type: isComplete ? 'PO_CLOSED' : 'PO_FORCE_CLOSED',
        title: `PO ${order.orderNumber} ${closeKindLabel}`,
        message: `${order.customName} (${order.orderNumber}) ${closeKindLabel} by ${req.user.name}. Supplier: ${order.supplierName}.`,
        targetRole: 'STORE_MANAGER',
        sentById: req.user.id,
      },
    });
    if (!isComplete) {
      await prisma.notification.create({
        data: {
          type: 'PO_FORCE_CLOSED',
          title: `PO ${order.orderNumber} force-closed`,
          message: `${order.customName} (${order.orderNumber}) was force-closed by ${req.user.name} with ${pendingItems.length} item(s) short and ₹${paymentRemaining.toLocaleString('en-IN')} unpaid.${reason ? ' Reason: ' + reason : ''}`,
          targetRole: 'ADMIN',
          sentById: req.user.id,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: isComplete ? 'CLOSE_PO' : 'FORCE_CLOSE_PO',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          forceClosed: !isComplete,
          pendingItems,
          paymentRemaining,
          cancelledPRItemIds: leftoverPRItemIds,
          reason: reason || null,
        },
        ipAddress: req.ip,
      },
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Close PO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/purchase-orders/:id/po-creation-delay-remark — PO officer submits remark for SLA-delayed PO creation
router.put('/:id/po-creation-delay-remark', authenticate, authorize('PURCHASE_OFFICER'), async (req, res) => {
  try {
    const { remark } = req.body;
    if (!remark?.trim()) return res.status(400).json({ error: 'Remark is required' });
    const check = validateReason(remark, { fieldLabel: 'delay remark' });
    if (!check.ok) return res.status(400).json({ error: check.error });

    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    const updated = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data: { poCreationDelayRemark: remark.trim() },
    });
    res.json(updated);
  } catch (error) {
    console.error('PO creation delay remark error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ──── PATCH /api/purchase-orders/:id/assign-number ────
//
// Turns a numberless draft into a real purchase order. Purchase supply the
// financial year and the running count; the RAPS/PO/ prefix and the shape are
// fixed so the number stays parseable by everything that derives from it (batch
// numbers, the register, the re-numbering cascade below).
//
// Nothing is suggested-and-committed here: the count the form pre-fills is only
// a hint. Purchase are copying the number off their own PO register, so gaps and
// out-of-order numbers are legitimate. The only hard rule is that no two orders
// may carry the same number — enforced by the unique index, checked up front so
// the user gets a readable message instead of a constraint error.
//
// Assigning is one-way: once a number exists this route refuses, and corrections
// go through the re-numbering route below, which carries the change into every
// downstream copy of the number.
const assignNumberSchema = z.object({
  fy: z.string().trim().optional(),
  count: z.coerce.number().int().min(1, 'Number must be at least 1').max(999999, 'Number is too large'),
});

router.patch('/:id/assign-number', authenticate, authorizePoNumberAssign, async (req, res) => {
  try {
    const { fy: rawFy, count } = assignNumberSchema.parse(req.body || {});
    const fy = rawFy || getFinancialYear();
    if (!isValidFinancialYear(fy)) {
      return res.status(400).json({ error: 'Financial year must be two consecutive years, e.g. 26-27.' });
    }

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, orderNumber: true, customName: true, supplierName: true, totalAmount: true,
        purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } },
        sourceRequests: {
          select: { purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    if (order.orderNumber) {
      return res.status(409).json({
        error: `This order is already numbered ${order.orderNumber}. Use "Change PO number" to correct it.`,
      });
    }

    const orderNumber = buildPoNumber(fy, count);
    const clash = await prisma.purchaseOrder.findFirst({
      where: { orderNumber },
      select: { id: true, customName: true, supplierName: true },
    });
    if (clash) {
      return res.status(409).json({
        error: `${orderNumber} is already used by another purchase order ("${clash.customName}" — ${clash.supplierName}). Pick a different number.`,
      });
    }

    const updated = await prisma.purchaseOrder.update({
      where: { id: order.id },
      data: {
        orderNumber,
        numberAssignedAt: new Date(),
        numberAssignedById: req.user.id,
      },
      include: ORDER_INCLUDE,
    });

    // Tell each source PR's raiser their request now has a PO number to quote.
    const linkedPRs = [
      ...(order.purchaseRequest ? [order.purchaseRequest] : []),
      ...order.sourceRequests.map((s) => s.purchaseRequest).filter(Boolean),
    ].filter((pr, i, arr) => arr.findIndex((x) => x.id === pr.id) === i);

    for (const pr of linkedPRs) {
      if (!pr.managerId) continue;
      await prisma.notification.create({
        data: {
          type: 'PO_NUMBER_ASSIGNED',
          title: `PO number issued: ${orderNumber}`,
          message: `Your purchase request ${pr.requestNumber} is now covered by purchase order ${orderNumber} ("${order.customName}", ${order.supplierName}). Quote this number on any correspondence about the order.`,
          targetUserId: pr.managerId,
          sentById: req.user.id,
        },
      }).catch(() => {});
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'ASSIGN_PO_NUMBER',
        entity: 'PurchaseOrder',
        entityId: order.id,
        details: {
          orderNumber,
          fy,
          count,
          customName: order.customName,
          supplierName: order.supplierName,
          totalAmount: order.totalAmount,
        },
        ipAddress: req.ip,
      },
    }).catch((err) => console.error('[PO ASSIGN NUMBER AUDIT FAIL]', err?.code, err?.message));

    res.json({ order: updated, orderNumber });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'That purchase order number was just taken. Pick a different number.' });
    }
    console.error('Assign PO number error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TEMPORARY FEATURE — PO RE-NUMBERING. REMOVE WHEN THE ROLLOUT IS OVER.
// ════════════════════════════════════════════════════════════════════════════
// PATCH /api/purchase-orders/:id/order-number
//
// Purchase is still reconciling the old manual PO register against the system,
// so they may correct the running COUNT on a PO number. The shape is fixed:
// RAPS/PO/<FY>/<n> — the prefix and financial year come from the number the PO
// already has and are never editable; only <n> changes.
//
// The PO number is denormalised into a handful of places, so a rename has to
// carry into all of them or the two halves of the system stop agreeing:
//
//   • Batch numbers derived from it (RAPS/PO/26-27/101-B1 → …/55-B1). These are
//     the lot's identity across QCInspection.batchNo, ProductBatch.batchNo,
//     StockMovement.batchNumber, RequestItem.materialBatchNo (MIV lines) and
//     MaterialInwardRegister.batchNo — all five move together or FIFO, MIV
//     matching and the inward register break apart. Batch numbers that were
//     typed by hand (i.e. don't start with the old PO number) are left alone.
//   • StockMovement.notes / ProductBatch.notes, which embed "PO <number> — …".
//   • Notification titles/messages that quote the number.
//
// Deliberately NOT rewritten: AuditLog.details — an audit trail records what was
// true at the time and must not be retconned. The rename is itself audit-logged
// and recorded in PurchaseOrderNumberHistory.
//
// Everything else (PR chain, payment requests, QC, inward register, dashboards,
// exports, PDFs) reads the number through a relation, so it follows on its own.
//
// NOTE: already-printed stickers and paperwork keep the OLD batch number. That
// was an accepted trade-off when this was requested — the system is treated as
// the source of truth and physical labels are re-printed as needed.

const renumberSchema = z.object({
  count: z.coerce.number().int().min(1, 'Number must be at least 1').max(999999, 'Number is too large'),
  reason: z.string().trim().min(1, 'Reason is required').max(500),
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches the PO number only where it isn't followed by another digit, so
// renaming "RAPS/PO/26-27/10" never chews into "RAPS/PO/26-27/101".
const poNumberOccurrenceRe = (poNumber) => new RegExp(`${escapeRe(poNumber)}(?!\\d)`, 'g');

// True when `batch` is a batch number derived from `poNumber` (e.g. "<po>-B1")
// or the bare number itself — and not a longer, unrelated PO's batch.
const isDerivedBatch = (batch, poNumber) =>
  !!batch && new RegExp(`^${escapeRe(poNumber)}(?!\\d)`).test(String(batch).trim());

router.patch('/:id/order-number', authenticate, authorizePoNumberEdit, async (req, res) => {
  try {
    const { count, reason } = renumberSchema.parse(req.body || {});

    const check = validateReason(reason, { fieldLabel: 'reason for changing the PO number' });
    if (!check.ok) return res.status(400).json({ error: check.error });

    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, orderNumber: true, customName: true, supplierName: true,
        purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } },
        sourceRequests: {
          select: { purchaseRequest: { select: { id: true, managerId: true, requestNumber: true } } },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Purchase order not found' });

    const oldNumber = order.orderNumber;
    if (!oldNumber) {
      return res.status(400).json({
        error: 'This order has no PO number yet — fill it in first, then it can be corrected here.',
      });
    }
    const parsed = parsePoNumber(oldNumber);
    if (!parsed) {
      return res.status(400).json({
        error: `"${oldNumber}" is not in the RAPS/PO/<FY>/<number> format, so its number can't be changed here.`,
      });
    }
    if (parsed.count === count) {
      return res.status(400).json({ error: `This purchase order is already numbered ${oldNumber}.` });
    }

    const newNumber = buildPoNumber(parsed.fy, count);
    const clash = await prisma.purchaseOrder.findFirst({
      where: { orderNumber: newNumber, id: { not: order.id } },
      select: { id: true, customName: true },
    });
    if (clash) {
      return res.status(409).json({
        error: `${newNumber} is already used by another purchase order ("${clash.customName}"). Pick a different number.`,
      });
    }

    // A fresh regex per call — poNumberOccurrenceRe is global, so a shared
    // instance would carry lastIndex across calls and match inconsistently.
    const rename = (text) => (text ? String(text).replace(poNumberOccurrenceRe(oldNumber), newNumber) : text);

    // ── Gather every record carrying a copy of the number, before touching anything ──
    const [inspections, movements, inwardRows] = await Promise.all([
      prisma.qCInspection.findMany({
        where: { purchaseOrderId: order.id },
        select: { id: true, batchNo: true },
      }),
      prisma.stockMovement.findMany({
        where: { referenceType: 'PurchaseOrder', referenceId: order.id },
        select: { id: true, batchNumber: true, notes: true },
      }),
      prisma.materialInwardRegister.findMany({
        where: { purchaseOrderId: order.id },
        select: { id: true, batchNo: true },
      }),
    ]);

    // ProductBatch rows point at the StockMovement that created them, not the PO.
    const batches = movements.length
      ? await prisma.productBatch.findMany({
        where: { referenceType: 'PurchaseOrder', referenceId: { in: movements.map((m) => m.id) } },
        select: { id: true, batchNo: true, notes: true },
      })
      : [];

    // old batch number → new batch number, for every batch derived from this PO.
    const batchMap = new Map();
    const noteDerived = (value) => {
      if (isDerivedBatch(value, oldNumber) && !batchMap.has(value)) {
        batchMap.set(value, rename(value));
      }
    };
    inspections.forEach((i) => noteDerived(i.batchNo));
    movements.forEach((m) => noteDerived(m.batchNumber));
    batches.forEach((b) => noteDerived(b.batchNo));
    inwardRows.forEach((r) => noteDerived(r.batchNo));

    const oldBatchNos = [...batchMap.keys()];

    // MIV lines are matched to a lot purely by the batch string — no PO link —
    // so they're found through the batch map rather than through the order.
    const mivItems = oldBatchNos.length
      ? await prisma.requestItem.findMany({
        where: { materialBatchNo: { in: oldBatchNos } },
        select: { id: true, materialBatchNo: true },
      })
      : [];

    const cascade = {
      qcInspections: 0,
      productBatches: 0,
      stockMovements: 0,
      mivItems: 0,
      inwardRows: 0,
      batchNumbers: batchMap.size,
      notifications: 0,
    };

    const { updated, historyId } = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { orderNumber: newNumber },
      });

      for (const insp of inspections) {
        if (!batchMap.has(insp.batchNo)) continue;
        await tx.qCInspection.update({
          where: { id: insp.id },
          data: { batchNo: batchMap.get(insp.batchNo) },
        });
        cascade.qcInspections++;
      }

      for (const mv of movements) {
        const data = {};
        if (batchMap.has(mv.batchNumber)) data.batchNumber = batchMap.get(mv.batchNumber);
        const notes = rename(mv.notes);
        if (notes !== mv.notes) data.notes = notes;
        if (!Object.keys(data).length) continue;
        await tx.stockMovement.update({ where: { id: mv.id }, data });
        cascade.stockMovements++;
      }

      for (const b of batches) {
        const data = {};
        if (batchMap.has(b.batchNo)) data.batchNo = batchMap.get(b.batchNo);
        const notes = rename(b.notes);
        if (notes !== b.notes) data.notes = notes;
        if (!Object.keys(data).length) continue;
        await tx.productBatch.update({ where: { id: b.id }, data });
        cascade.productBatches++;
      }

      for (const mi of mivItems) {
        await tx.requestItem.update({
          where: { id: mi.id },
          data: { materialBatchNo: batchMap.get(mi.materialBatchNo) },
        });
        cascade.mivItems++;
      }

      for (const row of inwardRows) {
        if (!batchMap.has(row.batchNo)) continue;
        await tx.materialInwardRegister.update({
          where: { id: row.id },
          data: { batchNo: batchMap.get(row.batchNo) },
        });
        cascade.inwardRows++;
      }

      const history = await tx.purchaseOrderNumberHistory.create({
        data: {
          purchaseOrderId: order.id,
          fromNumber: oldNumber,
          toNumber: newNumber,
          reason: check.cleaned || reason.trim(),
          cascade,
          changedById: req.user.id,
          changedByName: req.user.name || null,
          changedByRole: req.user.role || null,
        },
      });

      // Read back only after the cascade, so the caller gets the renamed batch
      // numbers on the QC inspections rather than the pre-rename ones.
      const po = await tx.purchaseOrder.findUnique({
        where: { id: order.id },
        include: ORDER_INCLUDE,
      });

      return { updated: po, historyId: history.id };
    }, { maxWait: 10000, timeout: 30000 });

    // ── Post-commit, best-effort: rewrite the number where it was quoted in text ──
    // Notifications are a running commentary, not an audit record, so a stale
    // number there just misleads. Scoped by `contains` then re-checked with the
    // digit-boundary regex so a shorter number can't match a longer one.
    try {
      const stale = await prisma.notification.findMany({
        where: { OR: [{ title: { contains: oldNumber } }, { message: { contains: oldNumber } }] },
        select: { id: true, title: true, message: true },
      });
      for (const n of stale) {
        const title = rename(n.title);
        const message = rename(n.message);
        if (title === n.title && message === n.message) continue;
        await prisma.notification.update({ where: { id: n.id }, data: { title, message } });
        cascade.notifications++;
      }
      if (cascade.notifications) {
        await prisma.purchaseOrderNumberHistory.update({
          where: { id: historyId },
          data: { cascade },
        });
      }
    } catch (err) {
      console.error('[PO RENUMBER NOTIFICATION REWRITE FAIL]', err?.code, err?.message);
    }

    // Tell the people who work off the number that it moved. Stores hold the
    // material, QC hold the inspection, and each source PR's raiser tracks it.
    const linkedPRs = [
      ...(order.purchaseRequest ? [order.purchaseRequest] : []),
      ...order.sourceRequests.map((s) => s.purchaseRequest).filter(Boolean),
    ].filter((pr, i, arr) => arr.findIndex((x) => x.id === pr.id) === i);

    const changeLine = `Purchase order "${order.customName}" (${order.supplierName}) has been renumbered from ${oldNumber} to ${newNumber} by ${req.user.name}. Reason: ${check.cleaned || reason.trim()}`;
    const batchLine = batchMap.size
      ? ` ${batchMap.size} batch number(s) derived from it were updated to match.`
      : '';

    const targets = [
      { targetRole: 'STORE_MANAGER' },
      ...(inspections.length ? [{ targetRole: 'QC' }] : []),
      ...linkedPRs.filter((pr) => pr.managerId).map((pr) => ({ targetUserId: pr.managerId })),
    ];
    for (const target of targets) {
      await prisma.notification.create({
        data: {
          type: 'PO_RENUMBERED',
          title: `PO renumbered: ${oldNumber} → ${newNumber}`,
          message: `${changeLine}.${batchLine} Please use the new number from now on.`,
          sentById: req.user.id,
          ...target,
        },
      }).catch(() => {});
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'RENUMBER_PO',
        entity: 'PurchaseOrder',
        entityId: order.id,
        // The old number is kept verbatim here — audit rows are never rewritten
        // by the cascade, so this stays a true record of what the PO was called.
        details: {
          fromNumber: oldNumber,
          toNumber: newNumber,
          orderNumber: newNumber,
          reason: check.cleaned || reason.trim(),
          cascade,
          renamedBatchNumbers: Object.fromEntries(batchMap),
        },
        ipAddress: req.ip,
      },
    }).catch((err) => console.error('[PO RENUMBER AUDIT FAIL]', err?.code, err?.message));

    res.json({ order: updated, fromNumber: oldNumber, toNumber: newNumber, cascade });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors?.[0]?.message || 'Invalid input', details: error.errors });
    }
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'That purchase order number is already taken. Pick a different number.' });
    }
    console.error('Renumber PO error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// ════════════════ END TEMPORARY FEATURE — PO RE-NUMBERING ═══════════════════

module.exports = router;
